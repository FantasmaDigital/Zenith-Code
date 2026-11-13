"""
Respaldo protegido de la sesión de WhatsApp Web (Baileys) en la base de datos.

El gateway guarda sus credenciales en archivos (creds.json + llaves de Signal). Si el contenedor se
recrea sin volumen persistente (p. ej. un redeploy en EasyPanel), esos archivos se pierden y hay que
escanear el QR otra vez. Por eso el gateway sube aquí cada archivo y, al arrancar sin credenciales,
los restaura.

Seguridad:
- Tabla en el esquema de la plataforma (no en el de cada empresa), con la empresa como columna.
- Contenido cifrado con Fernet (AES-128-CBC + HMAC). La llave se deriva de WA_AUTH_KEY o, si no está,
  de INTERNAL_API_KEY: quien lea la base de datos sin esa clave no puede usar la sesión.
- Solo accesible con la clave interna del gateway (nunca con tokens del panel).
"""
import base64
import hashlib
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional

from cryptography.fernet import Fernet, InvalidToken

from config import settings
from services.tenant_service import DEFAULT_TENANT

logger = logging.getLogger(__name__)

FILE_RE = re.compile(r"^[A-Za-z0-9._@:+=-]{1,200}$")
MAX_FILE_BYTES = 512 * 1024


class WaAuthService:
    def __init__(self):
        self._ready = False
        self._lock = threading.Lock()

    # ---------------- Cifrado ----------------
    @staticmethod
    def _fernet() -> Fernet:
        secret = (os.getenv("WA_AUTH_KEY") or settings.INTERNAL_API_KEY or "").strip()
        if not secret:
            raise RuntimeError("Falta INTERNAL_API_KEY (o WA_AUTH_KEY) para cifrar la sesión de WhatsApp.")
        key = hashlib.sha256(("zenith-wa-auth:" + secret).encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(key))

    # ---------------- Base de datos ----------------
    @staticmethod
    def _db():
        from services.db_service import db_service
        return db_service

    def _run(self, sql: str, params: tuple = (), fetch: bool = False):
        db = self._db()
        pg = db.is_postgres
        raw = db._get_pg_connection(DEFAULT_TENANT) if pg else db._get_sqlite_connection(DEFAULT_TENANT)
        try:
            cur = raw.cursor()
            cur.execute(sql.replace("?", "%s") if pg else sql, params)
            rows = cur.fetchall() if fetch else None
            raw.commit()
            return rows
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    def _ensure(self):
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self._run("""CREATE TABLE IF NOT EXISTS whatsapp_auth_store (
                tenant VARCHAR(60) NOT NULL, file_name VARCHAR(200) NOT NULL, data TEXT NOT NULL,
                updated_at VARCHAR(40) NOT NULL, PRIMARY KEY (tenant, file_name))""")
            self._ready = True

    # ---------------- API ----------------
    @staticmethod
    def valid_file(name: str) -> bool:
        return bool(FILE_RE.match(name or "")) and ".." not in name

    def load_all(self, tenant: str) -> Dict[str, str]:
        """{archivo: contenido} de la empresa. Ignora filas que no se puedan descifrar (llave cambiada)."""
        self._ensure()
        f = self._fernet()
        out: Dict[str, str] = {}
        for name, data in self._run("SELECT file_name, data FROM whatsapp_auth_store WHERE tenant = ?",
                                    (tenant,), fetch=True) or []:
            try:
                out[name] = f.decrypt(data.encode("ascii")).decode("utf-8")
            except (InvalidToken, ValueError):
                logger.warning(f"[wa-auth:{tenant}] No se pudo descifrar {name} (¿cambió INTERNAL_API_KEY?).")
        return out

    def save_files(self, tenant: str, files: Dict[str, Optional[str]]) -> int:
        """Inserta/actualiza archivos; un valor None borra ese archivo."""
        self._ensure()
        f = self._fernet()
        now = datetime.now(timezone.utc).isoformat()
        n = 0
        for name, content in files.items():
            if not self.valid_file(name):
                continue
            if content is None:
                self._run("DELETE FROM whatsapp_auth_store WHERE tenant = ? AND file_name = ?", (tenant, name))
                continue
            if len(content.encode("utf-8")) > MAX_FILE_BYTES:
                continue
            token = f.encrypt(content.encode("utf-8")).decode("ascii")
            upsert = ("INSERT INTO whatsapp_auth_store (tenant, file_name, data, updated_at) VALUES (?, ?, ?, ?) "
                      "ON CONFLICT (tenant, file_name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
            self._run(upsert, (tenant, name, token, now))
            n += 1
        return n

    def clear(self, tenant: str) -> None:
        self._ensure()
        self._run("DELETE FROM whatsapp_auth_store WHERE tenant = ?", (tenant,))

    def list_tenants(self) -> List[str]:
        """Empresas con creds.json respaldado (para restaurar todas al arrancar el gateway)."""
        self._ensure()
        rows = self._run("SELECT tenant FROM whatsapp_auth_store WHERE file_name = 'creds.json'", fetch=True) or []
        return sorted({r[0] for r in rows})


wa_auth_service = WaAuthService()
