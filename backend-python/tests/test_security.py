import unittest
from unittest.mock import patch

from config import settings
from services.auth_service import auth_service, mask_secret
from tests.fixtures import get_anonymous_client, get_test_client


class TestSecurity(unittest.TestCase):
    def setUp(self):
        self.anon = get_anonymous_client()
        self.client = get_test_client()
        auth_service._failed_logins.clear()

    def test_protected_routes_reject_anonymous(self):
        for method, path in [
            ("get", "/"),
            ("get", "/api/settings"),
            ("get", "/api/knowledge"),
            ("get", "/sessions"),
            ("post", "/api/whatsapp/send"),
            ("post", "/chat"),
            ("post", "/webhook"),
        ]:
            res = getattr(self.anon, method)(path)
            self.assertEqual(res.status_code, 401, f"{method.upper()} {path} debería exigir autenticación")

    def test_health_is_public_and_minimal(self):
        res = self.anon.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "online"})

    def test_wrong_internal_key_rejected(self):
        res = self.anon.get("/api/settings", headers={"X-Internal-Key": "clave-falsa"})
        self.assertEqual(res.status_code, 401)

    def test_login_and_bearer_token(self):
        res = self.anon.post("/api/auth/login", json={"password": auth_service.admin_password})
        self.assertEqual(res.status_code, 200)
        token = res.json()["token"]
        ok = self.anon.get("/api/auth/check", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(ok.status_code, 200)

        tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
        bad = self.anon.get("/api/auth/check", headers={"Authorization": f"Bearer {tampered}"})
        self.assertEqual(bad.status_code, 401)

    def test_expired_token_rejected(self):
        with patch("services.auth_service.time.time", return_value=0):
            token = auth_service.issue_token()["token"]
        self.assertFalse(auth_service.verify_token(token))

    def test_login_lockout_after_failed_attempts(self):
        for _ in range(5):
            res = self.anon.post("/api/auth/login", json={"password": "incorrecta"})
            self.assertEqual(res.status_code, 401)
        locked = self.anon.post("/api/auth/login", json={"password": auth_service.admin_password})
        self.assertEqual(locked.status_code, 429)

    def test_settings_never_expose_full_api_keys(self):
        with patch.object(settings, "GEMINI_API_KEY", "AIzaSyEXAMPLE-secret-1234"), \
             patch.object(settings, "load_db_overrides"):
            data = self.client.get("/api/settings").json()
        self.assertEqual(data["gemini_api_key"], mask_secret("AIzaSyEXAMPLE-secret-1234"))
        self.assertNotIn("secret", data["gemini_api_key"])

    def test_masked_key_is_not_saved_back(self):
        with patch.object(settings, "update_settings") as update_mock:
            self.client.post("/api/settings", json={"gemini_api_key": "••••1234", "bot_name": "Bot"})
        updates = update_mock.call_args[0][0]
        self.assertNotIn("GEMINI_API_KEY", updates)
        self.assertEqual(updates["BOT_NAME"], "Bot")

    def test_cors_rejects_unknown_origin(self):
        res = self.anon.options("/api/settings", headers={
            "Origin": "https://sitio-malicioso.example",
            "Access-Control-Request-Method": "GET",
        })
        self.assertNotEqual(res.headers.get("access-control-allow-origin"), "*")
        self.assertNotEqual(res.headers.get("access-control-allow-origin"), "https://sitio-malicioso.example")


if __name__ == "__main__":
    unittest.main()
