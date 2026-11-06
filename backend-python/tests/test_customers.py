"""Memoria del cliente: historial persistente, ficha, resumen vivo y contexto para el agente."""
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from services.auth_service import require_auth
from services.customer_service import customer_service
from services.lead_service import LeadService


class FakeDB:
    is_postgres = False

    def __init__(self, path):
        self.path = path

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn


class CustomerTestCase(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        self._prev = (customer_service._db, customer_service._ready)
        customer_service._db = FakeDB(self.path)
        customer_service._ready = False
        customer_service.init_tables()
        # Sin llamadas reales a la IA: el resumen se prueba con una respuesta simulada
        self._bg = patch.object(customer_service, "maybe_refresh_summary", return_value=False)
        self._bg.start()

    def tearDown(self):
        self._bg.stop()
        customer_service._db, customer_service._ready = self._prev
        os.remove(self.path)


class TestPersistence(CustomerTestCase):
    def test_history_survives_restart(self):
        leads = LeadService()
        leads.add_message("50370000001", "user", "Hola, quiero 2 pupusas")
        leads.add_message("50370000001", "assistant", "¡Claro! ¿De qué las quieres?")
        restarted = LeadService()  # memoria vacía, como tras reiniciar el servidor
        msgs = restarted.get_or_create_session("50370000001").messages
        self.assertEqual([m["content"] for m in msgs], ["Hola, quiero 2 pupusas", "¡Claro! ¿De qué las quieres?"])

    def test_customer_card_created_on_first_message(self):
        LeadService().add_message("50370000002", "user", "Hola", contact_name=None)
        c = customer_service.get_by_session("50370000002")
        self.assertEqual((c["channel"], c["phone"], c["stage"], c["message_count"]), ("whatsapp", "50370000002", "new", 1))
        LeadService().add_message("playground-session", "user", "Hola")
        self.assertEqual(customer_service.get_by_session("playground-session")["channel"], "web")

    def test_whatsapp_name_only_fills_empty_name(self):
        customer_service.note_contact("50370000003", "Ana López")
        customer_service.note_contact("50370000003", "Otro Nombre")
        self.assertEqual(customer_service.get_by_session("50370000003")["name"], "Ana López")

    def test_reset_context_keeps_history(self):
        leads = LeadService()
        leads.add_message("50370000004", "user", "Mensaje viejo")
        leads.reset_session("50370000004")
        self.assertEqual(LeadService().get_or_create_session("50370000004").messages, [])
        cid = customer_service.get_by_session("50370000004")["id"]
        self.assertEqual(len(customer_service.list_messages(cid)), 1)

    def test_final_reply_replaces_model_text(self):
        leads = LeadService()
        leads.add_message("50370000005", "user", "Sí, confirmo")
        leads.add_message("50370000005", "assistant", "texto con [[PEDIDO]]")
        leads.replace_last_assistant_message("50370000005", "✅ Pedido #7 registrado")
        self.assertEqual(LeadService().get_or_create_session("50370000005").messages[-1]["content"], "✅ Pedido #7 registrado")


class TestCardAndMemory(CustomerTestCase):
    def test_manual_edit_locks_stage(self):
        customer_service.note_contact("50370000010", "Luis")
        cid = customer_service.get_by_session("50370000010")["id"]
        c = customer_service.update(cid, tags=["VIP", "vip", " domicilio "], stage="loyal", notes="Paga puntual")
        self.assertEqual(c["tags"], ["vip", "domicilio"])
        self.assertTrue(c["stage_locked"])
        with self.assertRaises(ValueError):
            customer_service.update(cid, stage="otro")

    def test_summary_updates_card_without_overriding_manual_data(self):
        leads = LeadService()
        for i in range(3):
            leads.add_message("50370000011", "user", f"mensaje {i}")
        cid = customer_service.get_by_session("50370000011")["id"]
        customer_service.update(cid, stage="loyal")
        fake = {"summary": "Cliente que pide pizza los viernes.", "facts": ["Sin cebolla", "Paga en efectivo"],
                "name": "Carlos", "stage": "interested", "tags": ["pizza"]}
        with patch.object(customer_service, "_call_llm", return_value=fake):
            c = customer_service.refresh_summary("50370000011")
        self.assertEqual(c["summary"], "Cliente que pide pizza los viernes.")
        self.assertEqual(c["facts"], ["Sin cebolla", "Paga en efectivo"])
        self.assertEqual(c["name"], "Carlos")
        self.assertEqual(c["stage"], "loyal")  # la etapa fijada a mano no cambia
        self.assertIn("pizza", c["tags"])
        self.assertEqual(c["summary_msg_count"], 3)

    def test_failed_llm_keeps_card(self):
        LeadService().add_message("50370000012", "user", "hola")
        with patch.object(customer_service, "_call_llm", return_value=None):
            c = customer_service.refresh_summary("50370000012")
        self.assertEqual(c["summary"], "")

    def test_memory_context_for_agent(self):
        self.assertEqual(customer_service.memory_context("desconocido"), "")
        customer_service.note_contact("50370000013", "María")
        with customer_service._conn() as run:
            run("UPDATE customers SET summary = ?, facts = ? WHERE session_id = ?",
                ("Pide para su oficina.", '["Alérgica al maní"]', "50370000013"))
        ctx = customer_service.memory_context("50370000013")
        for expected in ("María", "Pide para su oficina.", "Alérgica al maní", "no la recites"):
            self.assertIn(expected, ctx)

    def test_summary_schedule(self):
        self._bg.stop()
        leads = LeadService()
        with patch.object(customer_service, "_summarize_safe") as run:
            for i in range(3):
                leads.add_message("50370000014", "user", f"m{i}")
            self.assertFalse(customer_service.maybe_refresh_summary("50370000014", background=False))
            leads.add_message("50370000014", "user", "m3")
            self.assertTrue(customer_service.maybe_refresh_summary("50370000014", background=False))
            run.assert_called_once()
        self._bg.start()


class TestListAndApi(CustomerTestCase):
    def setUp(self):
        super().setUp()
        for sid, name in (("50370000020", "Ana"), ("50370000021", "Beto"), ("50370000022", "Carla")):
            customer_service.note_contact(sid, name)
        self.app = FastAPI()
        self.app.include_router(main.router)

    def test_list_search_and_stage(self):
        cid = customer_service.get_by_session("50370000021")["id"]
        customer_service.update(cid, stage="customer", tags=["mayorista"])
        self.assertEqual(customer_service.list()["total"], 3)
        self.assertEqual([c["name"] for c in customer_service.list(search="bet")["customers"]], ["Beto"])
        self.assertEqual(customer_service.list(stage="customer")["total"], 1)
        self.assertEqual(customer_service.list(tag="mayorista")["total"], 1)
        self.assertEqual(customer_service.list()["by_stage"], {"new": 2, "customer": 1})

    def test_api_requires_login(self):
        client = TestClient(self.app)
        self.assertEqual(client.get("/api/customers").status_code, 401)

    def test_api_flow(self):
        self.app.dependency_overrides[require_auth] = lambda: "admin"
        client = TestClient(self.app)
        cid = client.get("/api/customers?search=ana").json()["customers"][0]["id"]
        res = client.patch(f"/api/customers/{cid}", json={"notes": "Prefiere WhatsApp", "stage": "interested"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["customer"]["stage_label"], "Interesado")
        self.assertEqual(client.patch(f"/api/customers/{cid}", json={"stage": "x"}).status_code, 422)
        self.assertEqual(client.get("/api/customers/99999").status_code, 404)
        self.assertEqual(client.get(f"/api/customers/{cid}/messages").json()["messages"], [])


if __name__ == "__main__":
    unittest.main()
