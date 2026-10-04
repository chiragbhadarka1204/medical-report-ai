"""
PDF report generation route.
"""
from flask import Blueprint, request, jsonify, g, send_file
import io
from routes.middleware import require_auth
from routes.summary import _get_patient_data
from services.bob_client import generate_medical_summary, analyze_medical_records
from services.pdf_generator import generate_summary_pdf
from database import db_cursor

pdf_bp = Blueprint("pdf", __name__, url_prefix="/api/pdf")


@pdf_bp.route("/generate", methods=["POST"])
@require_auth
def generate_pdf():
    """
    Generate and return a PDF medical summary.
    Body (optional JSON):
      { "include_analysis": true }
    """
    data = request.get_json(silent=True) or {}
    include_analysis = data.get("include_analysis", True)

    patient_data = _get_patient_data(g.user_id)
    if not patient_data["documents"]:
        return jsonify({"error": "No documents uploaded yet."}), 400

    # Get latest stored summary or generate one
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT content FROM medical_summaries
            WHERE user_id = %s AND summary_type = 'full'
            ORDER BY generated_at DESC LIMIT 1
            """,
            (g.user_id,),
        )
        row = cur.fetchone()

    if row:
        summary_text = row["content"]
    else:
        try:
            summary_text = generate_medical_summary(patient_data)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 502

    analysis = None
    if include_analysis:
        try:
            analysis = analyze_medical_records(patient_data)
        except RuntimeError:
            analysis = None  # PDF generation continues without analysis

    try:
        pdf_bytes = generate_summary_pdf(patient_data, summary_text, analysis)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="medical_summary.pdf",
    )
