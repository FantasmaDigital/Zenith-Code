"""Usuarios por empresa: invitaciones (WhatsApp / correo / enlace), roles y sesiones."""
import unittest
from unittest.mock import patch

from services.user_service import role_allows, user_service
from tests.test_tenants import TenantTestCase


def _token_from(link: str) -> str:
    return link.split("invitacion=", 1)[1]


class TestRolePermissions(unittest.TestCase):
    def test_matrix(self):
        self.assertTrue(role_allows("owner", "POST", "/api/users/invitations"))
        self.assertTrue(role_allows("admin", "PUT", "/api/agent/guardrails"))
        for role in ("supervisor", "agent", "viewer"):
            self.assertFalse(role_allows(role, "GET", "/api/users"))
            self.assertFalse(role_allows(role, "POST", "/api/settings"))
            self.assertTrue(role_allows(role, "GET", "/api/customers"))
            self.assertTrue(role_allows(role, "POST", "/api/auth/password"))
        self.assertTrue(role_allows("supervisor", "POST", "/api/agent/tasks/3/approve"))
        self.assertFalse(role_allows("agent", "POST", "/api/agent/tasks/3/approve"))
        self.assertFalse(role_allows("agent", "POST", "/api/knowledge/text"))
        self.assertTrue(role_allows("agent", "POST", "/api/customers/1/reply"))
        self.assertTrue(role_allows("agent", "POST", "/api/restaurant/orders"))
        self.assertFalse(role_allows("agent", "PUT", "/api/restaurant/config"))
        self.assertFalse(role_allows("viewer", "POST", "/api/customers/1/reply"))
        self.assertFalse(role_allows("hacker", "GET", "/api/customers"))


class TestInvitations(TenantTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user_service._ready = False  # crear las tablas en la base temporal

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        user_service._ready = False
        user_service._ver_cache.clear()

    def owner(self, tenant="acme"):
        return self.login(tenant, f"clave-{tenant}-123")

    def invite(self, headers, **body):
        body.setdefault("role", "agent")
        res = self.anon.post("/api/users/invitations", json=body, headers=headers)
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def accept(self, link, name="Ana", password="clave-ana-123", **extra):
        res = self.anon.post(f"/api/public/invitations/{_token_from(link)}/accept",
                             json={"name": name, "password": password, **extra})
        return res

    def test_link_invite_accept_and_login(self):
        h = self.owner()
        out = self.invite(h, email="ana@acme.test", role="supervisor", channel="link")
        self.assertEqual(out["sent_via"], "link")
        info = self.anon.get(f"/api/public/invitations/{_token_from(out['link'])}").json()
        self.assertEqual((info["tenant"], info["role"], info["email"]), ("acme", "supervisor", "ana@acme.test"))

        res = self.accept(out["link"])
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["role"], "supervisor")
        # El enlace es de un solo uso
        self.assertEqual(self.accept(out["link"]).status_code, 404)

        login = self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "ANA@acme.test",
                                                        "password": "clave-ana-123"})
        self.assertEqual(login.status_code, 200, login.text)
        uh = {"Authorization": f"Bearer {login.json()['token']}"}
        check = self.anon.get("/api/auth/check", headers=uh).json()
        self.assertEqual((check["role"], check["superadmin"], check["can_manage_users"]), ("supervisor", False, False))
        self.assertEqual(check["user"]["name"], "Ana")
        # Contraseña equivocada o empresa equivocada
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "ana@acme.test",
                                                                 "password": "otra-clave"}).status_code, 401)
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "globex", "username": "ana@acme.test",
                                                                 "password": "clave-ana-123"}).status_code, 401)
        # El dueño ve al usuario y nada de otra empresa
        listing = self.anon.get("/api/users", headers=h).json()
        self.assertIn("ana@acme.test", [u["email"] for u in listing["users"]])
        globex = self.anon.get("/api/users", headers=self.owner("globex")).json()["users"]
        self.assertNotIn("ana@acme.test", [u["email"] for u in globex])

    def test_roles_are_enforced(self):
        h = self.owner()
        viewer = self.accept(self.invite(h, phone="+503 7000-0001", role="viewer", channel="link")["link"],
                             password="clave-viewer-1").json()
        vh = {"Authorization": f"Bearer {viewer['token']}"}
        self.assertEqual(self.anon.get("/api/customers", headers=vh).status_code, 200)
        self.assertEqual(self.anon.get("/api/users", headers=vh).status_code, 403)
        self.assertEqual(self.anon.post("/api/knowledge/text", json={"title": "x", "content": "y"},
                                        headers=vh).status_code, 403)
        # Login por teléfono (en cualquier formato)
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "50370000001",
                                                                 "password": "clave-viewer-1"}).status_code, 200)

        agent = self.accept(self.invite(h, email="asesor@acme.test", role="agent", channel="link")["link"]).json()
        ah = {"Authorization": f"Bearer {agent['token']}"}
        self.assertEqual(self.anon.post("/api/settings", json={"bot_name": "X"}, headers=ah).status_code, 403)
        self.assertEqual(self.anon.post("/api/users/invitations", json={"email": "z@z.test", "role": "admin"},
                                        headers=ah).status_code, 403)

    def test_role_change_and_deactivation_close_sessions(self):
        h = self.owner()
        u = self.accept(self.invite(h, email="beto@acme.test", role="admin", channel="link")["link"]).json()
        uh = {"Authorization": f"Bearer {u['token']}"}
        self.assertEqual(self.anon.get("/api/users", headers=uh).status_code, 200)
        uid = u["user"]["id"]
        # Un admin no puede quitarse su rol ni desactivarse
        self.assertEqual(self.anon.patch(f"/api/users/{uid}", json={"active": False}, headers=uh).status_code, 400)

        user_service._ver_cache.clear()
        self.assertEqual(self.anon.patch(f"/api/users/{uid}", json={"role": "viewer"}, headers=h).status_code, 200)
        self.assertEqual(self.anon.get("/api/customers", headers=uh).status_code, 401)  # sesión anterior caducó

        self.anon.patch(f"/api/users/{uid}", json={"active": False}, headers=h)
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "beto@acme.test",
                                                                 "password": "clave-ana-123"}).status_code, 401)
        self.assertEqual(self.anon.delete(f"/api/users/{uid}", headers=h).status_code, 200)

    def test_user_of_default_tenant_is_not_superadmin(self):
        sa = self.superadmin()
        u = self.accept(self.invite(sa, email="op@plataforma.test", role="admin", channel="link")["link"]).json()
        self.assertFalse(u["superadmin"])
        uh = {"Authorization": f"Bearer {u['token']}"}
        self.assertEqual(self.anon.get("/api/tenants", headers=uh).status_code, 403)
        # Tampoco puede operar otra empresa con X-Tenant-Id
        res = self.anon.get("/api/auth/check", headers={**uh, "X-Tenant-Id": "acme"})
        self.assertEqual(res.json()["tenant"], "default")

    def test_whatsapp_delivery_when_connected(self):
        h = self.owner()
        with patch("services.whatsapp_service.whatsapp_service.get_status", return_value={"connected": True}), \
             patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True) as send:
            out = self.invite(h, phone="50370000002", name="Carla", role="agent")
        self.assertEqual(out["sent_via"], "whatsapp")
        to, text = send.call_args[0]
        self.assertEqual(to, "50370000002")
        self.assertIn(out["link"], text)
        self.assertIn("Carla", text)
        self.assertIn("Asesor", text)

    def test_auto_falls_back_to_email_then_link(self):
        h = self.owner()
        offline = patch("services.whatsapp_service.whatsapp_service.get_status", return_value={"connected": False})
        with offline, patch("services.email_service.email_service.is_configured", return_value=True), \
             patch("services.email_service.email_service.send") as send_mail:
            out = self.invite(h, phone="50370000003", email="dan@acme.test")
        self.assertEqual(out["sent_via"], "email")
        self.assertEqual(send_mail.call_args[0][0], "dan@acme.test")

        with patch("services.whatsapp_service.whatsapp_service.get_status", return_value={"connected": False}), \
             patch("services.email_service.email_service.is_configured", return_value=False):
            out = self.invite(h, phone="50370000004", email="eva@acme.test")
        self.assertEqual(out["sent_via"], "")
        self.assertTrue(out["error"])
        self.assertTrue(out["link"])  # el admin puede compartirlo a mano
        self.assertEqual(self.accept(out["link"]).status_code, 200)

    def test_resend_rotates_link_and_revoke(self):
        h = self.owner()
        out = self.invite(h, email="fer@acme.test", channel="link")
        inv_id = out["invitation"]["id"]
        again = self.anon.post(f"/api/users/invitations/{inv_id}/resend", json={"channel": "link"}, headers=h).json()
        self.assertNotEqual(again["link"], out["link"])
        self.assertEqual(self.accept(out["link"]).status_code, 404)  # el enlace viejo ya no sirve
        self.assertEqual(self.anon.delete(f"/api/users/invitations/{inv_id}", headers=h).status_code, 200)
        self.assertEqual(self.accept(again["link"]).status_code, 404)

    def test_validation(self):
        h = self.owner()
        for body in ({"role": "agent"}, {"email": "malo", "role": "agent"}, {"email": "a@b.test", "role": "dios"},
                     {"phone": "123", "role": "agent"}):
            self.assertEqual(self.anon.post("/api/users/invitations", json=body, headers=h).status_code, 400, body)
        self.accept(self.invite(h, email="gil@acme.test", channel="link")["link"])
        # Ya existe un usuario con ese correo
        self.assertEqual(self.anon.post("/api/users/invitations", json={"email": "gil@acme.test", "role": "agent"},
                                        headers=h).status_code, 400)

    def test_login_without_company(self):
        h = self.owner()
        self.accept(self.invite(h, email="ivan@acme.test", role="agent", channel="link")["link"], password="clave-ivan-123")
        res = self.anon.post("/api/auth/login", json={"username": "ivan@acme.test", "password": "clave-ivan-123"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["tenant"], res.json()["role"], res.json()["superadmin"]), ("acme", "agent", False))
        uh = {"Authorization": f"Bearer {res.json()['token']}"}
        self.assertEqual(self.anon.get("/api/auth/check", headers=uh).json()["tenant"], "acme")
        self.assertEqual(self.anon.post("/api/auth/login", json={"username": "ivan@acme.test",
                                                                 "password": "mala-clave"}).status_code, 401)

        # La misma persona en dos empresas: hay que elegir
        self.accept(self.invite(self.owner("globex"), email="ivan@acme.test", role="admin", channel="link")["link"],
                    password="clave-ivan-123")
        res = self.anon.post("/api/auth/login", json={"username": "ivan@acme.test", "password": "clave-ivan-123"})
        self.assertEqual(res.status_code, 409, res.text)
        self.assertEqual(sorted(t["slug"] for t in res.json()["detail"]["tenants"]), ["acme", "globex"])
        res = self.anon.post("/api/auth/login", json={"username": "ivan@acme.test", "password": "clave-ivan-123",
                                                      "tenant": "globex"})
        self.assertEqual((res.status_code, res.json()["role"]), (200, "admin"))

    def test_superadmin_login_by_username(self):
        from services.auth_service import auth_service
        for username in ("", "admin", "Admin"):
            res = self.anon.post("/api/auth/login", json={"username": username, "password": auth_service.admin_password})
            self.assertEqual(res.status_code, 200, res.text)
            self.assertTrue(res.json()["superadmin"])

    def test_change_own_password(self):
        h = self.owner()
        u = self.accept(self.invite(h, email="hugo@acme.test", channel="link")["link"]).json()
        uh = {"Authorization": f"Bearer {u['token']}"}
        res = self.anon.post("/api/auth/password", json={"current_password": "clave-ana-123",
                                                         "new_password": "nueva-clave-456"}, headers=uh)
        self.assertEqual(res.status_code, 200, res.text)
        user_service._ver_cache.clear()
        self.assertEqual(self.anon.get("/api/customers", headers=uh).status_code, 401)
        self.assertEqual(self.anon.post("/api/auth/login", json={"tenant": "acme", "username": "hugo@acme.test",
                                                                 "password": "nueva-clave-456"}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
