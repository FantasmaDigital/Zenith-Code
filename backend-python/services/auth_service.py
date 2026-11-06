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

    def issue_token(self) -> Dict[str, object]:
        expires_at = int(time.time()) + TOKEN_TTL_SECONDS
        payload = json.dumps({"role": "admin", "exp": expires_at}, separators=(",", ":"))
        payload_b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
        return {"token": f"{payload_b64}.{self._sign(payload_b64)}", "expires_at": expires_at}

    def verify_token(self, token: str) -> bool:
        try:
            payload_b64, signature = token.split(".", 1)
            if not hmac.compare_digest(signature, self._sign(payload_b64)):
                return False
            padded = payload_b64 + "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded))
            return payload.get("role") == "admin" and int(payload.get("exp", 0)) > time.time()
        except Exception:
            return False

    # ---------------- Login con bloqueo por intentos ----------------
    def login(self, password: str, client_ip: str) -> Dict[str, object]:
        attempts, locked_until = self._failed_logins.get(client_ip, (0, 0.0))
        if locked_until > time.time():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos fallidos. Intenta de nuevo en unos minutos."
            )
        if not hmac.compare_digest((password or "").encode("utf-8"), self.admin_password.encode("utf-8")):
            attempts += 1
            lock = time.time() + LOCKOUT_SECONDS if attempts >= MAX_FAILED_LOGINS else 0.0
            self._failed_logins[client_ip] = (0 if lock else attempts, lock)
            logger.warning(f"🔒 Intento de login fallido desde {client_ip} ({attempts}/{MAX_FAILED_LOGINS}).")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Contraseña incorrecta.")
        self._failed_logins.pop(client_ip, None)
        return self.issue_token()

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
    """Dependencia FastAPI: exige token de administrador (Bearer) o la clave interna del gateway."""
    if auth_service.is_valid_internal_key(x_internal_key):
        return "internal"
    if authorization and authorization.lower().startswith("bearer "):
        if auth_service.verify_token(authorization[7:].strip()):
            return "admin"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autorizado. Inicia sesión en el panel.",
        headers={"WWW-Authenticate": "Bearer"},
    )


SECRET_MASK_PREFIX = "••••"


def mask_secret(value: str) -> str:
    """Oculta una clave dejando visibles solo los últimos 4 caracteres."""
    if not value:
        return ""
    return f"{SECRET_MASK_PREFIX}{value[-4:]}" if len(value) > 8 else SECRET_MASK_PREFIX


def is_masked(value: Optional[str]) -> bool:
    return bool(value) and value.startswith(SECRET_MASK_PREFIX)
