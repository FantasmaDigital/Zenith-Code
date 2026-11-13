import unittest
from unittest.mock import patch

from services.auth_service import auth_service
from services.security_middleware import RateLimiter, rate_limiter
from tests.fixtures import get_anonymous_client


class TestSecurityHeaders(unittest.TestCase):
    def setUp(self):
        self.anon = get_anonymous_client()

    def test_defensive_headers_on_every_response(self):
        res = self.anon.get("/health")
        self.assertEqual(res.headers.get("x-content-type-options"), "nosniff")
        self.assertEqual(res.headers.get("x-frame-options"), "DENY")
        self.assertIn("referrer-policy", res.headers)
        self.assertNotIn("server", {k.lower() for k in res.headers})

    def test_api_responses_are_not_cached(self):
        res = self.anon.get("/api/public/branding", params={"tenant": "default"})
        self.assertEqual(res.headers.get("cache-control"), "no-store")

    def test_docs_hidden_outside_debug(self):
        from main import app
        if app.docs_url is None:
            self.assertEqual(self.anon.get("/docs").status_code, 404)
            self.assertEqual(self.anon.get("/openapi.json").status_code, 404)


class TestRateLimiter(unittest.TestCase):
    def test_window_blocks_then_releases(self):
        limiter = RateLimiter([("/api/public/", 3, 60)])
        with patch("services.security_middleware.time.monotonic", return_value=1000.0):
            self.assertEqual([limiter.hit("/api/public/x", "1.1.1.1") for _ in range(3)], [0, 0, 0])
            self.assertGreater(limiter.hit("/api/public/x", "1.1.1.1"), 0)
            # Otra IP no se ve afectada; una ruta sin regla nunca se limita
            self.assertEqual(limiter.hit("/api/public/x", "2.2.2.2"), 0)
            self.assertEqual(limiter.hit("/api/settings", "1.1.1.1"), 0)
        with patch("services.security_middleware.time.monotonic", return_value=1061.0):
            self.assertEqual(limiter.hit("/api/public/x", "1.1.1.1"), 0)

    def test_login_endpoint_returns_429_when_flooded(self):
        rate_limiter.reset()
        auth_service._failed_logins.clear()
        anon = get_anonymous_client()
        try:
            with patch.dict("os.environ", {"RATE_LIMIT_ENABLED": "true"}):
                statuses = [anon.post("/api/auth/login", json={"password": "x", "username": f"u{i}@x.com"}).status_code
                            for i in range(25)]
                self.assertIn(429, statuses)
                blocked = anon.post("/api/auth/login", json={"password": "x"})
                self.assertEqual(blocked.status_code, 429)
                self.assertIn("retry-after", blocked.headers)
        finally:
            rate_limiter.reset()
            auth_service._failed_logins.clear()


if __name__ == "__main__":
    unittest.main()
