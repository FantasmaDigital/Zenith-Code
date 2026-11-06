"""Supervisión humana: reglas por acción, aprobación de acciones, bandeja y toma de control."""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from services import agent_tools
from services.auth_service import require_auth
from services.automation_service import automation_service
from services.customer_service import customer_service
from services.lead_service import LeadService, lead_service
from tests.test_agent_tools import ToolTestCase, tools


class SupervisionTestCase(ToolTestCase):
    def setUp(self):
        super().setUp()
        self.settings = {}
        self._p = [
            patch("services.db_service.db_service.get_setting", side_effect=lambda k, d="": self.settings.get(k, d)),
            patch("services.db_service.db_service.set_setting", side_effect=lambda k, v: self.settings.__setitem__(k, v)),
            patch.object(agent_tools, "_registered_tools", tools),
            patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True),
        ]
        mocks = [p.start() for p in self._p]
        self.sent = mocks[3]
        automation_service._ready = False
        automation_service.init_tables()

    def tearDown(self):
        for p in reversed(self._p):
            p.stop()
        super().tearDown()


class TestPolicies(SupervisionTestCase):
    def test_off_hides_tool_and_handoff_cannot_be_limited(self):
        agent_tools.set_policy("cancelar_pedido", "off")
        self.assertNotIn("cancelar_pedido", [t.name for t in agent_tools.all_tools()])
        with self.assertRaises(ValueError):
            agent_tools.set_policy("transferir_a_asesor", "off")
        with self.assertRaises(ValueError):
            agent_tools.set_policy("no_existe", "auto")
        described = {t["name"]: t for t in agent_tools.describe_tools()}
        self.assertEqual(described["cancelar_pedido"]["policy"], "off")
        self.assertTrue(described["transferir_a_asesor"]["locked"])

    def test_approve_policy_queues_action_instead_of_running(self):
        agent_tools.set_policy("crear_pedido", "approve")
        ctx = agent_tools.ToolContext(session_id="50378880001")
        result = agent_tools.execute(agent_tools.all_tools(), "crear_pedido", self.order_args(), ctx)
        self.assertTrue(result["pendiente_aprobacion"])
        self.assertEqual(ctx.customer_messages, [])
        self.assertEqual(self.service.list_orders(session_id="50378880001"), [])  # no se creó todavía
        task = automation_service.list_tasks(status="pending_approval")[0]
        self.assertEqual((task["kind"], task["payload"]["tipo"]), ("action", "pickup"))
        self.assertIn("Crear pedido", task["message"])
        # Repetir la misma petición no duplica la tarea
        agent_tools.execute(agent_tools.all_tools(), "crear_pedido", self.order_args(), agent_tools.ToolContext(session_id="50378880001"))
        self.assertEqual(len(automation_service.list_tasks(status="pending_approval")), 1)

    def test_approving_runs_action_and_notifies_customer(self):
        agent_tools.set_policy("crear_pedido", "approve")
        agent_tools.execute(agent_tools.all_tools(), "crear_pedido", self.order_args(), agent_tools.ToolContext(session_id="50378880002"))
        task = automation_service.list_tasks(status="pending_approval")[0]
        done = automation_service.approve(task["id"], actor="Luis")
        self.assertEqual((done["status"], done["decided_by"]), ("sent", "Luis"))
        orders = self.service.list_orders(session_id="50378880002")
        self.assertEqual(len(orders), 1)
        self.assertIn(f"#{orders[0]['id']}", self.sent.call_args.args[1])  # confirmación oficial al cliente

    def test_rejected_action_never_runs(self):
        agent_tools.set_policy("crear_pedido", "approve")
        agent_tools.execute(agent_tools.all_tools(), "crear_pedido", self.order_args(), agent_tools.ToolContext(session_id="50378880003"))
        task = automation_service.list_tasks(status="pending_approval")[0]
        automation_service.reject(task["id"])
        self.assertEqual(self.service.list_orders(session_id="50378880003"), [])
        self.sent.assert_not_called()


class TestActionLog(SupervisionTestCase):
    def test_actions_appear_in_conversation_but_not_for_the_model(self):
        sid = "50378880010"
        ctx = agent_tools.ToolContext(session_id=sid)
        result = agent_tools.execute(agent_tools.all_tools(), "crear_pedido", self.order_args(), ctx)
        LeadService().add_message(sid, "user", "Sí, confirmo")
        agent_tools.log_actions(ctx)
        LeadService().add_message(sid, "assistant", "¡Gracias!")
        cid = customer_service.get_by_session(sid)["id"]
        roles = [(m["role"], m["content"]) for m in customer_service.list_messages(cid)]
        self.assertEqual([r for r, _ in roles], ["user", "action", "assistant"])
        self.assertIn(f"Pedido #{result['pedido']} creado", roles[1][1])
        self.assertNotIn("action", [m["role"] for m in customer_service.load_recent(sid)])

    def test_summaries(self):
        self.assertIn("falta direccion", agent_tools.action_summary(
            {"tool": "crear_pedido", "ok": False, "result": {"ok": False, "falta": "direccion"}}))
        self.assertIn("esperando aprobación", agent_tools.action_summary(
            {"tool": "cancelar_pedido", "ok": False, "result": {"pendiente_aprobacion": True}}))


class TestInbox(SupervisionTestCase):
    def setUp(self):
        super().setUp()
        self.app = FastAPI()
        self.app.include_router(main.router)
        self.app.dependency_overrides[require_auth] = lambda: "admin"
        self.client = TestClient(self.app)
        leads = LeadService()
        leads.add_message("50378880020", "user", "Hola, ¿tienen pupusas?")
        leads.add_message("50378880020", "assistant", "¡Sí! ¿De qué las quieres?")
        leads.add_message("50378880021", "user", "Quiero hablar con alguien")
        self.handoff = patch("services.handoff_analyzer.analyze_handoff_intent", return_value=("ATENCIÓN HUMANA", "nota"))
        self.handoff.start()

    def tearDown(self):
        self.handoff.stop()
        for sid in ("50378880020", "50378880021"):
            try:
                lead_service.release_handoff(sid)
            except Exception:
                pass
        super().tearDown()

    def test_list_reply_and_return_to_ai(self):
        convs = self.client.get("/api/inbox").json()["conversations"]
        self.assertEqual([c["session_id"] for c in convs][:2], ["50378880021", "50378880020"])
        cid = next(c["id"] for c in convs if c["session_id"] == "50378880020")
        res = self.client.post(f"/api/customers/{cid}/reply", json={"text": "Hola, soy Luis 👋", "actor": "Luis"})
        self.assertEqual(res.json(), {"status": "sent", "human": True})
        self.sent.assert_called_with("50378880020", "Hola, soy Luis 👋")
        msgs = customer_service.list_messages(cid)
        self.assertEqual((msgs[-1]["role"], msgs[-1]["content"]), ("human", "Hola, soy Luis 👋"))
        self.assertEqual(customer_service.load_recent("50378880020")[-1]["role"], "assistant")  # para el modelo
        only_human = self.client.get("/api/inbox?only=human").json()["conversations"]
        self.assertEqual([c["session_id"] for c in only_human], ["50378880020"])
        self.assertFalse(self.client.post(f"/api/customers/{cid}/takeover", json={"active": False}).json()["human"])

    def test_whatsapp_lid_ids_are_delivered(self):
        """WhatsApp puede identificar al cliente con un ID «…@lid» en vez del número: también hay que enviarle."""
        LeadService().add_message("99428711026699@lid", "user", "Hola")
        c = customer_service.get_by_session("99428711026699@lid")
        self.assertEqual((c["channel"], c["phone"]), ("whatsapp", None))
        res = self.client.post(f"/api/customers/{c['id']}/reply", json={"text": "Hola Daniel"})
        self.assertEqual(res.status_code, 200)
        self.sent.assert_called_with("99428711026699@lid", "Hola Daniel")

    def test_web_chat_reply_is_never_reported_as_delivered(self):
        LeadService().add_message("react-playground-session", "user", "Hola")
        cid = customer_service.get_by_session("react-playground-session")["id"]
        res = self.client.post(f"/api/customers/{cid}/reply", json={"text": "Hola"})
        self.assertEqual(res.status_code, 400)
        self.sent.assert_not_called()

    def test_failed_whatsapp_send_is_reported(self):
        cid = customer_service.get_by_session("50378880020")["id"]
        self.sent.return_value = False
        res = self.client.post(f"/api/customers/{cid}/reply", json={"text": "Hola"})
        self.assertEqual(res.status_code, 502)

    def test_policy_endpoints(self):
        self.assertEqual(self.client.put("/api/agent/tool-policies/crear_pedido", json={"policy": "x"}).status_code, 422)
        self.assertEqual(self.client.put("/api/agent/tool-policies/transferir_a_asesor", json={"policy": "off"}).status_code, 400)
        tools_out = self.client.put("/api/agent/tool-policies/crear_pedido", json={"policy": "approve"}).json()["tools"]
        self.assertEqual(next(t for t in tools_out if t["name"] == "crear_pedido")["policy"], "approve")
