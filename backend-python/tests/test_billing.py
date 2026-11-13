"""Cobro con PayPal: alta verificada contra PayPal, webhook y pausa automática (PayPal simulado)."""
from unittest.mock import patch

import services.password_reset_service as prs
from services.billing_service import billing_service
from services.security_middleware import rate_limiter
from services.tenant_service import tenant_registry
from tests.test_tenants import TenantTestCase

PLAN_IDS = {"_product": "PROD-1", "negocio:monthly": "P-NEG-M", "negocio:yearly": "P-NEG-Y",
            "emprendedor:monthly": "P-EMP-M", "emprendedor:yearly": "P-EMP-Y", "pro:monthly": "P-PRO-M",
            "pro:yearly": "P-PRO-Y"}


class TestBilling(TenantTestCase):
    def setUp(self):
        super().setUp()
        rate_limiter.reset()
        self.paypal_status = "ACTIVE"
        self.patches = [
            patch.object(billing_service, "_plan_ids", lambda: PLAN_IDS),
            patch.object(billing_service, "get_subscription", self.fake_subscription),
            patch.object(billing_service, "verify_webhook", lambda headers, event: True),
            patch.object(billing_service, "is_configured", lambda: True),
            patch.object(prs, "send_in_background", lambda *a, **k: None),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def fake_subscription(self, sub_id):
        return {"id": sub_id, "status": self.paypal_status, "plan_id": "P-NEG-M",
                "billing_info": {"next_billing_time": "2099-01-01T00:00:00Z"}}

    def test_config_lists_plans_with_paypal_ids(self):
        cfg = self.anon.get("/api/public/billing/config").json()
        self.assertTrue(cfg["enabled"])
        self.assertEqual([p["key"] for p in cfg["plans"]], ["emprendedor", "negocio", "pro"])
        self.assertNotIn("secret", str(cfg).lower())

    def test_slug_check_before_paying(self):
        self.assertFalse(self.anon.get("/api/public/billing/slug", params={"slug": "acme"}).json()["available"])
        self.assertFalse(self.anon.get("/api/public/billing/slug", params={"slug": "auth"}).json()["available"])
        self.assertTrue(self.anon.get("/api/public/billing/slug", params={"slug": "taller-nuevo"}).json()["available"])

    def test_activate_creates_company_and_webhook_pauses_it(self):
        res = self.anon.post("/api/public/billing/activate", json={
            "subscription_id": "I-ABC123456", "company": "Pupusería Ana", "slug": "pupuseria-ana",
            "email": "ana@pupuseria.dev"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(tenant_registry.is_active("pupuseria-ana"))
        self.assertEqual(tenant_registry.owner_email("pupuseria-ana"), "ana@pupuseria.dev")
        # Repetir la activación no crea otra empresa
        again = self.anon.post("/api/public/billing/activate", json={
            "subscription_id": "I-ABC123456", "company": "Otra", "slug": "otra", "email": "ana@pupuseria.dev"})
        self.assertTrue(again.json().get("already"), again.text)

        self.paypal_status = "SUSPENDED"
        hook = self.anon.post("/webhook/paypal", json={"event_type": "BILLING.SUBSCRIPTION.SUSPENDED",
                                                       "resource": {"id": "I-ABC123456"}})
        self.assertEqual(hook.status_code, 200)
        self.assertFalse(tenant_registry.is_active("pupuseria-ana"))

        self.paypal_status = "ACTIVE"
        self.anon.post("/webhook/paypal", json={"event_type": "BILLING.SUBSCRIPTION.ACTIVATED",
                                                "resource": {"id": "I-ABC123456"}})
        self.assertTrue(tenant_registry.is_active("pupuseria-ana"))

    def test_unpaid_subscription_rejected(self):
        self.paypal_status = "CANCELLED"
        res = self.anon.post("/api/public/billing/activate", json={
            "subscription_id": "I-NOPAGO1234", "company": "No Pago", "slug": "no-pago", "email": "x@y.dev"})
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(tenant_registry.get("no-pago"))

    def test_bad_webhook_signature_rejected(self):
        with patch.object(billing_service, "verify_webhook", lambda headers, event: False):
            res = self.anon.post("/webhook/paypal", json={"event_type": "X", "resource": {"id": "I-1"}})
        self.assertEqual(res.status_code, 400)
