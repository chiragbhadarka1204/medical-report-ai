"""
Document upload and extraction routes.
"""
import os
import uuid
from flask import Blueprint, request, jsonify, g, current_app
from werkzeug.utils import secure_filename
from database import db_cursor
from config import Config
from services.extractor import extract_text
from services.bob_client import extract_medical_facts
from routes.middleware import require_auth

docs_bp = Blueprint("documents", __name__, url_prefix="/api/documents")


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in Config.ALLOWED_EXTENSIONS


def _store_extracted_facts(cur, document_id: str, user_id: str, facts: dict):
    """Persist structured facts from extraction result into extracted_facts table."""
    report_date = facts.get("report_date")

    def insert_fact(category, field_name, field_value, unit=None, ref_range=None, source_text=None, status="found"):
        cur.execute(
            """
            INSERT INTO extracted_facts
              (document_id, user_id, category, field_name, field_value, unit, reference_range, status, report_date, source_text)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (document_id, user_id, category, field_name, field_value, unit, ref_range,
             status if field_value else "not_found", report_date, source_text),
        )

    # Lab results
    for item in facts.get("lab_results", []) or []:
        insert_fact("lab_result", item.get("test"), item.get("value"),
                    item.get("unit"), item.get("reference_range"), status=item.get("status", "found"))

    # Diagnoses
    for item in facts.get("diagnoses", []) or []:
        insert_fact("diagnosis", item.get("name"), item.get("name"),
                    source_text=item.get("source_text"))

    # Medications
    for item in facts.get("medications", []) or []:
        dose = item.get("dose")
        freq = item.get("frequency")
        value_str = f"{dose or ''} {freq or ''}".strip() or item.get("name")
        insert_fact("medication", item.get("name"), value_str,
                    unit=freq, source_text=item.get("source_text"))

    # Vital signs
    for item in facts.get("vital_signs", []) or []:
        insert_fact("vital_sign", item.get("name"), item.get("value"), item.get("unit"))

    # Allergies
    for item in facts.get("allergies", []) or []:
        insert_fact("allergy", item.get("substance"), item.get("reaction"))

    # Procedures
    for item in facts.get("procedures", []) or []:
        insert_fact("procedure", item.get("name"), item.get("notes"),
                    source_text=item.get("date"))

    # Symptoms
    for item in facts.get("symptoms", []) or []:
        insert_fact("symptom", item.get("name"), item.get("severity"),
                    unit=item.get("duration"))

    # Patient profile upsert
    patient = facts.get("patient") or {}
    if any(patient.values()):
        cur.execute(
            """
            INSERT INTO patient_profiles (user_id, full_name, date_of_birth, gender, blood_group, address)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
              full_name = COALESCE(EXCLUDED.full_name, patient_profiles.full_name),
              date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_profiles.date_of_birth),
              gender = COALESCE(EXCLUDED.gender, patient_profiles.gender),
              blood_group = COALESCE(EXCLUDED.blood_group, patient_profiles.blood_group),
              address = COALESCE(EXCLUDED.address, patient_profiles.address),
              updated_at = NOW()
            """,
            (user_id, patient.get("full_name"), patient.get("date_of_birth"),
             patient.get("gender"), patient.get("blood_group"), patient.get("address")),
        )


@docs_bp.route("/upload", methods=["POST"])
@require_auth
def upload_document():
    if "file" not in request.files:
        return jsonify({"error": "No file part in request."}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected."}), 400
    if not _allowed_file(file.filename):
        return jsonify({"error": f"File type not allowed. Supported: {', '.join(Config.ALLOWED_EXTENSIONS)}"}), 400

    original_filename = secure_filename(file.filename)
    ext = original_filename.rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid.uuid4()}.{ext}"
    upload_path = os.path.join(Config.UPLOAD_FOLDER, stored_filename)
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
    file.save(upload_path)
    file_size = os.path.getsize(upload_path)

    with db_cursor() as cur:
        # Register document
        cur.execute(
            """
            INSERT INTO documents (user_id, filename, original_filename, file_type, file_size_bytes, upload_status)
            VALUES (%s, %s, %s, %s, %s, 'processing')
            RETURNING id
            """,
            (g.user_id, stored_filename, original_filename, ext, file_size),
        )
        doc_id = str(cur.fetchone()["id"])

        try:
            # 1. Extract raw text
            raw_text = extract_text(upload_path, ext)

            # Store raw extraction
            cur.execute(
                "INSERT INTO document_extractions (document_id, raw_text, extraction_method) VALUES (%s, %s, %s)",
                (doc_id, raw_text, "text_extraction"),
            )

            # 2. AI extraction of structured facts
            facts = extract_medical_facts(raw_text)

            # 3. Store structured facts
            _store_extracted_facts(cur, doc_id, g.user_id, facts)

            # Mark document as extracted
            cur.execute(
                "UPDATE documents SET upload_status = 'extracted', extracted_at = NOW() WHERE id = %s",
                (doc_id,),
            )
        except Exception as exc:
            cur.execute(
                "UPDATE documents SET upload_status = 'error' WHERE id = %s",
                (doc_id,),
            )
            return jsonify({
                "error": f"Extraction failed: {str(exc)}",
                "document_id": doc_id,
            }), 500

    return jsonify({
        "message": "Document uploaded and extracted successfully.",
        "document_id": doc_id,
        "original_filename": original_filename,
        "facts_preview": {k: v for k, v in (facts or {}).items() if k != "error"},
    }), 201


@docs_bp.route("/", methods=["GET"])
@require_auth
def list_documents():
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, original_filename, file_type, file_size_bytes, upload_status, uploaded_at, extracted_at
            FROM documents WHERE user_id = %s ORDER BY uploaded_at DESC
            """,
            (g.user_id,),
        )
        docs = cur.fetchall()
    return jsonify({"documents": [dict(d) for d in docs]}), 200


@docs_bp.route("/<doc_id>", methods=["DELETE"])
@require_auth
def delete_document(doc_id):
    with db_cursor() as cur:
        cur.execute(
            "SELECT filename FROM documents WHERE id = %s AND user_id = %s",
            (doc_id, g.user_id),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Document not found."}), 404
        filepath = os.path.join(Config.UPLOAD_FOLDER, row["filename"])
        if os.path.exists(filepath):
            os.remove(filepath)
        cur.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
    return jsonify({"message": "Document deleted."}), 200
