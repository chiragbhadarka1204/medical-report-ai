import psycopg
import psycopg.rows
from contextlib import contextmanager
from config import Config


def _build_conninfo() -> str:
    """
    Build the connection string.
    Appends sslmode=require for Supabase pooler connections.
    """
    url = Config.DATABASE_URL
    if "supabase.com" in url or "pooler.supabase" in url:
        sep = "&" if "?" in url else "?"
        if "sslmode" not in url:
            url = url + sep + "sslmode=require"
    return url


def get_connection():
    return psycopg.connect(_build_conninfo(), row_factory=psycopg.rows.dict_row)


@contextmanager
def db_cursor():
    conn = get_connection()
    try:
        with conn:          # handles commit/rollback automatically
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()


def init_db():
    """Run schema.sql to create tables if they don't exist."""
    import os
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, "r") as f:
        sql = f.read()
    conn = get_connection()
    try:
        with conn:
            conn.execute(sql)
        import logging
        logging.getLogger("med_db").info("Schema initialized successfully.")
    finally:
        conn.close()
