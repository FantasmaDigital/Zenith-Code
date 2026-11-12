"""Agente proactivo: automatizaciones que detectan oportunidades y escriben al cliente por iniciativa propia.

Flujo:
  1. Cada pocos minutos se revisan las automatizaciones activas (reactivar clientes, pedir opinión tras un
     pedido, dar seguimiento a interesados).
  2. Por cada cliente que cumple la condición, el agente redacta un mensaje personalizado con su memoria.
  3. Según la automatización, el mensaje se envía solo o espera aprobación humana en la bandeja.
  4. Límites de seguridad: horario de envío, máximo de mensajes por cliente, clientes que pidieron no ser
     contactados, chats en manos de un asesor y ventana de 24 h de Meta.
Todo queda registrado como una tarea con su estado.
"""
import json
import logging
import threading
from services.tenant_service import DEFAULT_TENANT, TenantReadyMixin, tenant_context, tenant_registry
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.automations")

SCAN_INTERVAL_SECONDS = 300
MAX_CANDIDATES_PER_SCAN = 25
OPT_OUT_TAG = "no-contactar"
OPT_OUT_PHRASES = ("no me escriban", "no me escribas", "no quiero mensajes", "darme de baja", "dame de baja",
                   "no me manden", "dejen de escribir", "deja de escribir", "no me molesten")

DEFAULT_GUARDRAILS = {
    "quiet_start": "20:00",       # no escribir desde esta hora…
    "quiet_end": "08:00",         # …hasta esta (hora local del negocio)
    "min_days_between": 7,        # días mínimos entre dos mensajes proactivos al mismo cliente
}

# Automatizaciones incluidas. `params` se pueden editar desde el panel.
PLAYBOOKS = {
    "reactivation": {
        "name": "Reactivar clientes inactivos",
        "description": "Escribe a clientes que ya compraron pero no han vuelto a escribir en un tiempo, con un mensaje cálido y una razón para volver.",
        "default_mode": "approve",
        "params": {"inactive_days": 30},
        "goal": "Reactivar a un cliente que ya compró y no ha vuelto. Mensaje cálido, breve, que lo haga sentir recordado; menciona algo que le gusta si lo sabes. Invítalo a pedir de nuevo sin presionar.",
    },
    "post_order_feedback": {
        "name": "Pedir opinión después del pedido",
        "description": "Unas horas después de entregar un pedido, pregunta al cliente cómo le fue. Detecta problemas a tiempo y muestra atención.",
        "default_mode": "auto",
        "params": {"hours_after": 2},
        "requires": "restaurant",
        "goal": "Preguntar cómo le fue con su pedido recién entregado. Una sola pregunta corta y cálida; agradece la compra.",
    },
    "follow_up_interested": {
        "name": "Seguimiento a interesados",
        "description": "Si alguien preguntó o cotizó pero no concretó, le da seguimiento a los días para resolver dudas.",
        "default_mode": "approve",
        "params": {"days_without_reply": 2},
        "goal": "Dar seguimiento a alguien que preguntó o cotizó y no concretó. Retoma lo que buscaba, ofrece resolver dudas y facilita el siguiente paso. Sin presionar.",
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _clean(v):
    return v.isoformat() if isinstance(v, datetime) else v


class AutomationService(TenantReadyMixin):
    def __init__(self):
        self._db = None
        self._ready = False
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._scan_lock = threading.Lock()

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
            cur = raw.cursor() if pg else None
            if pg:
                cur.execute(sql.replace("?", "%s"), params)
                return cur
            return raw.execute(sql, params)

        def rows(cur) -> List[Dict[str, Any]]:
            if cur.description is None:
                return []
            names = [d[0] for d in cur.description]
            return [{n: _clean(v) for n, v in zip(names, tuple(r))} for r in cur.fetchall()]

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
            run(f"""CREATE TABLE IF NOT EXISTS agent_playbooks (
                key VARCHAR(50) PRIMARY KEY, enabled INTEGER DEFAULT 0, mode VARCHAR(20) DEFAULT 'approve',
                params TEXT DEFAULT '{{}}', updated_at VARCHAR(40))""")
            run(f"""CREATE TABLE IF NOT EXISTS agent_tasks (
                id {pk}, playbook VARCHAR(50) NOT NULL, session_id VARCHAR(120) NOT NULL, customer_id INTEGER,
                customer_name VARCHAR(120), reason TEXT, message TEXT, status VARCHAR(30) NOT NULL,
                dedupe_key VARCHAR(200) NOT NULL UNIQUE, error TEXT, decided_by VARCHAR(100),
                created_at VARCHAR(40) NOT NULL, decided_at VARCHAR(40), sent_at VARCHAR(40))""")
            cols = ({r["column_name"] for r in run.rows(run(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agent_tasks'"))}
                if run.pg else {r["name"] for r in run.rows(run("PRAGMA table_info(agent_tasks)"))})
            if "payload" not in cols:
                run("ALTER TABLE agent_tasks ADD COLUMN payload TEXT")  # argumentos de una acción por aprobar
            run("CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, created_at)")
            run("CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id, sent_at)")
            existing = {r["key"] for r in run.rows(run("SELECT key FROM agent_playbooks"))}
            for key, pb in PLAYBOOKS.items():
                if key not in existing:
                    # Todas empiezan apagadas: el dueño decide qué activar
                    run("INSERT INTO agent_playbooks (key, enabled, mode, params, updated_at) VALUES (?, 0, ?, ?, ?)",
                        (key, pb["default_mode"], json.dumps(pb["params"]), _iso(_now())))
        self._ready = True
        logger.info("✅ Agente proactivo listo (automatizaciones y bandeja de aprobación).")

    def _ensure(self):
        if not self._ready:
            self.init_tables()

    # ------------------------------------------------------------------
    # CONFIGURACIÓN
    # ------------------------------------------------------------------
    def guardrails(self) -> Dict[str, Any]:
        try:
            raw = self._get_db().get_setting("AGENT_GUARDRAILS", "")
            stored = json.loads(raw) if raw else {}
        except Exception:
            stored = {}
        return {**DEFAULT_GUARDRAILS, **(stored if isinstance(stored, dict) else {})}

    def save_guardrails(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        merged = {**self.guardrails(), **{k: v for k, v in updates.items() if k in DEFAULT_GUARDRAILS and v is not None}}
        self._get_db().set_setting("AGENT_GUARDRAILS", json.dumps(merged))
        return merged

    def list_playbooks(self) -> List[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            stored = {r["key"]: r for r in run.rows(run("SELECT * FROM agent_playbooks"))}
        installed = self._installed_modules()
        out = []
        for key, pb in PLAYBOOKS.items():
            row = stored.get(key, {})
            params = {**pb["params"], **json.loads(row.get("params") or "{}")}
            requires = pb.get("requires")
            out.append({
                "key": key, "name": pb["name"], "description": pb["description"],
                "enabled": bool(int(row.get("enabled") or 0)), "mode": row.get("mode") or pb["default_mode"],
                "params": params, "requires": requires, "available": not requires or requires in installed,
            })
        return out

    def update_playbook(self, key: str, enabled: Optional[bool] = None, mode: Optional[str] = None,
                        params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if key not in PLAYBOOKS:
            raise ValueError("Automatización no encontrada.")
        if mode is not None and mode not in ("auto", "approve"):
            raise ValueError("El modo debe ser 'auto' o 'approve'.")
        current = next(p for p in self.list_playbooks() if p["key"] == key)
        if enabled and not current["available"]:
            raise ValueError(f"Esta automatización necesita el módulo «{current['requires']}» instalado.")
        new_params = dict(current["params"])
        for k, v in (params or {}).items():
            if k in PLAYBOOKS[key]["params"]:
                new_params[k] = max(1, min(365, int(v)))
        with self._conn() as run:
            run("UPDATE agent_playbooks SET enabled = ?, mode = ?, params = ?, updated_at = ? WHERE key = ?",
                (1 if (current["enabled"] if enabled is None else enabled) else 0, mode or current["mode"],
                 json.dumps(new_params), _iso(_now()), key))
        return next(p for p in self.list_playbooks() if p["key"] == key)

    @staticmethod
    def _installed_modules() -> set:
        try:
            from modules.registry import module_registry
            return {mid for mid in PLAYBOOKS_REQUIRED if module_registry.is_loaded(mid)}
        except Exception:
            return set()

    # ------------------------------------------------------------------
    # CANDIDATOS
    # ------------------------------------------------------------------
    def _table_exists(self, run, name: str) -> bool:
        sql = ("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?" if run.pg
               else "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        return bool(run.rows(run(sql, (name,))))

    def _candidates(self, key: str, params: Dict[str, Any], now: datetime) -> List[Dict[str, Any]]:
        """Clientes que cumplen la condición. Cada uno trae `dedupe` (no repetir la misma oportunidad) y `reason`."""
        with self._conn() as run:
            if key == "reactivation":
                cutoff = _iso(now - timedelta(days=int(params["inactive_days"])))
                rows = run.rows(run(
                    "SELECT id, session_id, name, last_seen_at FROM customers "
                    "WHERE stage IN ('customer', 'loyal') AND last_seen_at < ? ORDER BY last_seen_at LIMIT ?",
                    (cutoff, MAX_CANDIDATES_PER_SCAN)))
                return [{**r, "reason": f"Sin escribir desde hace más de {params['inactive_days']} días.",
                         "dedupe": f"reactivation:{r['session_id']}:{r['last_seen_at'][:10]}"} for r in rows]

            if key == "follow_up_interested":
                cutoff = _iso(now - timedelta(days=int(params["days_without_reply"])))
                rows = run.rows(run(
                    "SELECT id, session_id, name, last_seen_at FROM customers "
                    "WHERE stage = 'interested' AND last_seen_at < ? ORDER BY last_seen_at DESC LIMIT ?",
                    (cutoff, MAX_CANDIDATES_PER_SCAN)))
                return [{**r, "reason": f"Preguntó o cotizó y no ha respondido en {params['days_without_reply']} días.",
                         "dedupe": f"follow_up:{r['session_id']}:{r['last_seen_at'][:10]}"} for r in rows]

            if key == "post_order_feedback":
                if not self._table_exists(run, "restaurant_orders"):
                    return []
                hours = int(params["hours_after"])
                newest, oldest = _iso(now - timedelta(hours=hours)), _iso(now - timedelta(hours=hours + 24))
                rows = run.rows(run(
                    "SELECT o.id AS order_id, o.session_id, o.customer_name AS name, c.id "
                    "FROM restaurant_orders o LEFT JOIN customers c ON c.session_id = o.session_id "
                    "WHERE o.status = 'delivered' AND o.updated_at <= ? AND o.updated_at >= ? "
                    "ORDER BY o.updated_at DESC LIMIT ?", (newest, oldest, MAX_CANDIDATES_PER_SCAN)))
                return [{**r, "reason": f"Pedido #{r['order_id']} entregado hace más de {hours} h.",
                         "dedupe": f"feedback:order:{r['order_id']}"} for r in rows]
        return []

    # ------------------------------------------------------------------
    # LÍMITES DE SEGURIDAD
    # ------------------------------------------------------------------
    @staticmethod
    def _local_tz() -> timezone:
        try:
            from modules.restaurant.service import restaurant_service
            return timezone(timedelta(hours=int(restaurant_service.get_config().get("utc_offset_hours", -6))))
        except Exception:
            return timezone(timedelta(hours=-6))

    def in_quiet_hours(self, now: Optional[datetime] = None) -> bool:
        g = self.guardrails()
        local = (now or _now()).astimezone(self._local_tz())
        cur = local.hour * 60 + local.minute

        def to_min(t: str) -> int:
            h, m = t.split(":")
            return int(h) * 60 + int(m)

        start, end = to_min(g["quiet_start"]), to_min(g["quiet_end"])
        if start == end:
            return False
        return (cur >= start or cur < end) if start > end else (start <= cur < end)

    def blocked_reason(self, session_id: str, now: Optional[datetime] = None,
                       exclude_task_id: Optional[int] = None) -> Optional[str]:
        """Motivo por el que NO se debe escribir a este cliente ahora (None = se puede)."""
        from services.customer_service import customer_service
        from services.lead_service import lead_service
        now = now or _now()
        c = customer_service.get_by_session(session_id)
        if not c:
            return "El cliente no tiene ficha."
        if c.get("channel") != "whatsapp":
            return "Solo se escribe proactivamente por WhatsApp."
        if OPT_OUT_TAG in (c.get("tags") or []):
            return "El cliente pidió no ser contactado."
        if lead_service.is_transferred(session_id):
            return "Un asesor está atendiendo este chat."
        days = int(self.guardrails()["min_days_between"])
        with self._conn() as run:
            recent = run.rows(run("SELECT 1 FROM agent_tasks WHERE session_id = ? AND status = 'sent' AND sent_at >= ? "
                                  "AND playbook NOT LIKE ?",
                                  (session_id, _iso(now - timedelta(days=days)), "tool:%")))
            waiting = run.rows(run("SELECT 1 FROM agent_tasks WHERE session_id = ? AND status IN ('pending_approval', 'approved') "
                                   "AND playbook NOT LIKE ? AND id <> ?", (session_id, "tool:%", exclude_task_id or -1)))
        if recent:
            return f"Ya recibió un mensaje proactivo en los últimos {days} días."
        if waiting:
            return "Ya tiene otro mensaje proactivo esperando."
        return None

    # ------------------------------------------------------------------
    # REDACCIÓN DEL MENSAJE
    # ------------------------------------------------------------------
    def draft_message(self, playbook: str, session_id: str, reason: str) -> str:
        from config import settings
        from services.customer_service import customer_service
        memory = customer_service.memory_context(session_id) or "Sin datos previos del cliente."
        c = customer_service.get_by_session(session_id) or {}
        name = (c.get("name") or "").split(" ")[0]
        prompt = (
            f"Eres {settings.BOT_NAME or 'el asistente'} de {settings.COMPANY_NAME or 'el negocio'}, escribiendo por "
            f"WhatsApp por iniciativa propia. Tono: {settings.BOT_TONE or 'cercano'}.\n"
            f"Objetivo: {PLAYBOOKS[playbook]['goal']}\nMotivo: {reason}\n{memory}\n"
            "Reglas: máximo 2 oraciones, español salvadoreño natural, sin asteriscos ni markdown, a lo sumo un emoji, "
            "no inventes promociones, precios ni datos; termina con una pregunta fácil de responder. "
            "Escribe SOLO el mensaje para el cliente."
        )
        text = self._llm_text(prompt)
        if text:
            return text.strip().strip('"')[:600]
        hi = f"¡Hola {name}!" if name else "¡Hola!"
        fallback = {
            "reactivation": f"{hi} Te extrañamos por aquí 😊 ¿Te gustaría que te ayudemos con un pedido esta semana?",
            "post_order_feedback": f"{hi} ¿Qué tal estuvo tu pedido? Nos encantaría saber cómo te fue 😊",
            "follow_up_interested": f"{hi} Quedamos pendientes de tu consulta. ¿Te puedo ayudar con algo más para avanzar?",
        }
        return fallback[playbook]

    @staticmethod
    def _llm_text(prompt: str) -> Optional[str]:
        from config import settings
        try:
            key = (settings.GEMINI_API_KEY or "").strip()
            if key and not key.startswith("AIzaSyFake"):
                from google import genai
                from google.genai import types
                cfg = {"temperature": 0.7, "max_output_tokens": 200}
                if hasattr(types, "ThinkingConfig"):
                    cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
                resp = genai.Client(api_key=key, http_options={"api_version": "v1beta"}).models.generate_content(
                    model=settings.GEMINI_MODEL or "gemini-2.5-flash", contents=prompt,
                    config=types.GenerateContentConfig(**cfg))
                if resp and resp.text:
                    return resp.text
        except Exception as e:
            logger.debug(f"Redacción con Gemini falló: {e}")
        try:
            key = (settings.OPENAI_API_KEY or "").strip()
            if key and not key.startswith("sk-fake"):
                import openai
                resp = openai.OpenAI(api_key=key).chat.completions.create(
                    model=settings.OPENAI_MODEL or "gpt-4o-mini", temperature=0.7, max_tokens=200,
                    messages=[{"role": "user", "content": prompt}])
                return resp.choices[0].message.content
        except Exception as e:
            logger.debug(f"Redacción con OpenAI falló: {e}")
        return None

    # ------------------------------------------------------------------
    # CICLO: REVISAR, CREAR TAREAS, ENVIAR
    # ------------------------------------------------------------------
    def scan(self, now: Optional[datetime] = None) -> Dict[str, int]:
        """Revisa las automatizaciones activas y crea las tareas nuevas. Devuelve un conteo por estado."""
        self._ensure()
        if not self._scan_lock.acquire(blocking=False):
            return {"skipped": 1}
        stats = {"created": 0, "sent": 0, "pending": 0, "blocked": 0}
        try:
            now = now or _now()
            for pb in self.list_playbooks():
                if not (pb["enabled"] and pb["available"]):
                    continue
                for cand in self._candidates(pb["key"], pb["params"], now):
                    if self._task_exists(cand["dedupe"]):
                        continue
                    blocked = self.blocked_reason(cand["session_id"], now)
                    if blocked:
                        # No se registra: muchos bloqueos son temporales (asesor atendiendo, mensaje reciente)
                        # y la oportunidad se vuelve a evaluar en la siguiente revisión.
                        stats["blocked"] += 1
                        continue
                    message = self.draft_message(pb["key"], cand["session_id"], cand["reason"])
                    status = "approved" if pb["mode"] == "auto" else "pending_approval"
                    self._insert_task(pb["key"], cand, message, status, now,
                                      decided_by="automático" if status == "approved" else None)
                    stats["created"] += 1
            stats["sent"] = self.dispatch_approved(now)
            stats["pending"] = len(self.list_tasks(status="pending_approval", limit=500))
        finally:
            self._scan_lock.release()
        if stats["created"] or stats["sent"]:
            logger.info(f"🤖 Agente proactivo: {stats}")
        return stats

    def dispatch_approved(self, now: Optional[datetime] = None) -> int:
        """Envía las tareas aprobadas, salvo en horario de silencio (esperan a la mañana)."""
        now = now or _now()
        if self.in_quiet_hours(now):
            return 0
        sent = 0
        for task in self.list_tasks(status="approved", limit=50):
            if self._send(task, now):
                sent += 1
        return sent

    def _send(self, task: Dict[str, Any], now: datetime) -> bool:
        from services.lead_service import lead_service
        from services.whatsapp_service import whatsapp_service
        blocked = self.blocked_reason(task["session_id"], now, exclude_task_id=task["id"])
        if blocked:
            self._set_status(task["id"], "skipped", error=blocked)
            return False
        ok = whatsapp_service.send_text_message(task["session_id"], task["message"])
        if not ok:
            error = whatsapp_service.last_send_error or "No se pudo enviar por WhatsApp."
            self._set_status(task["id"], "failed", error=error)
            return False
        # Queda en la conversación: si el cliente responde, el agente sabe qué le escribió
        lead_service.add_message(task["session_id"], "assistant", task["message"])
        self._set_status(task["id"], "sent", sent_at=_iso(now))
        return True

    # ------------------------------------------------------------------
    # TAREAS
    # ------------------------------------------------------------------
    def _task_exists(self, dedupe: str) -> bool:
        with self._conn() as run:
            return bool(run.rows(run("SELECT 1 FROM agent_tasks WHERE dedupe_key = ?", (dedupe,))))

    def _insert_task(self, playbook: str, cand: Dict[str, Any], message: Optional[str], status: str, now: datetime,
                     error: Optional[str] = None, decided_by: Optional[str] = None) -> None:
        with self._conn() as run:
            run("""INSERT INTO agent_tasks (playbook, session_id, customer_id, customer_name, reason, message, status,
                   dedupe_key, error, decided_by, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (playbook, cand["session_id"], cand.get("id"), (cand.get("name") or "")[:120] or None, cand["reason"],
                 message, status, cand["dedupe"], error, decided_by, _iso(now), _iso(now) if decided_by else None))

    def _set_status(self, task_id: int, status: str, error: Optional[str] = None, sent_at: Optional[str] = None,
                    decided_by: Optional[str] = None, message: Optional[str] = None) -> None:
        sets, params = ["status = ?"], [status]
        for col, val in (("error", error), ("sent_at", sent_at), ("decided_by", decided_by), ("message", message)):
            if val is not None:
                sets.append(f"{col} = ?")
                params.append(val)
        if decided_by is not None:
            sets.append("decided_at = ?")
            params.append(_iso(_now()))
        with self._conn() as run:
            run(f"UPDATE agent_tasks SET {', '.join(sets)} WHERE id = ?", tuple(params + [task_id]))

    def get_task(self, task_id: int) -> Optional[Dict[str, Any]]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run("SELECT * FROM agent_tasks WHERE id = ?", (task_id,)))
        return self._decorate(rows[0]) if rows else None

    def list_tasks(self, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        self._ensure()
        sql, params = "SELECT * FROM agent_tasks", []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._conn() as run:
            return [self._decorate(r) for r in run.rows(run(sql, tuple(params)))]

    @staticmethod
    def _decorate(t: Dict[str, Any]) -> Dict[str, Any]:
        is_tool = (t.get("playbook") or "").startswith("tool:")
        t["kind"] = "action" if is_tool else "message"
        t["playbook_name"] = ("Acción del agente" if is_tool
                              else PLAYBOOKS.get(t["playbook"], {}).get("name", t["playbook"]))
        try:
            t["payload"] = json.loads(t["payload"]) if t.get("payload") else None
        except (TypeError, ValueError):
            t["payload"] = None
        return t

    # ------------------------------------------------------------------
    # ACCIONES DEL AGENTE QUE NECESITAN APROBACIÓN
    # ------------------------------------------------------------------
    def request_tool_approval(self, session_id: str, tool_name: str, label: str,
                              args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """El agente quiso hacer algo delicado: queda en la bandeja hasta que una persona lo apruebe."""
        self._ensure()
        from services.customer_service import customer_service
        c = customer_service.get_by_session(session_id) or {}
        now = _now()
        summary = self._describe_action(tool_name, args)
        with self._conn() as run:
            # Si ya pidió lo mismo y sigue pendiente, no se duplica
            dup = run.rows(run("SELECT id FROM agent_tasks WHERE session_id = ? AND playbook = ? AND status = 'pending_approval'",
                               (session_id, f"tool:{tool_name}")))
            if dup:
                run("UPDATE agent_tasks SET payload = ?, message = ? WHERE id = ?",
                    (json.dumps(args, ensure_ascii=False), summary, dup[0]["id"]))
                return self.get_task(dup[0]["id"])
            run("""INSERT INTO agent_tasks (playbook, session_id, customer_id, customer_name, reason, message, status,
                   dedupe_key, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)""",
                (f"tool:{tool_name}", session_id, c.get("id"), c.get("name"), label, summary,
                 f"tool:{tool_name}:{session_id}:{_iso(now)}", json.dumps(args, ensure_ascii=False), _iso(now)))
            task_id = run.rows(run("SELECT id FROM agent_tasks WHERE dedupe_key = ?",
                                   (f"tool:{tool_name}:{session_id}:{_iso(now)}",)))[0]["id"]
        logger.info(f"⏳ Acción «{tool_name}» de {session_id} enviada a aprobación (tarea #{task_id}).")
        return self.get_task(task_id)

    @staticmethod
    def _describe_action(tool_name: str, args: Dict[str, Any]) -> str:
        if tool_name == "crear_pedido":
            items = args.get("productos") or args.get("items") or []
            parts = [f"{i.get('cantidad') or i.get('qty') or 1} × producto #{i.get('id')}" for i in items if isinstance(i, dict)]
            extra = ", ".join(x for x in (args.get("tipo"), args.get("direccion"), args.get("pago")) if x)
            return f"Crear pedido: {', '.join(parts) or 'sin productos'}" + (f" ({extra})" if extra else "")
        if tool_name == "cancelar_pedido":
            return "Cancelar el último pedido" + (f": {args['motivo']}" if args.get("motivo") else "")
        return f"{tool_name}: {json.dumps(args, ensure_ascii=False)[:300]}"

    def _run_approved_tool(self, task: Dict[str, Any], actor: str) -> Dict[str, Any]:
        """Ejecuta la acción aprobada y avisa al cliente con el resultado oficial."""
        from services import agent_tools
        from services.lead_service import lead_service
        from services.whatsapp_service import whatsapp_service
        tool_name = task["playbook"].split(":", 1)[1]
        ctx = agent_tools.ToolContext(session_id=task["session_id"], approved=True)
        result = agent_tools.execute(agent_tools.all_tools(), tool_name, task.get("payload") or {}, ctx)
        agent_tools.log_actions(ctx)
        if not result.get("ok"):
            error = result.get("error") or result.get("mensaje_sugerido") or "La acción no se pudo completar."
            self._set_status(task["id"], "failed", error=str(error)[:500], decided_by=actor[:100])
            return self.get_task(task["id"])
        text = "\n\n".join(ctx.customer_messages) or "✅ Listo, ya quedó confirmado."
        from services.customer_service import _channel_for
        is_whatsapp = _channel_for(task["session_id"]) == "whatsapp"
        sent = whatsapp_service.send_text_message(task["session_id"], text) if is_whatsapp else True
        lead_service.add_message(task["session_id"], "assistant", text)
        if sent:
            self._set_status(task["id"], "sent", decided_by=actor[:100], sent_at=_iso(_now()), message=text[:1000])
        else:
            self._set_status(task["id"], "failed", decided_by=actor[:100], message=text[:1000],
                             error="La acción se hizo, pero no se pudo avisar al cliente por WhatsApp.")
        return self.get_task(task["id"])

    def approve(self, task_id: int, message: Optional[str] = None, actor: str = "Admin") -> Dict[str, Any]:
        task = self.get_task(task_id)
        if not task:
            raise LookupError("Tarea no encontrada.")
        if task["status"] != "pending_approval":
            raise ValueError("Esta tarea ya fue decidida.")
        if task["kind"] == "action":
            return self._run_approved_tool(task, actor)
        text = (message if message is not None else task["message"] or "").strip()
        if len(text) < 2:
            raise ValueError("El mensaje está vacío.")
        self._set_status(task_id, "approved", decided_by=actor[:100], message=text[:1000])
        if not self.in_quiet_hours():
            self._send(self.get_task(task_id), _now())
        return self.get_task(task_id)

    def reject(self, task_id: int, actor: str = "Admin") -> Dict[str, Any]:
        task = self.get_task(task_id)
        if not task:
            raise LookupError("Tarea no encontrada.")
        if task["status"] not in ("pending_approval", "approved"):
            raise ValueError("Esta tarea ya fue decidida.")
        self._set_status(task_id, "rejected", decided_by=actor[:100])
        return self.get_task(task_id)

    def counts(self) -> Dict[str, int]:
        self._ensure()
        with self._conn() as run:
            rows = run.rows(run("SELECT status, COUNT(*) AS n FROM agent_tasks GROUP BY status"))
        return {r["status"]: int(r["n"]) for r in rows}

    # ------------------------------------------------------------------
    # BAJA: el cliente pide no recibir mensajes
    # ------------------------------------------------------------------
    @staticmethod
    def detect_opt_out(text: str) -> bool:
        t = (text or "").lower()
        return any(p in t for p in OPT_OUT_PHRASES)

    # ------------------------------------------------------------------
    # PROGRAMADOR EN SEGUNDO PLANO
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()

        def loop():
            while not self._stop.wait(SCAN_INTERVAL_SECONDS):
                try:
                    slugs = tenant_registry.active_slugs()
                except Exception as e:
                    logger.warning(f"No se pudo listar las empresas activas: {e}")
                    slugs = [DEFAULT_TENANT]
                for slug in slugs:  # cada empresa se revisa con sus propios datos, ajustes y claves
                    if not tenant_registry.has_feature(slug, "arm"):
                        continue  # el agente proactivo es parte del ARM
                    with tenant_context(slug):
                        try:
                            self.scan()
                        except Exception as e:
                            logger.warning(f"Error en el ciclo del agente proactivo ({slug}): {e}")
                        try:
                            from services.metrics_service import metrics_service
                            metrics_service.maybe_send_weekly()
                        except Exception as e:
                            logger.warning(f"Error enviando el reporte semanal ({slug}): {e}")

        self._thread = threading.Thread(target=loop, name="agente-proactivo", daemon=True)
        self._thread.start()
        logger.info(f"⏱️ Agente proactivo revisando oportunidades cada {SCAN_INTERVAL_SECONDS // 60} min.")

    def stop(self) -> None:
        self._stop.set()


PLAYBOOKS_REQUIRED = {pb["requires"] for pb in PLAYBOOKS.values() if pb.get("requires")}

automation_service = AutomationService()
