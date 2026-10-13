import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services.whatsapp_service import whatsapp_service
from services.openai_service import openai_service
from services.gemini_service import gemini_service, TRANSFER_MESSAGE
from services.ai_service import ai_service

class TestAsistenteOperativo(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_knowledge_base_loaded(self):
        # Validar que el hot cache se obtiene sin errores y opera como string
        context = knowledge_service.get_context_text()
        self.assertIsInstance(context, str)
        self.assertTrue(len(context) > 0)

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["agent"], "Asistente Operativo")
        self.assertEqual(data["status"], "online")
        self.assertIn(data["active_provider"], ["gemini", "openai"])
        self.assertIn("gateway_integration", data)

    def test_gateway_payload_parsing(self):
        mock_payload = {
            "sender": "50377778888",
            "message": "Hola, buenas tardes"
        }
        parsed = whatsapp_service.parse_incoming_webhook(mock_payload)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["from_number"], "50377778888")
        self.assertEqual(parsed["text"], "Hola, buenas tardes")

    def test_gateway_webhook_receive(self):
        with patch.object(whatsapp_service, "send_text_message", return_value=True):
            response = self.client.post("/webhook", json={
                "sender": "50370001122",
                "message": "¿Tienen soporte técnico?"
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "processed")
            self.assertEqual(data["to"], "50370001122")
            self.assertIn("reply", data)

    def test_gemini_transfer_protocol_trigger(self):
        session_id = "test-transfer-gemini"
        lead_service.reset_session(session_id)

        # Enviar mensaje pidiendo humano usando el servicio Gemini
        reply = gemini_service.generate_reply(session_id, "Quiero hablar con un humano por favor")
        self.assertEqual(reply, TRANSFER_MESSAGE)
        self.assertTrue(lead_service.is_transferred(session_id))

        # El siguiente mensaje debe confirmar que el humano ya está asignado
        next_reply = gemini_service.generate_reply(session_id, "Hola sigo esperando respuesta")
        self.assertIn("asesor humano ya tiene asignado tu caso", next_reply)

    def test_openai_transfer_protocol_trigger(self):
        session_id = "test-transfer-openai"
        lead_service.reset_session(session_id)

        reply = openai_service.generate_reply(session_id, "Quiero comunicarme con un asesor humano")
        self.assertEqual(reply, TRANSFER_MESSAGE)
        self.assertTrue(lead_service.is_transferred(session_id))

    def test_ai_router_active_provider(self):
        self.assertIn(ai_service.primary_provider, ["gemini", "openai"])

    def test_automatic_failover(self):
        session_id = "test-failover-user"
        lead_service.reset_session(session_id)

        # Simular que el proveedor principal falla con error de cuota o conexión
        with patch.object(ai_service, "_call_engine") as mock_engine:
            def side_effect(engine_name, sid, msg):
                if engine_name == ai_service.primary_provider:
                    raise RuntimeError("Error de cuota 429 en proveedor principal")
                return "Respuesta generada por el proveedor de respaldo"

            mock_engine.side_effect = side_effect
            reply = ai_service.generate_reply(session_id, "Hola, necesito información")
            self.assertEqual(reply, "Respuesta generada por el proveedor de respaldo")

    def test_chat_rest_endpoint_with_gemini(self):
        response = self.client.post("/chat", json={
            "session_id": "rest-gemini-user",
            "message": "Hola, ¿qué servicios ofrecen?"
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["session_id"], "rest-gemini-user")
        self.assertIn("reply", data)

    def test_dashboard_endpoint(self):
        response = self.client.get("/dashboard", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "http://localhost:5173")

    def test_knowledge_api_crud(self):
        # Crear texto
        res_create = self.client.post("/api/knowledge/text", json={
            "title": "Política Especial de Pruebas",
            "content": "Ofrecemos garantía extendida de 60 días para proyectos premium.",
            "category": "garantías"
        })
        self.assertEqual(res_create.status_code, 200)
        item = res_create.json()["item"]
        item_id = item["id"]

        # Listar
        res_list = self.client.get("/api/knowledge")
        self.assertEqual(res_list.status_code, 200)
        items = res_list.json()["items"]
        self.assertTrue(any(i["id"] == item_id for i in items))

        # Stats
        res_stats = self.client.get("/api/knowledge/stats")
        self.assertEqual(res_stats.status_code, 200)
        self.assertTrue(res_stats.json()["cached"])

        # Eliminar
        res_del = self.client.delete(f"/api/knowledge/{item_id}")
        self.assertEqual(res_del.status_code, 200)

    def test_settings_api(self):
        # 1. Obtener settings actuales
        res_get = self.client.get("/api/settings")
        self.assertEqual(res_get.status_code, 200)
        data = res_get.json()
        self.assertIn("company_name", data)
        self.assertIn("gemini_api_key", data)

        # 2. Actualizar configuración
        res_post = self.client.post("/api/settings", json={
            "company_name": "Fantasma Digital Inc",
            "bot_name": "Ghost AI Assistant",
            "bot_tone": "Profesional y moderno",
            "brand_instructions": "Priorizar cotizaciones de ingeniería de software.",
            "ai_provider": "gemini"
        })
        self.assertEqual(res_post.status_code, 200)
        updated = res_post.json()["settings"]
        self.assertEqual(updated["company_name"], "Fantasma Digital Inc")
        self.assertEqual(updated["bot_name"], "Ghost AI Assistant")

        # 3. Restaurar nombre original para no alterar otras pruebas
        self.client.post("/api/settings", json={
            "company_name": "Zenith Solutions",
            "bot_name": "Asistente Operativo"
        })

if __name__ == "__main__":
    unittest.main()
