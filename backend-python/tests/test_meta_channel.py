import hashlib
import hmac
import json
import unittest
from unittest.mock import patch

from config import settings
from services.meta_service import meta_service
from tests.fixtures import get_anonymous_client, get_test_client

APP_SECRET = "test-app-secret"
VERIFY_TOKEN = "test-verify-token"
PHONE_NUMBER_ID = "1234567890"


def meta_text_payload(message_id: str, sender: str = "50370001234", body: str = "Hola, ¿qué precios tienen?"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "WABA",
            "changes": [{
                "field": "messages",
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "50322223333", "phone_number_id": PHONE_NUMBER_ID},
                    "messages": [{"from": sender, "id": message_id, "type": "text", "text": {"body": body}}],
                },
            }],
        }],
    }


def sign(raw: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()


class TestMetaChannel(unittest.TestCase):
    def setUp(self):
        self.anon = get_anonymous_client()
        self.client = get_test_client()
        # load_db_overrides se desactiva para que la BD local no pise los valores de prueba
        self.patches = [
            patch.object(settings, "load_db_overrides"),
            patch.object(settings, "WHATSAPP_CHANNEL", "meta"),
            patch.object(settings, "META_APP_SECRET", APP_SECRET),
            patch.object(settings, "META_VERIFY_TOKEN", VERIFY_TOKEN),
            patch.object(settings, "META_PHONE_NUMBER_ID", PHONE_NUMBER_ID),
            patch.object(settings, "META_ACCESS_TOKEN", "EAAG-test-access-token-9999"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_webhook_subscription_verification(self):
        ok = self.anon.get("/webhook/meta", params={
            "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "987654"
        })
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.text, "987654")

        bad = self.anon.get("/webhook/meta", params={
            "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "987654"
        })
        self.assertEqual(bad.status_code, 403)

    def test_webhook_rejects_invalid_signature(self):
        raw = json.dumps(meta_text_payload("wamid.firma")).encode()
        res = self.anon.post("/webhook/meta", content=raw, headers={
            "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=deadbeef"
        })
        self.assertEqual(res.status_code, 401)

    def test_webhook_replies_through_meta_and_ignores_retries(self):
        raw = json.dumps(meta_text_payload("wamid.unico-1")).encode()
        headers = {"Content-Type": "application/json", "X-Hub-Signature-256": sign(raw)}
        with patch("main.ai_service.generate_reply", return_value="¡Hola! Con gusto te ayudo.") as ai_mock, \
             patch.object(meta_service, "send_text_message", return_value={"success": True}) as send_mock:
            first = self.anon.post("/webhook/meta", content=raw, headers=headers)
            retry = self.anon.post("/webhook/meta", content=raw, headers=headers)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["messages"], 1)
        self.assertEqual(retry.json()["messages"], 0)
        ai_mock.assert_called_once()
        self.assertEqual(ai_mock.call_args.kwargs["session_id"], "50370001234")
        send_mock.assert_called_once_with("50370001234", "¡Hola! Con gusto te ayudo.")

    def test_baileys_messages_are_silenced_when_meta_is_active(self):
        with patch("main.ai_service.generate_reply") as ai_mock:
            res = self.client.post("/chat", json={"session_id": "50370001234", "message": "Hola"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["reply"], "")
        ai_mock.assert_not_called()

    def test_settings_mask_meta_secrets(self):
        data = self.client.get("/api/settings").json()
        self.assertEqual(data["whatsapp_channel"], "meta")
        self.assertTrue(data["meta_access_token"].endswith("9999"))
        self.assertNotIn("test-access", data["meta_access_token"])
        self.assertNotIn(APP_SECRET, data["meta_app_secret"])

    def test_send_endpoint_reports_meta_error(self):
        with patch.object(meta_service, "send_text_message",
                          return_value={"success": False, "error": "Fuera de la ventana de 24 horas"}):
            res = self.client.post("/api/whatsapp/send", json={"to": "50370001234", "message": "Hola"})
        self.assertEqual(res.status_code, 502)
        self.assertIn("24 horas", res.json()["detail"])

    def test_channel_summary_lists_webhook_url(self):
        with patch.object(settings, "PUBLIC_BASE_URL", "https://bot.ejemplo.com"), \
             patch("main.whatsapp_service.get_baileys_status", return_value={"status": "UNREACHABLE"}):
            data = self.client.get("/api/whatsapp/channel").json()
        self.assertEqual(data["channel"], "meta")
        self.assertEqual(data["meta"]["webhook_url"], "https://bot.ejemplo.com/webhook/meta")
        self.assertTrue(data["meta"]["webhook_is_public_https"])
        self.assertEqual(data["meta"]["missing_fields"], [])


if __name__ == "__main__":
    unittest.main()
