import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Dict, Optional, Tuple

from fastapi import Header, HTTPException, Request, status

from config import settings
from services.tenant_service import DEFAULT_TENANT, current_tenant, normalize_slug, tenant_registry
from services.user_service import OWNER_ROLE, role_allows, user_service

logger = logging.getLogger("asistente_operativo.auth")

TOKEN_TTL_SECONDS = 12 * 3600
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 300


class AuthService:
    """
    Autenticación del panel administrativo y de las llamadas internas entre microservicios.
    - Panel: contraseña ADMIN_PASSWORD -> token firmado con HMAC (expira en 12 h).
    - Gateway <-> Backend: clave compartida INTERNAL_API_KEY en el header X-Internal-Key.
    """

    def __init__(self):
        self.admin_password = settings.ADMIN_PASSWORD
        if not self.admin_password:
            self.admin_password = secrets.token_urlsafe(12)
            logger.warning(
                "⚠️ ADMIN_PASSWORD no está configurada. Contraseña temporal para el panel "
                f"(cambia en cada reinicio): {self.admin_password}"
            )
        if not settings.INTERNAL_API_KEY:
            logger.error(
                "❌ INTERNAL_API_KEY no está configurada: el WhatsApp Gateway no podrá comunicarse con el backend."
            )
        secret_source = settings.AUTH_SECRET or f"zenith-auth::{self.admin_password}"
        self._secret = hashlib.sha256(secret_source.encode("utf-8")).digest()
        self._failed_logins: Dict[str, Tuple[int, float]] = {}

    # ---------------- Tokens del panel ----------------
    def _sign(self, payload_b64: str) -> str:
        return hmac.new(self._secret, payload_b64.encode("ascii"), hashlib.sha256).hexdigest()

    def issue_token(self, tenant: str = DEFAULT_TENANT) -> Dict[str, object]:
        """Token del panel. Lleva la empresa; el administrador de la empresa principal es superadmin de plataforma."""
        tenant = normalize_slug(tenant)
        expires_at = int(time.time()) + TOKEN_TTL_SECONDS
        claims = {"role": "admin", "urole": OWNER_ROLE, "tenant": tenant, "sa": tenant == DEFAULT_TENANT,
                  "exp": expires_at, "pv": tenant_registry.password_version(tenant)}
        return self._encode(claims)

    def issue_user_token(self, tenant: str, user: Dict[str, object]) -> Dict[str, object]:
        """Token de un usuario invitado: lleva su rol y nunca es superadmin (ni en la empresa principal)."""
        tenant = normalize_slug(tenant)
        expires_at = int(time.time()) + TOKEN_TTL_SECONDS
        claims = {"role": "admin", "urole": user["role"], "uid": int(user["id"]), "tenant": tenant, "sa": False,
                  "exp": expires_at, "pv": user_service.user_version(tenant, int(user["id"])) or ""}
        out = self._encode(claims)
        out["user"] = {"id": user["id"], "name": user.get("name") or "", "role": user["role"]}
        return out

    def _encode(self, claims: Dict[str, object]) -> Dict[str, object]:
        payload = json.dumps(claims, separators=(",", ":"))
        payload_b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
        return {"token": f"{payload_b64}.{self._sign(payload_b64)}", "expires_at": claims["exp"],
                "tenant": claims["tenant"], "superadmin": claims["sa"], "role": claims["urole"]}

    def decode_token(self, token: str) -> Optional[Dict[str, object]]:
        """Claims del token si la firma es válida y no expiró; si no, None."""
        try:
            payload_b64, signature = token.split(".", 1)
            if not hmac.compare_digest(signature, self._sign(payload_b64)):
                return None
            padded = payload_b64 + "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded))
            if payload.get("role") != "admin" or int(payload.get("exp", 0)) <= time.time():
                return None
            # Tokens emitidos antes del multi-empresa no traen empresa: eran del único administrador (principal)
            payload.setdefault("tenant", DEFAULT_TENANT)
            payload.setdefault("sa", payload["tenant"] == DEFAULT_TENANT)
            payload.setdefault("urole", OWNER_ROLE)
            if payload.get("uid") is not None:
                # Usuario invitado: si cambió su contraseña o rol, o fue desactivado/eliminado, la sesión cae
                expected = user_service.user_version(str(payload["tenant"]), int(payload["uid"]))
                if payload.get("sa") or not expected or not hmac.compare_digest(str(payload.get("pv", "")), expected):
                    return None
                return payload
            # Si la contraseña de la empresa cambió después de emitir el token, la sesión ya no es válida
            if not hmac.compare_digest(str(payload.get("pv", "")),
                                       tenant_registry.password_version(str(payload["tenant"]))):
                return None
            return payload
        except Exception:
            return None

    def verify_token(self, token: str) -> bool:
        return self.decode_token(token) is not None

    def tenant_from_headers(self, headers: Dict[str, str]) -> str:
        """
        Empresa de la petición (headers en minúsculas):
        - Token del panel: su propia empresa; un superadmin puede operar otra con X-Tenant-Id.
        - Clave interna (gateway): la empresa indicada en X-Tenant-Id (por defecto, la principal).
        Sin credenciales válidas se usa la principal (solo rutas públicas; las protegidas responden 401).
        """
        auth = headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            payload = self.decode_token(auth[7:].strip())
            if payload:
                if payload.get("sa") and headers.get("x-tenant-id"):
                    return normalize_slug(headers.get("x-tenant-id"))
                return normalize_slug(str(payload.get("tenant")))
        if self.is_valid_internal_key(headers.get("x-internal-key")):
            return normalize_slug(headers.get("x-tenant-id"))
        return DEFAULT_TENANT

    # ---------------- Login con bloqueo por intentos ----------------
    def login(self, password: str, client_ip: str, tenant: str = "", username: str = "") -> Dict[str, object]:
        """
        Inicio de sesión. La empresa NO es necesaria: se deduce de la cuenta.
        - Correo o teléfono + contraseña: usuario; su empresa y su rol salen de la cuenta. Si la misma persona
          tiene cuenta en varias empresas (con la misma contraseña), responde 409 con la lista para elegir y se
          reintenta enviando `tenant`.
        - Usuario vacío o «admin» + ADMIN_PASSWORD: administrador de la plataforma (superadmin).
        - Usuario vacío + `tenant` + contraseña de la empresa: acceso de propietario (compatibilidad).
        """
        attempts, locked_until = self._failed_logins.get(client_ip, (0, 0.0))
        if locked_until > time.time():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos fallidos. Intenta de nuevo en unos minutos."
            )
        username = (username or "").strip()
        tenant_given = bool((tenant or "").strip())
        tenant = normalize_slug(tenant)
        if username.lower() in ("admin", "superadmin"):
            username, tenant = "", DEFAULT_TENANT

        user = None
        ok = False
        if username:
            if tenant_given:
                found = user_service.authenticate(tenant, username, password)
                matches = [{**found, "tenant": tenant}] if found else []
            else:
                matches = user_service.authenticate_any(username, password)
            if len(matches) > 1:
                self._failed_logins.pop(client_ip, None)
                names = []
                for m in matches:
                    rec = tenant_registry.get(m["tenant"]) or {}
                    names.append({"slug": m["tenant"], "name": rec.get("name") or m["tenant"],
                                  "role": m["role"], "role_label": m["role_label"]})
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
                    "code": "choose_tenant", "message": "Tu cuenta pertenece a varias empresas. Elige a cuál entrar.",
                    "tenants": names})
            if matches:
                user, tenant, ok = matches[0], matches[0]["tenant"], True
        else:
            ok = tenant_registry.verify_password(tenant, password)

        if not ok:
            attempts += 1
            lock = time.time() + LOCKOUT_SECONDS if attempts >= MAX_FAILED_LOGINS else 0.0
            self._failed_logins[client_ip] = (0 if lock else attempts, lock)
            logger.warning(f"🔒 Intento de login fallido desde {client_ip} ({attempts}/{MAX_FAILED_LOGINS}).")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Usuario o contraseña incorrectos.")
        self._failed_logins.pop(client_ip, None)
        if user:
            user_service.touch_login(int(user["id"]))
            return self.issue_user_token(tenant, user)
        return self.issue_token(tenant)

    def confirm_superadmin_password(self, password: str, client_ip: str) -> None:
        """Reconfirma la contraseña del administrador de la plataforma antes de una acción destructiva.
        Comparte el bloqueo por intentos fallidos con el login."""
        attempts, locked_until = self._failed_logins.get(client_ip, (0, 0.0))
        if locked_until > time.time():
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail="Demasiados intentos fallidos. Intenta de nuevo en unos minutos.")
        if not tenant_registry.verify_password(DEFAULT_TENANT, password or ""):
            attempts += 1
            lock = time.time() + LOCKOUT_SECONDS if attempts >= MAX_FAILED_LOGINS else 0.0
            self._failed_logins[client_ip] = (0 if lock else attempts, lock)
            logger.warning(f"🔒 Contraseña de superadmin incorrecta desde {client_ip} ({attempts}/{MAX_FAILED_LOGINS}).")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Contraseña de administrador de la plataforma incorrecta.")
        self._failed_logins.pop(client_ip, None)

    # ---------------- Clave interna ----------------
    def is_valid_internal_key(self, key: Optional[str]) -> bool:
        expected = settings.INTERNAL_API_KEY
        return bool(expected and key) and hmac.compare_digest(key.encode("utf-8"), expected.encode("utf-8"))


auth_service = AuthService()


def require_auth(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_internal_key: Optional[str] = Header(default=None),
):
    """Dependencia FastAPI: exige token de administrador (Bearer) o la clave interna del gateway.
    La empresa ya fue fijada por el middleware; aquí se confirma que exista y esté activa."""
    role = None
    is_sa = False
    user_role = OWNER_ROLE
    if auth_service.is_valid_internal_key(x_internal_key):
        role = "internal"
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        payload = auth_service.decode_token(token)
        if payload:
            role = "admin"
            is_sa = bool(payload.get("sa"))
            user_role = str(payload.get("urole") or OWNER_ROLE)
    if role:
        # El superadmin de la plataforma puede inspeccionar y configurar empresas desactivadas.
        # Los usuarios normales y el gateway de WhatsApp son bloqueados si la empresa está inactiva.
        if not is_sa and not tenant_registry.is_active(current_tenant()):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Empresa inexistente o desactivada.")
        # Permisos por rol del usuario (el gateway y el propietario no tienen restricciones)
        if role == "admin" and not role_allows(user_role, request.method, request.url.path):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Tu rol no tiene permiso para esta acción.")
        return role
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autorizado. Inicia sesión en el panel.",
        headers={"WWW-Authenticate": "Bearer"},
    )


SECRET_MASK_PREFIX = "••••"


def require_superadmin(authorization: Optional[str] = Header(default=None)):
    """Solo el administrador de la plataforma (empresa principal) gestiona empresas."""
    payload = auth_service.decode_token(authorization[7:].strip()) if (
        authorization and authorization.lower().startswith("bearer ")) else None
    if not payload or not payload.get("sa"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo el administrador de la plataforma.")
    return "superadmin"


def mask_secret(value: str) -> str:
    """Oculta una clave dejando visibles solo los últimos 4 caracteres."""
    if not value:
        return ""
    return f"{SECRET_MASK_PREFIX}{value[-4:]}" if len(value) > 8 else SECRET_MASK_PREFIX


def is_masked(value: Optional[str]) -> bool:
    return bool(value) and value.startswith(SECRET_MASK_PREFIX)


def current_claims(authorization: Optional[str]) -> Optional[Dict[str, object]]:
    """Claims del token Bearer (o None)."""
    if authorization and authorization.lower().startswith("bearer "):
        return auth_service.decode_token(authorization[7:].strip())
    return None
