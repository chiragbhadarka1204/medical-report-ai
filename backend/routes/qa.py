"""
Q&A chatbot routes — answers questions from patient data only.
"""
from flask import Blueprint, request, jsonify, g
from database import db_cursor
from services.bob_client import answer_question
from routes.middleware import require_auth
from routes.summary import _get_patient_data

qa_bp = Blueprint("qa", __name__, url_prefix="/api/qa")


@qa_bp.route("/ask", methods=["POST"])
@require_auth
def ask():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify({"error": "Question is required."}), 400

    patient_data = _get_patient_data(g.user_id)

    if not patient_data["documents"]:
        return jsonify({
            "answer": "No medical records have been uploaded yet. Please upload your documents first.",
            "question": question,
        }), 200

    try:
        answer = answer_question(question, patient_data)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    # Store in conversation history
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO qa_conversations (user_id, question, answer) VALUES (%s, %s, %s)",
            (g.user_id, question, answer),
        )

    return jsonify({"question": question, "answer": answer}), 200


@qa_bp.route("/history", methods=["GET"])
@require_auth
def history():
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT question, answer, created_at
            FROM qa_conversations
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (g.user_id,),
        )
        rows = cur.fetchall()
    return jsonify({"history": [dict(r) for r in rows]}), 200


@qa_bp.route("/history", methods=["DELETE"])
@require_auth
def clear_history():
    with db_cursor() as cur:
        cur.execute("DELETE FROM qa_conversations WHERE user_id = %s", (g.user_id,))
    return jsonify({"message": "Conversation history cleared."}), 200
