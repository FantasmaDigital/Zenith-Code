"""
Recuperación de contraseña por correo y avisos de seguridad.

- Se pide con el correo; la respuesta es siempre la misma (no revela si el correo existe).
- El enlace lleva un token aleatorio de un solo uso que vence en 30 minutos; en la base solo se guarda su hash.
- Sirve para usuarios invitados y para el propietario de una empresa (su «correo de propietario").
- Al cambiar la contraseña se cierran las sesiones abiertas (cambia la huella de la contraseña) y se avisa por correo.
"""
import hashlib
import logging
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.tenant_service import hash_password, normalize_slug, public_slug, tenant_registry

logger = logging.getLogger("asistente_operativo.password_reset")

RESET_TTL_MINUTES = 30
WELCOME_TTL_HOURS = 72  # enlace del correo de bienvenida tras suscribirse
MIN_PASSWORD = 8


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def panel_base_url() -> str:
    from config import settings
    return (settings.PANEL_URL or (settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "")
            or "http://localhost:5173").rstrip("/")


def send_in_background(to: str, subject: str, text: str) -> None:
    """Envía sin bloquear la respuesta (y sin que el tiempo de respuesta delate si el correo existe)."""
    def run():
        try:
            from services.email_service import email_service
            if email_service.is_configured():
                email_service.send(to, subject, text)
            else:
                logger.warning("Correo no configurado: no se pudo enviar un aviso de seguridad.")
        except Exception as e:
            logger.warning(f"No se pudo enviar el correo «{subject}»: {e}")
    threading.Thread(target=run, daemon=True).start()


def notify_password_changed(to: str, company: str) -> None:
    if not to:
        return
    send_in_background(
        to, f"Tu contraseña de {company} cambió",
        f"Hola,\n\nLa contraseña de tu acceso a {company} en Zenith acaba de cambiar y se cerraron las sesiones "
        f"abiertas.\n\nSi no fuiste tú, recupera tu acceso desde la pantalla de inicio de sesión "
        f"(«¿Olvidaste tu contraseña?») y avisa a tu administrador.\n")


class PasswordResetService:
    def __init__(self):
        self._ready = False
        self._lock = threading.Lock()

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
            # user_id NULL = propietario de la empresa (contraseña de la empresa)
            self._run(f"""CREATE TABLE IF NOT EXISTS zenith_password_resets (
                id {pk}, token_hash VARCHAR(64) NOT NULL UNIQUE, tenant VARCHAR(40) NOT NULL,
                user_id INTEGER, email VARCHAR(160) DEFAULT '', created_at VARCHAR(40),
                expires_at VARCHAR(40), used_at VARCHAR(40) DEFAULT '')""")
            self._ready = True

    def _targets(self, email: str, tenant: str = "") -> List[Dict[str, Any]]:
        from services.user_service import user_service
        user_service.ensure()
        email = (email or "").strip().lower()
        if "@" not in email:
            return []
        only = normalize_slug(tenant) if (tenant or "").strip() else None
        out = [{"tenant": t, "user_id": None} for t in tenant_registry.tenants_for_owner_email(email)
               if only is None or t == only]
        rows = self._run("SELECT id, tenant FROM zenith_users WHERE email = ? AND active = 1", (email,), fetch=True)
        for r in rows:
            if (only is None or r["tenant"] == only) and tenant_registry.is_active(r["tenant"]):
                out.append({"tenant": r["tenant"], "user_id": int(r["id"])})
        return out[:5]

    def request(self, email: str, tenant: str = "", welcome: bool = False) -> int:
        """Envía un enlace por cada cuenta con ese correo. Devuelve cuántos (no se informa al público)."""
        self.ensure()
        email = (email or "").strip().lower()
        targets = self._targets(email, tenant)
        for t in targets:
            token = secrets.token_urlsafe(32)
            now = _now()
            self._run("""INSERT INTO zenith_password_resets (token_hash, tenant, user_id, email, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?)""",
                      (_hash(token), t["tenant"], t["user_id"], email, _iso(now),
                       _iso(now + (timedelta(hours=WELCOME_TTL_HOURS) if welcome
                                   else timedelta(minutes=RESET_TTL_MINUTES)))))
            company = (tenant_registry.get(t["tenant"]) or {}).get("name") or t["tenant"]
            slug = public_slug(t["tenant"])
            link = f"{panel_base_url()}/auth/{slug}?restablecer={token}"
            if welcome:
                send_in_background(
                    email, f"Bienvenido a Zenith: activa el acceso de {company}",
                    f"Hola,\n\nTu suscripción a Zenith está activa y {company} ya tiene su panel.\n\n"
                    f"1. Crea tu contraseña aquí (el enlace vence en {WELCOME_TTL_HOURS} horas):\n{link}\n\n"
                    f"2. Después entra siempre en {panel_base_url()}/auth/{slug} con este correo.\n\n"
                    "3. Conecta tu WhatsApp desde el panel (sección WhatsApp) y carga tu información.\n\n"
                    f"Tienes {14} días de prueba gratis. Si necesitas ayuda, responde a este correo.\n")
            else:
                send_in_background(
                    email, f"Restablece tu contraseña de {company}",
                    f"Hola,\n\nPediste restablecer la contraseña de tu acceso a {company} en Zenith.\n\n"
                    f"Crea una nueva aquí (el enlace vence en {RESET_TTL_MINUTES} minutos y sirve una sola vez):\n"
                    f"{link}\n\nSi no lo pediste, ignora este correo: tu contraseña no cambia.\n")
        if targets:
            logger.info(f"🔑 Enlace de recuperación generado para {len(targets)} cuenta(s).")
        return len(targets)

    def _valid(self, token: str) -> Optional[Dict[str, Any]]:
        self.ensure()
        if not token or len(token) > 200:
            return None
        rows = self._run("SELECT * FROM zenith_password_resets WHERE token_hash = ?", (_hash(token),), fetch=True)
        if not rows:
            return None
        row = rows[0]
        if row.get("used_at") or (row.get("expires_at") or "") < _iso(_now()):
            return None
        return row

    def check(self, token: str) -> bool:
        return self._valid(token) is not None

    def confirm(self, token: str, new_password: str) -> Dict[str, Any]:
        row = self._valid(token)
        if not row:
            raise ValueError("El enlace no es válido o ya venció. Pide uno nuevo.")
        if len(new_password or "") < MIN_PASSWORD:
            raise ValueError(f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres.")
        tenant = row["tenant"]
        if row.get("user_id") is not None:
            from services.user_service import user_service
            self._run("UPDATE zenith_users SET password_hash = ? WHERE tenant = ? AND id = ?",
                      (hash_password(new_password), tenant, int(row["user_id"])))
            user_service._forget(tenant, int(row["user_id"]))
        else:
            tenant_registry.update(tenant, password=new_password)
        # Este enlace y cualquier otro pendiente de la misma cuenta dejan de servir
        uid_clause = "user_id = ?" if row.get("user_id") is not None else "user_id IS NULL"
        params = (_iso(_now()), tenant) + ((int(row["user_id"]),) if row.get("user_id") is not None else ())
        self._run(f"UPDATE zenith_password_resets SET used_at = ? WHERE tenant = ? AND {uid_clause} AND used_at = ''",
                  params)
        company = (tenant_registry.get(tenant) or {}).get("name") or tenant
        notify_password_changed(row.get("email") or "", company)
        logger.info(f"🔑 Contraseña restablecida por correo en «{tenant}».")
        return {"tenant": tenant, "tenant_slug": public_slug(tenant)}


password_reset_service = PasswordResetService()
