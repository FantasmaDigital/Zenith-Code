import os
import re
import threading
from pathlib import Path
from dotenv import load_dotenv
from services.tenant_service import PRIVATE_SETTING_KEYS, current_tenant, tenant_context

# Cargar variables de entorno desde .env (local o central de la raíz)
local_env = Path(__file__).resolve().parent / ".env"
root_env = Path(__file__).resolve().parent.parent / ".env"

if local_env.exists():
    load_dotenv(dotenv_path=local_env)
elif root_env.exists():
    load_dotenv(dotenv_path=root_env)
else:
    load_dotenv()

# Instantánea de las variables de entorno al arrancar: las empresas nuevas parten de ella y NO de lo que otra
# empresa haya guardado después en os.environ (cada empresa guarda sus ajustes en su propia base de datos).
_BASE_ENV = dict(os.environ)

# Ajustes del canal de WhatsApp editables desde el panel (Baileys o Meta Cloud API oficial)
WHATSAPP_CHANNEL_KEYS = [
    "WHATSAPP_CHANNEL", "META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_WABA_ID",
    "META_VERIFY_TOKEN", "META_APP_SECRET", "META_API_VERSION", "PUBLIC_BASE_URL"
]

# Ajustes de plataforma (no dependen de la empresa): siempre se leen/escriben en la empresa principal
PLATFORM_KEYS = {"ADMIN_PASSWORD", "INTERNAL_API_KEY", "AUTH_SECRET", "ALLOWED_ORIGINS", "HOST", "PORT", "DEBUG",
                 "PANEL_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_SECURITY"}


class Settings:
    def __init__(self, tenant: str = "default", company_name: str = ""):
        self.tenant = tenant
        # La empresa principal lee el entorno vivo (compatibilidad); las demás, la instantánea inicial
        env = os.environ if tenant == "default" else _BASE_ENV

        class _Os:  # misma API que os.getenv, pero sobre `env`
            @staticmethod
            def getenv(key, default=None):
                return env.get(key, default)

        os_ = _Os
        self.COMPANY_NAME: str = os_.getenv("COMPANY_NAME", "Fantasma Digital").strip()
        self.BOT_NAME: str = os_.getenv("BOT_NAME", "Asistente Operativo").strip()
        self.BOT_TONE: str = os_.getenv(
            "BOT_TONE",
            "Profesional, directo, resolutivo y empático. Adaptado al español de El Salvador."
        ).strip()
        self.BRAND_INSTRUCTIONS: str = os_.getenv(
            "BRAND_INSTRUCTIONS",
            "Representar con excelencia a la marca, responder con total certeza y sin alucinaciones."
        ).strip()
        
        # Proveedor de IA activo: 'gemini' u 'openai'
        self.AI_PROVIDER: str = os_.getenv("AI_PROVIDER", "gemini").lower().strip()
        
        # Google Gemini
        self.GEMINI_API_KEY: str = os_.getenv("GEMINI_API_KEY", os_.getenv("GOOGLE_API_KEY", "")).strip()
        self.GEMINI_MODEL: str = os_.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()

        # OpenAI
        self.OPENAI_API_KEY: str = os_.getenv("OPENAI_API_KEY", "").strip()
        self.OPENAI_MODEL: str = os_.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
        
        # Microservicio In-House WhatsApp Gateway (Baileys)
        self.WHATSAPP_GATEWAY_URL: str = os_.getenv("WHATSAPP_GATEWAY_URL", "http://localhost:3000").rstrip("/")
        
        # Canal activo: 'baileys' (WhatsApp Web, económico) o 'meta' (Cloud API oficial, sin riesgo de baneo)
        self.WHATSAPP_CHANNEL: str = os_.getenv("WHATSAPP_CHANNEL", "baileys").lower().strip()
        self.META_ACCESS_TOKEN: str = os_.getenv("META_ACCESS_TOKEN", "").strip()
        self.META_PHONE_NUMBER_ID: str = os_.getenv("META_PHONE_NUMBER_ID", "").strip()
        self.META_WABA_ID: str = os_.getenv("META_WABA_ID", "").strip()
        self.META_VERIFY_TOKEN: str = os_.getenv("META_VERIFY_TOKEN", "").strip()
        self.META_APP_SECRET: str = os_.getenv("META_APP_SECRET", "").strip()
        self.META_API_VERSION: str = os_.getenv("META_API_VERSION", "v21.0").strip()
        # URL pública HTTPS del backend (Meta debe poder llamar a /webhook/meta)
        self.PUBLIC_BASE_URL: str = os_.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")

        # Personalización Visual y Multimedia
        self.COMPANY_LOGO: str = os_.getenv("COMPANY_LOGO", "").strip()
        self.BOT_AVATAR: str = os_.getenv("BOT_AVATAR", "").strip()
        self.PRIMARY_COLOR: str = os_.getenv("PRIMARY_COLOR", "#3ecf8e").strip()
        self.WELCOME_MESSAGE: str = os_.getenv(
            "WELCOME_MESSAGE",
            "¡Hola! Soy tu Asistente Operativo. Pregúntame sobre los servicios, garantías, precios o cualquier dato indexado en la base de datos."
        ).strip()
        self.TRANSFER_MESSAGE: str = os_.getenv(
            "TRANSFER_MESSAGE",
            "He tomado nota de tu solicitud. En un momento, un asesor humano revisará nuestra conversación y te contactará por este mismo medio."
        ).strip()
        self.SUPPORT_PHONE: str = os_.getenv("SUPPORT_PHONE", "").strip()
        self.WEBSITE_URL: str = os_.getenv("WEBSITE_URL", "").strip()
        self.HANDOFF_INACTIVITY_HOURS: float = float(os_.getenv("HANDOFF_INACTIVITY_HOURS", "6.0"))

        # Servidor
        self.HOST: str = os_.getenv("HOST", "0.0.0.0")
        self.PORT: int = int(os_.getenv("PORT", "8000"))
        self.DEBUG: bool = os_.getenv("DEBUG", "True").lower() in ("true", "1", "yes")

        # Seguridad (solo desde variables de entorno, nunca editables desde el panel)
        self.ADMIN_PASSWORD: str = os_.getenv("ADMIN_PASSWORD", "").strip()
        self.INTERNAL_API_KEY: str = os_.getenv("INTERNAL_API_KEY", "").strip()
        self.AUTH_SECRET: str = os_.getenv("AUTH_SECRET", "").strip()
        self.ALLOWED_ORIGINS: list = [
            o.strip().rstrip("/")
            for o in os_.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ]

        # URL pública del panel (enlaces de invitación). Vacío = primer origen de ALLOWED_ORIGINS
        self.PANEL_URL: str = os_.getenv("PANEL_URL", "").strip().rstrip("/")
        # Correo saliente (invitaciones de usuarios). SMTP_SECURITY: starttls | ssl | none
        self.SMTP_HOST: str = os_.getenv("SMTP_HOST", "").strip()
        self.SMTP_PORT: str = os_.getenv("SMTP_PORT", "").strip()
        self.SMTP_USER: str = os_.getenv("SMTP_USER", "").strip()
        # También se aceptan los nombres habituales SMTP_PASS y SMTP_SECURE=true (como en nodemailer)
        self.SMTP_PASSWORD: str = (os_.getenv("SMTP_PASSWORD") or os_.getenv("SMTP_PASS") or "").strip()
        # Sin SMTP_FROM se envía desde la cuenta autenticada (los proveedores rechazan otro remitente)
        self.SMTP_FROM: str = (os_.getenv("SMTP_FROM") or self.SMTP_USER).strip()
        secure = os_.getenv("SMTP_SECURE", "").strip().lower()
        security = os_.getenv("SMTP_SECURITY", "").strip().lower()
        if not security:
            if secure in ("true", "1", "yes", "ssl") or self.SMTP_PORT == "465":
                security = "ssl"
            else:
                security = "starttls"
        self.SMTP_SECURITY: str = security

        if tenant != "default":
            # Una empresa nueva no hereda identidad ni credenciales de canal de otra empresa
            self.COMPANY_NAME = company_name or tenant
            for key in PRIVATE_SETTING_KEYS:
                setattr(self, key, "")
            self.WHATSAPP_CHANNEL = "baileys"
            self.WELCOME_MESSAGE = (
                f"¡Hola! Soy el asistente de {self.COMPANY_NAME}. ¿En qué puedo ayudarte?"
            )

    def get_effective_support_phone(self) -> str:
        """
        Retorna el número de soporte humano efectivo:
        - Si el usuario configuró uno en SUPPORT_PHONE, se utiliza ese.
        - Si no está configurado (vacío), se obtiene automáticamente el número vinculado en el Gateway de WhatsApp.
        """
        if self.SUPPORT_PHONE:
            return self.SUPPORT_PHONE
        try:
            from services.whatsapp_service import whatsapp_service
            gw_status = whatsapp_service.get_status()
            gw_phone = gw_status.get("phone_number")
            if gw_phone:
                return gw_phone
            user_data = gw_status.get("user") or {}
            user_id = str(user_data.get("id") or "")
            if user_id:
                raw_num = user_id.split(":")[0].split("@")[0]
                return f"+{raw_num}" if raw_num else ""
        except Exception:
            pass
        return ""

    def load_db_overrides(self):
        with tenant_context(self.tenant):  # los ajustes se leen de la base de ESTA empresa
            return self._load_db_overrides()

    def _load_db_overrides(self):
        """
        Sincroniza y carga las configuraciones desde la BD (PostgreSQL / SQLite):
        - Si una clave existe en la BD, la carga en la instancia y en os.environ.
        - Si una clave no existe aún en la BD, la persiste físicamente con el valor actual (.env / default).
        Garantiza que la Base de Datos sea la fuente fidedigna y permanente de todos los ajustes.
        """
        try:
            from services.db_service import db_service
            db_settings = db_service.get_all_settings()

            tracked_keys = [
                "COMPANY_NAME", "BOT_NAME", "BOT_TONE", "BRAND_INSTRUCTIONS",
                "AI_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL",
                "OPENAI_API_KEY", "OPENAI_MODEL", "WHATSAPP_GATEWAY_URL",
                "COMPANY_LOGO", "BOT_AVATAR", "PRIMARY_COLOR",
                "WELCOME_MESSAGE", "TRANSFER_MESSAGE", "SUPPORT_PHONE", "WEBSITE_URL",
                "HANDOFF_INACTIVITY_HOURS"
            ] + WHATSAPP_CHANNEL_KEYS

            for key in tracked_keys:
                if key in db_settings and db_settings[key] is not None:
                    val = str(db_settings[key]).strip()
                    if key in ("AI_PROVIDER", "WHATSAPP_CHANNEL"):
                        val = val.lower()
                    if key == "HANDOFF_INACTIVITY_HOURS":
                        try:
                            self.HANDOFF_INACTIVITY_HOURS = float(val)
                        except ValueError:
                            self.HANDOFF_INACTIVITY_HOURS = 6.0
                    else:
                        setattr(self, key, val)
                    if self.tenant == "default":
                        os.environ[key] = val
                else:
                    # Persistir en la BD si no existe aún físicamente
                    current_val = getattr(self, key, "")
                    db_service.set_setting(key, current_val)
        except Exception:
            pass

    def update_settings(self, new_values: dict):
        with tenant_context(self.tenant):
            return self._update_settings(new_values)

    def _update_settings(self, new_values: dict):
        """
        Actualiza la configuración en caliente:
        1. Actualiza atributos de la instancia y os.environ
        2. Guarda en la base de datos (PostgreSQL/SQLite)
        3. Escribe en los archivos .env para persistencia total (omitiendo base64 pesado)
        """
        from services.db_service import db_service

        allowed_keys = [
            "COMPANY_NAME", "BOT_NAME", "BOT_TONE", "BRAND_INSTRUCTIONS",
            "AI_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL",
            "OPENAI_API_KEY", "OPENAI_MODEL", "WHATSAPP_GATEWAY_URL",
            "COMPANY_LOGO", "BOT_AVATAR", "PRIMARY_COLOR",
            "WELCOME_MESSAGE", "TRANSFER_MESSAGE", "SUPPORT_PHONE", "WEBSITE_URL",
            "HANDOFF_INACTIVITY_HOURS"
        ] + WHATSAPP_CHANNEL_KEYS

        updates = {}
        env_updates = {}
        for k, v in new_values.items():
            if k in allowed_keys and v is not None:
                val_str = str(v).strip()
                updates[k] = val_str
                if k in ("AI_PROVIDER", "WHATSAPP_CHANNEL"):
                    setattr(self, k, val_str.lower())
                elif k == "HANDOFF_INACTIVITY_HOURS":
                    try:
                        self.HANDOFF_INACTIVITY_HOURS = float(val_str)
                    except ValueError:
                        self.HANDOFF_INACTIVITY_HOURS = 6.0
                else:
                    setattr(self, k, val_str)
                if self.tenant == "default":
                    os.environ[k] = val_str
                db_service.set_setting(k, val_str)
                # En archivos .env solo persistir valores que no sean imágenes base64 gigantes
                if len(val_str) < 500 and self.tenant == "default":
                    env_updates[k] = val_str

        # Sincronizar archivo .env local (/app/.env) y de la raíz si están disponibles
        local_env = Path(__file__).resolve().parent / ".env"
        root_env = Path(__file__).resolve().parent.parent / ".env"
        if not local_env.exists():
            try:
                local_env.touch()
            except Exception:
                pass
        for p in (local_env, root_env):
            if p.exists():
                self._sync_env_file(p, env_updates)

    def _sync_env_file(self, path: Path, updates: dict):
        try:
            lines = []
            existing_keys = set()
            if path.exists():
                lines = path.read_text(encoding="utf-8").splitlines()

            # Sanitizar valores para formato seguro .env (evitar saltos de línea crudos)
            safe_updates = {}
            for k, v in updates.items():
                val_str = str(v).replace("\r\n", "\\n").replace("\n", "\\n")
                # Si contiene espacios o caracteres especiales, envolver en comillas dobles
                if " " in val_str or "\\n" in val_str or "=" in val_str:
                    safe_updates[k] = f'"{val_str}"'
                else:
                    safe_updates[k] = val_str

            new_lines = []
            for line in lines:
                matched = False
                for k, v in safe_updates.items():
                    if re.match(rf"^{k}\s*=", line):
                        new_lines.append(f"{k}={v}")
                        existing_keys.add(k)
                        matched = True
                        break
                if not matched:
                    new_lines.append(line)

            for k, v in safe_updates.items():
                if k not in existing_keys:
                    new_lines.append(f"{k}={v}")

            path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        except Exception:
            pass

class TenantSettings:
    """
    Proxy de ajustes: cada atributo se resuelve contra la empresa activa (ContextVar), de modo que todo el
    código existente (`settings.COMPANY_NAME`, `settings.GEMINI_API_KEY`...) pasa a ser multi-empresa sin cambios.
    Los ajustes de plataforma (PLATFORM_KEYS) son únicos y viven en la empresa principal.
    """

    def __init__(self):
        object.__setattr__(self, "_instances", {})
        object.__setattr__(self, "_lock", threading.RLock())

    def for_tenant(self, slug: str) -> Settings:
        inst = self._instances.get(slug)
        if inst is None:
            with self._lock:
                inst = self._instances.get(slug)
                if inst is None:
                    name = ""
                    if slug != "default":
                        from services.tenant_service import tenant_registry
                        rec = tenant_registry.get(slug)
                        name = rec["name"] if rec else slug
                    inst = Settings(slug, name)
                    self._instances[slug] = inst  # antes de cargar: load_db_overrides puede releer ajustes
                    inst.load_db_overrides()
        return inst

    def invalidate(self, slug: str) -> None:
        """Descarta los ajustes en memoria de una empresa para recargarlos de su base de datos."""
        with self._lock:
            self._instances.pop(slug, None)

    def __getattr__(self, name):
        slug = "default" if name in PLATFORM_KEYS else current_tenant()
        return getattr(self.for_tenant(slug), name)

    def __setattr__(self, name, value):
        slug = "default" if name in PLATFORM_KEYS else current_tenant()
        setattr(self.for_tenant(slug), name, value)

    def __delattr__(self, name):  # necesario para unittest.mock.patch.object(settings, ...)
        slug = "default" if name in PLATFORM_KEYS else current_tenant()
        delattr(self.for_tenant(slug), name)


settings = TenantSettings()
# Cargar cualquier sobreescritura previa guardada en BD (empresa principal)
settings.for_tenant("default")
