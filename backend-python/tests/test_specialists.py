"""Agentes especializados: enrutamiento, rol y herramientas por área, derivación y configuración."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from services import agent_tools, agents
from services.auth_service import require_auth
from services.customer_service import customer_service
from services.prompt_service import build_brand_system_prompt
from tests.test_agent_tools import tools
from tests.test_supervision import SupervisionTestCase


class SpecialistsTestCase(SupervisionTestCase):
    def setUp(self):
        super().setUp()
        self._registered = patch.object(agent_tools, "_registered_tools", lambda: agent_tools.CORE_TOOLS + tools()[3:])
        self._registered.start()

    def tearDown(self):
        self._registered.stop()
        super().tearDown()


class TestRouting(SpecialistsTestCase):
    def test_signals_and_priority(self):
        self.assertEqual(agents.detect_area("Hola, ¿cuánto cuesta la pupusa?"), "ventas")
        self.assertEqual(agents.detect_area("Quiero poner una QUEJA, llegó frío"), "soporte")
        self.assertEqual(agents.detect_area("quiero pedir pero el anterior llegó mal"), "soporte")  # soporte primero
        self.assertIsNone(agents.detect_area("buenas tardes"))

    def test_sticky_conversation_and_switch_note(self):
        sid = "50379990001"
        self.assertEqual(agents.route(sid, "Hola"), ("recepcion", None))
        agent, note = agents.route(sid, "¿Qué precio tiene el combo?")
        self.assertEqual(agent, "ventas")
        self.assertIn("Ventas y pedidos", note)
        self.assertEqual(agents.route(sid, "dos, por favor"), ("ventas", None))  # sigue con ventas

    def test_sticky_window_expires(self):
        sid = "50379990002"
        agents.route(sid, "quiero pedir")
        later = datetime.now(timezone.utc) + timedelta(hours=agents.STICKY_HOURS + 1)
        agent, note = agents.route(sid, "hola de nuevo", now=later)
        self.assertEqual(agent, "recepcion")
        self.assertIn("nueva conversación", note)

    def test_disabled_specialist_and_global_switch(self):
        agents.update_profile("soporte", enabled=False)
        self.assertIsNone(agents.detect_area("tengo una queja"))
        with self.assertRaises(ValueError):
            agents.update_profile("recepcion", enabled=False)
        agents.set_specialists_enabled(False)
        self.assertEqual(agents.route("50379990003", "quiero pedir"), (None, None))


class TestRolesAndTools(SpecialistsTestCase):
    def test_tools_per_area(self):
        names = lambda area: {t.name for t in agent_tools.all_tools(area)}
        self.assertIn("crear_pedido", names("ventas"))
        self.assertNotIn("crear_pedido", names("soporte"))
        self.assertIn("cancelar_pedido", names("soporte"))
        self.assertNotIn("cancelar_pedido", names("recepcion"))
        self.assertNotIn("derivar_a_area", names(None))  # sin especialistas no hay a quién derivar

    def test_role_goes_at_the_end_and_shared_prefix_is_identical(self):
        agents.update_profile("ventas", instructions="Ofrece siempre el combo del día.")
        base = build_brand_system_prompt(None)
        ventas = build_brand_system_prompt("ventas")
        soporte = build_brand_system_prompt("soporte")
        self.assertTrue(ventas.startswith(base) and soporte.startswith(base))  # caché compartible
        self.assertIn("VENTAS Y PEDIDOS", ventas)
        self.assertIn("Ofrece siempre el combo del día.", ventas)
        self.assertNotIn("combo del día", soporte)

    def test_reroute_tool(self):
        ctx = agent_tools.ToolContext(session_id="s", agent="recepcion")
        self.assertTrue(agent_tools.execute(agent_tools.all_tools("recepcion"), "derivar_a_area", {"area": "ventas"}, ctx)["ok"])
        self.assertEqual((ctx.reroute, ctx.end_turn), ("ventas", True))
        same = agent_tools.ToolContext(session_id="s", agent="ventas")
        self.assertFalse(agent_tools.execute(agent_tools.all_tools("ventas"), "derivar_a_area", {"area": "ventas"}, same)["ok"])


class TestRerouteInEngine(SpecialistsTestCase):
    def test_gemini_reroutes_once_and_new_area_answers(self):
        from services.gemini_service import gemini_service
        reroute = SimpleNamespace(name="derivar_a_area", args={"area": "soporte", "motivo": "reclamo"})
        r1 = SimpleNamespace(function_calls=[reroute], candidates=[SimpleNamespace(content=MagicMock())], text=None)
        r2 = SimpleNamespace(function_calls=None, candidates=[], text="Lamento mucho lo que pasó, ¿me das tu número de pedido?")
        prompts = []

        def fake_generate(client, system_instruction, *a, **k):
            prompts.append(system_instruction)
            return [r1, r2][len(prompts) - 1]

        with patch.object(gemini_service, "_get_client", return_value=MagicMock()), \
             patch.object(gemini_service, "_generate", side_effect=fake_generate), \
             patch("services.gemini_service.types.Part.from_function_response", return_value=MagicMock()), \
             patch("services.gemini_service.types.Content", return_value=MagicMock()):
            reply = gemini_service.execute_reply("50379990010", "Hola")
        self.assertEqual(reply, "Lamento mucho lo que pasó, ¿me das tu número de pedido?")
        self.assertIn("RECEPCIÓN", prompts[0])
        self.assertIn("SOPORTE Y RECLAMOS", prompts[1])
        self.assertEqual(customer_service.get_agent("50379990010")["agent"], "soporte")
        cid = customer_service.get_by_session("50379990010")["id"]
        timeline = [(m["role"], m["content"]) for m in customer_service.list_messages(cid)]
        self.assertEqual([r for r, _ in timeline], ["user", "action", "assistant"])
        self.assertIn("Soporte y reclamos", timeline[1][1])


class TestApi(SpecialistsTestCase):
    def test_endpoints(self):
        app = FastAPI()
        app.include_router(main.router)
        app.include_router(main.arm_router)
        self.assertEqual(TestClient(app).get("/api/agent/specialists").status_code, 401)
        app.dependency_overrides[require_auth] = lambda: "admin"
        client = TestClient(app)
        data = client.get("/api/agent/specialists").json()
        self.assertTrue(data["enabled"])
        self.assertEqual([a["key"] for a in data["agents"]], ["recepcion", "ventas", "soporte"])
        res = client.patch("/api/agent/specialists/soporte", json={"instructions": "Ofrece cupón solo con aprobación."})
        self.assertEqual(res.json()["agent"]["instructions"], "Ofrece cupón solo con aprobación.")
        self.assertEqual(client.patch("/api/agent/specialists/recepcion", json={"enabled": False}).status_code, 400)
        self.assertFalse(client.put("/api/agent/specialists", json={"enabled": False}).json()["enabled"])
