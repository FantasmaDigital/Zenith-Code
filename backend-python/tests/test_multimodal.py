import unittest
from unittest.mock import patch, MagicMock
from tests.fixtures import get_test_client, SAMPLE_AUDIO_BASE64, SAMPLE_IMAGE_BASE64
from models.chat import ChatRequest
from services.lead_service import lead_service
from services.prompt_service import build_brand_system_prompt
from services.gemini_service import gemini_service
from services.multimodal_service import multimodal_service
from services.ai_service import ai_service

class TestMultimodalArchitecture(unittest.TestCase):
    def setUp(self):
        self.client = get_test_client()

    def test_multimodal_service_mime_sanitization(self):
        """Verifica la sanitización de tipos MIME con codecs o parámetros."""
        self.assertEqual(multimodal_service.sanitize_mime_type("audio/ogg; codecs=opus"), "audio/ogg")
        self.assertEqual(multimodal_service.sanitize_mime_type("image/jpeg; charset=utf-8"), "image/jpeg")
        self.assertEqual(multimodal_service.sanitize_mime_type(None, default="audio/ogg"), "audio/ogg")

    def test_multimodal_service_base64_decoding_with_padding(self):
        """Verifica que el servicio de decodificación corrija paddings faltantes."""
        raw_bytes = b"Hello Zenith Multimodal"
        import base64
        encoded = base64.b64encode(raw_bytes).decode("utf-8")
        unpadded = encoded.rstrip("=")
        decoded = multimodal_service.decode_base64_media(unpadded)
        self.assertEqual(decoded, raw_bytes)

    def test_audio_instruction_part_injected(self):
        """Verifica que build_gemini_parts inyecte la directiva explícita de escucha e interpretación de audio."""
        parts, label = multimodal_service.build_gemini_parts(
            text="¿Tienen citas disponibles?",
            audio_base64=SAMPLE_AUDIO_BASE64,
            audio_mime_type="audio/ogg"
        )
        # Debe haber al menos una parte de audio y una parte de instrucción
        text_parts = [p.text for p in parts if p.text]
        self.assertTrue(any("Nota de voz del cliente" in t for t in text_parts))
        self.assertIn("🎙️ [Nota de voz]", label)

    def test_chat_request_domain_model_validation(self):
        """Verifica el método helper has_content del modelo ChatRequest."""
        empty_req = ChatRequest(session_id="test-1", message="   ")
        self.assertFalse(empty_req.has_content)

        text_req = ChatRequest(session_id="test-2", message="Hola")
        self.assertTrue(text_req.has_content)

        audio_req = ChatRequest(session_id="test-3", message="", audio_base64=SAMPLE_AUDIO_BASE64)
        self.assertTrue(audio_req.has_content)

        image_req = ChatRequest(session_id="test-4", message="", image_base64=SAMPLE_IMAGE_BASE64)
        self.assertTrue(image_req.has_content)

    def test_salvadoran_market_prompt_directives(self):
        """Verifica que el prompt del sistema contenga las directrices especializadas de El Salvador."""
        prompt = build_brand_system_prompt()
        for expected in ("[MULTIMEDIA]", "Notas de voz", "salvadoreño", "comprobante de pago"):
            self.assertIn(expected, prompt)

    def test_empty_message_and_media_rejected(self):
        """Verifica rechazo con HTTP 400 cuando el cliente no envía ningún contenido."""
        response = self.client.post("/chat", json={
            "session_id": "test-empty-user",
            "message": "   ",
            "audio_base64": None,
            "image_base64": None
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("Debe proporcionarse un mensaje de texto, nota de voz o imagen", response.json()["detail"])

    def test_voice_note_end_to_end(self):
        """Verifica procesamiento de nota de voz con registro adecuado en historial."""
        session_id = "arch-test-voice"
        lead_service.reset_session(session_id)

        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = MagicMock(text="Nota de voz procesada con éxito.")

        with patch.object(gemini_service, "_get_client", return_value=mock_client):
            response = self.client.post("/chat", json={
                "session_id": session_id,
                "message": "",
                "audio_base64": SAMPLE_AUDIO_BASE64,
                "audio_mime_type": "audio/ogg"
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["reply"], "Nota de voz procesada con éxito.")

            session = lead_service.get_or_create_session(session_id)
            last_msg = [m for m in session.messages if m["role"] == "user"][-1]
            self.assertIn("Nota de voz", last_msg["content"])

    def test_bank_receipt_image_end_to_end(self):
        """Verifica procesamiento de comprobante de transferencia bancaria."""
        session_id = "arch-test-receipt"
        lead_service.reset_session(session_id)

        receipt_text = "Comprobante recibido por $25.00 con ref #112233."
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = MagicMock(text=receipt_text)

        with patch.object(gemini_service, "_get_client", return_value=mock_client):
            response = self.client.post("/chat", json={
                "session_id": session_id,
                "message": "Aquí te mando la transferencia",
                "image_base64": SAMPLE_IMAGE_BASE64,
                "image_mime_type": "image/jpeg"
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["reply"], receipt_text)

            session = lead_service.get_or_create_session(session_id)
            last_msg = [m for m in session.messages if m["role"] == "user"][-1]
            self.assertIn("Comprobante / Imagen", last_msg["content"])

if __name__ == "__main__":
    unittest.main()
