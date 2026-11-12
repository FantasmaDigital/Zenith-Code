"""Observabilidad: registro de cada respuesta, métricas, costo estimado y reporte semanal."""
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from services import metrics_service as metrics
from services.auth_service import require_auth
from services.automation_service import automation_service
from services.customer_service import customer_service
from services.lead_service import LeadService
from services.metrics_service import metrics_service
from tests.test_automations import AutomationTestCase

NOW = datetime(2026, 11, 8, 18, 0, tzinfo=timezone.utc)  # domingo 12:00 en El Salvador


class MetricsTestCase(AutomationTestCase):
    def setUp(self):
        super().setUp()
        self._prev_metrics = (metrics_service._db, metrics_service._ready)
        metrics_service._db, metrics_service._ready = self.db, False
        metrics_service.init_tables()
        self._tz = patch.object(metrics_service, "_local_tz", return_value=timezone(timedelta(hours=-6)))
        self._tz.start()

    def tearDown(self):
        self._tz.stop()
        metrics_service._db, metrics_service._ready = self._prev_metrics
        super().tearDown()

    def fake_run(self, session, agent="ventas", inp=1000, out=200, cached=800, outcome="ok", tools=(), model="gemini-2.5-flash"):
        metrics.start_run()
        metrics.note_agent(agent)
        metrics.add_usage(inp, out, cached)
        metrics.note_tools(list(tools))
        metrics_service.record_run(session, "gemini", model, time.monotonic() - 1.2, outcome)

    def at(self, table, when):
        with metrics_service._conn() as run:
            run(f"UPDATE {table} SET created_at = ?", (when.isoformat(),))


class TestRecording(MetricsTestCase):
    def test_usage_is_accumulated_per_reply_and_isolated(self):
        metrics.start_run()
        metrics.gemini_usage(SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=1000, candidates_token_count=50, thoughts_token_count=0, cached_content_token_count=900)))
        metrics.openai_usage(SimpleNamespace(usage=SimpleNamespace(
            prompt_tokens=500, completion_tokens=20, prompt_tokens_details=SimpleNamespace(cached_tokens=400))))
        metrics.note_tools(["crear_pedido"])
        stats = metrics.take_run()
        self.assertEqual((stats["input"], stats["output"], stats["cached"], stats["rounds"]), (1500, 70, 1300, 2))
        self.assertEqual(metrics.take_run()["input"], 0)  # no se arrastra a la siguiente respuesta

    def test_router_records_ok_fallback_and_error(self):
        from services.ai_service import ai_service
        with patch.object(ai_service, "_run_engine", side_effect=[RuntimeError("cuota agotada"), "Hola 👋"]), \
             patch("services.ai_service.settings.AI_PROVIDER", "gemini"):
            self.assertEqual(ai_service.generate_reply("50371112000", "hola"), "Hola 👋")
        with metrics_service._conn() as run:
            rows = run.rows(run("SELECT provider, outcome, error FROM agent_runs ORDER BY id"))
        self.assertEqual([(r["provider"], r["outcome"]) for r in rows], [("gemini", "error"), ("openai", "fallback")])
        self.assertIn("cuota agotada", rows[0]["error"])


class TestSummary(MetricsTestCase):
    def test_costs_tokens_latency_and_areas(self):
        self.fake_run("a", agent="ventas", tools=["crear_pedido"])
        self.fake_run("b", agent="soporte", inp=2000, out=100, cached=0)
        self.fake_run("c", outcome="error", inp=0, out=0, cached=0)
        self.fake_run("d", model="modelo-sin-precio")
        m = metrics_service.summary(7)
        # ventas: (200 frescos*0.30 + 800 caché*0.075 + 200*2.50)/1M ; soporte: (2000*0.30 + 100*2.50)/1M
        expected = (200 * 0.30 + 800 * 0.075 + 200 * 2.50 + 2000 * 0.30 + 100 * 2.50) / 1_000_000
        self.assertAlmostEqual(m["cost"], round(expected, 4))
        self.assertEqual((m["runs"], m["errors"]), (4, 1))
        self.assertEqual(m["unpriced_models"], ["modelo-sin-precio"])
        self.assertEqual(m["tokens"]["cache_rate"], round(1600 / 4000 * 100, 1))  # a y d traen 800 cacheados c/u
        self.assertGreaterEqual(m["latency_ms"]["p50"], 1000)
        self.assertEqual(m["tools"], [{"tool": "crear_pedido", "count": 1}])
        self.assertEqual({a["agent"] for a in m["by_agent"]}, {"ventas", "soporte"})
        self.assertEqual(len(m["daily"]), 7)

    def test_conversation_handoff_and_proactive_metrics(self):
        leads = LeadService()
        for sid in ("50371112001", "50371112002"):
            leads.add_message(sid, "user", "Hola")
            leads.add_message(sid, "assistant", "¡Hola!")
        leads.add_message("50371112002", "human", "Soy Luis")
        customer_service.record_message("50371112002", "action", "✅ Transferir a un asesor")
        m = metrics_service.summary(7)
        self.assertEqual((m["conversations"], m["ai_replies"], m["human_replies"], m["handoffs"]), (2, 2, 1, 1))
        self.assertEqual(m["handoff_rate"], 50.0)
        self.assertEqual(m["automation_rate"], round(2 / 3 * 100, 1))

        # Mensaje proactivo enviado y respondido dentro de 48 h
        self.customer("50371112003")
        self.enable(mode="auto")
        with patch.object(automation_service, "in_quiet_hours", return_value=False):
            automation_service.scan(datetime.now(timezone.utc))
        LeadService().add_message("50371112003", "user", "¡Sí, quiero!")
        p = metrics_service.summary(7)["proactive"]
        self.assertEqual((p["sent"], p["replied"], p["reply_rate"]), (1, 1, 100.0))

    def test_price_editing(self):
        prices = metrics_service.save_price("modelo-x", 1, 2, 0.5)
        self.assertEqual(prices["modelo-x"], {"input": 1.0, "output": 2.0, "cached": 0.5})
        with self.assertRaises(ValueError):
            metrics_service.save_price("modelo-x", -1, 2, 0)


class TestWeeklyReport(MetricsTestCase):
    def test_text_schedule_and_once_per_week(self):
        LeadService().add_message("50371112010", "user", "Hola")
        metrics_service.save_report_config({"enabled": True, "phone": "+503 7000-0000", "weekday": 6, "hour": 20})
        self.assertEqual(metrics_service.report_config()["phone"], "50370000000")
        text = metrics_service.weekly_report_text()
        self.assertIn("Resumen semanal", text)
        self.assertIn("atendió 1 conversación.", text)  # singular correcto
        self.assertIn("1 cliente nuevo.", text)
        self.assertFalse(metrics_service.maybe_send_weekly(NOW))                       # domingo 12:00: aún no
        evening = NOW + timedelta(hours=9)                                              # domingo 21:00 local
        self.assertTrue(metrics_service.maybe_send_weekly(evening))
        self.sent.assert_called_once()
        self.assertEqual(self.sent.call_args.args[0], "50370000000")
        self.assertFalse(metrics_service.maybe_send_weekly(evening + timedelta(minutes=30)))  # una vez por semana

    def test_disabled_never_sends(self):
        metrics_service.save_report_config({"enabled": False, "phone": "50370000000"})
        self.assertFalse(metrics_service.maybe_send_weekly(NOW + timedelta(hours=9)))
        self.sent.assert_not_called()


class TestApi(MetricsTestCase):
    def test_endpoints(self):
        app = FastAPI()
        app.include_router(main.router)
        app.include_router(main.arm_router)
        self.assertEqual(TestClient(app).get("/api/agent/metrics").status_code, 401)
        app.dependency_overrides[require_auth] = lambda: "admin"
        client = TestClient(app)
        self.assertEqual(client.get("/api/agent/metrics?days=30").json()["days"], 30)
        self.assertEqual(client.get("/api/agent/metrics?days=999").status_code, 422)
        self.assertIn("gemini-2.5-flash", client.get("/api/agent/prices").json()["prices"])
        self.assertEqual(client.put("/api/agent/prices", json={"model": "x", "input": -1, "output": 1, "cached": 0}).status_code, 422)
        cfg = client.put("/api/agent/weekly-report", json={"enabled": True, "phone": "50370000001"}).json()
        self.assertTrue(cfg["config"]["enabled"])
        self.assertIn("Resumen semanal", cfg["preview"])
        self.assertEqual(client.post("/api/agent/weekly-report/send").json(), {"status": "sent"})
