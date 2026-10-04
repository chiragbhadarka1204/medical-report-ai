"""
Auth middleware — token validation decorator.
"""
from functools import wraps
from flask import request, jsonify, g
from database import db_cursor


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
        if not token:
            return jsonify({"error": "Authentication required."}), 401
        with db_cursor() as cur:
            cur.execute(
                """
                SELECT s.user_id, u.email, u.full_name
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s AND s.expires_at > NOW()
                """,
                (token,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({"error": "Invalid or expired session."}), 401
        g.user_id = str(row["user_id"])
        g.user_email = row["email"]
        g.user_name = row["full_name"]
        return f(*args, **kwargs)
    return decorated
