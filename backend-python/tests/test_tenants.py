"""Multi-empresa: cada empresa tiene datos, ajustes y credenciales aislados."""
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from config import settings
from main import app
from services.auth_service import auth_service
from services.customer_service import customer_service
from services.db_service import db_service
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services.tenant_service import DEFAULT_TENANT, tenant_context, tenant_registry, validate_slug
from services.user_service import user_service


def _reset_platform_tables():
    """Las tablas de recuperación y suscripciones viven en la base temporal de cada clase: recrearlas."""
    from services.billing_service import billing_service
    from services.password_reset_service import password_reset_service
    billing_service._ready = False
    password_reset_service._ready = False


class TenantTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Base de datos real (db_service) pero en una carpeta temporal, para no tocar la del proyecto
        cls.tmp = tempfile.mkdtemp(prefix="zenith_tenants_")
        cls._saved = (db_service.sqlite_path, set(db_service._provisioned), db_service.is_postgres,
                      customer_service._db, set(getattr(customer_service, "_ready_tenants", set())))
        db_service.sqlite_path = os.path.join(cls.tmp, "knowledge.sqlite")
        db_service.is_postgres = False
        db_service._provisioned = set()
        tenant_registry._ready = False
        tenant_registry._cache.clear()
        tenant_registry._pv_cache.clear()
        # Las tablas de usuarios viven en la misma BD: hay que recrearlas en la temporal
        user_service._ready = False
        _reset_platform_tables()
        user_service._ver_cache.clear()
        customer_service._db = db_service
        customer_service._ready_tenants = set()
        settings.invalidate(DEFAULT_TENANT)
        settings.for_tenant(DEFAULT_TENANT)

    @classmethod
    def tearDownClass(cls):
        (db_service.sqlite_path, db_service._provisioned, db_service.is_postgres,
         customer_service._db, customer_service._ready_tenants) = cls._saved
        tenant_registry._ready = False
        tenant_registry._cache.clear()
        tenant_registry._pv_cache.clear()
        user_service._ready = False
        _reset_platform_tables()
        user_service._ver_cache.clear()
        settings.invalidate(DEFAULT_TENANT)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        auth_service._failed_logins.clear()
        tenant_registry._cache.clear()
        tenant_registry._pv_cache.clear()
        self.anon = TestClient(app)
        for slug in ("acme", "globex"):
            if not tenant_registry.get(slug):
                tenant_registry.create(slug, f"Empresa {slug.title()}", f"clave-{slug}-123")
        tenant_registry.update("acme", active=True)

    def login(self, tenant, password):
        res = self.anon.post("/api/auth/login", json={"tenant": tenant, "password": password})
        self.assertEqual(res.status_code, 200, res.text)
        return {"Authorization": f"Bearer {res.json()['token']}"}

    def superadmin(self):
        return self.login("", auth_service.admin_password)


class TestTenantData(TenantTestCase):
    def test_slug_validation(self):
        for bad in ("a", "Ac me", "../etc", "default", "admin", "-x", "x_y"):
            with self.assertRaises(ValueError):
                validate_slug(bad)
        self.assertEqual(validate_slug("Mi-Empresa1"), "mi-empresa1")

    def test_duplicate_and_weak_password_rejected(self):
        with self.assertRaises(ValueError):
            tenant_registry.create("acme", "Otra", "clave-larga-123")
        with self.assertRaises(ValueError):
            tenant_registry.create("nueva", "Nueva", "corta")

    def test_knowledge_is_isolated(self):
        with tenant_context("acme"):
            db_service.add_item("Precios Acme", "Todo cuesta $5", "text")
            knowledge_service.refresh_cache()
            self.assertIn("Precios Acme", knowledge_service.get_context_text())
        with tenant_context("globex"):
            knowledge_service.refresh_cache()
            self.assertNotIn("Precios Acme", knowledge_service.get_context_text())
            self.assertEqual(db_service.count_items(), 0)
        with tenant_context(DEFAULT_TENANT):
            self.assertNotIn("Precios Acme", [i["title"] for i in db_service.get_all_items()])

    def test_customer_memory_is_isolated(self):
        with tenant_context("acme"):
            customer_service.record_message("503700011", "user", "Hola desde Acme")
            self.assertIsNotNone(customer_service.get_by_session("503700011"))
        with tenant_context("globex"):
            self.assertIsNone(customer_service.get_by_session("503700011"))
            self.assertEqual(customer_service.list()["total"], 0)

    def test_in_memory_sessions_are_isolated(self):
        with tenant_context("acme"):
            lead_service.add_message("sesion-x", "user", "hola")
            self.assertIn("sesion-x", lead_service.get_all_sessions())
        with tenant_context("globex"):
            self.assertNotIn("sesion-x", lead_service.get_all_sessions())

    def test_settings_isolated_and_credentials_not_inherited(self):
        with patch.object(settings, "META_ACCESS_TOKEN", "token-de-la-principal"):
            with tenant_context("acme"):
                self.assertEqual(settings.META_ACCESS_TOKEN, "")
                self.assertEqual(settings.COMPANY_NAME, "Empresa Acme")
                settings.update_settings({"BOT_NAME": "Acmebot"})
        with tenant_context("acme"):
            self.assertEqual(settings.BOT_NAME, "Acmebot")
        with tenant_context("globex"):
            self.assertNotEqual(settings.BOT_NAME, "Acmebot")
        with tenant_context(DEFAULT_TENANT):
            self.assertNotEqual(settings.BOT_NAME, "Acmebot")

    def test_platform_settings_are_shared(self):
        with tenant_context("acme"):
            self.assertEqual(settings.INTERNAL_API_KEY, settings.for_tenant(DEFAULT_TENANT).INTERNAL_API_KEY)


class TestTenantApi(TenantTestCase):
    def test_login_per_tenant(self):
        headers = self.login("acme", "clave-acme-123")
        check = self.anon.get("/api/auth/check", headers=headers).json()
        self.assertEqual(check["tenant"], "acme")
        self.assertFalse(check["superadmin"])
        # La clave de una empresa no sirve en otra ni como clave de la principal
        bad = self.anon.post("/api/auth/login", json={"tenant": "globex", "password": "clave-acme-123"})
        self.assertEqual(bad.status_code, 401)
        bad = self.anon.post("/api/auth/login", json={"tenant": "", "password": "clave-acme-123"})
        self.assertEqual(bad.status_code, 401)

    def test_password_change_revokes_open_sessions(self):
        tenant_registry.update("globex", password="clave-globex-123")
        headers = self.login("globex", "clave-globex-123")
        self.assertEqual(self.anon.get("/api/auth/check", headers=headers).status_code, 200)
        tenant_registry.update("globex", password="clave-globex-nueva")
        self.assertEqual(self.anon.get("/api/auth/check", headers=headers).status_code, 401)
        fresh = self.login("globex", "clave-globex-nueva")
        self.assertEqual(self.anon.get("/api/auth/check", headers=fresh).status_code, 200)
        tenant_registry.update("globex", password="clave-globex-123")

    def test_whatsapp_overview_for_superadmin_only(self):
        from services.whatsapp_service import whatsapp_service
        calls = []

        def fake_status(peek=False):
            from services.tenant_service import current_tenant
            calls.append((current_tenant(), peek))
            if current_tenant() == "acme":
                return {"status": "CONNECTED", "connected": True, "phone_number": "+50370000000"}
            return {"status": "UNREACHABLE", "connected": False}

        tenant_registry.update("globex", active=False)
        try:
            with patch.object(whatsapp_service, "get_baileys_status", side_effect=fake_status):
                res = self.anon.get("/api/tenants/whatsapp", headers=self.superadmin())
                self.assertEqual(res.status_code, 200, res.text)
                data = res.json()
                by_slug = {t["slug"]: t for t in data["tenants"]}
                self.assertEqual(by_slug["acme"]["status"], "CONNECTED")
                self.assertEqual(by_slug["acme"]["phone_number"], "+50370000000")
                self.assertEqual(by_slug["globex"]["status"], "INACTIVE")
                self.assertEqual(by_slug["default"]["status"], "UNREACHABLE")
                self.assertTrue(all(peek for _, peek in calls))  # nunca abre sesiones nuevas
                self.assertNotIn("globex", [slug for slug, _ in calls])
                self.assertGreaterEqual(data["summary"]["connected"], 1)
                # El administrador de una empresa no ve las demás
                tenant_admin = self.login("acme", "clave-acme-123")
                self.assertEqual(self.anon.get("/api/tenants/whatsapp", headers=tenant_admin).status_code, 403)
        finally:
            tenant_registry.update("globex", active=True)

    def test_superadmin_login_is_default_tenant(self):
        check = self.anon.get("/api/auth/check", headers=self.superadmin()).json()
        self.assertEqual(check["tenant"], DEFAULT_TENANT)
        self.assertTrue(check["superadmin"])

    def test_tenant_admin_cannot_manage_tenants_or_switch(self):
        headers = self.login("acme", "clave-acme-123")
        self.assertEqual(self.anon.get("/api/tenants", headers=headers).status_code, 403)
        # X-Tenant-Id es ignorado para un admin de empresa: sigue viendo SOLO su empresa
        res = self.anon.get("/api/auth/check", headers={**headers, "X-Tenant-Id": "globex"})
        self.assertEqual(res.json()["tenant"], "acme")

    def test_superadmin_can_create_list_and_operate_other_tenant(self):
        sa = self.superadmin()
        created = self.anon.post("/api/tenants", headers=sa,
                                 json={"slug": "inicial", "name": "Inicial SA", "password": "clave-inicial-1",
                                       "admin_email": "admin@inicial.test", "admin_channel": "link"})
        if created.status_code != 400:  # 400 = ya existía de una corrida previa
            self.assertEqual(created.status_code, 201, created.text)
            inv = created.json()["admin_invitation"]
            self.assertEqual(inv["invitation"]["role"], "admin")
            self.assertIn("invitacion=", inv["link"])
        slugs = [t["slug"] for t in self.anon.get("/api/tenants", headers=sa).json()["tenants"]]
        self.assertIn("acme", slugs)
        self.assertIn(DEFAULT_TENANT, slugs)
        res = self.anon.get("/api/auth/check", headers={**sa, "X-Tenant-Id": "acme"})
        self.assertEqual(res.json()["tenant"], "acme")

    def test_create_tenant_requires_admin_invite(self):
        sa = self.superadmin()
        res = self.anon.post("/api/tenants", headers=sa,
                             json={"slug": "sin-admin", "name": "Sin Admin", "password": "clave-sinadmin-1"})
        self.assertEqual(res.status_code, 400, res.text)
        slugs = [t["slug"] for t in self.anon.get("/api/tenants", headers=sa).json()["tenants"]]
        self.assertNotIn("sin-admin", slugs)

    def test_only_superadmin_installs_modules(self):
        owner = self.login("acme", "clave-acme-123")
        for action in ("install", "uninstall"):
            res = self.anon.post(f"/api/modules/restaurant/{action}", headers=owner)
            self.assertEqual(res.status_code, 403, res.text)
        # Listar sigue permitido (el panel lo usa para mostrar los módulos instalados)
        self.assertEqual(self.anon.get("/api/modules", headers=owner).status_code, 200)
        sa = self.superadmin()
        res = self.anon.post("/api/modules/no-existe/install", headers={**sa, "X-Tenant-Id": "acme"})
        self.assertNotIn(res.status_code, (401, 403), res.text)

    def test_delete_tenant_requires_superadmin_password(self):
        tenant_registry.create("borrable", "Empresa Borrable", "clave-borrable-1")
        with tenant_context("borrable"):
            db_service.set_setting("COMPANY_NAME", "Empresa Borrable")
        url = "/api/tenants/borrable/delete"
        body = {"password": auth_service.admin_password, "confirm_slug": "borrable"}
        # El propietario de una empresa no puede eliminar empresas (ni la suya)
        owner = self.login("borrable", "clave-borrable-1")
        self.assertEqual(self.anon.post(url, headers=owner, json=body).status_code, 403)
        sa = self.superadmin()
        wrong_pw = self.anon.post(url, headers=sa, json={**body, "password": "incorrecta"})
        self.assertEqual(wrong_pw.status_code, 403)
        wrong_slug = self.anon.post(url, headers=sa, json={**body, "confirm_slug": "otra"})
        self.assertEqual(wrong_slug.status_code, 400)
        self.assertIsNotNone(tenant_registry.get("borrable"))
        principal = self.anon.post(f"/api/tenants/{DEFAULT_TENANT}/delete", headers=sa,
                                   json={**body, "confirm_slug": DEFAULT_TENANT})
        self.assertEqual(principal.status_code, 400)
        with patch("main.whatsapp_service.logout", return_value=True) as logout:
            ok = self.anon.post(url, headers=sa, json=body)
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertTrue(ok.json()["archived"])
        logout.assert_called_once()
        self.assertIsNone(tenant_registry.get("borrable"))
        self.assertNotIn("borrable", [t["slug"] for t in self.anon.get("/api/tenants", headers=sa).json()["tenants"]])
        # La sesión del propietario de la empresa eliminada deja de valer y no puede volver a entrar
        self.assertEqual(self.anon.get("/api/auth/check", headers=owner).status_code, 401)
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "borrable", "password": "clave-borrable-1"}).status_code, 401)
        # Los datos se archivan, no se destruyen
        archived = os.listdir(os.path.join(self.tmp, "data", "tenants", "_deleted"))
        self.assertTrue(any(name.startswith("borrable__") for name in archived))
        self.assertEqual(self.anon.post(url, headers=sa, json=body).status_code, 404)

    def test_internal_key_requires_existing_active_tenant(self):
        key = {"X-Internal-Key": settings.INTERNAL_API_KEY}
        ok = self.anon.get("/api/auth/check", headers={**key, "X-Tenant-Id": "acme"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["tenant"], "acme")
        missing = self.anon.get("/api/auth/check", headers={**key, "X-Tenant-Id": "no-existe"})
        self.assertEqual(missing.status_code, 403)
        weird = self.anon.get("/api/auth/check", headers={**key, "X-Tenant-Id": "../x"})
        self.assertIn(weird.status_code, (403, 500))
        tenant_registry.update("acme", active=False)
        off = self.anon.get("/api/auth/check", headers={**key, "X-Tenant-Id": "acme"})
        self.assertEqual(off.status_code, 403)
        denied = self.anon.post("/api/auth/login", json={"tenant": "acme", "password": "clave-acme-123"})
        self.assertEqual(denied.status_code, 401)

    def test_api_data_isolated_between_tenants(self):
        acme = self.login("acme", "clave-acme-123")
        globex = self.login("globex", "clave-globex-123")
        res = self.anon.post("/api/knowledge/text", headers=acme,
                             json={"title": "Solo Acme", "content": "Dato privado de Acme", "category": "general"})
        self.assertEqual(res.status_code, 200, res.text)
        mine = self.anon.get("/api/knowledge", headers=acme).json()
        theirs = self.anon.get("/api/knowledge", headers=globex).json()
        self.assertIn("Solo Acme", str(mine))
        self.assertNotIn("Solo Acme", str(theirs))

    def test_branding_per_tenant(self):
        res = self.anon.get("/api/public/branding", params={"tenant": "acme"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["company_name"], "Empresa Acme")
        self.assertEqual(self.anon.get("/api/public/branding", params={"tenant": "nope"}).status_code, 404)

    def test_module_routes_require_install_in_tenant(self):
        headers = self.login("globex", "clave-globex-123")
        res = self.anon.get("/api/restaurant/config", headers=headers)
        self.assertIn(res.status_code, (403, 404))  # 404 si el router aún no se montó en este proceso

    def test_meta_number_cannot_belong_to_two_tenants(self):
        tenant_registry.set_meta_phone("acme", "111222333")
        self.assertEqual(tenant_registry.find_by_meta_phone("111222333"), "acme")
        with self.assertRaises(ValueError):
            tenant_registry.set_meta_phone("globex", "111222333")
        tenant_registry.set_meta_phone("acme", "")

    def test_meta_verify_uses_tenant_url(self):
        with tenant_context("acme"):
            settings.update_settings({"META_VERIFY_TOKEN": "verifica-acme"})
        ok = self.anon.get("/webhook/meta/acme", params={
            "hub.mode": "subscribe", "hub.verify_token": "verifica-acme", "hub.challenge": "42"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.text, "42")
        wrong = self.anon.get("/webhook/meta/globex", params={
            "hub.mode": "subscribe", "hub.verify_token": "verifica-acme", "hub.challenge": "42"})
        self.assertEqual(wrong.status_code, 403)


if __name__ == "__main__":
    unittest.main()


class TestOwnerEmailAccess(TenantTestCase):
    def tearDown(self):
        tenant_registry._run("UPDATE zenith_tenants SET owner_email = '' WHERE slug = 'globex'")
        tenant_registry._cache.clear()

    def test_owner_sets_email_and_admin_stops_working(self):
        headers = self.login("globex", "clave-globex-123")
        self.assertEqual(self.anon.get("/api/auth/owner", headers=headers).json()["email"], "")
        bad = self.anon.post("/api/auth/owner", headers=headers,
                             json={"email": "dueno@globex.dev", "current_password": "mala"})
        self.assertEqual(bad.status_code, 403)
        ok = self.anon.post("/api/auth/owner", headers=headers,
                            json={"email": "Dueno@Globex.dev", "current_password": "clave-globex-123"})
        self.assertEqual(ok.status_code, 200, ok.text)
        # Con correo: entra (con o sin la empresa en la URL) y sigue siendo propietario
        res = self.anon.post("/api/auth/login", json={"username": "dueno@globex.dev", "password": "clave-globex-123"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["tenant"], "globex")
        res = self.anon.post("/api/auth/login", json={"tenant": "globex", "username": "dueno@globex.dev",
                                                         "password": "clave-globex-123"})
        self.assertEqual(res.status_code, 200)
        # «admin» y la contraseña sola ya no sirven para esa empresa
        for username in ("admin", ""):
            auth_service._failed_logins.clear()
            res = self.anon.post("/api/auth/login", json={"tenant": "globex", "username": username,
                                                             "password": "clave-globex-123"})
            self.assertEqual(res.status_code, 401)
        # El correo no abre otra empresa
        res = self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "dueno@globex.dev",
                                                         "password": "clave-globex-123"})
        self.assertEqual(res.status_code, 401)

    def test_invited_user_cannot_change_owner_access(self):
        res = self.anon.get("/api/auth/owner")
        self.assertIn(res.status_code, (401, 403))


class TestPasswordReset(TenantTestCase):
    def setUp(self):
        super().setUp()
        from services.security_middleware import rate_limiter
        rate_limiter.reset()
        tenant_registry.set_owner_credentials("globex", "jefe@globex.dev")

    def tearDown(self):
        tenant_registry._run("UPDATE zenith_tenants SET owner_email = '' WHERE slug = 'globex'")
        tenant_registry.update("globex", password="clave-globex-123")

    def test_reset_owner_password_by_email(self):
        from unittest.mock import patch
        import services.password_reset_service as prs
        sent = []
        with patch.object(prs, "send_in_background", lambda to, subject, text: sent.append((to, text))):
            res = self.anon.post("/api/public/password-reset/request", json={"email": "jefe@globex.dev"})
            self.assertEqual(res.status_code, 200)
            # Mismo mensaje para un correo que no existe (no revela cuentas)
            other = self.anon.post("/api/public/password-reset/request", json={"email": "nadie@x.dev"})
            self.assertEqual(other.json()["message"], res.json()["message"])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "jefe@globex.dev")
        token = sent[0][1].split("restablecer=")[1].split()[0]
        self.assertEqual(self.anon.get(f"/api/public/password-reset/{token}").status_code, 200)

        login = self.anon.post("/api/auth/login", json={"username": "jefe@globex.dev", "password": "clave-globex-123"})
        old = {"Authorization": f"Bearer {login.json()['token']}"}
        ok = self.anon.post("/api/public/password-reset/confirm", json={"token": token, "password": "nueva-clave-99"})
        self.assertEqual(ok.status_code, 200, ok.text)
        # El enlace es de un solo uso y las sesiones anteriores se cierran
        again = self.anon.post("/api/public/password-reset/confirm", json={"token": token, "password": "otra-clave-99"})
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.anon.get("/api/auth/owner", headers=old).status_code, 401)
        res = self.anon.post("/api/auth/login", json={"username": "jefe@globex.dev", "password": "nueva-clave-99"})
        self.assertEqual(res.status_code, 200)

    def test_bad_token_rejected(self):
        self.assertEqual(self.anon.get("/api/public/password-reset/token-falso-123").status_code, 404)
