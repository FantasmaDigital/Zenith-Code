"""Observabilidad del agente: qué hizo, cuánto tardó, cuánto costó y qué logró.

- Cada respuesta de la IA queda en `agent_runs`: proveedor, modelo, área, tokens (entrada, salida, caché),
  tiempo, herramientas usadas y resultado (ok, respaldo, error).
- Las métricas cruzan esos registros con conversaciones, pedidos del restaurante y mensajes proactivos.
- El costo es una **estimación** con precios por millón de tokens editables desde el panel.
- Reporte semanal al dueño por WhatsApp (resultado de la semana en lenguaje simple).
"""
import json
import logging
import threading
from services.tenant_service import TenantReadyMixin
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.metrics")

PRICES_KEY = "AI_PRICES"
REPORT_KEY = "WEEKLY_REPORT"
# USD por millón de tokens. Valores de referencia: verifica los precios vigentes de tu proveedor y ajústalos en el panel.
DEFAULT_PRICES = {
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50, "cached": 0.075},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "cached": 0.075},
}
DEFAULT_REPORT = {"enabled": False, "phone": "", "weekday": 6, "hour": 20, "last_sent": ""}  # domingo 8:00 p. m.
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(v):
    return v.isoformat() if isinstance(v, datetime) else v


# ----------------------------------------------------------------------
# REGISTRO DE LA RESPUESTA EN CURSO (por hilo: cada mensaje se atiende en su propio hilo)
# ----------------------------------------------------------------------
_current = threading.local()


def start_run() -> None:
    _current.stats = {"input": 0, "output": 0, "cached": 0, "rounds": 0, "agent": None, "tools": []}


def add_usage(input_tokens: int = 0, output_tokens: int = 0, cached_tokens: int = 0) -> None:
    stats = getattr(_current, "stats", None)
    if stats is None:
        return
    stats["input"] += int(input_tokens or 0)
    stats["output"] += int(output_tokens or 0)
    stats["cached"] += int(cached_tokens or 0)
    stats["rounds"] += 1


def note_agent(agent: Optional[str]) -> None:
    stats = getattr(_current, "stats", None)
    if stats is not None and agent:
        stats["agent"] = agent


def note_tools(names: List[str]) -> None:
    stats = getattr(_current, "stats", None)
    if stats is not None:
        stats["tools"].extend(names)


def take_run() -> Dict[str, Any]:
    stats = getattr(_current, "stats", None) or {"input": 0, "output": 0, "cached": 0, "rounds": 0, "agent": None, "tools": []}
    _current.stats = None
    return stats


def gemini_usage(response) -> None:
    u = getattr(response, "usage_metadata", None)
    if u is not None:
        add_usage(getattr(u, "prompt_token_count", 0) or 0,
                  (getattr(u, "candidates_token_count", 0) or 0) + (getattr(u, "thoughts_token_count", 0) or 0),
                  getattr(u, "cached_content_token_count", 0) or 0)


def openai_usage(response) -> None:
    u = getattr(response, "usage", None)
    if u is not None:
        details = getattr(u, "prompt_tokens_details", None)
        add_usage(getattr(u, "prompt_tokens", 0) or 0, getattr(u, "completion_tokens", 0) or 0,
                  getattr(details, "cached_tokens", 0) or 0 if details else 0)


class MetricsService(TenantReadyMixin):
    def __init__(self):
        self._db = None
        self._ready = False

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
                return cur
            return raw.execute(sql, params)

        def rows(cur) -> List[Dict[str, Any]]:
            if cur.description is None:
                return []
            names = [d[0] for d in cur.description]
            return [{n: _clean(v) for n, v in zip(names, tuple(r))} for r in cur.fetchall()]

        run.rows, run.pg = rows, pg
        try:
            yield run
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    def init_tables(self) -> None:
        pk = "SERIAL PRIMARY KEY" if self._get_db().is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
        with self._conn() as run:
            run(f"""CREATE TABLE IF NOT EXISTS agent_runs (
                id {pk}, session_id VARCHAR(120), provider VARCHAR(20), model VARCHAR(80), agent VARCHAR(40),
                input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0,
                latency_ms INTEGER DEFAULT 0, rounds INTEGER DEFAULT 0, tools TEXT DEFAULT '[]',
                outcome VARCHAR(20) NOT NULL, error TEXT, created_at VARCHAR(40) NOT NULL)""")
            run("CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at)")
        self._ready = True

    def _ensure(self):
        if not self._ready:
            self.init_tables()

    # ------------------------------------------------------------------
    # REGISTRO
    # ------------------------------------------------------------------
    def record_run(self, session_id: str, provider: str, model: str, started: float, outcome: str,
                   error: Optional[str] = None) -> None:
        """Guarda la respuesta que se acaba de generar (outcome: ok | fallback | error)."""
        stats = take_run()
        try:
            self._ensure()
            with self._conn() as run:
                run("""INSERT INTO agent_runs (session_id, provider, model, agent, input_tokens, output_tokens, cached_tokens,
                       latency_ms, rounds, tools, outcome, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (session_id, provider, model, stats["agent"], stats["input"], stats["output"], stats["cached"],
                     int((time.monotonic() - started) * 1000), stats["rounds"], json.dumps(stats["tools"]), outcome,
                     (error or "")[:500] or None, _now().isoformat()))
        except Exception as e:
            logger.warning(f"No se pudo registrar la métrica de la respuesta: {e}")

    # ------------------------------------------------------------------
    # PRECIOS Y COSTO
    # ------------------------------------------------------------------
    def prices(self) -> Dict[str, Dict[str, float]]:
        try:
            raw = self._get_db().get_setting(PRICES_KEY, "")
            stored = json.loads(raw) if raw else {}
        except Exception:
            stored = {}
        return {**DEFAULT_PRICES, **(stored if isinstance(stored, dict) else {})}

    def save_price(self, model: str, input_price: float, output_price: float, cached_price: float) -> Dict[str, Any]:
        model = (model or "").strip()[:80]
        if not model:
            raise ValueError("Indica el modelo.")
        if min(input_price, output_price, cached_price) < 0:
            raise ValueError("Los precios no pueden ser negativos.")
        prices = self.prices()
        prices[model] = {"input": float(input_price), "output": float(output_price), "cached": float(cached_price)}
        self._get_db().set_setting(PRICES_KEY, json.dumps(prices))
        return prices

    def _cost(self, model: str, input_t: int, output_t: int, cached_t: int, prices: Dict[str, Any]) -> Optional[float]:
        p = prices.get(model)
        if not p:
            return None
        fresh = max(0, int(input_t) - int(cached_t))  # los tokens cacheados se cobran a tarifa reducida
        return (fresh * p["input"] + int(cached_t) * p["cached"] + int(output_t) * p["output"]) / 1_000_000

    # ------------------------------------------------------------------
    # MÉTRICAS
    # ------------------------------------------------------------------
    @staticmethod
    def _local_tz() -> timezone:
        try:
            from modules.restaurant.service import restaurant_service
            return timezone(timedelta(hours=int(restaurant_service.get_config().get("utc_offset_hours", -6))))
        except Exception:
            return timezone(timedelta(hours=-6))

    @staticmethod
    def _table_exists(run, name: str) -> bool:
        sql = ("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?" if run.pg
               else "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        return bool(run.rows(run(sql, (name,))))

    def summary(self, days: int = 7, now: Optional[datetime] = None) -> Dict[str, Any]:
        self._ensure()
        now = now or _now()
        since = (now - timedelta(days=days)).isoformat()
        prev_since = (now - timedelta(days=days * 2)).isoformat()
        prices = self.prices()
        tz = self._local_tz()
        with self._conn() as run:
            runs = run.rows(run("SELECT * FROM agent_runs WHERE created_at >= ?", (since,)))
            convo = self._conversation_stats(run, since, now.isoformat())
            prev_convo = self._conversation_stats(run, prev_since, since)
            orders = self._order_stats(run, since, now.isoformat())
            prev_orders = self._order_stats(run, prev_since, since)
            proactive = self._proactive_stats(run, since)

        cost, unknown_models = 0.0, set()
        by_agent: Dict[str, Dict[str, Any]] = {}
        daily: Dict[str, Dict[str, Any]] = {}
        latencies, tool_counts = [], {}
        for r in runs:
            c = self._cost(r["model"], r["input_tokens"], r["output_tokens"], r["cached_tokens"], prices)
            if c is None and r["outcome"] != "error":
                unknown_models.add(r["model"])
            c = c or 0.0
            cost += c
            if r["outcome"] != "error":
                latencies.append(int(r["latency_ms"] or 0))
            a = by_agent.setdefault(r["agent"] or "general", {"replies": 0, "cost": 0.0, "tools": 0})
            a["replies"] += 1
            a["cost"] += c
            for t in json.loads(r["tools"] or "[]"):
                a["tools"] += 1
                tool_counts[t] = tool_counts.get(t, 0) + 1
            day = datetime.fromisoformat(r["created_at"]).astimezone(tz).strftime("%Y-%m-%d")
            d = daily.setdefault(day, {"replies": 0, "cost": 0.0})
            d["replies"] += 1
            d["cost"] += c

        latencies.sort()
        total_in = sum(int(r["input_tokens"] or 0) for r in runs)
        cached = sum(int(r["cached_tokens"] or 0) for r in runs)
        days_list = [(now.astimezone(tz) - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]
        conv_daily = convo.pop("daily")
        prev_convo.pop("daily")

        def change(a, b):
            return None if not b else round((a - b) / b * 100, 1)

        return {
            "days": days,
            "conversations": convo["conversations"], "conversations_change_pct": change(convo["conversations"], prev_convo["conversations"]),
            "new_customers": convo["new_customers"],
            "ai_replies": convo["ai_replies"], "human_replies": convo["human_replies"],
            "automation_rate": round(convo["ai_replies"] / (convo["ai_replies"] + convo["human_replies"]) * 100, 1)
            if (convo["ai_replies"] + convo["human_replies"]) else None,
            "handoffs": convo["handoffs"],
            "handoff_rate": round(convo["handoffs"] / convo["conversations"] * 100, 1) if convo["conversations"] else None,
            "orders": orders, "orders_change_pct": change(orders["revenue"], prev_orders["revenue"]) if orders else None,
            "proactive": proactive,
            "runs": len(runs), "errors": sum(1 for r in runs if r["outcome"] == "error"),
            "fallbacks": sum(1 for r in runs if r["outcome"] == "fallback"),
            "latency_ms": {"p50": latencies[len(latencies) // 2] if latencies else None,
                           "p90": latencies[int(len(latencies) * 0.9)] if latencies else None},
            "tokens": {"input": total_in, "output": sum(int(r["output_tokens"] or 0) for r in runs), "cached": cached,
                       "cache_rate": round(cached / total_in * 100, 1) if total_in else None},
            "cost": round(cost, 4),
            "cost_per_conversation": round(cost / convo["conversations"], 4) if convo["conversations"] else None,
            "unpriced_models": sorted(m for m in unknown_models if m),
            "by_agent": [{"agent": k, **{**v, "cost": round(v["cost"], 4)}} for k, v in sorted(by_agent.items(), key=lambda x: -x[1]["replies"])],
            "tools": sorted(({"tool": k, "count": v} for k, v in tool_counts.items()), key=lambda x: -x["count"]),
            "daily": [{"day": d, "conversations": conv_daily.get(d, 0), "replies": daily.get(d, {}).get("replies", 0),
                       "cost": round(daily.get(d, {}).get("cost", 0.0), 4)} for d in days_list],
        }

    def _conversation_stats(self, run, since: str, until: str) -> Dict[str, Any]:
        if not self._table_exists(run, "conversation_messages"):
            return {"conversations": 0, "new_customers": 0, "ai_replies": 0, "human_replies": 0, "handoffs": 0, "daily": {}}
        counts = {r["role"]: int(r["n"]) for r in run.rows(run(
            "SELECT role, COUNT(*) AS n FROM conversation_messages WHERE created_at >= ? AND created_at < ? GROUP BY role",
            (since, until)))}
        users = run.rows(run("SELECT session_id, created_at FROM conversation_messages WHERE role = 'user' "
                             "AND created_at >= ? AND created_at < ?", (since, until)))
        handoffs = run.rows(run("SELECT COUNT(DISTINCT session_id) AS n FROM conversation_messages WHERE role = 'action' "
                                "AND content LIKE ? AND created_at >= ? AND created_at < ?", ("%Transferir%", since, until)))
        new_c = run.rows(run("SELECT COUNT(*) AS n FROM customers WHERE first_seen_at >= ? AND first_seen_at < ?", (since, until))) \
            if self._table_exists(run, "customers") else [{"n": 0}]
        tz = self._local_tz()
        per_day: Dict[str, set] = {}
        for u in users:
            day = datetime.fromisoformat(u["created_at"]).astimezone(tz).strftime("%Y-%m-%d")
            per_day.setdefault(day, set()).add(u["session_id"])
        return {"conversations": len({u["session_id"] for u in users}), "new_customers": int(new_c[0]["n"]),
                "ai_replies": counts.get("assistant", 0), "human_replies": counts.get("human", 0),
                "handoffs": int(handoffs[0]["n"]), "daily": {d: len(s) for d, s in per_day.items()}}

    def _order_stats(self, run, since: str, until: str) -> Optional[Dict[str, Any]]:
        if not self._table_exists(run, "restaurant_orders"):
            return None
        rows = run.rows(run("SELECT source, COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue FROM restaurant_orders "
                            "WHERE status <> 'cancelled' AND created_at >= ? AND created_at < ? GROUP BY source", (since, until)))
        by = {r["source"]: r for r in rows}
        bot = by.get("bot", {"n": 0, "revenue": 0})
        total_n = sum(int(r["n"]) for r in rows)
        return {"by_agent": int(bot["n"]), "revenue": round(float(bot["revenue"] or 0), 2), "total": total_n,
                "share": round(int(bot["n"]) / total_n * 100, 1) if total_n else None}

    def _proactive_stats(self, run, since: str) -> Optional[Dict[str, Any]]:
        if not self._table_exists(run, "agent_tasks"):
            return None
        sent = run.rows(run("SELECT session_id, sent_at FROM agent_tasks WHERE status = 'sent' AND sent_at >= ? "
                            "AND playbook NOT LIKE ?", (since, "tool:%")))
        replied = 0
        for t in sent:
            until = (datetime.fromisoformat(t["sent_at"]) + timedelta(hours=48)).isoformat()
            if run.rows(run("SELECT 1 FROM conversation_messages WHERE session_id = ? AND role = 'user' "
                            "AND created_at > ? AND created_at <= ? LIMIT 1", (t["session_id"], t["sent_at"], until))):
                replied += 1
        pending = run.rows(run("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'pending_approval'"))
        return {"sent": len(sent), "replied": replied,
                "reply_rate": round(replied / len(sent) * 100, 1) if sent else None, "pending": int(pending[0]["n"])}

    # ------------------------------------------------------------------
    # REPORTE SEMANAL AL DUEÑO
    # ------------------------------------------------------------------
    def report_config(self) -> Dict[str, Any]:
        try:
            raw = self._get_db().get_setting(REPORT_KEY, "")
            stored = json.loads(raw) if raw else {}
        except Exception:
            stored = {}
        cfg = {**DEFAULT_REPORT, **(stored if isinstance(stored, dict) else {})}
        if not cfg["phone"]:
            try:
                from config import settings
                cfg["phone"] = settings.get_effective_support_phone() or ""
            except Exception:
                pass
        return cfg

    def save_report_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        cfg = self.report_config()
        for k in ("enabled", "phone", "weekday", "hour"):
            if updates.get(k) is not None:
                cfg[k] = updates[k]
        cfg["phone"] = "".join(ch for ch in str(cfg["phone"]) if ch.isdigit())
        self._get_db().set_setting(REPORT_KEY, json.dumps(cfg))
        return cfg

    @staticmethod
    def _n(count: int, singular: str, plural: str) -> str:
        return f"{count} {singular if count == 1 else plural}"

    def weekly_report_text(self, now: Optional[datetime] = None) -> str:
        from config import settings
        m = self.summary(7, now)
        company = settings.COMPANY_NAME or "tu negocio"
        bot = settings.BOT_NAME or "Tu asistente"
        lines = [f"📊 Resumen semanal de {company}", "",
                 f"🤖 {bot} atendió {self._n(m['conversations'], 'conversación', 'conversaciones')}"
                 + (f" ({m['conversations_change_pct']:+.0f}% vs. la semana anterior)" if m["conversations_change_pct"] is not None else "") + "."]
        if m["new_customers"]:
            lines.append(f"🆕 {self._n(m['new_customers'], 'cliente nuevo', 'clientes nuevos')}.")
        if m["automation_rate"] is not None:
            lines.append(f"⚡ El {m['automation_rate']:.0f}% de las respuestas las dio la IA; {self._n(m['handoffs'], 'chat pasó', 'chats pasaron')} a un asesor.")
        if m["orders"] and m["orders"]["by_agent"]:
            lines.append(f"🛒 Cerró {self._n(m['orders']['by_agent'], 'pedido', 'pedidos')} por ${m['orders']['revenue']:.2f}"
                         + (f" ({m['orders']['share']:.0f}% del total)" if m["orders"]["share"] is not None else "") + ".")
        if m["proactive"] and m["proactive"]["sent"]:
            lines.append(f"📨 Envió {m['proactive']['sent']} mensajes por iniciativa propia y {m['proactive']['replied']} clientes respondieron.")
        if m["proactive"] and m["proactive"]["pending"]:
            lines.append(f"⏳ Tienes {m['proactive']['pending']} mensajes esperando tu aprobación.")
        minutes = (m["ai_replies"] * 1.5)  # ~1.5 min que le tomaría a una persona cada respuesta
        if minutes >= 60:
            lines.append(f"⏱️ Te ahorró cerca de {minutes / 60:.0f} horas de atención.")
        lines += ["", f"Costo estimado de IA: ${m['cost']:.2f}."]
        return "\n".join(lines)

    def maybe_send_weekly(self, now: Optional[datetime] = None) -> bool:
        cfg = self.report_config()
        if not cfg["enabled"] or not cfg["phone"]:
            return False
        local = (now or _now()).astimezone(self._local_tz())
        week = local.strftime("%G-W%V")
        if local.weekday() != int(cfg["weekday"]) or local.hour < int(cfg["hour"]) or cfg.get("last_sent") == week:
            return False
        return self.send_weekly(now, mark_week=week)

    def send_weekly(self, now: Optional[datetime] = None, mark_week: Optional[str] = None) -> bool:
        from services.whatsapp_service import whatsapp_service
        cfg = self.report_config()
        if not cfg["phone"]:
            raise ValueError("Configura el número de WhatsApp del dueño.")
        ok = whatsapp_service.send_text_message(cfg["phone"], self.weekly_report_text(now))
        if ok and mark_week:
            cfg["last_sent"] = mark_week
            self._get_db().set_setting(REPORT_KEY, json.dumps(cfg))
        if ok:
            logger.info(f"📊 Reporte semanal enviado a {cfg['phone']}.")
        return ok


metrics_service = MetricsService()
