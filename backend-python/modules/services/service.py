"""Servicio de lógica de negocio para el módulo Servicios Profesionales."""
import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.modules.services")

_init_lock = threading.Lock()
# Columnas que se agregaron después de la primera versión de la tabla (capture_lead_from_chat las usa)
LEAD_EXTRA_COLUMNS = ("session_id", "conversation_text", "budget_text", "timeline_text", "meeting_at")
CONFIG_KEY = "services_config"

DEFAULT_CONFIG: Dict[str, Any] = {
    "business_type": "software",
    "business_name": "",
    "tagline": "Soluciones tecnológicas a medida",
    "website": "",
    "portfolio_url": "",
    "work_mode": "remote",
    "currency": "USD",

    # Agente IA Comercial (ARM)
    "response_style": "profesional",
    "ai_pitch": (
        "Somos una empresa de desarrollo de software especializada en soluciones a medida. "
        "Ayudamos a nuestros clientes a digitalizarse, automatizar procesos y crecer con tecnología. "
        "Nuestro diferenciador: equipo senior, entregas puntuales y soporte post-entrega."
    ),
    "contact_cta": "¿Te gustaría agendar una consulta sin costo para evaluar tu proyecto?",
    "meeting_link": "",
    "ai_greeting": "",
    "special_instructions": "",
    "show_prices": True,
    "show_duration": True,
    "mention_stack": True,

    # Calificación de Leads
    "ask_budget": True,
    "ask_timeline": True,
    "ask_requirements": True,
    "min_project_budget": 500,

    # Modelo Comercial y Pagos
    "pricing_models": ["fixed", "milestones", "retainer"],
    "payment_terms": "50% anticipo al iniciar y 50% contra entrega a satisfacción.",
    "warranty_days": 30,

    # Horario Comercial
    "work_days": "Lunes a Viernes",
    "work_hours": "08:00 - 18:00",
    "timezone": "America/El_Salvador",
    "out_of_hours_msg": "Nuestro equipo comercial está fuera de horario, pero con gusto tomo tus requerimientos y mañana a primera hora te contactamos con una propuesta formal."
}

BUSINESS_TYPE_LABELS = {
    "software": "Empresa de Software / Desarrollo",
    "agencia": "Agencia Digital / Marketing",
    "consultoria": "Consultoría / Asesoría",
    "legal": "Despacho Legal / Firma",
    "diseno": "Estudio de Diseño",
    "contabilidad": "Contabilidad / Finanzas",
    "otro": "Otro tipo de servicio",
}


# ---------------------------------------------------------------------------
# Helpers de resultado de cursor (compatibilidad PG / SQLite)
# ---------------------------------------------------------------------------

class _Result:
    def __init__(self, cursor, is_pg: bool):
        self._cursor = cursor
        self.is_pg = is_pg
        self.rowcount = getattr(cursor, "rowcount", -1)

    def _row(self, row) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        if self.is_pg:
            desc = [d[0] for d in self._cursor.description]
            return dict(zip(desc, row))
        return {k: row[k] for k in row.keys()}

    def all(self) -> List[Dict[str, Any]]:
        return [self._row(r) for r in self._cursor.fetchall()]

    def one(self) -> Optional[Dict[str, Any]]:
        r = self._cursor.fetchone()
        return self._row(r) if r else None


class _Tx:
    def __init__(self, raw, is_pg: bool):
        self.raw = raw
        self.is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()) -> _Result:
        ph = sql.replace("?", "%s") if self.is_pg else sql
        self.raw.execute(ph, params)
        return _Result(self.raw, self.is_pg)

    def commit(self):
        pass  # Manejado por el contextmanager externo


# ---------------------------------------------------------------------------
# Clase de servicio principal
# ---------------------------------------------------------------------------

class ProfessionalServicesService:
    """Servicio de datos para el módulo Servicios Profesionales."""

    def __init__(self):
        self._db = None
        self._initialized = False

    def _set_db(self, db_service):
        self._db = db_service

    @contextmanager
    def _tx(self):
        """Contexto de transacción multi-tenant."""
        if self._db is None:
            try:
                from services.db_service import db_service
                self._db = db_service
            except Exception:
                pass
        is_pg = hasattr(self._db, "_get_pg_connection")
        if is_pg:
            conn = self._db._get_pg_connection()
            cur = conn.cursor()
            try:
                yield _Tx(cur, is_pg=True)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                cur.close()
                conn.close()
        else:
            conn = self._db._get_sqlite_connection()
            cur = conn.cursor()
            try:
                yield _Tx(cur, is_pg=False)
                conn.commit()
            finally:
                cur.close()

    def init_tables(self, db_service) -> None:
        """Crea las tablas necesarias si no existen."""
        with _init_lock:
            if self._initialized:
                return
            self._set_db(db_service)

            is_pg = hasattr(db_service, "_get_pg_connection")

            if is_pg:
                conn = db_service._get_pg_connection()
                cur = conn.cursor()
                try:
                    # Tabla de servicios ofrecidos
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS prof_services (
                            id          SERIAL PRIMARY KEY,
                            name        TEXT NOT NULL,
                            description TEXT DEFAULT '',
                            category    TEXT DEFAULT 'General',
                            price_min   NUMERIC(12,2),
                            price_max   NUMERIC(12,2),
                            duration_days INTEGER,
                            is_active   BOOLEAN DEFAULT TRUE,
                            created_at  TIMESTAMPTZ DEFAULT NOW(),
                            updated_at  TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    # Tabla de leads / CRM
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS prof_leads (
                            id               SERIAL PRIMARY KEY,
                            name             TEXT NOT NULL,
                            company          TEXT DEFAULT '',
                            email            TEXT DEFAULT '',
                            phone            TEXT DEFAULT '',
                            service_interest TEXT DEFAULT '',
                            status           TEXT DEFAULT 'nuevo',
                            source           TEXT DEFAULT 'manual',
                            notes            TEXT DEFAULT '',
                            created_at       TIMESTAMPTZ DEFAULT NOW(),
                            updated_at       TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    for col in LEAD_EXTRA_COLUMNS:
                        cur.execute(f"ALTER TABLE prof_leads ADD COLUMN IF NOT EXISTS {col} TEXT DEFAULT ''")
                    # Tabla de propuestas
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS prof_proposals (
                            id           SERIAL PRIMARY KEY,
                            lead_id      INTEGER REFERENCES prof_leads(id) ON DELETE SET NULL,
                            title        TEXT DEFAULT '',
                            services     TEXT DEFAULT '[]',
                            total_amount NUMERIC(12,2) DEFAULT 0,
                            valid_days   INTEGER DEFAULT 14,
                            status       TEXT DEFAULT 'borrador',
                            notes        TEXT DEFAULT '',
                            created_at   TIMESTAMPTZ DEFAULT NOW(),
                            updated_at   TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    # Tabla de configuración (clave-valor)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS prof_settings (
                            key   TEXT PRIMARY KEY,
                            value TEXT NOT NULL
                        )
                    """)
                    conn.commit()
                    logger.info("✅ Tablas Servicios Profesionales creadas/verificadas (PostgreSQL)")
                except Exception as e:
                    conn.rollback()
                    logger.error(f"❌ Error creando tablas services: {e}")
                    raise
                finally:
                    cur.close()
                    conn.close()
            else:
                conn = db_service._get_sqlite_connection()
                cur = conn.cursor()
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS prof_services (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL, description TEXT DEFAULT '',
                        category TEXT DEFAULT 'General', price_min REAL,
                        price_max REAL, duration_days INTEGER,
                        is_active INTEGER DEFAULT 1,
                        created_at TEXT, updated_at TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS prof_leads (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL, company TEXT DEFAULT '',
                        email TEXT DEFAULT '', phone TEXT DEFAULT '',
                        service_interest TEXT DEFAULT '', status TEXT DEFAULT 'nuevo',
                        source TEXT DEFAULT 'manual', notes TEXT DEFAULT '',
                        created_at TEXT, updated_at TEXT
                    )
                """)
                existing_cols = {r[1] for r in cur.execute("PRAGMA table_info(prof_leads)").fetchall()}
                for col in LEAD_EXTRA_COLUMNS:
                    if col not in existing_cols:
                        cur.execute(f"ALTER TABLE prof_leads ADD COLUMN {col} TEXT DEFAULT ''")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS prof_proposals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        lead_id INTEGER, title TEXT DEFAULT '',
                        services TEXT DEFAULT '[]', total_amount REAL DEFAULT 0,
                        valid_days INTEGER DEFAULT 14, status TEXT DEFAULT 'borrador',
                        notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS prof_settings (
                        key TEXT PRIMARY KEY, value TEXT NOT NULL
                    )
                """)
                conn.commit()
                cur.close()
                logger.info("✅ Tablas Servicios Profesionales creadas/verificadas (SQLite)")

            self._initialized = True

    # -----------------------------------------------------------------------
    # Configuración & Jerarquía de Herencia con Perfil General
    # -----------------------------------------------------------------------

    def get_profile_fallbacks(self) -> Dict[str, str]:
        """Obtiene la configuración global del perfil de la empresa para la jerarquía de herencia."""
        try:
            from config import settings
            return {
                "company_name": (getattr(settings, "COMPANY_NAME", None) or "").strip(),
                "bot_name": (getattr(settings, "BOT_NAME", None) or "").strip(),
                "bot_tone": (getattr(settings, "BOT_TONE", None) or "").strip(),
                "website_url": (getattr(settings, "WEBSITE_URL", None) or "").strip(),
                "support_phone": (settings.get_effective_support_phone() or "").strip(),
                "welcome_message": (getattr(settings, "WELCOME_MESSAGE", None) or "").strip(),
                "brand_instructions": (getattr(settings, "BRAND_INSTRUCTIONS", None) or "").strip(),
            }
        except Exception as e:
            logger.debug(f"Aviso consultando profile fallbacks: {e}")
            return {
                "company_name": "", "bot_name": "", "bot_tone": "",
                "website_url": "", "support_phone": "", "welcome_message": "",
                "brand_instructions": ""
            }

    def get_effective_config(self) -> Dict[str, Any]:
        """Aplica la jerarquía de herencia: si un valor está vacío en servicios, hereda del perfil."""
        cfg = self.get_config()
        fallbacks = self.get_profile_fallbacks()
        effective = dict(cfg)

        if not (effective.get("business_name") or "").strip():
            effective["business_name"] = fallbacks.get("company_name") or "Nuestra Empresa"
        if not (effective.get("website") or "").strip():
            effective["website"] = fallbacks.get("website_url") or ""
        if not (effective.get("ai_pitch") or "").strip() and fallbacks.get("brand_instructions"):
            effective["ai_pitch"] = fallbacks.get("brand_instructions")

        effective["_profile_fallbacks"] = fallbacks
        return effective

    def get_config(self) -> Dict[str, Any]:
        try:
            with self._tx() as tx:
                row = tx.execute(
                    "SELECT value FROM prof_settings WHERE key = ?", (CONFIG_KEY,)
                ).one()
                if row:
                    return {**DEFAULT_CONFIG, **json.loads(row["value"])}
        except Exception as e:
            logger.error(f"get_config error: {e}")
        return dict(DEFAULT_CONFIG)

    def save_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_config()
        merged = {**current, **{k: v for k, v in updates.items() if v is not None}}
        with self._tx() as tx:
            tx.execute(
                "INSERT INTO prof_settings(key, value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                (CONFIG_KEY, json.dumps(merged, ensure_ascii=False))
            )
        return merged

    # -----------------------------------------------------------------------
    # Servicios
    # -----------------------------------------------------------------------

    def list_services(self, only_active: bool = False) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            if only_active:
                rows = tx.execute(
                    "SELECT * FROM prof_services WHERE is_active = TRUE ORDER BY category, name"
                ).all()
            else:
                rows = tx.execute(
                    "SELECT * FROM prof_services ORDER BY category, name"
                ).all()
        return rows

    def add_service(self, data: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._tx() as tx:
            tx.execute(
                """INSERT INTO prof_services
                   (name, description, category, price_min, price_max, duration_days, is_active, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    data["name"], data.get("description", ""), data.get("category", "General"),
                    data.get("price_min"), data.get("price_max"), data.get("duration_days"),
                    data.get("is_active", True), now, now
                )
            )
            row = tx.execute(
                "SELECT * FROM prof_services ORDER BY id DESC LIMIT 1"
            ).one()
        return row

    def add_services_bulk(self, services: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        with self._tx() as tx:
            for s in services:
                if not s.get("name"):
                    continue
                tx.execute(
                    """INSERT INTO prof_services
                       (name, description, category, price_min, price_max, duration_days, is_active, created_at, updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?)""",
                    (
                        s["name"], s.get("description", ""), s.get("category", "General"),
                        s.get("price_min"), s.get("price_max"), s.get("duration_days"),
                        s.get("is_active", True), now, now
                    )
                )
        return self.list_services()

    def update_service(self, service_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        fields, vals = [], []
        for col in ["name", "description", "category", "price_min", "price_max", "duration_days", "is_active"]:
            if col in data and data[col] is not None:
                fields.append(f"{col} = ?")
                vals.append(data[col])
        if not fields:
            return self._get_service(service_id)
        vals += [now, service_id]
        with self._tx() as tx:
            tx.execute(
                f"UPDATE prof_services SET {', '.join(fields)}, updated_at=? WHERE id=?", tuple(vals)
            )
            return tx.execute("SELECT * FROM prof_services WHERE id=?", (service_id,)).one()

    def delete_service(self, service_id: int) -> bool:
        with self._tx() as tx:
            tx.execute("DELETE FROM prof_services WHERE id=?", (service_id,))
        return True

    def _get_service(self, service_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            return tx.execute("SELECT * FROM prof_services WHERE id=?", (service_id,)).one()

    def get_services_text(self) -> str:
        """Texto formateado del catálogo para el prompt de la IA."""
        services = self.list_services(only_active=True)
        if not services:
            return "No hay servicios configurados aún."

        by_cat: Dict[str, List] = {}
        for s in services:
            cat = s.get("category") or "General"
            by_cat.setdefault(cat, []).append(s)

        lines = ["[CATÁLOGO DE SERVICIOS DISPONIBLES]"]
        for cat, items in by_cat.items():
            lines.append(f"\n▶ {cat.upper()}")
            for s in items:
                price_str = ""
                if s.get("price_min") and s.get("price_max"):
                    price_str = f" | Desde ${s['price_min']:,.0f} hasta ${s['price_max']:,.0f}"
                elif s.get("price_min"):
                    price_str = f" | Desde ${s['price_min']:,.0f}"
                duration_str = f" | Tiempo estimado: {s['duration_days']} días" if s.get("duration_days") else ""
                lines.append(f"  • {s['name']}{price_str}{duration_str}")
                if s.get("description"):
                    lines.append(f"    {s['description']}")
        return "\n".join(lines)

    # -----------------------------------------------------------------------
    # Leads / CRM
    # -----------------------------------------------------------------------

    def list_leads(self) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            return tx.execute(
                "SELECT * FROM prof_leads ORDER BY created_at DESC"
            ).all()

    def get_lead(self, lead_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            return tx.execute("SELECT * FROM prof_leads WHERE id=?", (lead_id,)).one()

    def _get_session_transcript(self, session_id: str) -> str:
        """Obtiene y formatea toda la conversación histórica del cliente desde WhatsApp/Web."""
        if not session_id:
            return ""
        try:
            with self._tx() as tx:
                rows = tx.execute(
                    "SELECT role, content, created_at FROM conversation_messages WHERE session_id = ? ORDER BY id ASC",
                    (session_id,)
                ).all()
                if rows:
                    lines = []
                    for r in rows:
                        role_label = "👤 Cliente" if r.get("role") == "user" else "🤖 Asistente"
                        ts = str(r.get("created_at") or "")[:19].replace("T", " ")
                        lines.append(f"[{ts}] {role_label}:\n{r.get('content', '')}")
                    return "\n\n".join(lines)
        except Exception as e:
            logger.warning(f"Error consultando mensajes de sesión {session_id}: {e}")
        return ""

    def get_lead_messages(self, lead_id: int) -> List[Dict[str, Any]]:
        """Devuelve los mensajes estructurados de la conversación asociada al lead."""
        with self._tx() as tx:
            lead = tx.execute("SELECT session_id, conversation_text, name, phone FROM prof_leads WHERE id = ?", (lead_id,)).one()
            if not lead:
                return []
            sid = lead.get("session_id")
            if sid:
                rows = tx.execute(
                    "SELECT id, role, content, created_at FROM conversation_messages WHERE session_id = ? ORDER BY id ASC",
                    (sid,)
                ).all()
                if rows:
                    return rows

            # Si no hay rows en conversation_messages, estructurar desde conversation_text
            raw_text = lead.get("conversation_text") or ""
            if raw_text:
                blocks = raw_text.split("\n\n")
                simulated = []
                for idx, b in enumerate(blocks):
                    is_user = "👤 Cliente" in b
                    clean_content = re.sub(r"^\[.*?\] (?:👤 Cliente|🤖 Asistente):\s*", "", b).strip()
                    simulated.append({
                        "id": idx + 1,
                        "role": "user" if is_user else "assistant",
                        "content": clean_content,
                        "created_at": ""
                    })
                return simulated
            return []

    def capture_lead_from_chat(self, session_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Crea o actualiza un lead de forma automatizada por el Agente IA, vinculando toda la conversación."""
        now = datetime.now(timezone.utc).isoformat()
        name = str(args.get("nombre") or args.get("name") or "Prospecto").strip()
        company = str(args.get("empresa") or args.get("company") or "").strip()
        phone = str(args.get("telefono") or args.get("phone") or "").strip()
        email = str(args.get("email") or "").strip()
        service_interest = str(args.get("servicio_interes") or args.get("service") or "").strip()
        notes = str(args.get("notas") or args.get("notes") or "").strip()
        budget = str(args.get("presupuesto") or "").strip()
        timeline = str(args.get("plazo") or "").strip()

        # Extraer teléfono de session_id si aplica (WhatsApp)
        clean_sid = (session_id or "").split("@")[0]
        if not phone and clean_sid.isdigit() and len(clean_sid) >= 8:
            phone = f"+{clean_sid}"

        # Obtener la transcripción completa actualizada
        transcript = self._get_session_transcript(session_id)

        with self._tx() as tx:
            existing = None
            if session_id:
                existing = tx.execute("SELECT * FROM prof_leads WHERE session_id = ?", (session_id,)).one()
            if not existing and phone:
                existing = tx.execute("SELECT * FROM prof_leads WHERE phone = ? AND phone != ''", (phone,)).one()

            if existing:
                lead_id = existing["id"]
                current_notes = existing.get("notes") or ""
                merged_notes = f"{current_notes} | {notes}".strip(" |") if notes and notes not in current_notes else (current_notes or notes)
                tx.execute(
                    """UPDATE prof_leads
                       SET name = CASE WHEN ? != '' AND ? != 'Prospecto' THEN ? ELSE name END,
                           company = CASE WHEN ? != '' THEN ? ELSE company END,
                           email = CASE WHEN ? != '' THEN ? ELSE email END,
                           phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                           service_interest = CASE WHEN ? != '' THEN ? ELSE service_interest END,
                           notes = ?,
                           conversation_text = COALESCE(NULLIF(?, ''), conversation_text),
                           budget_text = CASE WHEN ? != '' THEN ? ELSE budget_text END,
                           timeline_text = CASE WHEN ? != '' THEN ? ELSE timeline_text END,
                           session_id = ?,
                           updated_at = ?
                       WHERE id = ?""",
                    (
                        name, name, name,
                        company, company,
                        email, email,
                        phone, phone,
                        service_interest, service_interest,
                        merged_notes,
                        transcript,
                        budget, budget,
                        timeline, timeline,
                        session_id,
                        now,
                        lead_id
                    )
                )
                logger.info(f"🔄 Lead #{lead_id} ({name}) actualizado automáticamente con transcripción en sesión {session_id}")
                return tx.execute("SELECT * FROM prof_leads WHERE id = ?", (lead_id,)).one()
            else:
                tx.execute(
                    """INSERT INTO prof_leads
                       (name, company, email, phone, service_interest, status, source, notes,
                        session_id, conversation_text, budget_text, timeline_text, created_at, updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        name, company, email, phone, service_interest,
                        "nuevo", "whatsapp", notes,
                        session_id, transcript, budget, timeline,
                        now, now
                    )
                )
                row = tx.execute("SELECT * FROM prof_leads ORDER BY id DESC LIMIT 1").one()
                logger.info(f"✨ Nuevo Lead #{row['id']} ({name}) capturado automáticamente por IA en sesión {session_id}")
                return row

    def register_meeting(self, session_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """El cliente confirmó una reunión: guarda/actualiza el lead y lo pasa a «reunion» con la fecha."""
        lead = self.capture_lead_from_chat(session_id, args)
        when = str(args.get("fecha_hora") or "").strip()[:120] or "Por confirmar (reserva por enlace)"
        now = datetime.now(timezone.utc).isoformat()
        with self._tx() as tx:
            tx.execute("UPDATE prof_leads SET status = 'reunion', meeting_at = ?, updated_at = ? WHERE id = ?",
                       (when, now, lead["id"]))
            lead = tx.execute("SELECT * FROM prof_leads WHERE id = ?", (lead["id"],)).one()
        logger.info(f"📅 Reunión registrada para el lead #{lead['id']} ({lead.get('name')}): {when}")
        return lead

    def add_lead(self, data: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._tx() as tx:
            tx.execute(
                """INSERT INTO prof_leads
                   (name, company, email, phone, service_interest, status, source, notes,
                    session_id, conversation_text, budget_text, timeline_text, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    data["name"], data.get("company", ""), data.get("email", ""),
                    data.get("phone", ""), data.get("service_interest", ""),
                    data.get("status", "nuevo"), data.get("source", "manual"),
                    data.get("notes", ""), data.get("session_id", ""),
                    data.get("conversation_text", ""), data.get("budget_text", ""),
                    data.get("timeline_text", ""), now, now
                )
            )
            row = tx.execute("SELECT * FROM prof_leads ORDER BY id DESC LIMIT 1").one()
        return row

    def update_lead(self, lead_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        fields, vals = [], []
        allowed = ["name", "company", "email", "phone", "service_interest", "status", "source", "notes", "conversation_text", "budget_text", "timeline_text", "session_id", "meeting_at"]
        for col in allowed:
            if col in data and data[col] is not None:
                fields.append(f"{col} = ?")
                vals.append(data[col])
        if not fields:
            with self._tx() as tx:
                return tx.execute("SELECT * FROM prof_leads WHERE id=?", (lead_id,)).one()
        vals += [now, lead_id]
        with self._tx() as tx:
            tx.execute(
                f"UPDATE prof_leads SET {', '.join(fields)}, updated_at=? WHERE id=?", tuple(vals)
            )
            return tx.execute("SELECT * FROM prof_leads WHERE id=?", (lead_id,)).one()

    def delete_lead(self, lead_id: int) -> bool:
        with self._tx() as tx:
            tx.execute("DELETE FROM prof_leads WHERE id=?", (lead_id,))
        return True

    # -----------------------------------------------------------------------
    # Propuestas
    # -----------------------------------------------------------------------

    def list_proposals(self) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            return tx.execute(
                "SELECT * FROM prof_proposals ORDER BY created_at DESC"
            ).all()

    def add_proposal(self, data: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        services_json = json.dumps(data.get("services", []), ensure_ascii=False) if isinstance(data.get("services"), list) else (data.get("services") or "[]")
        with self._tx() as tx:
            tx.execute(
                """INSERT INTO prof_proposals
                   (lead_id, title, services, total_amount, valid_days, status, notes, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    data.get("lead_id"), data.get("title", ""),
                    services_json, data.get("total_amount", 0),
                    data.get("valid_days", 14), data.get("status", "borrador"),
                    data.get("notes", ""), now, now
                )
            )
            row = tx.execute("SELECT * FROM prof_proposals ORDER BY id DESC LIMIT 1").one()
        return row

    def update_proposal(self, proposal_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        fields, vals = [], []
        for col in ["title", "services", "total_amount", "valid_days", "status", "notes"]:
            if col in data and data[col] is not None:
                fields.append(f"{col} = ?")
                vals.append(data[col])
        if not fields:
            with self._tx() as tx:
                return tx.execute("SELECT * FROM prof_proposals WHERE id=?", (proposal_id,)).one()

        # Si propuesta pasa a aceptada → actualizar lead a cliente
        if data.get("status") == "aceptada":
            with self._tx() as tx:
                prop = tx.execute("SELECT lead_id FROM prof_proposals WHERE id=?", (proposal_id,)).one()
                if prop and prop.get("lead_id"):
                    tx.execute(
                        "UPDATE prof_leads SET status='cliente', updated_at=? WHERE id=?",
                        (now, prop["lead_id"])
                    )

        vals += [now, proposal_id]
        with self._tx() as tx:
            tx.execute(
                f"UPDATE prof_proposals SET {', '.join(fields)}, updated_at=? WHERE id=?", tuple(vals)
            )
            return tx.execute("SELECT * FROM prof_proposals WHERE id=?", (proposal_id,)).one()

    def delete_proposal(self, proposal_id: int) -> bool:
        with self._tx() as tx:
            tx.execute("DELETE FROM prof_proposals WHERE id=?", (proposal_id,))
        return True

    # -----------------------------------------------------------------------
    # Estadísticas
    # -----------------------------------------------------------------------

    def get_stats(self) -> Dict[str, Any]:
        try:
            with self._tx() as tx:
                services_active = tx.execute(
                    "SELECT COUNT(*) AS cnt FROM prof_services WHERE is_active=TRUE"
                ).one() or {"cnt": 0}

                leads_by_status = tx.execute(
                    "SELECT status, COUNT(*) AS cnt FROM prof_leads GROUP BY status"
                ).all()

                proposals_by_status = tx.execute(
                    "SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total "
                    "FROM prof_proposals GROUP BY status"
                ).all()

                total_leads = tx.execute(
                    "SELECT COUNT(*) AS cnt FROM prof_leads"
                ).one() or {"cnt": 0}

                total_clients = tx.execute(
                    "SELECT COUNT(*) AS cnt FROM prof_leads WHERE status='cliente'"
                ).one() or {"cnt": 0}

                pipeline_value = tx.execute(
                    "SELECT COALESCE(SUM(total_amount),0) AS total FROM prof_proposals "
                    "WHERE status IN ('enviada','negociacion')"
                ).one() or {"total": 0}

                closed_value = tx.execute(
                    "SELECT COALESCE(SUM(total_amount),0) AS total FROM prof_proposals "
                    "WHERE status='aceptada'"
                ).one() or {"total": 0}

            leads_map = {r["status"]: r["cnt"] for r in leads_by_status}
            proposals_map = {r["status"]: {"count": r["cnt"], "total": float(r["total"])} for r in proposals_by_status}

            tl = int(total_leads.get("cnt") or 0)
            tc = int(total_clients.get("cnt") or 0)
            conversion = round((tc / tl) * 100, 1) if tl > 0 else 0

            return {
                "services_active": int(services_active.get("cnt") or 0),
                "leads_total": tl,
                "leads_by_status": leads_map,
                "conversion_rate": conversion,
                "proposals_by_status": proposals_map,
                "pipeline_value": float(pipeline_value.get("total") or 0),
                "closed_value": float(closed_value.get("total") or 0),
                "clients_total": tc,
            }
        except Exception as e:
            logger.error(f"get_stats error: {e}")
            return {}


# Singleton global
prof_services_service = ProfessionalServicesService()
