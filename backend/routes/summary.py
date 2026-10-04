"""
Medical Summary, Analysis routes.
"""
import json
from flask import Blueprint, request, jsonify, g
from database import db_cursor
from services.bob_client import generate_medical_summary, analyze_medical_records
from routes.middleware import require_auth

summary_bp = Blueprint("summary", __name__, url_prefix="/api/summary")


def _get_patient_data(user_id: str) -> dict:
    """Assemble all structured patient data from DB for a given user."""
    with db_cursor() as cur:
        # Profile
        cur.execute("SELECT * FROM patient_profiles WHERE user_id = %s", (user_id,))
        profile_row = cur.fetchone()

        # All extracted facts grouped by category
        cur.execute(
            """
            SELECT category, field_name, field_value, unit, reference_range, status, report_date, source_text
            FROM extracted_facts
            WHERE user_id = %s
            ORDER BY report_date ASC NULLS LAST, extracted_at ASC
            """,
            (user_id,),
        )
        facts = cur.fetchall()

        # Documents list
        cur.execute(
            "SELECT id, original_filename, file_type, uploaded_at FROM documents WHERE user_id = %s ORDER BY uploaded_at",
            (user_id,),
        )
        docs = cur.fetchall()

    # Group facts by category
    categorized = {}
    for f in facts:
        cat = f["category"]
        categorized.setdefault(cat, []).append(dict(f))

    return {
        "profile": dict(profile_row) if profile_row else {},
        "lab_results": categorized.get("lab_result", []),
        "diagnoses": categorized.get("diagnosis", []),
        "medications": categorized.get("medication", []),
        "vital_signs": categorized.get("vital_sign", []),
        "allergies": categorized.get("allergy", []),
        "procedures": categorized.get("procedure", []),
        "symptoms": categorized.get("symptom", []),
        "documents": [dict(d) for d in docs],
    }


@summary_bp.route("/generate", methods=["POST"])
@require_auth
def generate_summary():
    """Generate (or regenerate) the AI medical summary for the current user."""
    patient_data = _get_patient_data(g.user_id)

    if not patient_data["documents"]:
        return jsonify({"error": "No documents uploaded yet."}), 400

    try:
        summary_text = generate_medical_summary(patient_data)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    # Persist summary
    doc_ids = [d["id"] for d in patient_data["documents"]]
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO medical_summaries (user_id, summary_type, content, document_ids)
            VALUES (%s, 'full', %s, %s)
            """,
            (g.user_id, summary_text, doc_ids),
        )

    return jsonify({"summary": summary_text, "patient_data": patient_data}), 200


@summary_bp.route("/latest", methods=["GET"])
@require_auth
def latest_summary():
    """Return the most recent stored summary + patient data."""
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT content, generated_at FROM medical_summaries
            WHERE user_id = %s AND summary_type = 'full'
            ORDER BY generated_at DESC LIMIT 1
            """,
            (g.user_id,),
        )
        row = cur.fetchone()

    patient_data = _get_patient_data(g.user_id)
    return jsonify({
        "summary": row["content"] if row else None,
        "generated_at": str(row["generated_at"]) if row else None,
        "patient_data": patient_data,
    }), 200


@summary_bp.route("/analyze", methods=["POST"])
@require_auth
def analyze():
    """Run the analysis service: timeline, changes, medication summary, missing info."""
    patient_data = _get_patient_data(g.user_id)

    if not patient_data["documents"]:
        return jsonify({"error": "No documents uploaded yet."}), 400

    try:
        analysis = analyze_medical_records(patient_data)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    # Persist as analysis-type summary
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO medical_summaries (user_id, summary_type, content, document_ids)
            VALUES (%s, 'analysis', %s, %s)
            """,
            (g.user_id, json.dumps(analysis), [d["id"] for d in patient_data["documents"]]),
        )

    return jsonify({"analysis": analysis}), 200


@summary_bp.route("/patient-data", methods=["GET"])
@require_auth
def patient_data_endpoint():
    """Return all raw structured patient data."""
    return jsonify(_get_patient_data(g.user_id)), 200
