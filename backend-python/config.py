import os
import re
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno desde .env (local o central de la raíz)
local_env = Path(__file__).resolve().parent / ".env"
root_env = Path(__file__).resolve().parent.parent / ".env"

if local_env.exists():
    load_dotenv(dotenv_path=local_env)
elif root_env.exists():
    load_dotenv(dotenv_path=root_env)
else:
    load_dotenv()

class Settings:
    def __init__(self):
        self.COMPANY_NAME: str = os.getenv("COMPANY_NAME", "Fantasma Digital").strip()
        self.BOT_NAME: str = os.getenv("BOT_NAME", "Asistente Operativo").strip()
        self.BOT_TONE: str = os.getenv(
            "BOT_TONE",
            "Profesional, directo, resolutivo y empático. Adaptado al español de El Salvador."
        ).strip()
        self.BRAND_INSTRUCTIONS: str = os.getenv(
            "BRAND_INSTRUCTIONS",
            "Representar con excelencia a la marca, responder con total certeza y sin alucinaciones."
        ).strip()
        
        # Proveedor de IA activo: 'gemini' u 'openai'
        self.AI_PROVIDER: str = os.getenv("AI_PROVIDER", "gemini").lower().strip()
        
        # Google Gemini
        self.GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", "")).strip()
        self.GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()

        # OpenAI
        self.OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "").strip()
        self.OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
        
        # Microservicio In-House WhatsApp Gateway (Baileys)
        self.WHATSAPP_GATEWAY_URL: str = os.getenv("WHATSAPP_GATEWAY_URL", "http://localhost:3000").rstrip("/")
        
        # Personalización Visual y Multimedia
        self.COMPANY_LOGO: str = os.getenv("COMPANY_LOGO", "").strip()
        self.BOT_AVATAR: str = os.getenv("BOT_AVATAR", "").strip()
        self.PRIMARY_COLOR: str = os.getenv("PRIMARY_COLOR", "#3ecf8e").strip()
        self.WELCOME_MESSAGE: str = os.getenv(
            "WELCOME_MESSAGE",
            "¡Hola! Soy tu Asistente Operativo. Pregúntame sobre los servicios, garantías, precios o cualquier dato indexado en la base de datos."
        ).strip()
        self.TRANSFER_MESSAGE: str = os.getenv(
            "TRANSFER_MESSAGE",
            "He tomado nota de tu solicitud. En un momento, un asesor humano revisará nuestra conversación y te contactará por este mismo medio."
        ).strip()
        self.SUPPORT_PHONE: str = os.getenv("SUPPORT_PHONE", "").strip()
        self.WEBSITE_URL: str = os.getenv("WEBSITE_URL", "").strip()
        self.HANDOFF_INACTIVITY_HOURS: float = float(os.getenv("HANDOFF_INACTIVITY_HOURS", "6.0"))

        # Servidor
        self.HOST: str = os.getenv("HOST", "0.0.0.0")
        self.PORT: int = int(os.getenv("PORT", "8000"))
        self.DEBUG: bool = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")

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
            ]

            for key in tracked_keys:
                if key in db_settings and db_settings[key] is not None:
                    val = str(db_settings[key]).strip()
                    if key == "AI_PROVIDER":
                        val = val.lower()
                    if key == "HANDOFF_INACTIVITY_HOURS":
                        try:
                            self.HANDOFF_INACTIVITY_HOURS = float(val)
                        except ValueError:
                            self.HANDOFF_INACTIVITY_HOURS = 6.0
                    else:
                        setattr(self, key, val)
                    os.environ[key] = val
                else:
                    # Persistir en la BD si no existe aún físicamente
                    current_val = getattr(self, key, "")
                    db_service.set_setting(key, current_val)
        except Exception:
            pass

    def update_settings(self, new_values: dict):
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
        ]

        updates = {}
        env_updates = {}
        for k, v in new_values.items():
            if k in allowed_keys and v is not None:
                val_str = str(v).strip()
                updates[k] = val_str
                if k == "AI_PROVIDER":
                    setattr(self, k, val_str.lower())
                elif k == "HANDOFF_INACTIVITY_HOURS":
                    try:
                        self.HANDOFF_INACTIVITY_HOURS = float(val_str)
                    except ValueError:
                        self.HANDOFF_INACTIVITY_HOURS = 6.0
                else:
                    setattr(self, k, val_str)
                os.environ[k] = val_str
                db_service.set_setting(k, val_str)
                # En archivos .env solo persistir valores que no sean imágenes base64 gigantes
                if len(val_str) < 500:
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

settings = Settings()
# Cargar cualquier sobreescritura previa guardada en BD
settings.load_db_overrides()
