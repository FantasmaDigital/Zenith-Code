"""Tarjetas de fidelidad y planes por empresa: una empresa puede contratar SOLO fidelidad, sin el ARM."""
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from config import settings
from main import app
from modules.loyalty.service import LoyaltyError, loyalty_service
from modules.registry import module_registry
from services.auth_service import auth_service
from services.customer_service import customer_service
from services.db_service import db_service
from services.tenant_service import DEFAULT_TENANT, normalize_features, tenant_context, tenant_registry


class LoyaltyTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="zenith_loyalty_")
        cls._saved = (db_service.sqlite_path, set(db_service._provisioned), db_service.is_postgres,
                      customer_service._db)
        db_service.sqlite_path = os.path.join(cls.tmp, "knowledge.sqlite")
        db_service.is_postgres = False
        db_service._provisioned = set()
        tenant_registry._ready = False
        tenant_registry._cache.clear()
        tenant_registry._pv_cache.clear()
        customer_service._db = db_service
        loyalty_service._db = db_service
        loyalty_service.__dict__["_ready_tenants"] = set()
        settings.invalidate(DEFAULT_TENANT)
        settings.for_tenant(DEFAULT_TENANT)

        tenant_registry.create("solo-lealtad", "Cafetería Solo", "clave-solo-123", features=["loyalty"])
        tenant_registry.create("solo-arm", "Empresa ARM", "clave-arm-1234", features=["arm"])
        tenant_registry.create("completa", "Empresa Completa", "clave-full-123", features=["arm", "loyalty"])
        for slug in ("solo-lealtad", "completa"):
            with tenant_context(slug):
                module_registry.install("loyalty", db_service, app)

    @classmethod
    def tearDownClass(cls):
        (db_service.sqlite_path, db_service._provisioned, db_service.is_postgres, customer_service._db) = cls._saved
        loyalty_service.__dict__["_ready_tenants"] = set()
        for slug in ("solo-lealtad", "solo-arm", "completa"):
            module_registry._loaded_by_tenant.pop(slug, None)
        tenant_registry._ready = False
        tenant_registry._cache.clear()
        tenant_registry._pv_cache.clear()
        settings.invalidate(DEFAULT_TENANT)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        auth_service._failed_logins.clear()
        tenant_registry._cache.clear()
        self.anon = TestClient(app)

    def login(self, tenant, password):
        res = self.anon.post("/api/auth/login", json={"tenant": tenant, "password": password})
        self.assertEqual(res.status_code, 200, res.text)
        return {"Authorization": f"Bearer {res.json()['token']}"}


class TestPlans(LoyaltyTestCase):
    def test_features_validation(self):
        self.assertEqual(normalize_features("loyalty, ARM"), ["arm", "loyalty"])
        with self.assertRaises(ValueError):
            normalize_features([])
        with self.assertRaises(ValueError):
            normalize_features(["pizza"])

    def test_default_tenant_has_everything(self):
        self.assertEqual(tenant_registry.get(DEFAULT_TENANT)["features"], ["arm", "loyalty"])
        with self.assertRaises(ValueError):
            tenant_registry.update(DEFAULT_TENANT, features=["loyalty"])

    def test_loyalty_only_tenant_is_blocked_from_arm(self):
        h = self.login("solo-lealtad", "clave-solo-123")
        for path in ("/api/knowledge", "/api/customers", "/api/inbox", "/api/agent/tasks", "/sessions"):
            res = self.anon.get(path, headers=h)
            self.assertEqual(res.status_code, 403, f"{path}: {res.text}")
        # Lo común sigue funcionando
        self.assertEqual(self.anon.get("/api/auth/check", headers=h).json()["features"], ["loyalty"])
        self.assertEqual(self.anon.get("/", headers=h).status_code, 200)
        self.assertEqual(self.anon.get("/api/loyalty/programs", headers=h).status_code, 200)

    def test_arm_only_tenant_cannot_use_or_install_loyalty(self):
        h = self.login("solo-arm", "clave-arm-1234")
        self.assertEqual(self.anon.get("/api/knowledge", headers=h).status_code, 200)
        self.assertEqual(self.anon.get("/api/loyalty/programs", headers=h).status_code, 403)
        with tenant_context("solo-arm"):
            with self.assertRaises(ValueError):
                module_registry.install("loyalty", db_service, app)
            mods = {m["id"]: m for m in module_registry.get_modules_with_status(db_service)}
            self.assertFalse(mods["loyalty"]["in_plan"])
            self.assertTrue(mods["restaurant"]["in_plan"])

    def test_loyalty_only_tenant_cannot_install_arm_modules(self):
        with tenant_context("solo-lealtad"):
            with self.assertRaises(ValueError):
                module_registry.install("restaurant", db_service, app)

    def test_downgrade_disables_module_routes(self):
        tenant_registry.create("baja", "Empresa Baja", "clave-baja-123", features=["arm", "loyalty"])
        with tenant_context("baja"):
            module_registry.install("loyalty", db_service, app)
        h = self.login("baja", "clave-baja-123")
        self.assertEqual(self.anon.get("/api/loyalty/programs", headers=h).status_code, 200)
        tenant_registry.update("baja", features=["arm"])
        self.assertEqual(self.anon.get("/api/loyalty/programs", headers=h).status_code, 403)
        with tenant_context("baja"):
            self.assertFalse(module_registry.is_loaded("loyalty"))


class TestLoyaltyFlow(LoyaltyTestCase):
    def test_points_program_full_flow_via_api(self):
        h = self.login("solo-lealtad", "clave-solo-123")
        prog = self.anon.post("/api/loyalty/programs", headers=h,
                              json={"name": "Puntos Café", "kind": "points", "points_per_currency": 2}).json()
        reward = self.anon.post("/api/loyalty/rewards", headers=h,
                                json={"program_id": prog["id"], "name": "Latte gratis", "cost": 20})
        self.assertEqual(reward.status_code, 201, reward.text)
        card = self.anon.post("/api/loyalty/cards", headers=h, json={
            "program_id": prog["id"], "customer_name": "Ana", "phone": "+503 7000-1111"}).json()
        self.assertEqual(card["phone"], "50370001111")
        self.assertEqual(len(card["code"]), 8)

        # $7.90 x 2 = 15 puntos (se redondea hacia abajo)
        res = self.anon.post(f"/api/loyalty/cards/{card['id']}/earn", headers=h,
                             json={"purchase_amount": 7.9, "reference": "T-1"}).json()
        self.assertEqual((res["points"], res["balance"]), (15, 15))
        # La misma referencia no suma dos veces
        dup = self.anon.post(f"/api/loyalty/cards/{card['id']}/earn", headers=h,
                             json={"purchase_amount": 7.9, "reference": "T-1"}).json()
        self.assertTrue(dup["duplicate"])
        self.assertEqual(dup["balance"], 15)

        # Saldo insuficiente
        bad = self.anon.post(f"/api/loyalty/cards/{card['id']}/redeem", headers=h,
                             json={"reward_id": reward.json()["id"]})
        self.assertEqual(bad.status_code, 400)

        self.anon.post(f"/api/loyalty/cards/{card['id']}/earn", headers=h, json={"purchase_amount": 5})
        ok = self.anon.post(f"/api/loyalty/cards/{card['id']}/redeem", headers=h,
                            json={"reward_id": reward.json()["id"]}).json()
        self.assertEqual((ok["balance"], ok["reward"]), (5, "Latte gratis"))

        # Búsqueda por teléfono y vista pública (sin login, sin datos privados)
        found = self.anon.get("/api/loyalty/cards/lookup", headers=h, params={"q": "7000-1111"}).json()
        self.assertEqual(found["id"], card["id"])
        pub = self.anon.get(f"/api/public/loyalty/solo-lealtad/cards/{card['public_token']}")
        self.assertEqual(pub.status_code, 200, pub.text)
        body = pub.json()
        self.assertEqual(body["balance"], 5)
        self.assertNotIn("phone", body)
        self.assertNotIn("public_token", body)
        self.assertEqual(body["company"]["name"], "Cafetería Solo")

        stats = self.anon.get("/api/loyalty/stats", headers=h).json()
        self.assertEqual((stats["points_earned"], stats["points_redeemed"], stats["redemptions"]), (25, 20, 1))

    def test_public_card_is_tenant_scoped(self):
        with tenant_context("completa"):
            prog = loyalty_service.create_program({"name": "Sellos", "kind": "stamps", "stamps_goal": 3})
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Beto"})
        self.assertEqual(self.anon.get(f"/api/public/loyalty/completa/cards/{card['public_token']}").status_code, 200)
        for slug in ("solo-lealtad", "solo-arm", "no-existe"):
            res = self.anon.get(f"/api/public/loyalty/{slug}/cards/{card['public_token']}")
            self.assertEqual(res.status_code, 404, slug)
        # Las rutas del panel exigen login
        self.assertIn(self.anon.get("/api/loyalty/programs").status_code, (401, 403))

    def test_stamps_program(self):
        with tenant_context("completa"):
            prog = loyalty_service.create_program({"name": "Café 5", "kind": "stamps", "stamps_goal": 5,
                                                   "reward_description": "Café gratis", "stamp_cooldown_minutes": 0})
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Caro"})
            for _ in range(4):
                r = loyalty_service.earn(card["id"])
            self.assertFalse(r["reward_ready"])
            with self.assertRaises(LoyaltyError):
                loyalty_service.redeem(card["id"])
            r = loyalty_service.earn(card["id"])
            self.assertTrue(r["reward_ready"])
            r = loyalty_service.redeem(card["id"])
            self.assertEqual((r["balance"], r["reward"]), (0, "Café gratis"))
            with self.assertRaises(LoyaltyError):
                loyalty_service.create_reward({"program_id": prog["id"], "name": "x", "cost": 1})

    def test_blocked_card_and_duplicate_phone(self):
        with tenant_context("completa"):
            prog = loyalty_service.create_program({"name": "Pts", "kind": "points"})
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Dani", "phone": "70002222"})
            with self.assertRaises(LoyaltyError):
                loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Otro", "phone": "7000-2222"})
            loyalty_service.update_card(card["id"], {"status": "blocked"})
            with self.assertRaises(LoyaltyError):
                loyalty_service.earn(card["id"], purchase_amount=10)

    def test_expiry_by_inactivity(self):
        with tenant_context("completa"):
            prog = loyalty_service.create_program({"name": "Vence", "kind": "points", "expiry_days": 30})
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Eva"})
            loyalty_service.earn(card["id"], purchase_amount=50)
            with loyalty_service._tx() as tx:
                tx.execute("UPDATE zenith_loyalty_cards SET last_activity_at = ? WHERE id = ?",
                           ("2020-01-01T00:00:00+00:00", card["id"]))
            r = loyalty_service.earn(card["id"], purchase_amount=3)
            self.assertEqual(r["balance"], 3)
            kinds = [t["kind"] for t in loyalty_service.card_transactions(card["id"])]
            self.assertIn("expire", kinds)

    def test_agent_tool_finds_card_by_session_phone(self):
        from modules.loyalty.module import _tool_consultar_tarjeta
        from services.agent_tools import ToolContext
        with tenant_context("completa"):
            prog = loyalty_service.create_program({"name": "Tool", "kind": "points"})
            loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Fer", "phone": "50379990000"})
            out = _tool_consultar_tarjeta(ToolContext(session_id="50379990000"), {})
            self.assertTrue(out["ok"])
            self.assertEqual(out["cliente"], "Fer")
            self.assertFalse(_tool_consultar_tarjeta(ToolContext(session_id="1"), {})["ok"])



class TestStampsAndKioskQr(LoyaltyTestCase):
    def _stamps_program(self, cooldown=60):
        return loyalty_service.create_program({"name": f"Sellos {cooldown}", "kind": "stamps", "stamps_goal": 3,
                                               "reward_description": "Café", "stamp_cooldown_minutes": cooldown})

    def test_only_one_stamp_and_cooldown(self):
        with tenant_context("completa"):
            prog = self._stamps_program(60)
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Gabi"})
            r = loyalty_service.earn(card["id"], purchase_amount=500)  # el monto no cambia nada: 1 sello
            self.assertEqual((r["points"], r["balance"]), (1, 1))
            with self.assertRaises(LoyaltyError) as err:
                loyalty_service.earn(card["id"])
            self.assertIn("min", str(err.exception))
            self.assertEqual(loyalty_service.get_card(card["id"])["balance"], 1)
            # Pasado el tiempo de espera vuelve a admitir un sello
            with loyalty_service._tx() as tx:
                tx.execute("UPDATE zenith_loyalty_cards SET last_stamp_at = ? WHERE id = ?",
                           ("2020-01-01T00:00:00+00:00", card["id"]))
            self.assertEqual(loyalty_service.earn(card["id"])["balance"], 2)

    def test_api_ignores_stamp_quantity(self):
        h = self.login("completa", "clave-full-123")
        with tenant_context("completa"):
            prog = self._stamps_program(0)
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Hugo"})
        res = self.anon.post(f"/api/loyalty/cards/{card['id']}/earn", headers=h, json={"stamps": 50}).json()
        self.assertEqual((res["points"], res["balance"]), (1, 1))

    def _qr(self, h, cooldown=60):
        with tenant_context("completa"):
            prog = self._stamps_program(cooldown)
        qr = self.anon.get(f"/api/loyalty/programs/{prog['id']}/qr", headers=h).json()["qr_token"]
        return prog, qr


class TestPrintedQrWithCashierApproval(TestStampsAndKioskQr):
    """QR impreso fijo: el cliente pide el sello y SOLO se suma cuando el cajero lo aprueba."""

    def setUp(self):
        super().setUp()
        self.h = self.login("completa", "clave-full-123")
        self.receipts = []
        p1 = patch("modules.loyalty.notify.send_receipt_async",
                   side_effect=lambda cid, res, kind, link="": self.receipts.append((cid, kind, res.get("balance"))))
        p2 = patch("modules.loyalty.notify.channels", return_value={"email": False, "whatsapp": False})
        p1.start()
        p2.start()
        self.addCleanup(p1.stop)
        self.addCleanup(p2.stop)

    def base(self, qr):
        return f"/api/public/loyalty/completa/stamp/{qr}"

    def pending_id(self, short_code):
        pend = self.anon.get("/api/loyalty/requests", headers=self.h).json()["requests"]
        return [r for r in pend if r["short_code"] == short_code][0]

    def test_qr_is_fixed_until_regenerated(self):
        prog, qr = self._qr(self.h)
        self.assertEqual(self.anon.get(f"/api/loyalty/programs/{prog['id']}/qr", headers=self.h).json()["qr_token"], qr)
        self.assertEqual(self.anon.get(self.base(qr)).status_code, 200)
        new = self.anon.post(f"/api/loyalty/programs/{prog['id']}/qr/regenerate", headers=self.h).json()["qr_token"]
        self.assertNotEqual(new, qr)
        self.assertEqual(self.anon.get(self.base(qr)).status_code, 404)  # el QR viejo deja de servir

    def test_nothing_is_added_without_cashier(self):
        prog, qr = self._qr(self.h)
        url = self.base(qr)
        self.assertTrue(self.anon.post(url, json={"card_tokens": []}).json()["needs_verification"])
        self.assertFalse(self.anon.post(url + "/code", json={"contact": "7000-3333"}).json()["code_required"])
        self.assertTrue(self.anon.post(url + "/verify", json={"contact": "7000-3333", "code": "0000"}).json()["needs_name"])
        req = self.anon.post(url + "/verify", json={"contact": "7000-3333", "code": "0000", "customer_name": "Lu"}).json()
        self.assertEqual(req["status"], "pending")
        self.assertEqual(len(req["short_code"]), 4)
        self.assertEqual(req["card"]["balance"], 0)  # todavía nada

        # Pedirlo otra vez desde el mismo teléfono no duplica: es la misma solicitud
        again = self.anon.post(url, json={"card_tokens": [req["card_token"]]}).json()
        self.assertEqual(again["request_token"], req["request_token"])

        mine = self.pending_id(req["short_code"])
        self.assertEqual(mine["customer_name"], "Lu")
        status_url = f"/api/public/loyalty/completa/requests/{req['request_token']}"
        self.assertEqual(self.anon.get(status_url).json()["status"], "pending")

        ok = self.anon.post(f"/api/loyalty/requests/{mine['id']}/approve", headers=self.h).json()
        self.assertEqual((ok["status"], ok["balance"]), ("approved", 1))
        st = self.anon.get(status_url).json()
        self.assertEqual((st["status"], st["card"]["balance"]), ("approved", 1))
        self.assertEqual(self.receipts[-1][1:], ("earn", 1))
        # Ya atendida: no se puede aprobar dos veces
        self.assertEqual(self.anon.post(f"/api/loyalty/requests/{mine['id']}/approve", headers=self.h).status_code, 400)
        # Y por la espera, el cliente no puede pedir otro de inmediato
        res = self.anon.post(url, json={"card_tokens": [req["card_token"]]})
        self.assertEqual(res.status_code, 400)
        self.assertIn("min", res.json()["detail"])

    def test_reject_and_expire(self):
        prog, qr = self._qr(self.h, cooldown=0)
        url = self.base(qr)
        req = self.anon.post(url + "/verify", json={"contact": "ana@ejemplo.com", "code": "", "customer_name": "Ana"}).json()
        rid = self.pending_id(req["short_code"])["id"]
        self.assertEqual(self.anon.post(f"/api/loyalty/requests/{rid}/reject", headers=self.h).json()["status"], "rejected")
        st = self.anon.get(f"/api/public/loyalty/completa/requests/{req['request_token']}").json()
        self.assertEqual((st["status"], st["card"]["balance"]), ("rejected", 0))
        # Una solicitud vencida no se puede aprobar
        req2 = self.anon.post(url, json={"card_tokens": [req["card_token"]]}).json()
        rid2 = self.pending_id(req2["short_code"])["id"]
        with tenant_context("completa"):
            with loyalty_service._tx() as tx:
                tx.execute("UPDATE zenith_loyalty_requests SET expires_at = '2020-01-01T00:00:00+00:00' WHERE id = ?",
                           (rid2,))
        st2 = self.anon.get(f"/api/public/loyalty/completa/requests/{req2['request_token']}").json()
        self.assertEqual(st2["status"], "expired")
        self.assertEqual(self.anon.post(f"/api/loyalty/requests/{rid2}/approve", headers=self.h).status_code, 400)

    def test_code_verification_when_channel_available(self):
        prog, qr = self._qr(self.h)
        url = self.base(qr)
        sent = {}
        with patch("modules.loyalty.notify.channels", return_value={"email": True, "whatsapp": False}), \
                patch("modules.loyalty.notify.send_code", side_effect=lambda c, ch, code: sent.update(code=code) or ch):
            r = self.anon.post(url + "/code", json={"contact": "Beto@Ejemplo.com"}).json()
            self.assertEqual((r["code_required"], r["sent_via"]), (True, "email"))
            self.assertEqual(r["contact"], "be***@ejemplo.com")
            # Reenvío inmediato bloqueado
            self.assertEqual(self.anon.post(url + "/code", json={"contact": "beto@ejemplo.com"}).status_code, 400)
            bad = self.anon.post(url + "/verify", json={"contact": "beto@ejemplo.com", "code": "999999",
                                                        "customer_name": "B"})
            self.assertEqual(bad.status_code, 400)
            good = self.anon.post(url + "/verify", json={"contact": "beto@ejemplo.com", "code": sent["code"],
                                                         "customer_name": "Beto"}).json()
            self.assertEqual(good["status"], "pending")
            self.assertTrue(good["card_created"])
            # El código es de un solo uso
            self.assertEqual(self.anon.post(url + "/verify", json={"contact": "beto@ejemplo.com",
                                                                   "code": sent["code"]}).status_code, 400)

    def test_wrong_code_attempts_are_limited(self):
        prog, qr = self._qr(self.h)
        url = self.base(qr)
        sent = {}
        with patch("modules.loyalty.notify.channels", return_value={"email": False, "whatsapp": True}), \
                patch("modules.loyalty.notify.send_code", side_effect=lambda c, ch, code: sent.update(code=code) or ch):
            self.anon.post(url + "/code", json={"contact": "7000 4444"})
            for _ in range(5):
                self.anon.post(url + "/verify", json={"contact": "70004444", "code": "000000", "customer_name": "X"})
            res = self.anon.post(url + "/verify", json={"contact": "70004444", "code": sent["code"], "customer_name": "X"})
            self.assertEqual(res.status_code, 400)
            self.assertIn("intentos", res.json()["detail"])

    def test_cashier_can_scan_customer_card_qr(self):
        with tenant_context("completa"):
            prog = self._stamps_program(0)
            card = loyalty_service.create_card({"program_id": prog["id"], "customer_name": "Mia"})
        link = f"https://panel.ejemplo.com/?tarjeta={card['public_token']}&empresa=completa"
        found = self.anon.get("/api/loyalty/cards/lookup", headers=self.h, params={"q": link}).json()
        self.assertEqual(found["id"], card["id"])

    def test_points_program_has_no_printed_qr(self):
        with tenant_context("completa"):
            pts = loyalty_service.create_program({"name": "Pts sin QR", "kind": "points"})
        self.assertEqual(self.anon.get(f"/api/loyalty/programs/{pts['id']}/qr", headers=self.h).status_code, 400)
        self.assertEqual(self.anon.get("/api/public/loyalty/solo-arm/stamp/x").status_code, 404)
        self.assertIn(self.anon.get("/api/loyalty/requests").status_code, (401, 403))

    def test_receipt_text(self):
        from modules.loyalty.notify import receipt_lines
        title, lines = receipt_lines({"code": "ABC"}, {"kind": "stamps", "stamps_goal": 8, "name": "Café",
                                                       "reward_description": "café gratis"}, {"balance": 3}, "earn")
        self.assertEqual(title, "¡Sumaste un sello!")
        self.assertIn("Te faltan 5 para tu café gratis.", lines)

if __name__ == "__main__":
    unittest.main()
