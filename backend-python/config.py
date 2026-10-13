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
        self.COMPANY_NAME: str = os.getenv("COMPANY_NAME", "Zenith Solutions").strip()
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
        
        # Servidor
        self.HOST: str = os.getenv("HOST", "0.0.0.0")
        self.PORT: int = int(os.getenv("PORT", "8000"))
        self.DEBUG: bool = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")

    def load_db_overrides(self):
        """Carga sobreescrituras guardadas por el usuario en la BD (PostgreSQL / SQLite)."""
        try:
            from services.db_service import db_service
            db_settings = db_service.get_all_settings()
            if not db_settings:
                return

            if "COMPANY_NAME" in db_settings: self.COMPANY_NAME = db_settings["COMPANY_NAME"]
            if "BOT_NAME" in db_settings: self.BOT_NAME = db_settings["BOT_NAME"]
            if "BOT_TONE" in db_settings: self.BOT_TONE = db_settings["BOT_TONE"]
            if "BRAND_INSTRUCTIONS" in db_settings: self.BRAND_INSTRUCTIONS = db_settings["BRAND_INSTRUCTIONS"]
            if "AI_PROVIDER" in db_settings: self.AI_PROVIDER = db_settings["AI_PROVIDER"].lower()
            if "GEMINI_API_KEY" in db_settings: self.GEMINI_API_KEY = db_settings["GEMINI_API_KEY"]
            if "GEMINI_MODEL" in db_settings: self.GEMINI_MODEL = db_settings["GEMINI_MODEL"]
            if "OPENAI_API_KEY" in db_settings: self.OPENAI_API_KEY = db_settings["OPENAI_API_KEY"]
            if "OPENAI_MODEL" in db_settings: self.OPENAI_MODEL = db_settings["OPENAI_MODEL"]
        except Exception:
            pass

    def update_settings(self, new_values: dict):
        """
        Actualiza la configuración en caliente:
        1. Actualiza atributos de la instancia y os.environ
        2. Guarda en la base de datos (PostgreSQL/SQLite)
        3. Escribe en los archivos .env para persistencia total
        """
        from services.db_service import db_service

        allowed_keys = [
            "COMPANY_NAME", "BOT_NAME", "BOT_TONE", "BRAND_INSTRUCTIONS",
            "AI_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL",
            "OPENAI_API_KEY", "OPENAI_MODEL"
        ]

        updates = {}
        for k, v in new_values.items():
            if k in allowed_keys and v is not None:
                val_str = str(v).strip()
                updates[k] = val_str
                setattr(self, k, val_str.lower() if k == "AI_PROVIDER" else val_str)
                os.environ[k] = val_str
                db_service.set_setting(k, val_str)

        # Sincronizar archivo .env central de la raíz
        root_env = Path(__file__).resolve().parent.parent / ".env"
        local_env = Path(__file__).resolve().parent / ".env"
        if root_env.exists():
            self._sync_env_file(root_env, updates)
        if local_env.exists():
            self._sync_env_file(local_env, updates)

    def _sync_env_file(self, path: Path, updates: dict):
        try:
            lines = []
            existing_keys = set()
            if path.exists():
                lines = path.read_text(encoding="utf-8").splitlines()

            new_lines = []
            for line in lines:
                matched = False
                for k, v in updates.items():
                    if re.match(rf"^{k}\s*=", line):
                        new_lines.append(f"{k}={v}")
                        existing_keys.add(k)
                        matched = True
                        break
                if not matched:
                    new_lines.append(line)

            for k, v in updates.items():
                if k not in existing_keys:
                    new_lines.append(f"{k}={v}")

            path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        except Exception:
            pass

settings = Settings()
# Cargar cualquier sobreescritura previa guardada en BD
settings.load_db_overrides()
