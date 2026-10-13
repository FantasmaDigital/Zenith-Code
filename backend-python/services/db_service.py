import os
import time
import logging
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from config import settings
from services.encoding_utils import fix_mojibake

logger = logging.getLogger("asistente_operativo.db")

class DatabaseService:
    def __init__(self):
        self.db_url = os.getenv("DATABASE_URL", "").strip()
        self.is_postgres = self.db_url.startswith("postgresql://") or self.db_url.startswith("postgres://")
        self.sqlite_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "knowledge_db.sqlite")
        self._init_db()

    def _get_pg_connection(self):
        import psycopg2
        import psycopg2.extras
        return psycopg2.connect(self.db_url)

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.sqlite_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Inicializa las tablas en PostgreSQL o SQLite según la configuración."""
        if self.is_postgres:
            for attempt in range(5):
                try:
                    conn = self._get_pg_connection()
                    with conn.cursor() as cur:
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS knowledge_items (
                                id SERIAL PRIMARY KEY,
                                title VARCHAR(255) NOT NULL,
                                source_type VARCHAR(50) NOT NULL DEFAULT 'text',
                                source_url TEXT,
                                category VARCHAR(100) DEFAULT 'general',
                                content TEXT NOT NULL,
                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                            );
                            CREATE INDEX IF NOT EXISTS idx_k_category ON knowledge_items(category);
                            CREATE INDEX IF NOT EXISTS idx_k_source_type ON knowledge_items(source_type);

                            CREATE TABLE IF NOT EXISTS app_settings (
                                key VARCHAR(100) PRIMARY KEY,
                                value TEXT NOT NULL,
                                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                            );
                        """)
                    conn.commit()
                    conn.close()
                    logger.info("✅ Conexión con PostgreSQL establecida y tablas listas.")
                    self.repair_existing_items()
                    return
                except Exception as e:
                    logger.warning(f"Intento {attempt + 1}/5 conectando a PostgreSQL ({e}). Esperando...")
                    time.sleep(2)
            logger.warning("No se pudo conectar a PostgreSQL tras 5 intentos. Usando SQLite local como respaldo...")
            self.is_postgres = False

        # Fallback a SQLite
        conn = self._get_sqlite_connection()
        with conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS knowledge_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'text',
                    source_url TEXT,
                    category TEXT DEFAULT 'general',
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        conn.close()
        logger.info(f"✅ Base de datos SQLite lista en: {self.sqlite_path}")
        self.repair_existing_items()

    def repair_existing_items(self):
        """Repara cualquier texto con caracteres corruptos (mojibake) ya existente en la BD."""
        try:
            items = self.get_all_items()
            repaired_count = 0
            for item in items:
                fixed_title = fix_mojibake(item["title"])
                fixed_content = fix_mojibake(item["content"])
                if fixed_title != item["title"] or fixed_content != item["content"]:
                    item_id = item["id"]
                    if self.is_postgres:
                        conn = self._get_pg_connection()
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE knowledge_items SET title = %s, content = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s;",
                                (fixed_title, fixed_content, item_id)
                            )
                        conn.commit()
                        conn.close()
                    else:
                        conn = self._get_sqlite_connection()
                        with conn:
                            conn.execute(
                                "UPDATE knowledge_items SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?;",
                                (fixed_title, fixed_content, item_id)
                            )
                        conn.close()
                    repaired_count += 1
            if repaired_count > 0:
                logger.info(f"✨ Se repararon {repaired_count} documentos con caracteres corruptos (mojibake) en la BD.")
        except Exception as e:
            logger.warning(f"Error reparando mojibake existente en BD: {e}")

    def add_item(self, title: str, content: str, source_type: str = "text", source_url: Optional[str] = None, category: str = "general") -> Dict[str, Any]:
        title = fix_mojibake(title.strip())
        content = fix_mojibake(content.strip())
        now_iso = datetime.now(timezone.utc).isoformat()

        if self.is_postgres:
            conn = self._get_pg_connection()
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO knowledge_items (title, source_type, source_url, category, content, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id, title, source_type, source_url, category, content, created_at, updated_at;
                """, (title, source_type, source_url, category, content))
                row = cur.fetchone()
                item_id = row[0]
            conn.commit()
            conn.close()
            return {
                "id": item_id,
                "title": title,
                "source_type": source_type,
                "source_url": source_url,
                "category": category,
                "content": content,
                "created_at": str(row[6]),
                "updated_at": str(row[7])
            }
        else:
            conn = self._get_sqlite_connection()
            with conn:
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO knowledge_items (title, source_type, source_url, category, content, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'));
                """, (title, source_type, source_url, category, content))
                item_id = cur.lastrowid
            conn.close()
            return {
                "id": item_id,
                "title": title,
                "source_type": source_type,
                "source_url": source_url,
                "category": category,
                "content": content,
                "created_at": now_iso,
                "updated_at": now_iso
            }

    def get_all_items(self) -> List[Dict[str, Any]]:
        items = []
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT id, title, source_type, source_url, category, content, created_at, updated_at
                        FROM knowledge_items
                        ORDER BY id DESC;
                    """)
                    for r in cur.fetchall():
                        items.append({
                            "id": r[0],
                            "title": r[1],
                            "source_type": r[2],
                            "source_url": r[3],
                            "category": r[4],
                            "content": r[5],
                            "created_at": str(r[6]),
                            "updated_at": str(r[7])
                        })
                conn.close()
                return items
            except Exception as e:
                logger.error(f"Error consultando PostgreSQL: {e}")

        # SQLite
        conn = self._get_sqlite_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, source_type, source_url, category, content, created_at, updated_at
            FROM knowledge_items
            ORDER BY id DESC;
        """)
        for r in cur.fetchall():
            items.append({
                "id": r["id"],
                "title": r["title"],
                "source_type": r["source_type"],
                "source_url": r["source_url"],
                "category": r["category"],
                "content": r["content"],
                "created_at": str(r["created_at"]),
                "updated_at": str(r["updated_at"])
            })
        conn.close()
        return items

    def delete_item(self, item_id: int) -> bool:
        if self.is_postgres:
            conn = self._get_pg_connection()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM knowledge_items WHERE id = %s;", (item_id,))
                deleted = cur.rowcount > 0
            conn.commit()
            conn.close()
            return deleted
        else:
            conn = self._get_sqlite_connection()
            with conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM knowledge_items WHERE id = ?;", (item_id,))
                deleted = cur.rowcount > 0
            conn.close()
            return deleted

    def count_items(self) -> int:
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM knowledge_items;")
                    count = cur.fetchone()[0]
                conn.close()
                return count
            except Exception:
                pass
        conn = self._get_sqlite_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM knowledge_items;")
        count = cur.fetchone()[0]
        conn.close()
        return count

    def get_setting(self, key: str, default: str = "") -> str:
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("SELECT value FROM app_settings WHERE key = %s;", (key,))
                    row = cur.fetchone()
                    if row:
                        return row[0]
                conn.close()
            except Exception as e:
                logger.error(f"Error consultando setting {key} en PostgreSQL: {e}")
        else:
            try:
                conn = self._get_sqlite_connection()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_settings WHERE key = ?;", (key,))
                row = cur.fetchone()
                conn.close()
                if row:
                    return row["value"]
            except Exception as e:
                logger.error(f"Error consultando setting {key} en SQLite: {e}")
        return default

    def set_setting(self, key: str, value: str):
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO app_settings (key, value, updated_at)
                        VALUES (%s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (key) DO UPDATE
                        SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
                    """, (key, value))
                conn.commit()
                conn.close()
            except Exception as e:
                logger.error(f"Error guardando setting {key} en PostgreSQL: {e}")
        else:
            try:
                conn = self._get_sqlite_connection()
                with conn:
                    conn.execute("""
                        INSERT INTO app_settings (key, value, updated_at)
                        VALUES (?, ?, datetime('now'))
                        ON CONFLICT(key) DO UPDATE
                        SET value = excluded.value, updated_at = datetime('now');
                    """, (key, value))
                conn.close()
            except Exception as e:
                logger.error(f"Error guardando setting {key} en SQLite: {e}")

    def get_all_settings(self) -> Dict[str, str]:
        settings_map = {}
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("SELECT key, value FROM app_settings;")
                    for r in cur.fetchall():
                        settings_map[r[0]] = r[1]
                conn.close()
                return settings_map
            except Exception as e:
                logger.error(f"Error listando settings en PostgreSQL: {e}")
        try:
            conn = self._get_sqlite_connection()
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM app_settings;")
            for r in cur.fetchall():
                settings_map[r["key"]] = r["value"]
            conn.close()
        except Exception as e:
            logger.error(f"Error listando settings en SQLite: {e}")
        return settings_map

db_service = DatabaseService()
