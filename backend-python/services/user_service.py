"""
Usuarios por empresa, roles e invitaciones.

- Cada empresa puede tener varios usuarios con distinto rol. La contraseña de la empresa sigue funcionando
  como acceso del «propietario» (rol `owner`), así que las instalaciones existentes no cambian.
- Las invitaciones se envían por WhatsApp (si la empresa ya tiene su número conectado), por correo (si hay
  SMTP configurado) o se comparte el enlace a mano. El enlace lleva un token aleatorio; en la base solo se
  guarda su hash.
- Los usuarios e invitaciones viven en la base «maestra» (empresa default), igual que el registro de empresas.
"""
import hashlib
import logging
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.tenant_service import (
    DEFAULT_TENANT, check_password, hash_password, normalize_slug, tenant_context, tenant_registry,
)

logger = logging.getLogger("asistente_operativo.users")

INVITE_TTL_DAYS = 7
MIN_PASSWORD = 8
_CACHE_TTL = 30.0

# ----------------------------------------------------------------------
# Roles y permisos
# ----------------------------------------------------------------------
ROLES: Dict[str, Dict[str, str]] = {
    "admin": {"label": "Administrador", "description": "Todo en la empresa, incluidos usuarios, ajustes y módulos."},
    "supervisor": {"label": "Supervisor", "description": "Opera todo y aprueba tareas del agente; no cambia ajustes ni usuarios."},
    "agent": {"label": "Asesor", "description": "Atiende la bandeja, clientes y la operación diaria de los módulos."},
    "viewer": {"label": "Solo lectura", "description": "Puede ver todo, pero no modificar nada."},
}
OWNER_ROLE = "owner"  # acceso con la contraseña de la empresa
ROLE_LABELS = {OWNER_ROLE: "Propietario", **{k: v["label"] for k, v in ROLES.items()}}

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}
# Gestión de usuarios: solo propietario y administradores
_USERS_PREFIXES = ("/api/users",)
# Escrituras de configuración: solo propietario y administradores
_CONFIG_WRITE = (
    "/api/settings", "/api/modules", "/api/whatsapp/logout", "/api/whatsapp/meta",
    "/api/agent/specialists", "/api/agent/prices", "/api/agent/tool-policies", "/api/agent/guardrails",
    "/api/agent/playbooks", "/api/agent/weekly-report",
    "/api/restaurant/config", "/api/invoicing/config", "/api/services/config",
)
# Escrituras que un asesor no puede hacer (además de la configuración)
_AGENT_BLOCKED_WRITES = (
    "/api/knowledge", "/api/agent", "/api/handoff/release-all", "/sessions",
)


def _matches(path: str, prefixes) -> bool:
    return any(path == p or path.startswith(p + "/") for p in prefixes)


def role_allows(role: str, method: str, path: str) -> bool:
    """¿Puede este rol hacer `method path`? El propietario y el administrador pueden todo en su empresa."""
    role = role or OWNER_ROLE
    if role in (OWNER_ROLE, "admin"):
        return True
    method = (method or "GET").upper()
    path = (path or "/").rstrip("/") or "/"
    if _matches(path, ("/api/auth",)):  # cada quien gestiona su propia sesión y contraseña
        return role in ROLES
    if _matches(path, _USERS_PREFIXES):
        return False
    if method in _READ_METHODS:
        return role in ROLES
    if role == "viewer":
        return False
    if _matches(path, _CONFIG_WRITE):
        return False
    if role == "agent" and _matches(path, _AGENT_BLOCKED_WRITES):
        return False
    return role in ("supervisor", "agent")


def can_manage_users(role: str) -> bool:
    return (role or OWNER_ROLE) in (OWNER_ROLE, "admin")


# ----------------------------------------------------------------------
# Normalización
# ----------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(raw: Optional[str]) -> str:
    email = (raw or "").strip().lower()
    if email and not EMAIL_RE.match(email):
        raise ValueError("El correo electrónico no es válido.")
    return email[:160]


def normalize_phone(raw: Optional[str]) -> str:
    """Solo dígitos, con código de país (ej. 50370000000)."""
    digits = re.sub(r"\D", "", raw or "")
    if digits and not (8 <= len(digits) <= 15):
        raise ValueError("El teléfono debe incluir el código de país (8 a 15 dígitos).")
    return digits


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------
# Servicio
# ----------------------------------------------------------------------
class UserService:
    def __init__(self):
        self._lock = threading.Lock()
        self._ready = False
        self._ver_cache: Dict[tuple, tuple] = {}  # (tenant, uid) -> (versión|None, expira)

    def _run(self, sql: str, params: tuple = (), fetch: bool = False):
        return tenant_registry._run(sql, params, fetch=fetch)

    def ensure(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            tenant_registry.ensure()
            pk = "SERIAL PRIMARY KEY" if tenant_registry._db().is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
            self._run(f"""CREATE TABLE IF NOT EXISTS zenith_users (
                id {pk}, tenant VARCHAR(40) NOT NULL, email VARCHAR(160) DEFAULT '', phone VARCHAR(20) DEFAULT '',
                name VARCHAR(120) DEFAULT '', role VARCHAR(20) NOT NULL, password_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1, invited_by VARCHAR(160) DEFAULT '',
                created_at VARCHAR(40), last_login_at VARCHAR(40) DEFAULT '')""")
            self._run("CREATE INDEX IF NOT EXISTS idx_zenith_users_tenant ON zenith_users (tenant)")
            self._run(f"""CREATE TABLE IF NOT EXISTS zenith_invitations (
                id {pk}, tenant VARCHAR(40) NOT NULL, token_hash VARCHAR(64) NOT NULL UNIQUE,
                email VARCHAR(160) DEFAULT '', phone VARCHAR(20) DEFAULT '', name VARCHAR(120) DEFAULT '',
                role VARCHAR(20) NOT NULL, channel VARCHAR(20) DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'pending',
                invited_by VARCHAR(160) DEFAULT '', delivery_error TEXT DEFAULT '',
                created_at VARCHAR(40), expires_at VARCHAR(40), sent_at VARCHAR(40) DEFAULT '',
                accepted_at VARCHAR(40) DEFAULT '')""")
            self._run("CREATE INDEX IF NOT EXISTS idx_zenith_invitations_tenant ON zenith_invitations (tenant)")
            self._ready = True

    # ------------------------------------------------------------------
    # Usuarios
    # ------------------------------------------------------------------
    @staticmethod
    def _public_user(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row["id"], "email": row.get("email") or "", "phone": row.get("phone") or "",
            "name": row.get("name") or "", "role": row["role"], "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "active": bool(row["active"]), "invited_by": row.get("invited_by") or "",
            "created_at": row.get("created_at") or "", "last_login_at": row.get("last_login_at") or "",
        }

    def _user_row(self, tenant: str, user_id: int) -> Optional[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_users WHERE tenant = ? AND id = ?", (normalize_slug(tenant), int(user_id)),
                         fetch=True)
        return rows[0] if rows else None

    def get_user(self, tenant: str, user_id: int) -> Optional[Dict[str, Any]]:
        row = self._user_row(tenant, user_id)
        return self._public_user(row) if row else None

    def list_users(self, tenant: str) -> List[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_users WHERE tenant = ? ORDER BY created_at, id",
                         (normalize_slug(tenant),), fetch=True)
        return [self._public_user(r) for r in rows]

    def _find_by_identifier(self, tenant: str, identifier: str) -> Optional[Dict[str, Any]]:
        self.ensure()
        ident = (identifier or "").strip()
        if not ident:
            return None
        tenant = normalize_slug(tenant)
        if "@" in ident:
            rows = self._run("SELECT * FROM zenith_users WHERE tenant = ? AND email = ?", (tenant, ident.lower()), fetch=True)
        else:
            phone = re.sub(r"\D", "", ident)
            if not phone:
                return None
            rows = self._run("SELECT * FROM zenith_users WHERE tenant = ? AND phone = ?", (tenant, phone), fetch=True)
        return rows[0] if rows else None

    def _assert_unique(self, tenant: str, email: str, phone: str, exclude_id: Optional[int] = None) -> None:
        for field, value, label in (("email", email, "correo"), ("phone", phone, "teléfono")):
            if not value:
                continue
            rows = self._run(f"SELECT id FROM zenith_users WHERE tenant = ? AND {field} = ?", (tenant, value), fetch=True)
            if any(r["id"] != exclude_id for r in rows):
                raise ValueError(f"Ya existe un usuario con ese {label} en la empresa.")

    def authenticate(self, tenant: str, identifier: str, password: str) -> Optional[Dict[str, Any]]:
        """Usuario si las credenciales son válidas y está activo (y la empresa también)."""
        tenant = normalize_slug(tenant)
        if not tenant_registry.is_active(tenant):
            return None
        row = self._find_by_identifier(tenant, identifier)
        if not row or not row["active"] or not check_password(password or "", row["password_hash"]):
            return None
        self._run("UPDATE zenith_users SET last_login_at = ? WHERE id = ?", (_iso(_now()), row["id"]))
        return self._public_user(row)

    def authenticate_any(self, identifier: str, password: str) -> List[Dict[str, Any]]:
        """
        Login sin empresa: cuentas activas (de empresas activas) con ese correo/teléfono y esa contraseña.
        Normalmente es una; si la misma persona está en varias empresas con la misma contraseña, son varias.
        """
        self.ensure()
        ident = (identifier or "").strip()
        if "@" in ident:
            rows = self._run("SELECT * FROM zenith_users WHERE email = ? AND active = 1", (ident.lower(),), fetch=True)
        else:
            phone = re.sub(r"\D", "", ident)
            rows = self._run("SELECT * FROM zenith_users WHERE phone = ? AND active = 1", (phone,), fetch=True) if phone else []
        out = []
        for row in rows[:20]:
            if tenant_registry.is_active(row["tenant"]) and check_password(password or "", row["password_hash"]):
                out.append({**self._public_user(row), "tenant": row["tenant"]})
        return out

    def touch_login(self, user_id: int) -> None:
        self._run("UPDATE zenith_users SET last_login_at = ? WHERE id = ?", (_iso(_now()), int(user_id)))

    def user_version(self, tenant: str, user_id: int) -> Optional[str]:
        """
        Huella de credenciales + rol + estado. Va en el token: cambiar contraseña, rol o desactivar al usuario
        invalida sus sesiones abiertas. None si el usuario ya no existe o está inactivo.
        """
        key = (normalize_slug(tenant), int(user_id))
        hit = self._ver_cache.get(key)
        if hit and hit[1] > time.time():
            return hit[0]
        row = self._user_row(*key)
        version = None
        if row and row["active"]:
            version = hashlib.sha256(f"{row['password_hash']}|{row['role']}".encode("utf-8")).hexdigest()[:16]
        self._ver_cache[key] = (version, time.time() + _CACHE_TTL)
        return version

    def _forget(self, tenant: str, user_id: int) -> None:
        self._ver_cache.pop((normalize_slug(tenant), int(user_id)), None)

    def update_user(self, tenant: str, user_id: int, role: Optional[str] = None, active: Optional[bool] = None,
                    name: Optional[str] = None, acting_user_id: Optional[int] = None) -> Dict[str, Any]:
        tenant = normalize_slug(tenant)
        row = self._user_row(tenant, user_id)
        if not row:
            raise LookupError("Usuario no encontrado.")
        is_self = acting_user_id is not None and int(acting_user_id) == int(user_id)
        if role is not None:
            if role not in ROLES:
                raise ValueError("Rol inválido.")
            if is_self and role != row["role"]:
                raise ValueError("No puedes cambiar tu propio rol.")
            self._run("UPDATE zenith_users SET role = ? WHERE id = ?", (role, row["id"]))
        if active is not None:
            if is_self and not active:
                raise ValueError("No puedes desactivar tu propio usuario.")
            self._run("UPDATE zenith_users SET active = ? WHERE id = ?", (1 if active else 0, row["id"]))
        if name is not None:
            self._run("UPDATE zenith_users SET name = ? WHERE id = ?", (name.strip()[:120], row["id"]))
        self._forget(tenant, user_id)
        return self.get_user(tenant, user_id)

    def delete_user(self, tenant: str, user_id: int, acting_user_id: Optional[int] = None) -> None:
        tenant = normalize_slug(tenant)
        if acting_user_id is not None and int(acting_user_id) == int(user_id):
            raise ValueError("No puedes eliminar tu propio usuario.")
        if not self._user_row(tenant, user_id):
            raise LookupError("Usuario no encontrado.")
        self._run("DELETE FROM zenith_users WHERE tenant = ? AND id = ?", (tenant, int(user_id)))
        self._forget(tenant, user_id)

    def change_password(self, tenant: str, user_id: int, current: str, new: str) -> None:
        row = self._user_row(tenant, user_id)
        if not row or not check_password(current or "", row["password_hash"]):
            raise ValueError("La contraseña actual no es correcta.")
        if len(new or "") < MIN_PASSWORD:
            raise ValueError(f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres.")
        self._run("UPDATE zenith_users SET password_hash = ? WHERE id = ?", (hash_password(new), row["id"]))
        self._forget(tenant, user_id)

    # ------------------------------------------------------------------
    # Invitaciones
    # ------------------------------------------------------------------
    @staticmethod
    def _public_invite(row: Dict[str, Any]) -> Dict[str, Any]:
        expired = row["status"] == "pending" and (row.get("expires_at") or "") < _iso(_now())
        return {
            "id": row["id"], "email": row.get("email") or "", "phone": row.get("phone") or "",
            "name": row.get("name") or "", "role": row["role"], "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "channel": row.get("channel") or "", "status": "expired" if expired else row["status"],
            "invited_by": row.get("invited_by") or "", "delivery_error": row.get("delivery_error") or "",
            "created_at": row.get("created_at") or "", "expires_at": row.get("expires_at") or "",
            "sent_at": row.get("sent_at") or "", "accepted_at": row.get("accepted_at") or "",
        }

    def _invite_row(self, tenant: str, invite_id: int) -> Optional[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_invitations WHERE tenant = ? AND id = ?",
                         (normalize_slug(tenant), int(invite_id)), fetch=True)
        return rows[0] if rows else None

    def list_invitations(self, tenant: str, include_closed: bool = False) -> List[Dict[str, Any]]:
        self.ensure()
        sql = "SELECT * FROM zenith_invitations WHERE tenant = ?"
        if not include_closed:
            sql += " AND status = 'pending'"
        rows = self._run(sql + " ORDER BY created_at DESC, id DESC", (normalize_slug(tenant),), fetch=True)
        return [self._public_invite(r) for r in rows]

    def create_invitation(self, tenant: str, role: str, email: str = "", phone: str = "", name: str = "",
                          invited_by: str = "") -> Dict[str, Any]:
        """Crea la invitación y devuelve {'invitation': ..., 'token': ...}. El token solo se conoce aquí."""
        tenant = normalize_slug(tenant)
        self.ensure()
        if role not in ROLES:
            raise ValueError("Rol inválido.")
        email, phone = normalize_email(email), normalize_phone(phone)
        if not email and not phone:
            raise ValueError("Indica un correo o un número de WhatsApp para invitar.")
        self._assert_unique(tenant, email, phone)
        # Una nueva invitación a la misma persona reemplaza a la pendiente anterior
        for field, value in (("email", email), ("phone", phone)):
            if value:
                self._run(f"UPDATE zenith_invitations SET status = 'revoked' WHERE tenant = ? AND status = 'pending' "
                          f"AND {field} = ?", (tenant, value))
        token = secrets.token_urlsafe(32)
        now = _now()
        self._run("""INSERT INTO zenith_invitations (tenant, token_hash, email, phone, name, role, status, invited_by,
                     created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
                  (tenant, _hash_token(token), email, phone, (name or "").strip()[:120], role, (invited_by or "")[:160],
                   _iso(now), _iso(now + timedelta(days=INVITE_TTL_DAYS))))
        row = self._run("SELECT * FROM zenith_invitations WHERE token_hash = ?", (_hash_token(token),), fetch=True)[0]
        return {"invitation": self._public_invite(row), "token": token}

    def renew_token(self, tenant: str, invite_id: int) -> Dict[str, Any]:
        """Nuevo enlace (el anterior deja de valer) y nueva fecha de vencimiento, para reenviar."""
        row = self._invite_row(tenant, invite_id)
        if not row or row["status"] != "pending":
            raise LookupError("Invitación no encontrada o ya utilizada.")
        token = secrets.token_urlsafe(32)
        self._run("UPDATE zenith_invitations SET token_hash = ?, expires_at = ? WHERE id = ?",
                  (_hash_token(token), _iso(_now() + timedelta(days=INVITE_TTL_DAYS)), row["id"]))
        return {"invitation": self._public_invite(self._invite_row(tenant, invite_id)), "token": token}

    def mark_sent(self, tenant: str, invite_id: int, channel: str, error: str = "") -> Dict[str, Any]:
        self._run("UPDATE zenith_invitations SET channel = ?, delivery_error = ?, sent_at = ? WHERE tenant = ? AND id = ?",
                  (channel, (error or "")[:500], "" if error else _iso(_now()), normalize_slug(tenant), int(invite_id)))
        return self._public_invite(self._invite_row(tenant, invite_id))

    def revoke_invitation(self, tenant: str, invite_id: int) -> None:
        row = self._invite_row(tenant, invite_id)
        if not row:
            raise LookupError("Invitación no encontrada.")
        if row["status"] == "pending":
            self._run("UPDATE zenith_invitations SET status = 'revoked' WHERE id = ?", (row["id"],))

    def _invite_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        self.ensure()
        if not token or len(token) > 200:
            return None
        rows = self._run("SELECT * FROM zenith_invitations WHERE token_hash = ?", (_hash_token(token),), fetch=True)
        return rows[0] if rows else None

    def lookup_invitation(self, token: str) -> Dict[str, Any]:
        """Datos públicos de una invitación válida (para la pantalla de aceptar)."""
        row = self._invite_by_token(token)
        if not row or row["status"] != "pending":
            raise LookupError("La invitación no existe o ya fue utilizada.")
        info = self._public_invite(row)
        if info["status"] == "expired":
            raise LookupError("La invitación venció. Pide que te envíen una nueva.")
        if not tenant_registry.is_active(row["tenant"]):
            raise LookupError("La empresa de esta invitación no está activa.")
        rec = tenant_registry.get(row["tenant"]) or {}
        return {
            "tenant": row["tenant"], "tenant_name": rec.get("name", ""), "email": info["email"], "phone": info["phone"],
            "name": info["name"], "role": info["role"], "role_label": info["role_label"], "expires_at": info["expires_at"],
        }

    def accept_invitation(self, token: str, name: str, password: str, email: str = "") -> Dict[str, Any]:
        """Crea el usuario a partir de la invitación. Devuelve el usuario público (con su empresa)."""
        info = self.lookup_invitation(token)
        row = self._invite_by_token(token)
        tenant = row["tenant"]
        name = (name or "").strip()
        if not name:
            raise ValueError("Escribe tu nombre.")
        if len(password or "") < MIN_PASSWORD:
            raise ValueError(f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres.")
        # Si la invitación llegó por WhatsApp sin correo, la persona puede añadir el suyo
        final_email = info["email"] or normalize_email(email)
        phone = info["phone"]
        with self._lock:  # si dos pestañas aceptan a la vez, solo una gana
            again = self._invite_row(tenant, row["id"])
            if not again or again["status"] != "pending":
                raise LookupError("La invitación ya fue utilizada.")
            self._assert_unique(tenant, final_email, phone)
            self._run("UPDATE zenith_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
                      (_iso(_now()), row["id"]))
            now = _iso(_now())  # aceptar la invitación ya inicia sesión
            self._run("""INSERT INTO zenith_users (tenant, email, phone, name, role, password_hash, active, invited_by,
                         created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                      (tenant, final_email, phone, name[:120], row["role"], hash_password(password),
                       row.get("invited_by") or "", now, now))
        user = self._find_by_identifier(tenant, final_email or phone)
        logger.info(f"👤 [{tenant}] Invitación aceptada: usuario {user['id']} ({row['role']}).")
        return {**self._public_user(user), "tenant": tenant}


user_service = UserService()


# ----------------------------------------------------------------------
# Envío de invitaciones
# ----------------------------------------------------------------------
def invite_link(tenant: str, token: str) -> str:
    from config import settings
    base = (settings.PANEL_URL or (settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "")
            or "http://localhost:5173").rstrip("/")
    return f"{base}/?invitacion={token}"


def available_channels(tenant: str) -> Dict[str, Any]:
    """Qué canales hay para enviar invitaciones en esta empresa."""
    from services.email_service import email_service
    whatsapp_ok, whatsapp_channel, detail = False, "", ""
    with tenant_context(tenant):
        try:
            from services.whatsapp_service import whatsapp_service
            whatsapp_channel = whatsapp_service.channel
            if whatsapp_channel == "meta":
                from services.meta_service import meta_service
                whatsapp_ok = meta_service.is_configured()
                detail = "" if whatsapp_ok else "Completa la configuración de Meta Cloud API."
            else:
                status = whatsapp_service.get_status()
                whatsapp_ok = bool(status.get("connected"))
                detail = "" if whatsapp_ok else "Conecta el WhatsApp de la empresa (escanea el QR)."
        except Exception as e:
            logger.warning(f"[{tenant}] No se pudo consultar WhatsApp para invitaciones: {e}")
            detail = "No se pudo consultar el estado de WhatsApp."
    email_ok = email_service.is_configured()
    return {
        "whatsapp": whatsapp_ok, "whatsapp_channel": whatsapp_channel, "whatsapp_detail": detail,
        "email": email_ok, "email_detail": "" if email_ok else "Configura SMTP_HOST y SMTP_FROM en el servidor.",
    }


def _message_text(tenant: str, invite: Dict[str, Any], link: str, invited_by: str) -> Dict[str, str]:
    rec = tenant_registry.get(tenant) or {}
    company = rec.get("name") or tenant
    who = f"{invited_by} te invitó" if invited_by else "Te invitaron"
    greeting = f"Hola {invite['name']}," if invite.get("name") else "Hola,"
    login_hint = f"Al entrar usa la empresa «{tenant}»." if tenant != DEFAULT_TENANT else ""
    body = (f"{greeting}\n\n{who} a unirte a {company} en Zenith como {invite['role_label']}.\n\n"
            f"Crea tu acceso aquí (vence en {INVITE_TTL_DAYS} días):\n{link}\n\n{login_hint}").strip()
    return {"subject": f"Invitación a {company}", "body": body, "company": company}


def deliver_invitation(tenant: str, invite: Dict[str, Any], token: str, channel: str = "auto",
                       invited_by: str = "") -> Dict[str, Any]:
    """
    Envía la invitación. channel: auto | whatsapp | email | link.
    auto = WhatsApp si hay número y canal conectado; si no, correo; si tampoco, solo enlace.
    Devuelve {'invitation', 'link', 'sent_via', 'error'}.
    """
    link = invite_link(tenant, token)
    channel = (channel or "auto").lower()
    if channel not in ("auto", "whatsapp", "email", "link"):
        raise ValueError("Canal de envío inválido.")
    if channel == "link":
        return {"invitation": user_service.mark_sent(tenant, invite["id"], "link"), "link": link,
                "sent_via": "link", "error": ""}

    avail = available_channels(tenant)
    order: List[str] = []
    if channel in ("auto", "whatsapp") and invite.get("phone"):
        order.append("whatsapp")
    if channel in ("auto", "email") and invite.get("email"):
        order.append("email")
    if channel == "whatsapp" and not invite.get("phone"):
        raise ValueError("Para enviar por WhatsApp indica el número de la persona.")
    if channel == "email" and not invite.get("email"):
        raise ValueError("Para enviar por correo indica el correo de la persona.")

    msg = _message_text(tenant, invite, link, invited_by)
    errors: List[str] = []
    for via in order:
        if not avail[via]:
            errors.append(avail[f"{via}_detail"] or f"{via} no disponible.")
            continue
        try:
            if via == "whatsapp":
                with tenant_context(tenant):
                    from services.whatsapp_service import whatsapp_service
                    ok = whatsapp_service.send_text_message(invite["phone"], msg["body"])
                    if not ok:
                        raise RuntimeError(whatsapp_service.last_send_error or "WhatsApp no aceptó el mensaje.")
            else:
                from services.email_service import email_service
                email_service.send(invite["email"], msg["subject"], msg["body"], html=_email_html(msg, link))
            return {"invitation": user_service.mark_sent(tenant, invite["id"], via), "link": link,
                    "sent_via": via, "error": ""}
        except Exception as e:
            logger.warning(f"[{tenant}] No se pudo enviar la invitación {invite['id']} por {via}: {e}")
            errors.append(f"{'WhatsApp' if via == 'whatsapp' else 'Correo'}: {e}")

    error = "; ".join(errors) or "No hay un canal disponible: comparte el enlace manualmente."
    return {"invitation": user_service.mark_sent(tenant, invite["id"], "link", error), "link": link,
            "sent_via": "", "error": error}


def _email_html(msg: Dict[str, str], link: str) -> str:
    import html as _h
    paragraphs = "".join(f"<p>{_h.escape(p).replace(chr(10), '<br>')}</p>"
                         for p in msg["body"].split("\n\n") if link not in p)
    return (f"<div style=\"font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:520px\">{paragraphs}"
            f"<p><a href=\"{_h.escape(link)}\" style=\"display:inline-block;background:#3ecf8e;color:#000;"
            f"padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600\">Crear mi acceso</a></p>"
            f"<p style=\"font-size:12px;color:#777\">Si el botón no funciona, copia este enlace:<br>{_h.escape(link)}</p>"
            f"</div>")
