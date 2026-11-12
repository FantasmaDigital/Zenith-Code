"""Herramientas del agente (function calling): ejecución, reglas de negocio y bucle en Gemini/OpenAI."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from modules.restaurant import chat_orders
from services import agent_tools
from services.customer_service import customer_service
from services.lead_service import lead_service
from tests.test_restaurant import RestaurantTestCase


def tools(*_args):
    return agent_tools.CORE_TOOLS + chat_orders.build_tools()


class ToolTestCase(RestaurantTestCase):
    def setUp(self):
        super().setUp()
        self._summary = patch.object(customer_service, "maybe_refresh_summary", return_value=False)
        self._summary.start()

    def tearDown(self):
        self._summary.stop()
        super().tearDown()

    def run_tool(self, name, args, session="50377770000"):
        ctx = agent_tools.ToolContext(session_id=session)
        return agent_tools.execute(tools(), name, args, ctx), ctx

    def order_args(self, **extra):
        args = {"productos": [{"id": self.pupusa["id"], "cantidad": 2, "notas": "sin curtido"}],
                "tipo": "pickup", "pago": "cash", "nombre": "Ana"}
        args.update(extra)
        return args


class TestRestaurantTools(ToolTestCase):
    def test_create_order_sends_official_confirmation(self):
        result, ctx = self.run_tool("crear_pedido", self.order_args())
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 3.0)
        self.assertIn("nota", result)  # instruye al modelo a no repetir montos
        self.assertEqual(len(ctx.customer_messages), 1)
        self.assertIn(f"#{result['pedido']}", ctx.customer_messages[0])
        self.assertIn("$3.00", ctx.customer_messages[0])
        self.assertEqual(self.service.get_order(result["pedido"])["source"], "bot")

    def test_missing_data_is_reported_to_model_not_customer(self):
        result, ctx = self.run_tool("crear_pedido", self.order_args(tipo="delivery", direccion=""))
        self.assertFalse(result["ok"])
        self.assertEqual(result["falta"], "direccion")
        self.assertEqual(ctx.customer_messages, [])

    def test_business_rules_still_apply(self):
        result, _ = self.run_tool("crear_pedido", self.order_args(productos=[{"id": 9999, "cantidad": 1}]))
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_status_and_cancel(self):
        created, _ = self.run_tool("crear_pedido", self.order_args())
        status, _ = self.run_tool("consultar_pedido", {})
        self.assertEqual((status["pedido"], status["pago"]), (created["pedido"], "pendiente"))
        refused, _ = self.run_tool("cancelar_pedido", {"confirmado": False})
        self.assertFalse(refused["ok"])
        done, _ = self.run_tool("cancelar_pedido", {"confirmado": True, "motivo": "Se equivocó"})
        self.assertTrue(done["ok"])
        self.assertEqual(self.service.get_order(created["pedido"])["status"], "cancelled")

    def test_order_tools_hidden_when_ai_does_not_take_orders(self):
        self.service.save_config({"ai": {"take_orders": False}})
        self.assertEqual([t.name for t in chat_orders.build_tools()], ["consultar_pedido"])


class TestCoreTools(ToolTestCase):
    def test_remember_customer_data(self):
        result, _ = self.run_tool("guardar_dato_cliente", {"nombre": "Ana", "dato": "Alérgica al maní", "etiqueta": "Sin Maní"})
        self.assertEqual(result["guardado"], ["nombre", "dato", "etiqueta"])
        c = customer_service.get_by_session("50377770000")
        self.assertEqual((c["name"], c["facts"], c["tags"]), ("Ana", ["Alérgica al maní"], ["sin maní"]))
        again, _ = self.run_tool("guardar_dato_cliente", {"nombre": "Otra", "dato": "alérgica al maní"})
        self.assertEqual(again["guardado"], [])  # no pisa el nombre ni duplica datos

    def test_handoff_ends_turn_with_official_message(self):
        with patch("services.handoff_analyzer.analyze_handoff_intent", return_value=("RECLAMO", "nota")):
            result, ctx = self.run_tool("transferir_a_asesor", {"motivo": "Reclamo por pedido frío"}, session="50377770001")
        self.assertTrue(result["ok"] and ctx.end_turn)
        self.assertTrue(lead_service.is_transferred("50377770001"))
        self.assertEqual(agent_tools.compose_reply("texto del modelo", ctx), ctx.customer_messages[0])

    def test_unknown_tool_and_crash_never_raise(self):
        result, _ = self.run_tool("no_existe", {})
        self.assertFalse(result["ok"])
        boom = agent_tools.Tool("boom", "x", {"type": "object"}, lambda ctx, a: 1 / 0)
        ctx = agent_tools.ToolContext(session_id="s")
        self.assertFalse(agent_tools.execute([boom], "boom", {}, ctx)["ok"])
        self.assertEqual([(a["tool"], a["ok"]) for a in ctx.actions], [("boom", False)])


class TestEngineLoops(ToolTestCase):
    def test_gemini_executes_tool_then_replies(self):
        from services.gemini_service import gemini_service
        call = SimpleNamespace(name="crear_pedido", args=self.order_args())
        first = SimpleNamespace(function_calls=[call], candidates=[SimpleNamespace(content=MagicMock())], text=None)
        second = SimpleNamespace(function_calls=None, candidates=[], text="¡Gracias, Ana! 🙌")
        with patch.object(agent_tools, "all_tools", tools), \
             patch.object(gemini_service, "_get_client", return_value=MagicMock()), \
             patch.object(gemini_service, "_generate", side_effect=[first, second]) as gen, \
             patch("services.gemini_service.types.Part.from_function_response", return_value=MagicMock()), \
             patch("services.gemini_service.types.Content", return_value=MagicMock()):
            reply = gemini_service.execute_reply("50377770002", "Sí, confirmo")
        self.assertEqual(gen.call_count, 2)
        self.assertTrue(reply.startswith("¡Gracias, Ana!"))
        self.assertIn("$3.00", reply)  # confirmación oficial con el total del servidor
        self.assertEqual(lead_service.get_or_create_session("50377770002").messages[-1]["content"], reply)

    def test_openai_executes_tool_then_replies(self):
        from services.openai_service import openai_service
        tool_call = SimpleNamespace(id="call_1", function=SimpleNamespace(name="crear_pedido", arguments=json.dumps(self.order_args())))
        msg1 = MagicMock(tool_calls=[tool_call], content=None)
        msg1.model_dump.return_value = {"role": "assistant", "tool_calls": []}
        msg2 = MagicMock(tool_calls=None, content="¡Listo, Ana!")
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            SimpleNamespace(choices=[SimpleNamespace(message=msg1)]),
            SimpleNamespace(choices=[SimpleNamespace(message=msg2)]),
        ]
        with patch.object(agent_tools, "all_tools", tools), patch.object(openai_service, "_get_client", return_value=client):
            reply = openai_service.execute_reply("50377770003", "Sí, confirmo")
        sent = client.chat.completions.create.call_args_list[1].kwargs["messages"]
        self.assertEqual(sent[-1]["role"], "tool")
        self.assertTrue(json.loads(sent[-1]["content"])["ok"])
        self.assertTrue(reply.startswith("¡Listo, Ana!"))
        self.assertIn("$3.00", reply)
