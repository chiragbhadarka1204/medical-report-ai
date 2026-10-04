import os
import base64
from dotenv import load_dotenv

# Load .env from the project root (one level up from backend/)
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env.example")
load_dotenv(_env_path)
# Also try .env if it exists
_env_real = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(_env_real):
    load_dotenv(_env_real, override=True)


def _decode_bob_key(raw: str) -> str:
    """
    Bob API keys are stored as base64(k2:uuid:secret).
    Return the decoded raw key for use as Bearer token.
    """
    if not raw:
        return ""
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        return decoded  # e.g. k2:dc8843aa-...:secret
    except Exception:
        return raw  # already decoded or plain key


class Config:
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key-change-in-prod")
    DATABASE_URL = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:password@localhost:5432/medical_report_ai",
    )

    # Supabase (for reference / REST fallback)
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

    # BOB API — decoded key + confirmed endpoint
    BOB_API_BASE_URL = os.environ.get(
        "BOB_API_BASE_URL",
        "https://api.us-east.bob.ibm.com/inference/v1",
    )
    _raw_bob_key = os.environ.get("BOB_API_KEY", "")
    BOB_API_KEY = _decode_bob_key(_raw_bob_key)
    BOB_MODEL = os.environ.get("BOB_MODEL", "granite3.3:8b")

    # File Upload
    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "uploads")
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_CONTENT_LENGTH_MB", 50)) * 1024 * 1024
    ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "gif", "tiff", "bmp", "txt", "doc", "docx"}

    # OTP
    OTP_DEV_MODE = os.environ.get("OTP_DEV_MODE", "true").lower() == "true"
    OTP_EXPIRY_MINUTES = int(os.environ.get("OTP_EXPIRY_MINUTES", 10))

    # Session
    SESSION_TOKEN_EXPIRY_HOURS = 24
