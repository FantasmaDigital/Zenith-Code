import os
import time
import logging
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
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

                            CREATE TABLE IF NOT EXISTS conversation_handoffs (
                                session_id VARCHAR(100) PRIMARY KEY,
                                transferred_to_human BOOLEAN NOT NULL DEFAULT TRUE,
                                transferred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                reason TEXT DEFAULT 'Derivado a agente humano',
                                inactivity_hours DOUBLE PRECISION DEFAULT 6.0,
                                tag VARCHAR(50) DEFAULT 'ATENCIÓN HUMANA',
                                notes TEXT DEFAULT ''
                            );
                            ALTER TABLE conversation_handoffs ADD COLUMN IF NOT EXISTS tag VARCHAR(50) DEFAULT 'ATENCIÓN HUMANA';
                            ALTER TABLE conversation_handoffs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
                        """)
                    conn.commit()
                    conn.close()
                    logger.info("✅ Conexión con PostgreSQL establecida y tablas listas.")
                    self.repair_existing_items()
                    self._ensure_sqlite_tables()
                    return
                except Exception as e:
                    logger.warning(f"Intento {attempt + 1}/5 conectando a PostgreSQL ({e}). Esperando...")
                    time.sleep(2)
            logger.warning("No se pudo conectar a PostgreSQL tras 5 intentos. Usando SQLite local como respaldo...")
            self.is_postgres = False

        self._ensure_sqlite_tables()
        logger.info(f"✅ Base de datos SQLite lista en: {self.sqlite_path}")
        self.repair_existing_items()

    def _ensure_sqlite_tables(self):
        try:
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
                    CREATE TABLE IF NOT EXISTS conversation_handoffs (
                        session_id TEXT PRIMARY KEY,
                        transferred_to_human INTEGER NOT NULL DEFAULT 1,
                        transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        reason TEXT DEFAULT 'Derivado a agente humano',
                        inactivity_hours REAL DEFAULT 6.0,
                        tag TEXT DEFAULT 'ATENCIÓN HUMANA',
                        notes TEXT DEFAULT ''
                    );
                """)
                # Migración SQLite segura para tablas existentes
                cur = conn.cursor()
                cur.execute("PRAGMA table_info(conversation_handoffs);")
                columns = [c[1] for c in cur.fetchall()]
                if "tag" not in columns:
                    cur.execute("ALTER TABLE conversation_handoffs ADD COLUMN tag TEXT DEFAULT 'ATENCIÓN HUMANA';")
                if "notes" not in columns:
                    cur.execute("ALTER TABLE conversation_handoffs ADD COLUMN notes TEXT DEFAULT '';")
            conn.close()
        except Exception as e:
            logger.warning(f"Error preparando tablas SQLite de respaldo: {e}")
        logger.info(f"✅ Base de datos SQLite lista en: {self.sqlite_path}")
        self.repair_existing_items()

    def repair_existing_items(self):
        """Repara cualquier texto con caracteres corruptos (mojibake) ya existente en la BD (items y settings)."""
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

            # Reparar también app_settings en la BD si contienen caracteres corruptos
            settings_map = self.get_all_settings()
            for key, val in settings_map.items():
                if val:
                    fixed_val = fix_mojibake(val)
                    if fixed_val != val:
                        self.set_setting(key, fixed_val)
                        logger.info(f"✨ Ajuste '{key}' reparado por mojibake en la BD.")
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
                    if row and row[0] is not None:
                        return fix_mojibake(row[0])
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
                if row and row["value"] is not None:
                    return fix_mojibake(row["value"])
            except Exception as e:
                logger.error(f"Error consultando setting {key} en SQLite: {e}")
        return default

    def set_setting(self, key: str, value: str):
        val_raw = str(value).strip() if value is not None else ""
        val_clean = val_raw if (val_raw.startswith("data:") or ";base64," in val_raw) else fix_mojibake(val_raw)
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO app_settings (key, value, updated_at)
                        VALUES (%s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (key) DO UPDATE
                        SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
                    """, (key, val_clean))
                conn.commit()
                conn.close()
            except Exception as e:
                logger.error(f"Error guardando setting {key} en PostgreSQL: {e}")

        # Guardar siempre en SQLite como espejo local para evitar cualquier desincronización
        try:
            conn = self._get_sqlite_connection()
            with conn:
                conn.execute("""
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(key) DO UPDATE
                    SET value = excluded.value, updated_at = datetime('now');
                """, (key, val_clean))
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
                        settings_map[r[0]] = fix_mojibake(r[1]) if r[1] is not None else ""
                conn.close()
                return settings_map
            except Exception as e:
                logger.error(f"Error listando settings en PostgreSQL: {e}")
        try:
            conn = self._get_sqlite_connection()
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM app_settings;")
            for r in cur.fetchall():
                settings_map[r["key"]] = fix_mojibake(r["value"]) if r["value"] is not None else ""
            conn.close()
        except Exception as e:
            logger.error(f"Error listando settings en SQLite: {e}")
        return settings_map

    def has_setting(self, key: str) -> bool:
        return key in self.get_all_settings()

    # ==============================================================
    # MÉTODOS DE TRANSFERENCIA A HUMANO (HANDOFF PERSISTENTE)
    # ==============================================================
    def set_handoff(
        self,
        session_id: str,
        transferred: bool = True,
        reason: str = "Derivado a agente humano",
        inactivity_hours: float = 6.0,
        tag: Optional[str] = None,
        notes: Optional[str] = None
    ):
        """Registra o actualiza el estado de derivación a humano con marca de tiempo persistente, tag y nota ejecutiva."""
        clean_sid = str(session_id).strip()
        if not clean_sid:
            return

        tag_val = (tag or "").strip()
        notes_val = (notes or "").strip()

        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO conversation_handoffs (session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes)
                        VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, %s, %s, COALESCE(NULLIF(%s, ''), 'ATENCIÓN HUMANA'), COALESCE(%s, ''))
                        ON CONFLICT (session_id) DO UPDATE
                        SET transferred_to_human = EXCLUDED.transferred_to_human,
                            transferred_at = CASE WHEN EXCLUDED.transferred_to_human THEN CURRENT_TIMESTAMP ELSE conversation_handoffs.transferred_at END,
                            last_activity_at = CURRENT_TIMESTAMP,
                            reason = EXCLUDED.reason,
                            inactivity_hours = EXCLUDED.inactivity_hours,
                            tag = CASE WHEN EXCLUDED.tag IS NOT NULL AND EXCLUDED.tag <> '' THEN EXCLUDED.tag ELSE conversation_handoffs.tag END,
                            notes = CASE WHEN EXCLUDED.notes IS NOT NULL AND EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE conversation_handoffs.notes END;
                    """, (clean_sid, transferred, reason, inactivity_hours, tag_val, notes_val))
                conn.commit()
                conn.close()
            except Exception as e:
                logger.error(f"Error guardando handoff en PostgreSQL para {clean_sid}: {e}")
        else:
            try:
                conn = self._get_sqlite_connection()
                with conn:
                    conn.execute("""
                        INSERT INTO conversation_handoffs (session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes)
                        VALUES (?, ?, datetime('now'), datetime('now'), ?, ?, COALESCE(NULLIF(?, ''), 'ATENCIÓN HUMANA'), COALESCE(?, ''))
                        ON CONFLICT(session_id) DO UPDATE
                        SET transferred_to_human = excluded.transferred_to_human,
                            transferred_at = CASE WHEN excluded.transferred_to_human = 1 THEN datetime('now') ELSE conversation_handoffs.transferred_at END,
                            last_activity_at = datetime('now'),
                            reason = excluded.reason,
                            inactivity_hours = excluded.inactivity_hours,
                            tag = CASE WHEN excluded.tag IS NOT NULL AND excluded.tag != '' THEN excluded.tag ELSE conversation_handoffs.tag END,
                            notes = CASE WHEN excluded.notes IS NOT NULL AND excluded.notes != '' THEN excluded.notes ELSE conversation_handoffs.notes END;
                    """, (clean_sid, 1 if transferred else 0, reason, inactivity_hours, tag_val, notes_val))
                conn.close()
            except Exception as e:
                logger.error(f"Error guardando handoff en SQLite para {clean_sid}: {e}")

    def update_handoff_meta(self, session_id: str, tag: Optional[str] = None, notes: Optional[str] = None):
        """Actualiza directamente la etiqueta y/o nota de una sesión transferida sin alterar su estado activo."""
        clean_sid = str(session_id).strip()
        if not clean_sid:
            return False

        updated = False
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    updates = []
                    params = []
                    if tag is not None:
                        updates.append("tag = %s")
                        params.append(tag.strip() or 'ATENCIÓN HUMANA')
                    if notes is not None:
                        updates.append("notes = %s")
                        params.append(notes.strip())
                    if updates:
                        params.append(clean_sid)
                        cur.execute(f"UPDATE conversation_handoffs SET {', '.join(updates)} WHERE session_id = %s;", tuple(params))
                        conn.commit()
                        updated = True
                conn.close()
            except Exception as e:
                logger.error(f"Error actualizando meta de handoff en PostgreSQL: {e}")
        else:
            try:
                conn = self._get_sqlite_connection()
                with conn:
                    updates = []
                    params = []
                    if tag is not None:
                        updates.append("tag = ?")
                        params.append(tag.strip() or 'ATENCIÓN HUMANA')
                    if notes is not None:
                        updates.append("notes = ?")
                        params.append(notes.strip())
                    if updates:
                        params.append(clean_sid)
                        conn.execute(f"UPDATE conversation_handoffs SET {', '.join(updates)} WHERE session_id = ?;", tuple(params))
                        updated = True
                conn.close()
            except Exception as e:
                logger.error(f"Error actualizando meta de handoff en SQLite: {e}")
        return updated

    def touch_handoff(self, session_id: str):
        """Actualiza last_activity_at para mantener viva la ventana de inactividad mientras hablan."""
        clean_sid = str(session_id).strip()
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("UPDATE conversation_handoffs SET last_activity_at = CURRENT_TIMESTAMP WHERE session_id = %s;", (clean_sid,))
                conn.commit()
                conn.close()
            except Exception as e:
                logger.error(f"Error actualizando last_activity_at en PostgreSQL: {e}")
        else:
            try:
                conn = self._get_sqlite_connection()
                with conn:
                    conn.execute("UPDATE conversation_handoffs SET last_activity_at = datetime('now') WHERE session_id = ?;", (clean_sid,))
                conn.close()
            except Exception as e:
                logger.error(f"Error actualizando last_activity_at en SQLite: {e}")

    def get_handoff(self, session_id: str) -> Optional[Dict[str, Any]]:
        clean_sid = str(session_id).strip()
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("SELECT session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes FROM conversation_handoffs WHERE session_id = %s;", (clean_sid,))
                    row = cur.fetchone()
                conn.close()
                if row:
                    return {
                        "session_id": row[0],
                        "transferred_to_human": bool(row[1]),
                        "transferred_at": row[2],
                        "last_activity_at": row[3],
                        "reason": row[4],
                        "inactivity_hours": float(row[5] or 6.0),
                        "tag": row[6] or "ATENCIÓN HUMANA",
                        "notes": row[7] or ""
                    }
                return None
            except Exception as e:
                logger.error(f"Error consultando handoff en PostgreSQL: {e}")
        try:
            conn = self._get_sqlite_connection()
            cur = conn.cursor()
            cur.execute("SELECT session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes FROM conversation_handoffs WHERE session_id = ?;", (clean_sid,))
            row = cur.fetchone()
            conn.close()
            if row:
                return {
                    "session_id": row["session_id"],
                    "transferred_to_human": bool(row["transferred_to_human"]),
                    "transferred_at": row["transferred_at"],
                    "last_activity_at": row["last_activity_at"],
                    "reason": row["reason"],
                    "inactivity_hours": float(row["inactivity_hours"] or 6.0),
                    "tag": row["tag"] or "ATENCIÓN HUMANA",
                    "notes": row["notes"] or ""
                }
        except Exception as e:
            logger.error(f"Error consultando handoff en SQLite: {e}")
        return None

    def list_active_handoffs(self) -> List[Dict[str, Any]]:
        active = []
        if self.is_postgres:
            try:
                conn = self._get_pg_connection()
                with conn.cursor() as cur:
                    cur.execute("SELECT session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes FROM conversation_handoffs WHERE transferred_to_human = TRUE ORDER BY last_activity_at DESC;")
                    for row in cur.fetchall():
                        active.append({
                            "session_id": row[0],
                            "transferred_to_human": True,
                            "transferred_at": row[2].isoformat() if hasattr(row[2], 'isoformat') else str(row[2]),
                            "last_activity_at": row[3].isoformat() if hasattr(row[3], 'isoformat') else str(row[3]),
                            "reason": row[4],
                            "inactivity_hours": float(row[5] or 6.0),
                            "tag": row[6] or "ATENCIÓN HUMANA",
                            "notes": row[7] or ""
                        })
                conn.close()
                return active
            except Exception as e:
                logger.error(f"Error listando active handoffs en PostgreSQL: {e}")
        try:
            conn = self._get_sqlite_connection()
            cur = conn.cursor()
            cur.execute("SELECT session_id, transferred_to_human, transferred_at, last_activity_at, reason, inactivity_hours, tag, notes FROM conversation_handoffs WHERE transferred_to_human = 1 ORDER BY last_activity_at DESC;")
            for row in cur.fetchall():
                active.append({
                    "session_id": row["session_id"],
                    "transferred_to_human": True,
                    "transferred_at": str(row["transferred_at"]),
                    "last_activity_at": str(row["last_activity_at"]),
                    "reason": row["reason"],
                    "inactivity_hours": float(row["inactivity_hours"] or 6.0),
                    "tag": row["tag"] or "ATENCIÓN HUMANA",
                    "notes": row["notes"] or ""
                })
            conn.close()
        except Exception as e:
            logger.error(f"Error listando active handoffs en SQLite: {e}")
        return active

db_service = DatabaseService()
