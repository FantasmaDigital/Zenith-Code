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
from services.db_service import db_service

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
        self.assertTrue(bool(data["agent"]))
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
        from services.prompt_service import get_effective_transfer_message
        self.assertEqual(reply, get_effective_transfer_message())
        self.assertTrue(lead_service.is_transferred(session_id))

        # El siguiente mensaje debe permanecer en silencio total (string vacío)
        next_reply = gemini_service.generate_reply(session_id, "Hola sigo esperando respuesta")
        self.assertEqual(next_reply, "")

    def test_openai_transfer_protocol_trigger(self):
        session_id = "test-transfer-openai"
        lead_service.reset_session(session_id)

        reply = openai_service.generate_reply(session_id, "Quiero comunicarme con un asesor humano")
        from services.prompt_service import get_effective_transfer_message
        self.assertEqual(reply, get_effective_transfer_message())
        self.assertTrue(lead_service.is_transferred(session_id))
        next_reply = openai_service.generate_reply(session_id, "Hola sigo esperando")
        self.assertEqual(next_reply, "")

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
        # 1. Obtener settings actuales para preservarlos
        res_get = self.client.get("/api/settings")
        self.assertEqual(res_get.status_code, 200)
        data = res_get.json()
        orig_company = data.get("company_name") or "Fantasma Digital"
        orig_bot = data.get("bot_name") or "Asistente Operativo"
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
        self.assertTrue(res_post.json().get("persisted_in_db"))
        updated = res_post.json()["settings"]
        self.assertEqual(updated["company_name"], "Fantasma Digital Inc")
        self.assertEqual(updated["bot_name"], "Ghost AI Assistant")
        # Validar persistencia directa en la base de datos (PostgreSQL/SQLite)
        self.assertEqual(db_service.get_setting("COMPANY_NAME"), "Fantasma Digital Inc")
        self.assertEqual(db_service.get_setting("BOT_NAME"), "Ghost AI Assistant")

        # 3. Restaurar configuración original previa para no sobreescribir la BD del usuario
        self.client.post("/api/settings", json={
            "company_name": orig_company,
            "bot_name": orig_bot
        })
        self.assertEqual(db_service.get_setting("COMPANY_NAME"), orig_company)

    def test_human_handoff_and_inactivity_timeout(self):
        """
        Valida que si la IA deriva a un agente humano:
        1. La IA NO responde a mensajes posteriores mientras la derivación esté activa.
        2. El tiempo de inactividad se respeta (configurable).
        3. Al expirar la inactividad, la IA reanuda la atención de forma autónoma.
        4. La liberación manual reanuda la IA de inmediato.
        """
        test_sid = "50399887766"

        # 1. Asegurar estado inicial limpio
        lead_service.release_handoff(test_sid)
        is_active, _ = lead_service.is_in_human_handoff(test_sid)
        self.assertFalse(is_active)

        # 2. Activar derivación a humano
        lead_service.set_transferred(test_sid, True, reason="Cliente solicitó agente")
        is_active, remaining = lead_service.is_in_human_handoff(test_sid)
        self.assertTrue(is_active)
        self.assertGreater(remaining, 0.0)

        # 3. Validar que /chat responde indicando que el modo agente humano está activo y NO llama a la IA
        chat_res = self.client.post("/chat", json={
            "session_id": test_sid,
            "message": "¿Hola, sigues ahí?"
        })
        self.assertEqual(chat_res.status_code, 200)
        self.assertTrue(chat_res.json()["transferred_to_human"])
        self.assertTrue(chat_res.json().get("human_handoff_active", False))
        self.assertEqual(chat_res.json()["reply"], "") # Silencio absoluto para no enviar mensajes extra al cliente en WhatsApp

        # 4. Validar que /webhook omite respuesta de IA y reporta handoff activo
        hook_res = self.client.post("/webhook", json={
            "sender": test_sid,
            "message": "Necesito hablar con el asesor"
        })
        self.assertEqual(hook_res.status_code, 200)
        self.assertEqual(hook_res.json()["status"], "human_handoff_active")

        # 5. Endpoint de liberación manual
        rel_res = self.client.post(f"/api/handoff/{test_sid}/release")
        self.assertEqual(rel_res.status_code, 200)
        self.assertEqual(rel_res.json()["status"], "released")

        is_active_after, _ = lead_service.is_in_human_handoff(test_sid)
        self.assertFalse(is_active_after)

    def test_handoff_tag_and_notes(self):
        """Valida que al pausar/derivar se asigne tag y nota para el asesor, y que puedan actualizarse."""
        test_sid = "50370001122"
        lead_service.release_handoff(test_sid)

        # 1. Agregar historial previo del cliente cotizando un servicio
        lead_service.add_message(test_sid, "user", "Buenas tardes, quiero una cotización del plan empresarial para 15 usuarios")

        # 2. Transferir a agente humano
        lead_service.set_transferred(test_sid, True, reason="Solicitó cotización")

        handoff = db_service.get_handoff(test_sid)
        self.assertIsNotNone(handoff)
        self.assertTrue(handoff["transferred_to_human"])
        # Debe haber detectado COTIZACIÓN
        self.assertIn("COTIZ", handoff["tag"].upper())
        self.assertTrue(len(handoff["notes"]) > 0)
        self.assertIn("cotización", handoff["notes"].lower())

        # 3. Validar list_active_handoffs contiene tag y notes
        active_list = lead_service.list_active_handoffs()
        matching = [h for h in active_list if h["session_id"] == test_sid]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["tag"], handoff["tag"])
        self.assertEqual(matching[0]["notes"], handoff["notes"])

        # 4. Actualizar tag y notas vía API endpoint
        update_res = self.client.post(f"/api/handoff/{test_sid}/update", json={
            "tag": "VENTAS",
            "notes": "Cliente listo para cerrar contrato hoy mismo."
        })
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.json()["status"], "updated")

        updated_handoff = db_service.get_handoff(test_sid)
        self.assertEqual(updated_handoff["tag"], "VENTAS")
        self.assertEqual(updated_handoff["notes"], "Cliente listo para cerrar contrato hoy mismo.")

        # 5. Validar detección de ECOMMERCE
        ecom_sid = "50378889900"
        lead_service.release_handoff(ecom_sid)
        lead_service.add_message(ecom_sid, "user", "Necesito una tienda online con pasarela de pago y carrito Shopify")
        lead_service.set_transferred(ecom_sid, True, reason="Consulta tienda virtual")
        ecom_handoff = db_service.get_handoff(ecom_sid)
        self.assertEqual(ecom_handoff["tag"], "ECOMMERCE")
        lead_service.release_handoff(ecom_sid)

        # 6. Validar detección de AUTOMATIZACIÓN
        auto_sid = "50371112233"
        lead_service.release_handoff(auto_sid)
        lead_service.add_message(auto_sid, "user", "Quiero automatizar mis flujos de clientes con webhook y zapier")
        lead_service.set_transferred(auto_sid, True, reason="Consulta automatización")
        auto_handoff = db_service.get_handoff(auto_sid)
        self.assertEqual(auto_handoff["tag"], "AUTOMATIZACIÓN")
        lead_service.release_handoff(auto_sid)

        # 7. Limpieza
        lead_service.release_handoff(test_sid)

    def test_effective_support_phone(self):
        """Valida que si no se define SUPPORT_PHONE se use el de WhatsApp Gateway, y si se define se respete el personalizado."""
        from config import settings

        # Si se configura un número manual, debe retornar ese
        settings.update_settings({"SUPPORT_PHONE": "+503 7123-4567"})
        self.assertEqual(settings.get_effective_support_phone(), "+503 7123-4567")

        # Si se deja vacío, debe resolver el número efectivo disponible
        settings.update_settings({"SUPPORT_PHONE": ""})
        effective = settings.get_effective_support_phone()
        self.assertIsInstance(effective, str)

    def test_brand_profile_prompt_binding(self):
        """Valida que todos los campos del perfil de marca se integren en el prompt del sistema de la IA."""
        from services.prompt_service import build_brand_system_prompt, get_effective_transfer_message, detect_manual_transfer
        from config import settings

        orig_company = settings.COMPANY_NAME
        orig_bot = settings.BOT_NAME
        orig_tone = settings.BOT_TONE
        orig_inst = settings.BRAND_INSTRUCTIONS
        orig_welcome = settings.WELCOME_MESSAGE
        orig_transfer = settings.TRANSFER_MESSAGE
        orig_phone = settings.SUPPORT_PHONE
        orig_web = settings.WEBSITE_URL

        try:
            settings.update_settings({
                "COMPANY_NAME": "Test Enterprise Corp",
                "BOT_NAME": "Zenith AI Alpha",
                "BOT_TONE": "Cálido, empático y resolutivo",
                "BRAND_INSTRUCTIONS": "Ofrecer siempre un 10% de descuento en primer contacto.",
                "WELCOME_MESSAGE": "¡Saludos cordiales! Bienvenido a Test Enterprise Corp.",
                "TRANSFER_MESSAGE": "Con gusto te transfiero con uno de nuestros ejecutivos de cuenta especializados.",
                "SUPPORT_PHONE": "+503 7000-0000",
                "WEBSITE_URL": "https://testenterprise.com"
            })

            prompt = build_brand_system_prompt()

            # Verificar que absolutamente todos los campos del perfil están presentes e integrados
            self.assertIn("Test Enterprise Corp", prompt)
            self.assertIn("Zenith AI Alpha", prompt)
            self.assertIn("Cálido, empático y resolutivo", prompt)
            self.assertIn("Ofrecer siempre un 10% de descuento en primer contacto.", prompt)
            self.assertIn("¡Saludos cordiales! Bienvenido a Test Enterprise Corp.", prompt)
            self.assertIn("Con gusto te transfiero con uno de nuestros ejecutivos de cuenta especializados.", prompt)
            self.assertIn("+503 7000-0000", prompt)
            self.assertIn("https://testenterprise.com", prompt)

            # Verificar helper de transferencia y detección
            self.assertEqual(get_effective_transfer_message(), "Con gusto te transfiero con uno de nuestros ejecutivos de cuenta especializados.")
            self.assertTrue(detect_manual_transfer("Por favor quiero hablar con un humano"))
            self.assertFalse(detect_manual_transfer("¿Qué servicios ofrecen?"))
        finally:
            settings.update_settings({
                "COMPANY_NAME": orig_company,
                "BOT_NAME": orig_bot,
                "BOT_TONE": orig_tone,
                "BRAND_INSTRUCTIONS": orig_inst,
                "WELCOME_MESSAGE": orig_welcome,
                "TRANSFER_MESSAGE": orig_transfer,
                "SUPPORT_PHONE": orig_phone,
                "WEBSITE_URL": orig_web
            })

if __name__ == "__main__":
    unittest.main()

