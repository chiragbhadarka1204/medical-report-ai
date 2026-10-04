"""
Authentication routes: login, OTP verification, logout.
"""
import random
import string
import secrets
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from database import db_cursor
from config import Config

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _generate_otp(length=6):
    return "".join(random.choices(string.digits, k=length))


def _generate_token():
    return secrets.token_urlsafe(48)


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    Step 1: Accept email + phone.
    Create user if not exists.
    Generate and send OTP.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()

    if not email or not phone:
        return jsonify({"error": "Email and phone number are required."}), 400

    with db_cursor() as cur:
        # Upsert user
        cur.execute(
            """
            INSERT INTO users (email, phone)
            VALUES (%s, %s)
            ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone
            RETURNING id
            """,
            (email, phone),
        )
        row = cur.fetchone()
        user_id = str(row["id"])

        # Invalidate old OTPs
        cur.execute("UPDATE otp_codes SET used = TRUE WHERE user_id = %s AND used = FALSE", (user_id,))

        # Generate new OTP
        otp = _generate_otp()
        expires_at = datetime.now() + timedelta(minutes=Config.OTP_EXPIRY_MINUTES)
        cur.execute(
            "INSERT INTO otp_codes (user_id, code, expires_at) VALUES (%s, %s, %s)",
            (user_id, otp, expires_at),
        )

    # Development mode: return OTP in response (dev only)
    if Config.OTP_DEV_MODE:
        import logging
        logging.getLogger("med_otp").info(f"[DEV OTP] user={email}  OTP={otp}")
        return jsonify({
            "message": "OTP generated (dev mode).",
            "dev_otp": otp,
            "user_id": user_id,
        }), 200

    # Production: send OTP via SMS/email (configure external provider)
    return jsonify({"message": "OTP sent.", "user_id": user_id}), 200


@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    """
    Step 2: Verify OTP and issue session token.
    """
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    code = (data.get("otp") or "").strip()

    if not user_id or not code:
        return jsonify({"error": "user_id and otp are required."}), 400

    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id FROM otp_codes
            WHERE user_id = %s AND code = %s AND used = FALSE AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id, code),
        )
        otp_row = cur.fetchone()
        if not otp_row:
            return jsonify({"error": "Invalid or expired OTP."}), 401

        # Mark OTP as used
        cur.execute("UPDATE otp_codes SET used = TRUE WHERE id = %s", (str(otp_row["id"]),))

        # Update last login
        cur.execute("UPDATE users SET last_login = NOW() WHERE id = %s", (user_id,))

        # Issue session token
        token = _generate_token()
        expires_at = datetime.now() + timedelta(hours=Config.SESSION_TOKEN_EXPIRY_HOURS)
        cur.execute(
            "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
            (user_id, token, expires_at),
        )

        # Get user info
        cur.execute("SELECT email, phone, full_name FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()

    return jsonify({
        "token": token,
        "user": {
            "id": user_id,
            "email": user["email"],
            "phone": user["phone"],
            "full_name": user["full_name"],
        },
    }), 200


@auth_bp.route("/logout", methods=["POST"])
def logout():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if token:
        with db_cursor() as cur:
            cur.execute("DELETE FROM user_sessions WHERE token = %s", (token,))
    return jsonify({"message": "Logged out."}), 200
