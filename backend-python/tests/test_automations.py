"""Agente proactivo: oportunidades, redacción, aprobación humana, envío y límites de seguridad."""
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from services.auth_service import require_auth
from services.automation_service import OPT_OUT_TAG, automation_service
from services.customer_service import customer_service
from services.lead_service import LeadService, lead_service

# Mediodía en El Salvador (fuera del horario de silencio)
NOON = datetime(2026, 11, 5, 18, 0, tzinfo=timezone.utc)
NIGHT = datetime(2026, 11, 6, 4, 0, tzinfo=timezone.utc)  # 22:00 local


class FakeDB:
    is_postgres = False

    def __init__(self, path):
        self.path = path
        self.settings = {}

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_setting(self, key, default=""):
        return self.settings.get(key, default)

    def set_setting(self, key, value):
        self.settings[key] = value


class AutomationTestCase(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        self.db = FakeDB(self.path)
        self._prev = [(svc, svc._db, svc._ready) for svc in (customer_service, automation_service)]
        for svc in (customer_service, automation_service):
            svc._db, svc._ready = self.db, False
        customer_service.init_tables()
        automation_service.init_tables()
        self.patches = [
            patch.object(customer_service, "maybe_refresh_summary", return_value=False),
            patch.object(automation_service, "_llm_text", return_value="¡Hola Ana! Te extrañamos 😊 ¿Te preparamos tu pedido de siempre?"),
            patch.object(automation_service, "_local_tz", return_value=timezone(timedelta(hours=-6))),
            patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True),
            patch.object(lead_service, "is_transferred", return_value=False),
        ]
        mocks = [p.start() for p in self.patches]
        self.sent = mocks[3]

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        for svc, db, ready in self._prev:
            svc._db, svc._ready = db, ready
        lead_service._sessions.clear()
        os.remove(self.path)

    def customer(self, sid, name="Ana", stage="customer", days_ago=40):
        customer_service.note_contact(sid, name)
        with customer_service._conn() as run:
            run("UPDATE customers SET stage = ?, last_seen_at = ? WHERE session_id = ?",
                (stage, (NOON - timedelta(days=days_ago)).isoformat(), sid))

    def enable(self, key="reactivation", mode="approve", **params):
        automation_service.update_playbook(key, enabled=True, mode=mode, params=params or None)


class TestPlaybooks(AutomationTestCase):
    def test_all_start_disabled_and_restaurant_one_needs_module(self):
        pbs = {p["key"]: p for p in automation_service.list_playbooks()}
        self.assertFalse(any(p["enabled"] for p in pbs.values()))
        self.assertEqual(automation_service.scan(NOON)["created"], 0)
        with patch.object(automation_service, "_installed_modules", return_value=set()):
            with self.assertRaises(ValueError):
                automation_service.update_playbook("post_order_feedback", enabled=True)

    def test_params_are_clamped(self):
        pb = automation_service.update_playbook("reactivation", params={"inactive_days": 9999, "otro": 5})
        self.assertEqual(pb["params"], {"inactive_days": 365})


class TestApprovalFlow(AutomationTestCase):
    def test_approve_mode_waits_then_sends_edited_message(self):
        self.customer("50371110001")
        self.customer("50371110002", stage="new")          # no compró: no aplica
        self.customer("50371110003", days_ago=5)           # activo: no aplica
        self.enable()
        stats = automation_service.scan(NOON)
        self.assertEqual((stats["created"], stats["pending"]), (1, 1))
        self.sent.assert_not_called()
        task = automation_service.list_tasks(status="pending_approval")[0]
        self.assertEqual(task["session_id"], "50371110001")
        self.assertIn("Ana", task["message"])
        with patch.object(automation_service, "in_quiet_hours", return_value=False):
            done = automation_service.approve(task["id"], message="Hola Ana, ¿pizza este viernes? 🍕", actor="Luis")
        self.assertEqual((done["status"], done["decided_by"]), ("sent", "Luis"))
        self.sent.assert_called_once_with("50371110001", "Hola Ana, ¿pizza este viernes? 🍕")
        # Queda en la conversación para que el agente tenga contexto si el cliente responde
        self.assertEqual(LeadService().get_or_create_session("50371110001").messages[-1]["content"], "Hola Ana, ¿pizza este viernes? 🍕")
        self.assertEqual(automation_service.scan(NOON)["created"], 0)  # no se repite la misma oportunidad

    def test_auto_mode_sends_and_reject_works(self):
        self.customer("50371110010")
        self.enable(mode="auto")
        self.assertEqual(automation_service.scan(NOON)["sent"], 1)
        self.assertEqual(automation_service.list_tasks()[0]["status"], "sent")
        self.customer("50371110011", stage="interested", days_ago=3)
        self.enable("follow_up_interested")
        automation_service.scan(NOON)
        task = automation_service.list_tasks(status="pending_approval")[0]
        self.assertEqual(automation_service.reject(task["id"])["status"], "rejected")
        with self.assertRaises(ValueError):
            automation_service.approve(task["id"])

    def test_llm_failure_uses_safe_template(self):
        self.customer("50371110020", name="Beto Pérez")
        self.enable()
        with patch.object(automation_service, "_llm_text", return_value=None):
            automation_service.scan(NOON)
        self.assertTrue(automation_service.list_tasks()[0]["message"].startswith("¡Hola Beto!"))


class TestGuardrails(AutomationTestCase):
    def test_quiet_hours_hold_messages_until_morning(self):
        self.customer("50371110030")
        self.enable(mode="auto")
        self.assertEqual(automation_service.scan(NIGHT)["sent"], 0)
        self.assertEqual(automation_service.list_tasks()[0]["status"], "approved")
        self.assertEqual(automation_service.dispatch_approved(NOON), 1)

    def test_opt_out_phrase_blocks_proactive_messages(self):
        self.customer("50371110040")
        LeadService().add_message("50371110040", "user", "Por favor ya no me escriban más")
        self.assertIn(OPT_OUT_TAG, customer_service.get_by_session("50371110040")["tags"])
        with customer_service._conn() as run:  # vuelve a estar inactivo
            run("UPDATE customers SET last_seen_at = ? WHERE session_id = ?", ((NOON - timedelta(days=40)).isoformat(), "50371110040"))
        self.enable(mode="auto")
        self.assertEqual(automation_service.scan(NOON)["blocked"], 1)
        self.sent.assert_not_called()

    def test_frequency_cap_and_human_handoff(self):
        self.customer("50371110050")
        self.enable(mode="auto")
        automation_service.scan(NOON)
        self.assertIn("últimos 7 días", automation_service.blocked_reason("50371110050", NOON))
        self.customer("50371110051")
        with patch.object(lead_service, "is_transferred", return_value=True):
            self.assertEqual(automation_service.blocked_reason("50371110051", NOON), "Un asesor está atendiendo este chat.")
        customer_service.note_contact("web-session", "Web")
        self.assertIn("WhatsApp", automation_service.blocked_reason("web-session", NOON))

    def test_send_failure_is_recorded(self):
        self.customer("50371110060")
        self.enable(mode="auto")
        self.sent.return_value = False
        with patch("services.whatsapp_service.whatsapp_service.last_send_error", "Fuera de la ventana de 24 h"):
            automation_service.scan(NOON)
        task = automation_service.list_tasks()[0]
        self.assertEqual((task["status"], task["error"]), ("failed", "Fuera de la ventana de 24 h"))


class TestPostOrderFeedback(AutomationTestCase):
    def test_delivered_orders_get_feedback_request(self):
        with automation_service._conn() as run:
            run("CREATE TABLE restaurant_orders (id INTEGER PRIMARY KEY, session_id TEXT, customer_name TEXT, "
                "status TEXT, updated_at TEXT)")
            run("INSERT INTO restaurant_orders VALUES (1, '50371110070', 'Ana', 'delivered', ?), "
                "(2, '50371110071', 'Beto', 'delivered', ?), (3, '50371110072', 'Eva', 'preparing', ?)",
                ((NOON - timedelta(hours=3)).isoformat(), (NOON - timedelta(minutes=30)).isoformat(),
                 (NOON - timedelta(hours=3)).isoformat()))
        for sid in ("50371110070", "50371110071", "50371110072"):
            self.customer(sid, days_ago=0)
        with patch.object(automation_service, "_installed_modules", return_value={"restaurant"}):
            self.enable("post_order_feedback", mode="auto")
            stats = automation_service.scan(NOON)
        self.assertEqual(stats["sent"], 1)
        self.assertEqual(automation_service.list_tasks()[0]["reason"], "Pedido #1 entregado hace más de 2 h.")


class TestApi(AutomationTestCase):
    def test_endpoints(self):
        app = FastAPI()
        app.include_router(main.router)
        self.assertEqual(TestClient(app).get("/api/agent/tasks").status_code, 401)
        app.dependency_overrides[require_auth] = lambda: "admin"
        client = TestClient(app)
        self.assertEqual(len(client.get("/api/agent/playbooks").json()["playbooks"]), 3)
        self.assertEqual(client.patch("/api/agent/playbooks/reactivation", json={"enabled": True, "mode": "x"}).status_code, 422)
        self.assertTrue(client.patch("/api/agent/playbooks/reactivation", json={"enabled": True}).json()["playbook"]["enabled"])
        g = client.put("/api/agent/guardrails", json={"quiet_start": "21:30", "min_days_between": 3}).json()["guardrails"]
        self.assertEqual((g["quiet_start"], g["min_days_between"]), ("21:30", 3))
        self.assertEqual(client.put("/api/agent/guardrails", json={"quiet_start": "25:00"}).status_code, 422)
        self.assertEqual(client.post("/api/agent/tasks/999/approve", json={}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
