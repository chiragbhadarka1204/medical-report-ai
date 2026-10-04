#!/usr/bin/env python3
"""
Setup script for Medical Report AI.
Run this once to:
1. Create the PostgreSQL database.
2. Initialize schema.
3. Verify BOB API connection.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from config import Config


def create_database():
    """Create the database if it doesn't exist."""
    from urllib.parse import urlparse

    url = urlparse(Config.DATABASE_URL)
    db_name = url.path.lstrip("/")

    print(f"\n[1] Supabase database: {db_name} on {url.hostname}")
    print(f"    ✓ Database is hosted on Supabase — no local creation needed.")


def init_schema():
    """Initialize database tables."""
    print("\n[2] Initializing schema…")
    from database import init_db
    try:
        init_db()
        print("    ✓ Schema initialized.")
    except Exception as e:
        print(f"    ✗ Schema init failed: {e}")
        sys.exit(1)


def check_uploads_dir():
    """Ensure upload directory exists."""
    print("\n[3] Checking upload directory…")
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
    print(f"    ✓ Upload directory: {Config.UPLOAD_FOLDER}")


def check_bob_api():
    """Test BOB API connectivity."""
    print(f"\n[4] Testing BOB API ({Config.BOB_API_BASE_URL})…")
    import requests
    try:
        headers = {"Content-Type": "application/json"}
        if Config.BOB_API_KEY:
            headers["Authorization"] = f"Bearer {Config.BOB_API_KEY}"
        r = requests.post(
            f"{Config.BOB_API_BASE_URL.rstrip('/')}/chat/completions",
            json={
                "model": Config.BOB_MODEL,
                "messages": [{"role": "user", "content": "Respond with: OK"}],
                "max_tokens": 10,
            },
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        print(f"    ✓ BOB API reachable. Model: {Config.BOB_MODEL}")
    except Exception as e:
        print(f"    ⚠ BOB API not reachable: {e}")
        print("    The app will still start; ensure BOB_API_BASE_URL and BOB_MODEL are set in .env")


if __name__ == "__main__":
    print("=" * 56)
    print("  Medical Report AI — Setup")
    print("=" * 56)
    create_database()
    init_schema()
    check_uploads_dir()
    check_bob_api()
    print("\n" + "=" * 56)
    print("  Setup complete! Run the app with:")
    print("  cd backend && python app.py")
    print("=" * 56 + "\n")
