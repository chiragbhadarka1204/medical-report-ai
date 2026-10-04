"""
Medical Report AI — Flask application entry point.
"""
import os
import sys

# Ensure the backend directory is in the Python path
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS

from config import Config
from database import init_db
from routes.auth import auth_bp
from routes.documents import docs_bp
from routes.summary import summary_bp
from routes.qa import qa_bp
from routes.pdf import pdf_bp


def create_app():
    app = Flask(
        __name__,
        static_folder=os.path.join(os.path.dirname(__file__), "..", "frontend", "static"),
        template_folder=os.path.join(os.path.dirname(__file__), "..", "frontend", "templates"),
    )
    app.config.from_object(Config)

    # CORS: allow frontend requests
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(docs_bp)
    app.register_blueprint(summary_bp)
    app.register_blueprint(qa_bp)
    app.register_blueprint(pdf_bp)

    # Serve frontend
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "static")
        template_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "templates")
        # Serve static assets
        static_path = os.path.join(static_dir, path)
        if path and os.path.isfile(static_path):
            return send_from_directory(static_dir, path)
        # Always serve index.html for SPA routing
        return send_from_directory(template_dir, "index.html")

    @app.errorhandler(404)
    def not_found(e):
        template_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "templates")
        index = os.path.join(template_dir, "index.html")
        if os.path.isfile(index):
            return send_from_directory(template_dir, "index.html")
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(413)
    def file_too_large(e):
        return jsonify({"error": f"File too large. Maximum size is {Config.MAX_CONTENT_LENGTH // (1024*1024)} MB."}), 413

    return app


if __name__ == "__main__":
    import threading
    import logging

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    log = logging.getLogger("med_app")

    def _bg_init_db():
        try:
            init_db()
        except Exception as exc:
            short = str(exc).split("\n")[0][:120]
            log.warning(f"DB init failed: {short}")
            log.warning("Set DATABASE_URL in .env.example with your Supabase DB password.")

    threading.Thread(target=_bg_init_db, daemon=True).start()

    app = create_app()
    port = int(os.environ.get("FLASK_PORT", 5000))
    db_display = Config.DATABASE_URL
    host_part = db_display.split("@")[-1][:55] if "@" in db_display else db_display[:55]

    log.info("=" * 52)
    log.info("  Medical Report AI")
    log.info(f"  http://localhost:{port}")
    log.info(f"  BOB API : {Config.BOB_API_BASE_URL}")
    log.info(f"  Model   : {Config.BOB_MODEL}")
    log.info(f"  DB      : {host_part}")
    log.info("=" * 52)

    # Run with no reloader so process stays stable
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
