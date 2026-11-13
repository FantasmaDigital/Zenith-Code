"""
Multi-empresa (multi-tenant) de Zenith.

Modelo de aislamiento: **una base de datos (SQLite) o un esquema (PostgreSQL) por empresa**.
Toda la capa de datos resuelve la empresa activa desde un ContextVar, de modo que conocimiento, clientes,
conversaciones, ajustes, métricas, módulos, finanzas, restaurante, etc. quedan separados sin que cada
consulta tenga que filtrar por `tenant_id`.

- La empresa «default» conserva la base de datos original (compatibilidad con instalaciones existentes).
- El registro de empresas (`zenith_tenants`) vive siempre en la base de la empresa «default».
"""
import contextvars
import functools
import hashlib
import hmac
import logging
import re
import secrets
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.tenants")

DEFAULT_TENANT = "default"
RESERVED_SLUGS = {"default", "admin", "api", "root", "superadmin", "system", "public",
                  "auth", "privacidad", "cookies", "tenants", "empresas", "backend", "assets"}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")

_current: contextvars.ContextVar = contextvars.ContextVar("zenith_tenant", default=DEFAULT_TENANT)


def _slugify(text: str) -> str:
    import unicodedata
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:40].strip("-")


@functools.lru_cache(maxsize=1)
def default_public_slug() -> str:
    """Slug con el que la empresa principal aparece en la URL (/fantasma-digital/...).
    Se toma de DEFAULT_TENANT_SLUG o, si no está, del nombre de la empresa (COMPANY_NAME)."""
    import os
    # Mismo valor por defecto que COMPANY_NAME en config.py, para que en producción sin esa variable
    # el slug no caiga en «principal».
    company = os.getenv("COMPANY_NAME", "") or "Fantasma Digital"
    for candidate in (os.getenv("DEFAULT_TENANT_SLUG", ""), _slugify(company)):
        slug = (candidate or "").strip().lower()
        if slug and slug not in RESERVED_SLUGS and SLUG_RE.match(slug):
            return slug
    return "principal"





def public_slug(slug: Optional[str]) -> str:
    """Slug para la URL: la empresa «default» usa su alias legible."""
    slug = normalize_slug(slug)
    return default_public_slug() if slug == DEFAULT_TENANT else slug


# ----------------------------------------------------------------------
# Contexto de empresa activa
# ----------------------------------------------------------------------
def current_tenant() -> str:
    return _current.get()


def normalize_slug(raw: Optional[str]) -> str:
    """Normaliza el identificador de empresa; vacío = empresa por defecto."""
    slug = (raw or "").strip().lower()
    if not slug or slug == default_public_slug():  # el alias de la URL es la empresa principal
        return DEFAULT_TENANT
    return slug


def validate_slug(raw: str) -> str:
    slug = normalize_slug(raw)
    if slug in RESERVED_SLUGS or not SLUG_RE.match(slug):
        raise ValueError(
            "Identificador inválido: usa 2-40 caracteres en minúsculas, números o guiones "
            "(sin espacios) y que no sea una palabra reservada."
        )
    return slug


@contextmanager
def tenant_context(slug: Optional[str]):
    """Ejecuta el bloque dentro de la empresa indicada y restaura la anterior al salir."""
    token = _current.set(normalize_slug(slug))
    try:
        yield
    finally:
        _current.reset(token)


def run_in_tenant(slug: Optional[str], fn, *args, **kwargs):
    with tenant_context(slug):
        return fn(*args, **kwargs)


def thread_target(fn):
    """Envuelve `fn` para que un hilo nuevo herede la empresa activa (los hilos no copian ContextVars)."""
    ctx = contextvars.copy_context()

    def runner(*args, **kwargs):
        return ctx.run(fn, *args, **kwargs)

    return runner


def _checked(slug: str) -> str:
    if slug != DEFAULT_TENANT and not SLUG_RE.match(slug):
        raise ValueError("Identificador de empresa inválido.")
    return slug


def sqlite_path_for(slug: str, default_path: str) -> str:
    import os
    slug = _checked(slug)
    if slug == DEFAULT_TENANT:
        return default_path
    folder = os.path.join(os.path.dirname(default_path), "data", "tenants")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{slug}.sqlite")


def pg_schema_for(slug: str) -> Optional[str]:
    slug = _checked(slug)
    if slug == DEFAULT_TENANT:
        return None
    return "t_" + slug.replace("-", "_")


# ----------------------------------------------------------------------
# Utilidades para estado en memoria por empresa
# ----------------------------------------------------------------------
class TenantReadyMixin:
    """`self._ready` pasa a ser un indicador por empresa (las tablas se preparan una vez por empresa)."""

    @property
    def _ready(self) -> bool:
        return current_tenant() in self.__dict__.setdefault("_ready_tenants", set())

    @_ready.setter
    def _ready(self, value: bool) -> None:
        tenants = self.__dict__.setdefault("_ready_tenants", set())
        if value:
            tenants.add(current_tenant())
        else:
            tenants.discard(current_tenant())


class TenantDict:
    """Diccionario cuyas claves quedan separadas por empresa (misma API básica que `dict`)."""

    def __init__(self):
        self._data: Dict[str, Dict[Any, Any]] = {}

    def _d(self) -> Dict[Any, Any]:
        return self._data.setdefault(current_tenant(), {})

    def __getitem__(self, k):
        return self._d()[k]

    def __setitem__(self, k, v):
        self._d()[k] = v

    def __delitem__(self, k):
        del self._d()[k]

    def __contains__(self, k):
        return k in self._d()

    def __len__(self):
        return len(self._d())

    def __iter__(self):
        return iter(self._d())

    def get(self, k, default=None):
        return self._d().get(k, default)

    def pop(self, k, *default):
        return self._d().pop(k, *default)

    def items(self):
        return self._d().items()

    def keys(self):
        return self._d().keys()

    def values(self):
        return self._d().values()

    def clear(self):
        self._d().clear()


# ----------------------------------------------------------------------
# Contraseñas
# ----------------------------------------------------------------------
_PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, iters, salt, digest = stored.split("$")
        if scheme != "pbkdf2":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(calc.hex(), digest)
    except Exception:
        return False


# ----------------------------------------------------------------------
# Registro de empresas
# ----------------------------------------------------------------------
# Claves de ajustes que NUNCA deben heredarse de la empresa principal: identidad y canal propios.
PRIVATE_SETTING_KEYS = [
    "SUPPORT_PHONE", "WEBSITE_URL", "COMPANY_LOGO", "BOT_AVATAR",
    "META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_WABA_ID", "META_VERIFY_TOKEN", "META_APP_SECRET",
    "WHATSAPP_GATEWAY_URL",
]

_CACHE_TTL = 30.0

# Productos que se venden por separado. Cada empresa tiene contratados uno o varios.
FEATURE_ARM = "arm"          # Agente IA, WhatsApp, bandeja, clientes, conocimiento y automatizaciones
FEATURE_LOYALTY = "loyalty"  # Tarjetas de fidelidad / compra
FEATURES = (FEATURE_ARM, FEATURE_LOYALTY)
DEFAULT_FEATURES = [FEATURE_ARM]  # empresas existentes y nuevas sin plan explícito conservan el ARM


def normalize_features(raw) -> List[str]:
    """Lista ordenada y sin duplicados de productos válidos (acepta lista o texto separado por comas)."""
    items = raw.split(",") if isinstance(raw, str) else list(raw or [])
    clean = {str(f).strip().lower() for f in items if str(f).strip()}
    unknown = clean - set(FEATURES)
    if unknown:
        raise ValueError(f"Producto desconocido: {', '.join(sorted(unknown))}. Válidos: {', '.join(FEATURES)}.")
    if not clean:
        raise ValueError("La empresa debe tener al menos un producto contratado.")
    return [f for f in FEATURES if f in clean]


class TenantRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._ready = False
        self._cache: Dict[str, tuple] = {}  # slug -> (registro|None, expira)
        self._pv_cache: Dict[str, tuple] = {}  # slug -> (versión de contraseña, expira)

    # --- acceso a la base «maestra» (empresa default) ---
    @staticmethod
    def _db():
        from services.db_service import db_service
        return db_service

    def _run(self, sql: str, params: tuple = (), fetch: bool = False):
        db = self._db()
        pg = db.is_postgres
        raw = db._get_pg_connection(DEFAULT_TENANT) if pg else db._get_sqlite_connection(DEFAULT_TENANT)
        try:
            if pg:
                cur = raw.cursor()
                cur.execute(sql.replace("?", "%s"), params)
            else:
                cur = raw.execute(sql, params)
            rows = []
            if fetch and cur.description is not None:
                names = [d[0] for d in cur.description]
                rows = [dict(zip(names, tuple(r))) for r in cur.fetchall()]
            raw.commit()
            return rows
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    def ensure(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self._run("""CREATE TABLE IF NOT EXISTS zenith_tenants (
                slug VARCHAR(40) PRIMARY KEY, name VARCHAR(160) NOT NULL, password_hash TEXT DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1, meta_phone_number_id VARCHAR(60) DEFAULT '',
                created_at VARCHAR(40))""")
            try:
                self._run("ALTER TABLE zenith_tenants ADD COLUMN features VARCHAR(200) DEFAULT 'arm'")
            except Exception:
                pass  # la columna ya existe
            try:
                # Correo con el que entra el propietario (en la principal, el superadmin) en vez de «admin»
                self._run("ALTER TABLE zenith_tenants ADD COLUMN owner_email VARCHAR(160) DEFAULT ''")
            except Exception:
                pass
            if not self._run("SELECT slug FROM zenith_tenants WHERE slug = ?", (DEFAULT_TENANT,), fetch=True):
                from config import settings
                name = settings.COMPANY_NAME or "Empresa principal"
                self._run("INSERT INTO zenith_tenants (slug, name, password_hash, active, created_at) VALUES (?, ?, '', 1, ?)",
                          (DEFAULT_TENANT, name, _now_iso()))
            self._ready = True

    # --- consultas ---
    @staticmethod
    def _public(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "slug": row["slug"], "name": row["name"], "active": bool(row["active"]),
            "has_own_password": bool(row.get("password_hash")),
            "has_owner_email": bool(row.get("owner_email")),
            "meta_phone_number_id": row.get("meta_phone_number_id") or "",
            "created_at": row.get("created_at") or "",
            "features": TenantRegistry._features_of(row),
        }

    @staticmethod
    def _features_of(row: Dict[str, Any]) -> List[str]:
        # La empresa principal es la dueña de la plataforma: siempre tiene todos los productos
        if row.get("slug") == DEFAULT_TENANT:
            return list(FEATURES)
        try:
            return normalize_features(row.get("features") or "")
        except ValueError:
            return list(DEFAULT_FEATURES)

    def has_feature(self, slug: str, feature: str) -> bool:
        rec = self.get(slug)
        return bool(rec and feature in rec.get("features", []))

    def _raw(self, slug: str) -> Optional[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_tenants WHERE slug = ?", (slug,), fetch=True)
        return rows[0] if rows else None

    def get(self, slug: str) -> Optional[Dict[str, Any]]:
        """Registro público de la empresa (con caché corta para no consultar la BD en cada petición)."""
        slug = normalize_slug(slug)
        hit = self._cache.get(slug)
        if hit and hit[1] > time.time():
            return hit[0]
        raw = self._raw(slug)
        rec = self._public(raw) if raw else None
        self._cache[slug] = (rec, time.time() + _CACHE_TTL)
        return rec

    def is_active(self, slug: str) -> bool:
        rec = self.get(slug)
        return bool(rec and rec["active"])

    def list(self) -> List[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_tenants ORDER BY created_at, slug", fetch=True)
        for r in rows:
            # Autocorrección: el nombre de marca (Identidad) manda sobre el del registro
            try:
                with tenant_context(r["slug"]):
                    brand = (self._db().get_setting("COMPANY_NAME") or "").strip()
                if brand and brand != r["name"]:
                    self._run("UPDATE zenith_tenants SET name = ? WHERE slug = ?", (brand[:160], r["slug"]))
                    r["name"] = brand[:160]
                    self._cache.pop(r["slug"], None)
            except Exception as e:
                logger.debug(f"No se pudo leer COMPANY_NAME de «{r['slug']}»: {e}")
        return [self._public(r) for r in rows]

    def active_slugs(self) -> List[str]:
        return [t["slug"] for t in self.list() if t["active"]]

    def find_by_meta_phone(self, phone_number_id: str) -> Optional[str]:
        if not phone_number_id:
            return None
        self.ensure()
        rows = self._run("SELECT slug FROM zenith_tenants WHERE active = 1 AND meta_phone_number_id = ?",
                         (phone_number_id,), fetch=True)
        return rows[0]["slug"] if rows else None

    def verify_password(self, slug: str, password: str) -> bool:
        """Contraseña de la empresa; la empresa «default» usa ADMIN_PASSWORD si no definió una propia."""
        raw = self._raw(normalize_slug(slug))
        if not raw or not raw["active"]:
            return False
        stored = raw.get("password_hash") or ""
        if stored:
            return check_password(password or "", stored)
        if raw["slug"] == DEFAULT_TENANT:
            from services.auth_service import auth_service
            return hmac.compare_digest((password or "").encode("utf-8"), auth_service.admin_password.encode("utf-8"))
        return False

    def owner_email(self, slug: str) -> str:
        return ((self._raw(normalize_slug(slug)) or {}).get("owner_email") or "").strip().lower()

    def tenants_for_owner_email(self, email: str) -> List[str]:
        """Empresas (activas) cuyo propietario entra con ese correo."""
        email = (email or "").strip().lower()
        if "@" not in email:
            return []
        rows = self._run("SELECT slug FROM zenith_tenants WHERE LOWER(owner_email) = ? AND active = 1",
                         (email,), fetch=True)
        return [r["slug"] for r in rows]

    def set_owner_credentials(self, slug: str, email: str, password: Optional[str] = None) -> None:
        """Guarda el correo del propietario y, si se indica, una contraseña nueva (siempre con hash, en la base)."""
        slug = normalize_slug(slug)
        email = (email or "").strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 160:
            raise ValueError("Correo inválido.")
        taken = [s for s in self.tenants_for_owner_email(email) if s != slug]
        if taken:
            raise ValueError("Ese correo ya es el acceso de otra empresa.")
        if password is not None:
            if len(password) < 8:
                raise ValueError("La contraseña debe tener al menos 8 caracteres.")
            self._run("UPDATE zenith_tenants SET password_hash = ? WHERE slug = ?", (hash_password(password), slug))
        self._run("UPDATE zenith_tenants SET owner_email = ? WHERE slug = ?", (email, slug))
        self._cache.pop(slug, None)
        self._pv_cache.pop(slug, None)

    def password_version(self, slug: str) -> str:
        """
        Huella corta de la contraseña vigente de la empresa. Va dentro del token del panel: al cambiar la
        contraseña, todos los tokens emitidos antes dejan de valer (cierra las sesiones abiertas).
        """
        slug = normalize_slug(slug)
        hit = self._pv_cache.get(slug)
        if hit and hit[1] > time.time():
            return hit[0]
        raw = self._raw(slug) or {}
        stored = raw.get("password_hash") or ""
        if not stored and slug == DEFAULT_TENANT:
            from services.auth_service import auth_service
            stored = "env:" + auth_service.admin_password
        version = hashlib.sha256(stored.encode("utf-8")).hexdigest()[:16]
        self._pv_cache[slug] = (version, time.time() + _CACHE_TTL)
        return version

    # --- administración ---
    def create(self, slug: str, name: str, password: str = "", gateway_url: str = "",
               features: Optional[List[str]] = None) -> Dict[str, Any]:
        slug = validate_slug(slug)
        feats = normalize_features(features if features is not None else DEFAULT_FEATURES)
        name = (name or "").strip()
        if not name:
            raise ValueError("El nombre de la empresa es obligatorio.")
        pw = (password or "").strip()
        if pw and len(pw) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres.")
        if self._raw(slug):
            raise ValueError(f"Ya existe una empresa con el identificador «{slug}».")
        self._run("INSERT INTO zenith_tenants (slug, name, password_hash, active, created_at, features) "
                  "VALUES (?, ?, ?, 1, ?, ?)",
                  (slug, name[:160], hash_password(pw) if pw else "", _now_iso(), ",".join(feats)))
        self._cache.pop(slug, None)
        self._provision(slug, name, gateway_url)
        logger.info(f"🏢 Empresa creada: {slug}")
        return self.get(slug)

    def _provision(self, slug: str, name: str, gateway_url: str = "") -> None:
        """Crea la base de la empresa y siembra sus ajustes iniciales (sin heredar credenciales de otra empresa)."""
        db = self._db()
        with tenant_context(slug):
            db.ensure_tenant(slug)
            db.set_setting("COMPANY_NAME", name)
            for key in PRIVATE_SETTING_KEYS:
                db.set_setting(key, "")
            if gateway_url:
                db.set_setting("WHATSAPP_GATEWAY_URL", gateway_url.strip())
            from config import settings
            settings.invalidate(slug)

    def update(self, slug: str, name: Optional[str] = None, password: Optional[str] = None,
               active: Optional[bool] = None, features: Optional[List[str]] = None) -> Dict[str, Any]:
        slug = normalize_slug(slug)
        raw = self._raw(slug)
        if not raw:
            raise LookupError("Empresa no encontrada.")
        if name is not None:
            if not name.strip():
                raise ValueError("El nombre no puede quedar vacío.")
            self._run("UPDATE zenith_tenants SET name = ? WHERE slug = ?", (name.strip()[:160], slug))
            # El nombre de marca (lo que usa la IA) debe coincidir con el del selector de empresas
            try:
                from config import settings as _s
                with tenant_context(slug):
                    self._db().set_setting("COMPANY_NAME", name.strip())
                _s.invalidate(slug)
            except Exception as e:
                logger.warning(f"No se pudo sincronizar COMPANY_NAME de «{slug}»: {e}")
        if password is not None:
            if len(password) < 8:
                raise ValueError("La contraseña debe tener al menos 8 caracteres.")
            self._run("UPDATE zenith_tenants SET password_hash = ? WHERE slug = ?", (hash_password(password), slug))
        if active is not None:
            if slug == DEFAULT_TENANT and not active:
                raise ValueError("La empresa principal no se puede desactivar.")
            self._run("UPDATE zenith_tenants SET active = ? WHERE slug = ?", (1 if active else 0, slug))
        if features is not None:
            if slug == DEFAULT_TENANT:
                raise ValueError("La empresa principal siempre tiene todos los productos.")
            self._run("UPDATE zenith_tenants SET features = ? WHERE slug = ?",
                      (",".join(normalize_features(features)), slug))
        self._cache.pop(slug, None)
        self._pv_cache.pop(slug, None)
        return self.get(slug)

    def delete(self, slug: str) -> Dict[str, Any]:
        """
        Elimina una empresa de la plataforma: su registro, usuarios e invitaciones. Sus datos NO se destruyen:
        la base SQLite se mueve a data/tenants/_deleted/ y el esquema PostgreSQL se renombra, para poder
        recuperarlos manualmente si fue un error. El identificador queda libre para una empresa nueva.
        """
        slug = normalize_slug(slug)
        if slug == DEFAULT_TENANT:
            raise ValueError("La empresa principal de la plataforma no se puede eliminar.")
        raw = self._raw(slug)
        if not raw:
            raise LookupError("Empresa no encontrada.")
        stamp = time.strftime("%Y%m%d%H%M%S")
        db = self._db()
        archived = ""
        if db.is_postgres:
            import psycopg2
            schema = pg_schema_for(slug)
            target = f"{schema}__deleted_{stamp}"[:63]
            conn = psycopg2.connect(db.db_url)
            try:
                with conn.cursor() as cur:
                    cur.execute(f'ALTER SCHEMA "{schema}" RENAME TO "{target}"')
                conn.commit()
                archived = target
            except Exception as e:
                conn.rollback()
                logger.warning(f"No se pudo archivar el esquema de «{slug}»: {e}")
            finally:
                conn.close()
        else:
            import os
            import shutil
            src = sqlite_path_for(slug, db.sqlite_path)
            if os.path.exists(src):
                folder = os.path.join(os.path.dirname(src), "_deleted")
                os.makedirs(folder, exist_ok=True)
                archived = os.path.join(folder, f"{slug}__{stamp}.sqlite")
                shutil.move(src, archived)
        for table in ("zenith_invitations", "zenith_users"):
            try:
                self._run(f"DELETE FROM {table} WHERE tenant = ?", (slug,))
            except Exception as e:  # la tabla puede no existir si nunca se invitó a nadie
                logger.debug(f"Limpieza de {table} para «{slug}»: {e}")
        self._run("DELETE FROM zenith_tenants WHERE slug = ?", (slug,))
        db._provisioned.discard(slug)
        self._cache.pop(slug, None)
        self._pv_cache.pop(slug, None)
        try:
            from config import settings
            settings.invalidate(slug)
        except Exception:
            pass
        logger.warning(f"🗑️ Empresa eliminada: {slug} (datos archivados en {archived or 'ninguno'})")
        return {"slug": slug, "name": raw["name"], "archived": bool(archived)}

    def sync_name(self, slug: str, name: str) -> None:
        """Refleja en el registro (selector de empresas) el nombre guardado en Identidad."""
        name = (name or "").strip()
        if not name:
            return
        slug = normalize_slug(slug)
        self._run("UPDATE zenith_tenants SET name = ? WHERE slug = ?", (name[:160], slug))
        self._cache.pop(slug, None)

    def set_meta_phone(self, slug: str, phone_number_id: str) -> None:
        """Mantiene el índice phone_number_id → empresa que usa el webhook de Meta."""
        slug = normalize_slug(slug)
        phone_number_id = (phone_number_id or "").strip()
        if phone_number_id:
            owner = self.find_by_meta_phone(phone_number_id)
            if owner and owner != slug:
                raise ValueError("Ese número de Meta ya está asignado a otra empresa.")
        self._run("UPDATE zenith_tenants SET meta_phone_number_id = ? WHERE slug = ?", (phone_number_id, slug))
        self._cache.pop(slug, None)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


tenant_registry = TenantRegistry()


def require_feature(feature: str):
    """Dependencia FastAPI: la empresa de la petición debe tener contratado `feature`."""
    from fastapi import HTTPException

    def _check():
        if not tenant_registry.has_feature(current_tenant(), feature):
            raise HTTPException(status_code=403, detail=f"Tu plan no incluye este producto ({feature}).")
    return _check
