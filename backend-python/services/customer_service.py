"""Memoria del cliente (base del ARM): historial de conversaciones persistente y ficha de cada cliente.

- Cada mensaje se guarda en `conversation_messages` (sobrevive a reinicios).
- Cada persona que escribe tiene una ficha en `customers`: nombre, teléfono, etapa, etiquetas, notas y un
  **resumen vivo** con sus datos clave, que un modelo de IA actualiza cada pocos mensajes.
- El agente lee esa memoria antes de responder (ver `memory_context`).
"""
import json
import logging
import re
import threading
from services.tenant_service import TenantReadyMixin, thread_target
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.customers")

STAGES = ("new", "interested", "customer", "loyal", "lost")
STAGE_LABELS = {"new": "Nuevo", "interested": "Interesado", "customer": "Cliente",
                "loyal": "Frecuente", "lost": "Perdido"}

# Tipos de entrada en la conversación:
#   user = cliente · assistant = agente IA · human = asesor desde el panel · action = acción del agente (pedido creado…)
CHAT_ROLES = ("user", "assistant", "human")
HISTORY_FOR_AGENT = 20          # mensajes que el agente recuerda de la conversación
SUMMARY_FIRST_AFTER = 4         # primer resumen tras 4 mensajes
SUMMARY_EVERY = 8               # luego, cada 8 mensajes nuevos
SUMMARY_WINDOW = 40             # mensajes que el resumidor lee
MAX_FACTS = 12
MAX_AUDIO_B64 = 12 * 1024 * 1024  # ~9 MB de audio

# Datos del NEGOCIO que cambian (horarios, precios, promociones, stock): nunca van a la memoria del cliente,
# la IA los toma en vivo de la configuración. El presupuesto del cliente sí es un dato suyo y se conserva.
_VOLATILE_RE = re.compile(
    r"horario|hora(s)? de (atenci[oó]n|apertura|cierre)|abre(n)? (a las|de)|cierra(n)? (a las|de)|"
    r"\d{1,2}(:\d{2})?\s*(am|pm|a\.\s?m\.|p\.\s?m\.)?\s*(a|-|–|hasta)\s*\d{1,2}(:\d{2})?\s*(am|pm|a\.\s?m\.|p\.\s?m\.)|"
    r"precio|tarifa|cuesta|costo|vale \$|promoci[oó]n|descuento|oferta|stock|disponibilidad del men[uú]",
    re.IGNORECASE)


def is_volatile_business_fact(text: Any) -> bool:
    t = str(text or "")
    if re.search(r"presupuesto", t, re.IGNORECASE):
        return False
    return bool(_VOLATILE_RE.search(t))
MAX_TAGS = 15


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def _channel_for(session_id: str) -> str:
    """WhatsApp identifica al cliente por su número o, en cuentas nuevas, por un ID interno «…@lid»."""
    sid = session_id or ""
    if re.fullmatch(r"\d{8,15}", sid) or re.fullmatch(r"\d{6,25}@(lid|s\.whatsapp\.net)", sid):
        return "whatsapp"
    return "web"


PLAYGROUND_PATTERN = "%playground-session"  # IDs del chat de prueba del panel (p. ej. «react-playground-session»)


def _phone_for(session_id: str) -> Optional[str]:
    """Teléfono real solo si el ID es un número (los IDs «@lid» no revelan el número)."""
    return session_id if re.fullmatch(r"\d{8,15}", session_id or "") else None


class CustomerService(TenantReadyMixin):
    def __init__(self):
        self._db = None
        self._ready = False
        self._summarizing: set = set()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # BASE DE DATOS
    # ------------------------------------------------------------------
    def _get_db(self):
        if self._db is None:
            from services.db_service import db_service
            self._db = db_service
        return self._db

    @contextmanager
    def _conn(self):
        db = self._get_db()
        pg = db.is_postgres
        raw = db._get_pg_connection() if pg else db._get_sqlite_connection()

        def run(sql: str, params: tuple = ()):
            if pg:
                cur = raw.cursor()
                cur.execute(sql.replace("?", "%s"), params)
            else:
                cur = raw.execute(sql, params)
            return cur

        def rows(cur) -> List[Dict[str, Any]]:
            if cur.description is None:
                return []
            names = [d[0] for d in cur.description]
            return [{n: _clean(v) for n, v in zip(names, (tuple(r) if not pg else r))} for r in cur.fetchall()]

        run.rows = rows
        run.pg = pg
        try:
            yield run
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    def init_tables(self) -> None:
        db = self._get_db()
        pk = "SERIAL PRIMARY KEY" if db.is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
        with self._conn() as run:
            run(f"""CREATE TABLE IF NOT EXISTS conversation_messages (
                id {pk}, session_id VARCHAR(120) NOT NULL, role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)""")
            run("CREATE INDEX IF NOT EXISTS idx_conv_msg_session ON conversation_messages(session_id, id)")
            run(f"""CREATE TABLE IF NOT EXISTS customers (
                id {pk}, session_id VARCHAR(120) NOT NULL UNIQUE, name VARCHAR(120), phone VARCHAR(40),
                channel VARCHAR(20) DEFAULT 'whatsapp', stage VARCHAR(20) DEFAULT 'new', stage_locked INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]', notes TEXT DEFAULT '', summary TEXT DEFAULT '', facts TEXT DEFAULT '[]',
                summary_updated_at VARCHAR(40), summary_msg_count INTEGER DEFAULT 0, message_count INTEGER DEFAULT 0,
                context_reset_at VARCHAR(40), first_seen_at VARCHAR(40), last_seen_at VARCHAR(40),
                created_at VARCHAR(40), updated_at VARCHAR(40))""")
            run("CREATE INDEX IF NOT EXISTS idx_customers_last_seen ON customers(last_seen_at)")
            # Notas de voz de los clientes (para escucharlas en la bandeja)
            run("""CREATE TABLE IF NOT EXISTS conversation_media (
                message_id INTEGER PRIMARY KEY, session_id VARCHAR(120) NOT NULL, mime VARCHAR(80) NOT NULL,
                data TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)""")
            cols = ({r["column_name"] for r in run.rows(run(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'customers'"))}
                if run.pg else {r["name"] for r in run.rows(run("PRAGMA table_info(customers)"))})
            for col in ("current_agent", "current_agent_at"):
                if col not in cols:
                    run(f"ALTER TABLE customers ADD COLUMN {col} VARCHAR(40)")  # área que atiende el chat
            if "avatar_url" not in cols:
                run("ALTER TABLE customers ADD COLUMN avatar_url TEXT")  # foto de perfil de WhatsApp
            if "removed_facts" not in cols:
                # Datos que el equipo borró a mano de la memoria: la IA no debe volver a agregarlos
                run("ALTER TABLE customers ADD COLUMN removed_facts TEXT DEFAULT '[]'")
            # Chats de WhatsApp con ID «@lid» que se guardaron como «web» antes de reconocerlos
            run("UPDATE customers SET channel = 'whatsapp' WHERE channel = 'web' AND session_id LIKE ?", ("%@lid",))
        self._ready = True
        logger.info("✅ Memoria de clientes lista (conversaciones y fichas).")

    def _ensure(self):
        if not self._ready:
            self.init_tables()

    @staticmethod
    def _decode(c: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not c:
            return c
        for key in ("tags", "facts", "removed_facts"):
            try:
                c[key] = json.loads(c.get(key) or "[]")
            except (TypeError, ValueError):
                c[key] = []
        c["stage_locked"] = bool(int(c.get("stage_locked") or 0))
        c["stage_label"] = STAGE_LABELS.get(c.get("stage"), c.get("stage"))
        return c

    # ------------------------------------------------------------------
    # MENSAJES
    # ------------------------------------------------------------------
    def record_message(self, session_id: str, role: str, content: str, contact_name: Optional[str] = None) -> None:
        """Guarda el mensaje y mantiene la ficha del cliente (la crea en su primer mensaje)."""
        self._ensure()
        now = _now()
        with self._conn() as run:
            run("INSERT INTO conversation_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content or "", now))
            exists = run.rows(run("SELECT id, name FROM customers WHERE session_id = ?", (session_id,)))
            if not exists:
                channel = _channel_for(session_id)
                run("""INSERT INTO customers (session_id, name, phone, channel, first_seen_at, last_seen_at,
                       message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                    (session_id, (contact_name or "").strip()[:120] or None,
                     _phone_for(session_id), channel, now, now, now, now))
            elif role in CHAT_ROLES:
                # last_seen_at = último mensaje del cliente (lo usan las automatizaciones de inactividad)
                seen = "last_seen_at = ?, " if role == "user" else ""
                run(f"UPDATE customers SET message_count = message_count + 1, {seen}updated_at = ? WHERE session_id = ?",
                    ((now, now, session_id) if role == "user" else (now, session_id)))
                if contact_name and not exists[0].get("name"):
                    run("UPDATE customers SET name = ? WHERE session_id = ?", (contact_name.strip()[:120], session_id))

    def set_avatar(self, session_id: str, url: Optional[str]) -> None:
        """Guarda (o borra, si llega vacía) la URL de la foto de perfil de WhatsApp."""
        self._ensure()
        url = (url or "").strip() or None
        if url and not url.startswith("https://"):
            return
        with self._conn() as run:
            run("UPDATE customers SET avatar_url = ? WHERE session_id = ?", (url, session_id))

    def note_contact(self, session_id: str, name: str) -> None:
        """Registra el nombre de perfil (WhatsApp) si la ficha aún no tiene nombre. Crea la ficha si no existe."""
        self._ensure()
        name = (name or "").strip()[:120]
        if not name:
            return
        now = _now()
        with self._conn() as run:
            row = run.rows(run("SELECT name FROM customers WHERE session_id = ?", (session_id,)))
            if not row:
                channel = _channel_for(session_id)
                run("""INSERT INTO customers (session_id, name, phone, channel, first_seen_at, last_seen_at,
                       message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                    (session_id, name, _phone_for(session_id), channel, now, now, now, now))
            elif not row[0].get("name"):
                run("UPDATE customers SET name = ?, updated_at = ? WHERE session_id = ?", (name, now, session_id))

    def remember(self, session_id: str, name: Optional[str] = None, fact: Optional[str] = None,
                 tag: Optional[str] = None) -> List[str]:
        """El agente guarda al instante lo que el cliente acaba de contar. No pisa un nombre ya registrado."""
        self._ensure()
        c = self.get_by_session(session_id)
        saved, sets, params = [], [], []
        if not c:
            self.note_contact(session_id, name or "")
            c = self.get_by_session(session_id)
            if not c:
                return []
            if c.get("name"):
                saved.append("nombre")  # la ficha se creó ya con el nombre
        if name and name.strip() and not c.get("name"):
            sets.append("name = ?")
            params.append(name.strip()[:120])
            saved.append("nombre")
        if fact and fact.strip():
            facts = list(c.get("facts") or [])
            clean = fact.strip()[:160]
            if clean.lower() not in [f.lower() for f in facts]:
                facts = (facts + [clean])[-MAX_FACTS:]
                sets.append("facts = ?")
                params.append(json.dumps(facts, ensure_ascii=False))
                saved.append("dato")
        if tag and tag.strip():
            tags = self._norm_tags(list(c.get("tags") or []) + [tag])
            if tags != c.get("tags"):
                sets.append("tags = ?")
                params.append(json.dumps(tags, ensure_ascii=False))
                saved.append("etiqueta")
        if sets:
            with self._conn() as run:
                run(f"UPDATE customers SET {', '.join(sets)}, updated_at = ? WHERE session_id = ?",
                    tuple(params + [_now(), session_id]))
        return saved

    def get_agent(self, session_id: str) -> Optional[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run("SELECT current_agent, current_agent_at FROM customers WHERE session_id = ?", (session_id,)))
        if not rows or not rows[0].get("current_agent"):
            return None
        return {"agent": rows[0]["current_agent"], "at": rows[0]["current_agent_at"]}

    def set_agent(self, session_id: str, agent_key: str) -> None:
        self._ensure()
        now = _now()
        with self._conn() as run:
            exists = run.rows(run("SELECT 1 FROM customers WHERE session_id = ?", (session_id,)))
            if not exists:
                channel = _channel_for(session_id)
                run("""INSERT INTO customers (session_id, phone, channel, first_seen_at, last_seen_at, message_count,
                       created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
                    (session_id, _phone_for(session_id), channel, now, now, now, now))
            run("UPDATE customers SET current_agent = ?, current_agent_at = ? WHERE session_id = ?",
                (agent_key, now, session_id))

    def replace_last_assistant(self, session_id: str, content: str) -> None:
        """La respuesta final al cliente puede diferir del texto del modelo (p. ej. confirmación de pedido)."""
        self._ensure()
        with self._conn() as run:
            last = run.rows(run("SELECT id, role FROM conversation_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
                                (session_id,)))
            if last and last[0]["role"] == "assistant":
                run("UPDATE conversation_messages SET content = ? WHERE id = ?", (content, last[0]["id"]))

    def load_recent(self, session_id: str, limit: int = HISTORY_FOR_AGENT) -> List[Dict[str, str]]:
        """Últimos mensajes de la conversación (desde el último «reiniciar conversación»), en orden."""
        self._ensure()
        with self._conn() as run:
            cust = run.rows(run("SELECT context_reset_at FROM customers WHERE session_id = ?", (session_id,)))
            since = (cust[0].get("context_reset_at") if cust else None) or ""
            rows = run.rows(run(
                "SELECT role, content FROM conversation_messages WHERE session_id = ? AND created_at > ? "
                "AND role IN ('user', 'assistant', 'human') ORDER BY id DESC LIMIT ?", (session_id, since, limit)))
        # Para el modelo, lo que escribió un asesor también es «del negocio»
        return [{"role": "user" if r["role"] == "user" else "assistant", "content": r["content"]} for r in reversed(rows)]

    def reset_context(self, session_id: str) -> None:
        """El agente empieza de cero, pero el historial y la ficha se conservan."""
        self._ensure()
        with self._conn() as run:
            run("UPDATE customers SET context_reset_at = ?, updated_at = ? WHERE session_id = ?",
                (_now(), _now(), session_id))

    def list_messages(self, customer_id: int, before_id: Optional[int] = None, limit: int = 50) -> List[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            cust = run.rows(run("SELECT session_id FROM customers WHERE id = ?", (customer_id,)))
            if not cust:
                return []
            sql = "SELECT id, role, content, created_at FROM conversation_messages WHERE session_id = ?"
            params: list = [cust[0]["session_id"]]
            if before_id:
                sql += " AND id < ?"
                params.append(before_id)
            sql += " ORDER BY id DESC LIMIT ?"
            params.append(limit)
            msgs = list(reversed(run.rows(run(sql, tuple(params)))))
            ids = [m["id"] for m in msgs]
            media = {}
            if ids:
                marks = ",".join("?" for _ in ids)
                media = {r["message_id"]: r["mime"] for r in run.rows(run(
                    f"SELECT message_id, mime FROM conversation_media WHERE message_id IN ({marks})", tuple(ids)))}
            for m in msgs:
                mime = media.get(m["id"]) or ""
                m["media"] = "image" if mime.startswith("image/") else "audio" if mime.startswith("audio/") else None
                m["has_audio"] = m["media"] == "audio"
            return msgs

    # ------------------------------------------------------------------
    # NOTAS DE VOZ
    # ------------------------------------------------------------------
    def attach_audio(self, session_id: str, audio_base64: str, mime: Optional[str]) -> None:
        self.attach_media(session_id, audio_base64, mime or "audio/ogg")

    def attach_media(self, session_id: str, data_base64: str, mime: Optional[str], role: str = "user") -> None:
        """Guarda la nota de voz o imagen junto al último mensaje de ese rol en esta conversación."""
        if not data_base64 or len(data_base64) > MAX_AUDIO_B64:
            return
        self._ensure()
        mime = (mime or "application/octet-stream").split(";")[0].strip()[:80]
        if not (mime.startswith("audio/") or mime.startswith("image/")):
            return
        with self._conn() as run:
            last = run.rows(run("SELECT id FROM conversation_messages WHERE session_id = ? AND role = ? "
                                "ORDER BY id DESC LIMIT 1", (session_id, role)))
            if not last:
                return
            mid = last[0]["id"]
            if run.rows(run("SELECT message_id FROM conversation_media WHERE message_id = ?", (mid,))):
                return
            run("INSERT INTO conversation_media (message_id, session_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)",
                (mid, session_id, mime, data_base64, _now()))

    def get_audio(self, customer_id: int, message_id: int) -> Optional[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run(
                "SELECT m.mime, m.data FROM conversation_media m JOIN customers c ON c.session_id = m.session_id "
                "WHERE c.id = ? AND m.message_id = ?", (customer_id, message_id)))
        return rows[0] if rows else None

    # ------------------------------------------------------------------
    # FICHAS
    # ------------------------------------------------------------------
    def get_by_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run("SELECT * FROM customers WHERE session_id = ?", (session_id,)))
        return self._decode(rows[0]) if rows else None

    def get(self, customer_id: int) -> Optional[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run("SELECT * FROM customers WHERE id = ?", (customer_id,)))
        if not rows:
            return None
        customer = self._decode(rows[0])
        customer["orders"] = self._order_stats(customer["session_id"])
        return customer

    def list(self, search: str = "", stage: str = "", tag: str = "", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self._ensure()
        # El chat de prueba del panel no es un cliente real: no sale en la bandeja ni en Clientes
        where, params = ["session_id NOT LIKE ?"], [PLAYGROUND_PATTERN]
        if search:
            like = f"%{search.strip().lower()}%"
            where.append("(LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ? OR LOWER(session_id) LIKE ? "
                         "OR LOWER(COALESCE(summary,'')) LIKE ? OR LOWER(COALESCE(notes,'')) LIKE ?)")
            params += [like] * 5
        if stage in STAGES:
            where.append("stage = ?")
            params.append(stage)
        if tag:
            where.append("LOWER(tags) LIKE ?")
            params.append(f'%"{tag.strip().lower()}"%')
        sql_where = " AND ".join(where)
        with self._conn() as run:
            total = run.rows(run(f"SELECT COUNT(*) AS n FROM customers WHERE {sql_where}", tuple(params)))[0]["n"]
            rows = run.rows(run(
                f"SELECT * FROM customers WHERE {sql_where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?",
                tuple(params + [limit, offset])))
            counts = run.rows(run("SELECT stage, COUNT(*) AS n FROM customers WHERE session_id NOT LIKE ? GROUP BY stage",
                                  (PLAYGROUND_PATTERN,)))
        return {
            "customers": [self._decode(r) for r in rows],
            "total": int(total),
            "by_stage": {r["stage"]: int(r["n"]) for r in counts},
        }

    def conversations(self, search: str = "", only: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        """Bandeja: chats ordenados por actividad, con el último mensaje y si los atiende un asesor."""
        from services.lead_service import lead_service
        data = self.list(search=search, limit=limit if only != "human" else 200)
        out = []
        with self._conn() as run:
            for c in data["customers"]:
                last = run.rows(run(
                    "SELECT role, content, created_at FROM conversation_messages WHERE session_id = ? "
                    "AND role IN ('user', 'assistant', 'human') ORDER BY id DESC LIMIT 1", (c["session_id"],)))
                if not last:
                    continue
                try:
                    human = lead_service.is_transferred(c["session_id"])
                except Exception:
                    human = False
                if only == "human" and not human:
                    continue
                out.append({"id": c["id"], "session_id": c["session_id"], "name": c.get("name"), "phone": c.get("phone"), "channel": c.get("channel"),
                            "avatar_url": c.get("avatar_url"), "stage": c["stage"], "stage_label": c["stage_label"], "tags": c.get("tags") or [],
                            "human": human, "last_role": last[0]["role"], "last_message": last[0]["content"][:160],
                            "last_at": last[0]["created_at"]})
        out.sort(key=lambda x: x["last_at"] or "", reverse=True)
        return out[:limit]

    def update(self, customer_id: int, name: Optional[str] = None, phone: Optional[str] = None,
               tags: Optional[List[str]] = None, notes: Optional[str] = None, stage: Optional[str] = None,
               summary: Optional[str] = None, facts: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
        """Edición manual desde el panel. Si una persona fija la etapa, la IA deja de cambiarla."""
        self._ensure()
        sets, params = [], []
        if summary is not None:
            sets.append("summary = ?")
            params.append(summary.strip()[:1200])
        if facts is not None:
            current = self.get(customer_id)
            if not current:
                return None
            new_facts = []
            for f in facts:
                f = re.sub(r"s+", " ", str(f)).strip()[:160]
                if f and f.lower() not in [x.lower() for x in new_facts]:
                    new_facts.append(f)
            new_facts = new_facts[:MAX_FACTS]
            kept = {f.lower() for f in new_facts}
            # Lo que el equipo quita queda bloqueado para que el resumen automático no lo vuelva a agregar
            blocked = [f for f in (current.get("removed_facts") or []) if f.lower() not in kept]
            for f in current.get("facts") or []:
                if f.lower() not in kept and f.lower() not in [b.lower() for b in blocked]:
                    blocked.append(f)
            sets += ["facts = ?", "removed_facts = ?"]
            params += [json.dumps(new_facts, ensure_ascii=False), json.dumps(blocked[-30:], ensure_ascii=False)]
        if name is not None:
            sets.append("name = ?")
            params.append(name.strip()[:120] or None)
        if phone is not None:
            sets.append("phone = ?")
            params.append(phone.strip()[:40] or None)
        if tags is not None:
            sets.append("tags = ?")
            params.append(json.dumps(self._norm_tags(tags), ensure_ascii=False))
        if notes is not None:
            sets.append("notes = ?")
            params.append(notes[:4000])
        if stage is not None:
            if stage not in STAGES:
                raise ValueError("Etapa no válida.")
            sets += ["stage = ?", "stage_locked = 1"]
            params.append(stage)
        if sets:
            sets.append("updated_at = ?")
            params.append(_now())
            with self._conn() as run:
                run(f"UPDATE customers SET {', '.join(sets)} WHERE id = ?", tuple(params + [customer_id]))
        return self.get(customer_id)

    @staticmethod
    def _norm_tags(tags: List[str]) -> List[str]:
        out = []
        for t in tags or []:
            t = re.sub(r"\s+", " ", str(t)).strip().lower()[:30]
            if t and t not in out:
                out.append(t)
        return out[:MAX_TAGS]

    def _order_stats(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Resumen de compras si el módulo de restaurante existe (pedidos no cancelados)."""
        try:
            with self._conn() as run:
                exists = run.rows(run(
                    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'restaurant_orders'" if run.pg else
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='restaurant_orders'"))
                if not exists:
                    return None
                stats = run.rows(run(
                    "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS spent, MAX(created_at) AS last_at "
                    "FROM restaurant_orders WHERE session_id = ? AND status <> 'cancelled'", (session_id,)))[0]
                recent = run.rows(run(
                    "SELECT id, total, status, items_json, created_at FROM restaurant_orders WHERE session_id = ? "
                    "ORDER BY id DESC LIMIT 5", (session_id,)))
        except Exception as e:
            logger.debug(f"Sin estadísticas de pedidos para {session_id}: {e}")
            return None
        for r in recent:
            try:
                items = json.loads(r.pop("items_json") or "[]")
                r["items"] = ", ".join(f"{i.get('quantity', 1)}x {i.get('name', '')}" for i in items)
            except (TypeError, ValueError):
                r["items"] = ""
            r["total"] = float(r["total"] or 0)
        return {"count": int(stats["n"]), "total_spent": round(float(stats["spent"] or 0), 2),
                "last_order_at": stats["last_at"], "recent": recent}

    # ------------------------------------------------------------------
    # MEMORIA PARA EL AGENTE
    # ------------------------------------------------------------------
    def memory_context(self, session_id: str) -> str:
        """Bloque breve que acompaña al mensaje del cliente: quién es y qué se sabe de él."""
        try:
            c = self.get_by_session(session_id)
        except Exception as e:
            logger.debug(f"Sin memoria de cliente para {session_id}: {e}")
            return ""
        if not c:
            return ""
        parts = []
        if c.get("name"):
            parts.append(f"Nombre: {c['name']}.")
        parts.append(f"Etapa: {c['stage_label']}.")
        orders = self._order_stats(session_id)
        if orders and orders["count"]:
            last = orders["recent"][0] if orders["recent"] else None
            parts.append(f"Pedidos anteriores: {orders['count']} (total ${orders['total_spent']:.2f})"
                         + (f"; el último fue: {last['items']}." if last and last.get("items") else "."))
        if c.get("summary"):
            parts.append(f"Resumen: {c['summary']}")
        # Las fichas viejas pueden traer horarios o precios: nunca se le pasan a la IA
        facts = [f for f in (c.get("facts") or []) if not is_volatile_business_fact(f)]
        if facts:
            parts.append("Datos clave: " + "; ".join(facts) + ".")
        if c.get("notes"):
            parts.append(f"Notas del equipo: {c['notes'][:300]}")
        if len(parts) <= 1:
            return ""
        return ("[MEMORIA DEL CLIENTE — úsala con naturalidad para personalizar (ej. saludar por su nombre, "
                "sugerir lo que suele pedir); no la recites ni digas que tienes una ficha] " + " ".join(parts))

    # ------------------------------------------------------------------
    # RESUMEN VIVO
    # ------------------------------------------------------------------
    def maybe_refresh_summary(self, session_id: str, background: bool = True) -> bool:
        """Lanza la actualización del resumen si hubo suficientes mensajes nuevos desde el último."""
        try:
            c = self.get_by_session(session_id)
        except Exception:
            return False
        if not c:
            return False
        pending = int(c["message_count"] or 0) - int(c["summary_msg_count"] or 0)
        due = pending >= (SUMMARY_FIRST_AFTER if not c.get("summary") else SUMMARY_EVERY)
        if not due:
            return False
        with self._lock:
            if session_id in self._summarizing:
                return False
            self._summarizing.add(session_id)
        if background:
            threading.Thread(target=thread_target(self._summarize_safe), args=(session_id,), daemon=True).start()
        else:
            self._summarize_safe(session_id)
        return True

    def _summarize_safe(self, session_id: str) -> None:
        try:
            self.refresh_summary(session_id)
        except Exception as e:
            logger.warning(f"No se pudo actualizar el resumen de {session_id}: {e}")
        finally:
            with self._lock:
                self._summarizing.discard(session_id)

    def refresh_summary(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Lee la conversación y actualiza resumen, datos clave, nombre, etapa y etiquetas sugeridas."""
        c = self.get_by_session(session_id)
        if not c:
            return None
        with self._conn() as run:
            msgs = run.rows(run("SELECT role, content FROM conversation_messages WHERE session_id = ? "
                                "AND role IN ('user', 'assistant', 'human') ORDER BY id DESC LIMIT ?",
                                (session_id, SUMMARY_WINDOW)))
            total = run.rows(run("SELECT message_count FROM customers WHERE session_id = ?", (session_id,)))[0]["message_count"]
        if not msgs:
            return c
        who = {"user": "Cliente", "assistant": "Asistente", "human": "Asesor"}
        transcript = "\n".join(f"{who.get(m['role'], 'Asistente')}: {m['content'][:400]}"
                               for m in reversed(msgs))
        result = self._call_llm(self._summary_prompt(c, transcript))
        if not result:
            return c

        blocked = {str(b).strip().lower() for b in (c.get("removed_facts") or [])}
        facts = [str(f).strip()[:160] for f in (result.get("facts") or [])
                 if str(f).strip() and not is_volatile_business_fact(str(f))
                 and str(f).strip()[:160].lower() not in blocked][:MAX_FACTS]
        tags = self._norm_tags(list(c.get("tags") or []) + list(result.get("tags") or []))
        stage = result.get("stage") if result.get("stage") in STAGES else c["stage"]
        if c["stage_locked"]:
            stage = c["stage"]
        name = c.get("name") or (str(result.get("name") or "").strip()[:120] or None)
        with self._conn() as run:
            run("""UPDATE customers SET summary = ?, facts = ?, tags = ?, stage = ?, name = ?,
                   summary_updated_at = ?, summary_msg_count = ?, updated_at = ? WHERE session_id = ?""",
                (str(result.get("summary") or c.get("summary") or "")[:1200], json.dumps(facts, ensure_ascii=False),
                 json.dumps(tags, ensure_ascii=False), stage, name, _now(), int(total), _now(), session_id))
        logger.info(f"🧠 Memoria de {session_id} actualizada ({len(facts)} datos clave, etapa {stage}).")
        return self.get_by_session(session_id)

    @staticmethod
    def _summary_prompt(c: Dict[str, Any], transcript: str) -> str:
        return (
            "Eres el analista de clientes de un negocio. Con la conversación, actualiza la ficha del cliente. "
            "Responde SOLO un JSON con: "
            '"summary" (2-3 oraciones: quién es, qué busca o compra, estado actual), '
            '"facts" (lista de hasta 10 datos útiles y estables para atenderlo mejor: preferencias, restricciones, '
            'dirección o zona habitual, forma de pago preferida, fechas importantes; nada inventado. '
            'SOLO datos del CLIENTE, nunca del negocio: PROHIBIDO guardar horarios de atención, precios, tarifas, '
            'costos, promociones, descuentos, stock, menú o catálogo, porque cambian y la IA los consulta en vivo), '
            '"summary" tampoco debe mencionar horarios ni precios del negocio, '
            '"name" (su nombre si lo dijo, o null), '
            f'"stage" (uno de: {", ".join(STAGES)}; new=solo saludó, interested=pregunta o cotiza, customer=ya compró, '
            'loyal=compra seguido, lost=se quejó o dijo que no volverá), '
            '"tags" (hasta 3 etiquetas cortas en minúsculas, p. ej. "domicilio", "vegetariano", "mayorista").\n\n'
            f"Ficha actual: resumen={c.get('summary') or '-'}; "
            f"datos={[f for f in (c.get('facts') or []) if not is_volatile_business_fact(f)]}; etapa={c.get('stage')}.\n"
            + (f"El equipo BORRÓ a mano estos datos por incorrectos o irrelevantes; no los vuelvas a incluir "
               f"ni nada equivalente: {c.get('removed_facts')}.\n" if c.get('removed_facts') else "")
            + "La ficha actual pudo ser corregida por el equipo: respeta esas correcciones.\n\n"
            f"Conversación (más reciente al final):\n{transcript}\n\nJSON:"
        )

    @staticmethod
    def _call_llm(prompt: str) -> Optional[Dict[str, Any]]:
        """Gemini (modelo configurado) y, si falla, OpenAI. Salida JSON."""
        from config import settings
        try:
            key = (settings.GEMINI_API_KEY or "").strip()
            if key and not key.startswith("AIzaSyFake"):
                from google import genai
                from google.genai import types
                cfg = {"temperature": 0.2, "max_output_tokens": 600, "response_mime_type": "application/json"}
                if hasattr(types, "ThinkingConfig"):
                    cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
                # El cliente debe seguir vivo durante la petición (si no, «the client has been closed»)
                client = genai.Client(api_key=key, http_options={"api_version": "v1beta"})
                resp = client.models.generate_content(
                    model=settings.GEMINI_MODEL or "gemini-2.5-flash", contents=prompt,
                    config=types.GenerateContentConfig(**cfg))
                if resp and resp.text:
                    return json.loads(resp.text)
        except Exception as e:
            logger.warning(f"Resumen con Gemini falló: {e}")
        try:
            key = (settings.OPENAI_API_KEY or "").strip()
            if key and not key.startswith("sk-fake"):
                import openai
                resp = openai.OpenAI(api_key=key).chat.completions.create(
                    model=settings.OPENAI_MODEL or "gpt-4o-mini", temperature=0.2, max_tokens=600,
                    response_format={"type": "json_object"},
                    messages=[{"role": "user", "content": prompt}])
                return json.loads(resp.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Resumen con OpenAI falló: {e}")
        return None


customer_service = CustomerService()
