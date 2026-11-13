import logging
from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, Header, Query, Request, HTTPException, status
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import uvicorn

from config import settings
from models import (
    ChatRequest,
    ChatResponse,
    SendMessageRequest,
    TextKnowledgeRequest,
    UrlKnowledgeRequest,
    CrawlSiteRequest,
    BatchIndexUrlsRequest,
    UpdateSettingsRequest,
    PauseHandoffRequest,
    UpdateHandoffMetaRequest
)
from services.prompt_service import get_effective_welcome
from services.customer_service import customer_service
from services.automation_service import automation_service
from services.ai_service import ai_service
from services.whatsapp_service import whatsapp_service
from services.lead_service import lead_service
from services.knowledge_service import knowledge_service
from services.scraper_service import scraper_service
from services.auth_service import (
    auth_service, current_claims, require_auth, require_superadmin, mask_secret, is_masked,
)
from services.user_service import (
    OWNER_ROLE, ROLE_LABELS, ROLES, available_channels, can_manage_users, deliver_invitation, user_service,
    invite_link, normalize_email, normalize_phone,
)
from services.tenant_service import (
    DEFAULT_TENANT, FEATURE_ARM, current_tenant, normalize_slug, public_slug, default_public_slug, require_feature, tenant_context, tenant_registry,
)
from services.meta_service import meta_service
from services.db_service import db_service
from modules.registry import module_registry
from services.security_middleware import RateLimitMiddleware, SecurityHeadersMiddleware, rate_limiter
from services.password_reset_service import password_reset_service, send_in_background

# Configuración de logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("asistente_operativo.api")

app = FastAPI(
    title=f"Asistente Operativo - {settings.COMPANY_NAME}",
    description="Backend de IA con Gestión Dinámica de Conocimiento, Scraper y WhatsApp Gateway In-House.",
    version="2.1.0",
    # Swagger solo en modo desarrollo para no exponer el mapa de la API en producción
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None
)

class CatchErrorsMiddleware:
    """
    Convierte cualquier excepción no controlada en un 500 JSON *dentro* de CORS. Sin esto, Starlette responde
    el 500 desde fuera de CORSMiddleware y el navegador solo muestra "blocked by CORS", ocultando el error real.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as e:
            logger.exception(f"Error no controlado en {scope.get('method')} {scope.get('path')}: {e}")
            if started:
                raise
            response = JSONResponse(status_code=500, content={"detail": f"Error interno del servidor: {type(e).__name__}"})
            await response(scope, receive, send)


app.add_middleware(CatchErrorsMiddleware)

# Límite por IP en rutas públicas y cabeceras de seguridad. Se agregan antes que CORS para que CORS quede
# por fuera y también las respuestas 429 lleven sus cabeceras (el panel puede leer el error).
app.add_middleware(RateLimitMiddleware, limiter=rate_limiter)
app.add_middleware(SecurityHeadersMiddleware)

# CORS restringido a los orígenes del panel (ALLOWED_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Internal-Key", "X-Tenant-Id"],
)


class TenantMiddleware:
    """
    Fija la empresa activa (ContextVar) al inicio de cada petición, a partir del token del panel o de la
    clave interna + X-Tenant-Id. Se hace aquí (y no en una dependencia) para que los endpoints síncronos,
    que corren en un hilo, hereden la empresa correcta.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        with tenant_context(auth_service.tenant_from_headers(headers)):
            await self.app(scope, receive, send)


app.add_middleware(TenantMiddleware)

# Todas las rutas de `router` exigen token de administrador o la clave interna del gateway
router = APIRouter(dependencies=[Depends(require_auth)])
# Rutas del ARM (agente, WhatsApp, bandeja, clientes, conocimiento): además exigen que la empresa lo tenga contratado
arm_router = APIRouter(dependencies=[Depends(require_auth), Depends(require_feature(FEATURE_ARM))])

# Los esquemas y modelos REST se encuentran desacoplados en el paquete `models/`

@app.on_event("startup")
def startup_event():
    """Garantiza la sincronización de tablas y persistencia de settings al arrancar."""
    logger.info("Iniciando Asistente Operativo...")
    try:
        slugs = tenant_registry.active_slugs()
    except Exception as e:
        logger.error(f"No se pudo leer el registro de empresas: {e}")
        slugs = [DEFAULT_TENANT]
    for slug in slugs:  # cada empresa prepara sus propias tablas
        with tenant_context(slug):
            logger.info(f"🏢 Preparando empresa: {slug}")
            settings.load_db_overrides()
            if not tenant_registry.has_feature(slug, FEATURE_ARM):
                continue  # sin ARM: no se preparan memoria de clientes, agente proactivo ni WhatsApp
            try:
                customer_service.init_tables()
            except Exception as e:
                logger.error(f"[{slug}] No se pudo preparar la memoria de clientes: {e}")
            try:
                from services.metrics_service import metrics_service
                metrics_service.init_tables()
            except Exception as e:
                logger.error(f"[{slug}] No se pudieron preparar las métricas del agente: {e}")
            try:
                automation_service.init_tables()
            except Exception as e:
                logger.error(f"[{slug}] No se pudo preparar el agente proactivo: {e}")
            try:
                # Índice phone_number_id (Meta) -> empresa, para enrutar el webhook
                pid = (settings.META_PHONE_NUMBER_ID or "").strip()
                if pid and not tenant_registry.find_by_meta_phone(pid):
                    tenant_registry.set_meta_phone(slug, pid)
            except Exception as e:
                logger.warning(f"[{slug}] No se pudo indexar el número de Meta: {e}")
    try:
        automation_service.start()  # un solo hilo que recorre todas las empresas activas
    except Exception as e:
        logger.error(f"No se pudo iniciar el agente proactivo: {e}")
    try:
        module_registry.load_installed(app, db_service)
        knowledge_service.refresh_cache()
    except Exception as mod_err:
        logger.warning(f"Aviso cargando modulos: {mod_err}")
    logger.info("✅ Ajustes de marca, modelos y API keys sincronizados con la Base de Datos.")

# ==============================================================
# AUTENTICACIÓN DEL PANEL (RUTAS PÚBLICAS)
# ==============================================================
class LoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)
    tenant: str = Field(default="", max_length=60)  # identificador de la empresa; vacío = empresa principal
    username: str = Field(default="", max_length=160)  # correo o teléfono del usuario; vacío = contraseña de la empresa

@app.get("/health")
def health_check():
    """Chequeo de vida público, sin datos de configuración."""
    return {"status": "online"}

@app.get("/api/public/branding")
def public_branding(tenant: str = ""):
    """Identidad visual para la pantalla de inicio de sesión (pública: solo nombre, logo y color, nada privado)."""
    if not (tenant or "").strip():
        # Sin empresa no se revela ninguna marca: la raíz del panel es neutra
        raise HTTPException(status_code=404, detail="Empresa no encontrada.")
    slug = normalize_slug(tenant)
    if slug != DEFAULT_TENANT and not tenant_registry.is_active(slug):
        raise HTTPException(status_code=404, detail="Empresa no encontrada.")
    with tenant_context(slug):
        return _branding_payload()


def _branding_payload():
    settings.load_db_overrides()
    logo = (settings.COMPANY_LOGO or "").strip()
    if logo.startswith("data:") and len(logo) > 600_000:
        logo = ""  # un logo gigante en base64 no debe frenar la pantalla de login
    return {
        "company_name": (settings.COMPANY_NAME or "").strip(),
        "bot_name": (settings.BOT_NAME or "").strip(),
        "logo": logo,
        "primary_color": (settings.PRIMARY_COLOR or "").strip(),
    }

@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    """Valida la contraseña del panel y devuelve un token firmado (expira en 12 h)."""
    client_ip = request.client.host if request.client else "unknown"
    return auth_service.login(req.password, client_ip, req.tenant, req.username)

@router.get("/api/auth/check")
def check_auth(authorization: Optional[str] = Header(default=None)):
    """Permite al panel confirmar que su token sigue vigente e informa de la empresa activa."""
    claims = auth_service.decode_token(authorization[7:].strip()) if (
        authorization and authorization.lower().startswith("bearer ")) else None
    rec = tenant_registry.get(current_tenant()) or {}
    role = str((claims or {}).get("urole") or OWNER_ROLE)
    user = None
    if claims and claims.get("uid") is not None:
        user = user_service.get_user(str(claims["tenant"]), int(claims["uid"]))
    return {
        "authenticated": True,
        "tenant": current_tenant(),
        "tenant_slug": public_slug(current_tenant()),
        "default_slug": default_public_slug(),
        "tenant_name": rec.get("name", ""),
        "features": rec.get("features", []),
        "superadmin": bool(claims and claims.get("sa")),
        "role": role,
        "role_label": ROLE_LABELS.get(role, role),
        "can_manage_users": can_manage_users(role),
        "user": user,
    }

class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)

@router.post("/api/auth/password")
def change_own_password(req: PasswordChange, authorization: Optional[str] = Header(default=None)):
    """Un usuario invitado cambia su propia contraseña (devuelve un token nuevo: el anterior deja de valer)."""
    claims = current_claims(authorization)
    if not claims or claims.get("uid") is None:
        raise HTTPException(status_code=400, detail="La contraseña de la empresa se cambia desde Empresas.")
    tenant, uid = str(claims["tenant"]), int(claims["uid"])
    try:
        user_service.change_password(tenant, uid, req.current_password, req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return auth_service.issue_user_token(tenant, user_service.get_user(tenant, uid))

class OwnerCredentials(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    email: str = Field(..., min_length=3, max_length=160)
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=256)

@router.get("/api/auth/owner")
def get_owner_access(authorization: Optional[str] = Header(default=None)):
    """Correo con el que entra el propietario de la empresa (solo lo ve el propietario)."""
    claims = current_claims(authorization)
    if not claims or claims.get("uid") is not None:
        raise HTTPException(status_code=403, detail="Solo el propietario de la empresa.")
    return {"email": tenant_registry.owner_email(str(claims["tenant"]))}

@router.post("/api/auth/owner")
def set_owner_access(req: OwnerCredentials, authorization: Optional[str] = Header(default=None)):
    """El propietario fija su correo de acceso (y opcionalmente una contraseña nueva). Todo queda en la base,
    la contraseña con hash. Desde ese momento «admin» deja de funcionar para esta empresa."""
    claims = current_claims(authorization)
    if not claims or claims.get("uid") is not None:
        raise HTTPException(status_code=403, detail="Solo el propietario de la empresa.")
    tenant = str(claims["tenant"])
    if not tenant_registry.verify_password(tenant, req.current_password):
        raise HTTPException(status_code=403, detail="La contraseña actual no es correcta.")
    previous_email = tenant_registry.owner_email(tenant)
    try:
        tenant_registry.set_owner_credentials(tenant, req.email, req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(f"🔐 Acceso del propietario de «{tenant}» actualizado.")
    # Aviso de seguridad al correo nuevo y, si cambió, también al anterior
    company = (tenant_registry.get(tenant) or {}).get("name") or tenant
    new_email = tenant_registry.owner_email(tenant)
    for to in {previous_email, new_email} - {""}:
        send_in_background(to, f"Cambió el acceso de propietario de {company}",
                           f"Hola,\n\nEl acceso de propietario de {company} en Zenith ahora usa el correo {new_email}"
                           f"{' y una contraseña nueva' if req.new_password else ''}.\n\nSi no fuiste tú, "
                           "recupera tu acceso desde «¿Olvidaste tu contraseña?» en la pantalla de inicio.\n")
    return auth_service.issue_token(tenant)  # la contraseña pudo cambiar: el token anterior deja de valer

# ==============================================================
# RECUPERACIÓN DE CONTRASEÑA (RUTAS PÚBLICAS)
# ==============================================================
class ResetRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=160)
    tenant: str = Field(default="", max_length=40)

class ResetConfirm(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)
    password: str = Field(..., min_length=8, max_length=256)

@app.post("/api/public/password-reset/request")
def password_reset_request(req: ResetRequest):
    """Siempre responde lo mismo: no revela si el correo tiene cuenta."""
    try:
        password_reset_service.request(req.email, req.tenant)
    except Exception as e:
        logger.warning(f"Error al generar enlace de recuperación: {e}")
    return {"ok": True, "message": "Si el correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña."}

@app.get("/api/public/password-reset/{token}")
def password_reset_check(token: str):
    if not password_reset_service.check(token):
        raise HTTPException(status_code=404, detail="El enlace no es válido o ya venció. Pide uno nuevo.")
    return {"ok": True}

@app.post("/api/public/password-reset/confirm")
def password_reset_confirm(req: ResetConfirm):
    try:
        return password_reset_service.confirm(req.token, req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==============================================================
# INVITACIONES (RUTAS PÚBLICAS: el enlace lleva un token aleatorio de un solo uso)
# ==============================================================
class InvitationAccept(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    password: str = Field(..., min_length=8, max_length=256)
    email: str = Field(default="", max_length=160)

@app.get("/api/public/invitations/{token}")
def get_invitation(token: str):
    try:
        info = user_service.lookup_invitation(token)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    with tenant_context(info["tenant"]):
        return {**info, "branding": _branding_payload()}

@app.post("/api/public/invitations/{token}/accept")
def accept_invitation(token: str, req: InvitationAccept):
    """Crea el usuario y devuelve directamente su sesión."""
    try:
        user = user_service.accept_invitation(token, req.name, req.password, req.email)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return auth_service.issue_user_token(user["tenant"], user)

# ==============================================================
# USUARIOS DE LA EMPRESA (solo propietario y administradores: lo valida require_auth por rol)
# ==============================================================
users_router = APIRouter(prefix="/api/users", dependencies=[Depends(require_auth)])

class InvitationCreate(BaseModel):
    email: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=30)
    name: str = Field(default="", max_length=120)
    role: str = Field(..., max_length=20)
    channel: str = Field(default="auto", pattern="^(auto|whatsapp|email|link)$")

class InvitationResend(BaseModel):
    channel: str = Field(default="auto", pattern="^(auto|whatsapp|email|link)$")

class UserUpdate(BaseModel):
    role: Optional[str] = Field(default=None, max_length=20)
    active: Optional[bool] = None
    name: Optional[str] = Field(default=None, max_length=120)

def _actor(authorization: Optional[str]) -> dict:
    """Quién hace la petición: id de usuario (si es invitado) y un nombre para «invitado por»."""
    claims = current_claims(authorization) or {}
    uid = claims.get("uid")
    if uid is None:
        return {"uid": None, "label": "El administrador de la plataforma" if claims.get("sa") else "El administrador"}
    user = user_service.get_user(str(claims["tenant"]), int(uid)) or {}
    return {"uid": int(uid), "label": user.get("name") or user.get("email") or "Un administrador"}

@users_router.get("")
def list_company_users():
    tenant = current_tenant()
    return {
        "users": user_service.list_users(tenant),
        "invitations": user_service.list_invitations(tenant),
        "roles": [{"id": k, **v} for k, v in ROLES.items()],
        "channels": available_channels(tenant),
    }

@users_router.post("/invitations", status_code=201)
def invite_user(req: InvitationCreate, authorization: Optional[str] = Header(default=None)):
    tenant = current_tenant()
    actor = _actor(authorization)
    try:
        created = user_service.create_invitation(tenant, req.role, req.email, req.phone, req.name, actor["label"])
        return deliver_invitation(tenant, created["invitation"], created["token"], req.channel, actor["label"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@users_router.post("/invitations/{invite_id}/resend")
def resend_invitation(invite_id: int, req: InvitationResend, authorization: Optional[str] = Header(default=None)):
    tenant = current_tenant()
    actor = _actor(authorization)
    try:
        renewed = user_service.renew_token(tenant, invite_id)
        return deliver_invitation(tenant, renewed["invitation"], renewed["token"], req.channel, actor["label"])
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@users_router.delete("/invitations/{invite_id}")
def revoke_invitation(invite_id: int):
    try:
        user_service.revoke_invitation(current_tenant(), invite_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "revoked"}

@users_router.patch("/{user_id}")
def update_company_user(user_id: int, req: UserUpdate, authorization: Optional[str] = Header(default=None)):
    try:
        return user_service.update_user(current_tenant(), user_id, req.role, req.active, req.name,
                                        acting_user_id=_actor(authorization)["uid"])
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@users_router.delete("/{user_id}")
def delete_company_user(user_id: int, authorization: Optional[str] = Header(default=None)):
    try:
        user_service.delete_user(current_tenant(), user_id, acting_user_id=_actor(authorization)["uid"])
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted"}

# ==============================================================
# GESTIÓN DE EMPRESAS (MULTI-TENANT) — SOLO ADMINISTRADOR DE PLATAFORMA
# ==============================================================
tenants_router = APIRouter(prefix="/api/tenants", dependencies=[Depends(require_superadmin)])

class TenantCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=40)
    name: str = Field(..., min_length=1, max_length=160)
    password: str = Field(default="", max_length=256)
    gateway_url: str = Field(default="", max_length=300)
    # Administrador invitado (obligatorio): correo o WhatsApp
    admin_email: str = Field(default="", max_length=160)
    admin_phone: str = Field(default="", max_length=30)
    admin_name: str = Field(default="", max_length=120)
    admin_channel: str = Field(default="auto", pattern="^(auto|whatsapp|email|link)$")
    features: Optional[list[str]] = None  # productos contratados: ["arm"], ["loyalty"] o ambos

class TenantUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=160)
    password: Optional[str] = Field(default=None, max_length=256)
    active: Optional[bool] = None
    features: Optional[list[str]] = None

@tenants_router.get("")
def list_tenants():
    return {"tenants": tenant_registry.list()}

@tenants_router.post("", status_code=201)
def create_tenant(req: TenantCreate, authorization: Optional[str] = Header(default=None)):
    # Validar al administrador antes de crear nada, para no dejar empresas sin admin
    try:
        admin_email = normalize_email(req.admin_email)
        admin_phone = normalize_phone(req.admin_phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not admin_email and not admin_phone:
        raise HTTPException(status_code=400, detail="Indica el correo o WhatsApp del administrador de la empresa.")
    try:
        tenant = tenant_registry.create(req.slug, req.name, req.password, req.gateway_url, req.features)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    invited_by = _actor(authorization)["label"]
    try:
        created = user_service.create_invitation(tenant["slug"], "admin", admin_email, admin_phone,
                                                 req.admin_name, invited_by)
    except ValueError as e:
        tenant_registry.delete(tenant["slug"])  # sin administrador no se crea la empresa
        raise HTTPException(status_code=400, detail=str(e))
    try:
        delivery = deliver_invitation(tenant["slug"], created["invitation"], created["token"],
                                      req.admin_channel, invited_by)
    except ValueError as e:
        # La invitación existe; si el envío falla se devuelve el enlace para compartirlo a mano
        delivery = {"invitation": created["invitation"], "sent_via": "link", "error": str(e),
                    "link": invite_link(tenant["slug"], created["token"])}
    return {**tenant, "admin_invitation": delivery}

# Estados que requieren que alguien haga algo (escanear QR, revisar el gateway, completar Meta...)
WHATSAPP_ATTENTION_STATUSES = {
    "STOPPED", "QR_EXPIRED", "WAITING_QR", "UNREACHABLE", "ERROR", "META_INCOMPLETE",
    "DISCONNECTED", "RECONNECTING", "NOT_STARTED",
}

def _tenant_whatsapp_summary(tenant: dict) -> dict:
    """Estado del canal de WhatsApp de una empresa, sin abrir sesiones nuevas en el gateway."""
    slug = tenant["slug"]
    base = {"slug": slug, "name": tenant["name"], "active": tenant["active"]}
    if not tenant["active"]:
        return {**base, "channel": None, "status": "INACTIVE", "connected": False, "phone_number": ""}
    with tenant_context(slug):
        try:
            channel = whatsapp_service.channel
            if channel == "meta":
                configured = meta_service.is_configured()
                return {**base, "channel": "meta", "status": "META_CONFIGURED" if configured else "META_INCOMPLETE",
                        "connected": configured, "phone_number": ""}
            data = whatsapp_service.get_baileys_status(peek=True)
            return {
                **base,
                "channel": "baileys",
                "status": data.get("status") or "UNKNOWN",
                "connected": bool(data.get("connected")),
                "phone_number": data.get("phone_number") or "",
                "connected_at": data.get("connectedAt"),
                "stop_reason": data.get("stopReason"),
                "error": "No se pudo contactar el WhatsApp Gateway." if data.get("status") == "UNREACHABLE" else None,
            }
        except Exception as e:
            logger.warning(f"[{slug}] No se pudo consultar el estado de WhatsApp: {e}")
            return {**base, "channel": None, "status": "ERROR", "connected": False, "phone_number": "",
                    "error": "Error consultando el estado."}

@tenants_router.get("/whatsapp")
def tenants_whatsapp_overview():
    """Estado de WhatsApp de todas las empresas en una sola vista (consultas en paralelo)."""
    from concurrent.futures import ThreadPoolExecutor
    tenants = tenant_registry.list()
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(tenants)))) as pool:
        items = list(pool.map(_tenant_whatsapp_summary, tenants))
    active = [i for i in items if i["active"]]
    return {
        "tenants": items,
        "summary": {
            "total": len(active),
            "connected": sum(1 for i in active if i["connected"]),
            "attention": sum(1 for i in active if i["status"] in WHATSAPP_ATTENTION_STATUSES),
        },
    }

@tenants_router.patch("/{slug}")
def update_tenant(slug: str, req: TenantUpdate):
    try:
        return tenant_registry.update(slug, req.name, req.password, req.active, req.features)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class TenantDelete(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)  # contraseña del administrador de la plataforma
    confirm_slug: str = Field(..., min_length=1, max_length=60)  # el identificador escrito a mano

@tenants_router.post("/{slug}/delete")
def delete_tenant(slug: str, req: TenantDelete, request: Request):
    """Elimina una empresa. Exige reconfirmar la contraseña del superadmin y escribir su identificador."""
    slug = normalize_slug(slug)
    if normalize_slug(req.confirm_slug) != slug:
        raise HTTPException(status_code=400, detail="El identificador escrito no coincide con el de la empresa.")
    if slug == DEFAULT_TENANT:
        raise HTTPException(status_code=400, detail="La empresa principal de la plataforma no se puede eliminar.")
    if not tenant_registry.get(slug):
        raise HTTPException(status_code=404, detail="Empresa no encontrada.")
    client_ip = request.client.host if request.client else "unknown"
    auth_service.confirm_superadmin_password(req.password, client_ip)
    # Desvincula su WhatsApp (sin bloquear el borrado si el gateway no responde)
    try:
        with tenant_context(slug):
            if whatsapp_service.channel != "meta":
                whatsapp_service.logout()
    except Exception as e:
        logger.warning(f"[{slug}] No se pudo cerrar la sesión de WhatsApp antes de eliminar: {e}")
    try:
        return {"status": "deleted", **tenant_registry.delete(slug)}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/")
def read_root():
    settings.load_db_overrides()
    has_arm = tenant_registry.has_feature(current_tenant(), FEATURE_ARM)
    # Sin ARM no se consulta el gateway de WhatsApp ni la base de conocimiento
    gateway_status = whatsapp_service.get_status() if has_arm else {"connected": False, "status": "NOT_IN_PLAN"}
    kb_stats = knowledge_service.get_stats() if has_arm else {
        "database_type": "", "total_db_items": 0, "cached": False}
    effective_phone = settings.get_effective_support_phone()
    curr_slug = current_tenant()
    is_active = tenant_registry.is_active(curr_slug)
    return {
        "status": "online",
        "tenant": curr_slug,
        "tenant_active": is_active,
        "agent": settings.BOT_NAME,
        "company": settings.COMPANY_NAME,
        "company_name": settings.COMPANY_NAME,
        "bot_name": settings.BOT_NAME,
        "company_logo": settings.COMPANY_LOGO,
        "bot_avatar": settings.BOT_AVATAR,
        "primary_color": settings.PRIMARY_COLOR,
        "welcome_message": settings.WELCOME_MESSAGE,
        "effective_welcome": get_effective_welcome(),
        "support_phone": settings.SUPPORT_PHONE,
        "effective_support_phone": effective_phone,
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "website_url": settings.WEBSITE_URL,
        "active_provider": ai_service.provider,
        "active_model": ai_service.active_model,
        "knowledge_engine": {
            "database": kb_stats["database_type"],
            "total_items": kb_stats["total_db_items"],
            "hot_cache_active": kb_stats["cached"]
        },
        "gateway_integration": {
            "type": "In-House Baileys WebSocket",
            "gateway_url": settings.WHATSAPP_GATEWAY_URL,
            "connected": gateway_status.get("connected", False),
            "gateway_state": gateway_status.get("status", "UNKNOWN")
        },
        "endpoints": {
            "frontend_app": "http://localhost:5173 (React + Tailwind CSS)",
            "swagger_docs": "/docs (GET)",
            "knowledge_api": "/api/knowledge (GET/POST)",
            "chat": "/chat (POST)",
            "webhook": "/webhook (POST)",
            "send_message": "/send (POST)"
        }
    }

# ==============================================================
# REDIRECCIÓN DEL DASHBOARD AL FRONTEND OFICIAL EN VITE
# ==============================================================
@app.get("/dashboard")
def get_dashboard():
    """Redirige al frontend oficial en React + Vite + Tailwind CSS."""
    panel = settings.PANEL_URL or (settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "http://localhost:5173")
    return RedirectResponse(url=panel, status_code=307)

# ==============================================================
# ENDPOINTS REST DE GESTIÓN DINÁMICA DE CONOCIMIENTO
# ==============================================================
@arm_router.get("/api/knowledge")
def list_knowledge():
    """Devuelve todos los documentos y páginas web indexadas en la BD."""
    return {"items": knowledge_service.list_documents()}

@arm_router.post("/api/knowledge/text")
def add_text_knowledge(req: TextKnowledgeRequest):
    """Agrega un documento de texto o catálogo y refresca el Hot Cache al instante."""
    if not req.title.strip() or not req.content.strip():
        raise HTTPException(status_code=400, detail="Título y contenido no pueden estar vacíos.")
    item = knowledge_service.add_text_document(
        title=req.title,
        content=req.content,
        category=req.category
    )
    return {"status": "created", "item": item}

@arm_router.post("/api/knowledge/url")
def add_url_knowledge(req: UrlKnowledgeRequest):
    """Scrapea un sitio web, extrae el texto limpio y lo indexa en la BD y el caché."""
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="La URL es requerida.")
    try:
        item = knowledge_service.add_web_source(url=req.url, category=req.category)
        return {"status": "scraped_and_indexed", "title": item["title"], "item": item}
    except Exception as e:
        logger.error(f"Error procesando URL {req.url}: {e}")
        raise HTTPException(status_code=422, detail=f"No se pudo extraer el sitio web: {str(e)}")

@arm_router.post("/api/knowledge/crawl")
def crawl_site(req: CrawlSiteRequest):
    """
    Rastrea y descubre todas las URLs internas de un sitio web (vía enlaces y sitemap.xml)
    para que el usuario pueda revisarlas y seleccionarlas antes de indexar.
    """
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="La URL es requerida.")
    try:
        result = scraper_service.discover_site_urls(req.url, req.max_urls)
        return result
    except Exception as e:
        logger.error(f"Error descubriendo URLs en {req.url}: {e}")
        raise HTTPException(status_code=422, detail=f"No se pudieron rastrear las URLs del sitio: {str(e)}")

@arm_router.post("/api/knowledge/batch-urls")
def batch_index_urls(req: BatchIndexUrlsRequest):
    """
    Scrapea e indexa en lote las URLs seleccionadas por el usuario,
    actualizando la base de datos y el Hot Cache en RAM.
    """
    if not req.urls:
        raise HTTPException(status_code=400, detail="La lista de URLs no puede estar vacía.")

    indexed = []
    failed = []

    for u in req.urls:
        try:
            item = knowledge_service.add_web_source(url=u, category=req.category)
            indexed.append(item)
        except Exception as e:
            logger.warning(f"Error indexando {u}: {e}")
            failed.append({"url": u, "error": str(e)})

    return {
        "status": "completed",
        "total_requested": len(req.urls),
        "total_indexed": len(indexed),
        "total_failed": len(failed),
        "indexed": indexed,
        "failed": failed
    }

@arm_router.delete("/api/knowledge/{item_id}")
def delete_knowledge(item_id: int):
    """Elimina un documento de la BD y recompila el caché de IA."""
    deleted = knowledge_service.delete_document(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    return {"status": "deleted", "id": item_id}

@arm_router.post("/api/knowledge/sync")
def sync_knowledge_cache():
    """Fuerza la recompilación en memoria RAM del Hot Cache."""
    knowledge_service.refresh_cache()
    return {"status": "synchronized", "stats": knowledge_service.get_stats()}

@arm_router.get("/api/knowledge/stats")
def get_knowledge_stats():
    """Métricas del sistema de almacenamiento y caché."""
    return knowledge_service.get_stats()

# ==============================================================
# ENDPOINTS REST DE CONFIGURACIÓN DE MARCA Y CLAVES IA
# ==============================================================
@router.get("/api/settings")
def get_app_settings():
    """Devuelve la configuración de marca, proveedor y claves de IA directamente sincronizada con la BD."""
    settings.load_db_overrides()
    kb_stats = knowledge_service.get_stats()
    return {
        "company_name": settings.COMPANY_NAME,
        "bot_name": settings.BOT_NAME,
        "bot_tone": settings.BOT_TONE,
        "brand_instructions": settings.BRAND_INSTRUCTIONS,
        "ai_provider": settings.AI_PROVIDER,
        # Las claves nunca salen completas del servidor: solo los últimos 4 caracteres
        "gemini_api_key": mask_secret(settings.GEMINI_API_KEY),
        "gemini_model": settings.GEMINI_MODEL,
        "openai_api_key": mask_secret(settings.OPENAI_API_KEY),
        "openai_model": settings.OPENAI_MODEL,
        "whatsapp_gateway_url": settings.WHATSAPP_GATEWAY_URL,
        "company_logo": settings.COMPANY_LOGO,
        "bot_avatar": settings.BOT_AVATAR,
        "primary_color": settings.PRIMARY_COLOR,
        "welcome_message": settings.WELCOME_MESSAGE,
        "effective_welcome": get_effective_welcome(),
        "transfer_message": settings.TRANSFER_MESSAGE,
        "support_phone": settings.SUPPORT_PHONE,
        "effective_support_phone": settings.get_effective_support_phone(),
        "detected_whatsapp_phone": (whatsapp_service.get_status().get("phone_number") or ""),
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "website_url": settings.WEBSITE_URL,
        "whatsapp_channel": whatsapp_service.channel,
        "meta_access_token": mask_secret(settings.META_ACCESS_TOKEN),
        "meta_phone_number_id": settings.META_PHONE_NUMBER_ID,
        "meta_waba_id": settings.META_WABA_ID,
        "meta_verify_token": settings.META_VERIFY_TOKEN,
        "meta_app_secret": mask_secret(settings.META_APP_SECRET),
        "meta_api_version": settings.META_API_VERSION,
        "public_base_url": settings.PUBLIC_BASE_URL,
        "database_type": kb_stats["database_type"],
        "persisted_in_db": True
    }

@router.post("/api/settings")
def update_app_settings(req: UpdateSettingsRequest):
    """Actualiza en caliente la configuración de marca, proveedor y API keys en BD y memoria."""
    updates = {}
    if req.company_name is not None: updates["COMPANY_NAME"] = req.company_name
    if req.bot_name is not None: updates["BOT_NAME"] = req.bot_name
    if req.bot_tone is not None: updates["BOT_TONE"] = req.bot_tone
    if req.brand_instructions is not None: updates["BRAND_INSTRUCTIONS"] = req.brand_instructions
    if req.ai_provider is not None: updates["AI_PROVIDER"] = req.ai_provider
    # Un valor enmascarado ("••••abcd") significa que el panel no cambió la clave
    if req.gemini_api_key is not None and not is_masked(req.gemini_api_key): updates["GEMINI_API_KEY"] = req.gemini_api_key
    if req.gemini_model is not None: updates["GEMINI_MODEL"] = req.gemini_model
    if req.openai_api_key is not None and not is_masked(req.openai_api_key): updates["OPENAI_API_KEY"] = req.openai_api_key
    if req.openai_model is not None: updates["OPENAI_MODEL"] = req.openai_model
    if req.whatsapp_gateway_url is not None: updates["WHATSAPP_GATEWAY_URL"] = req.whatsapp_gateway_url
    if req.company_logo is not None: updates["COMPANY_LOGO"] = req.company_logo
    if req.bot_avatar is not None: updates["BOT_AVATAR"] = req.bot_avatar
    if req.primary_color is not None: updates["PRIMARY_COLOR"] = req.primary_color
    if req.welcome_message is not None: updates["WELCOME_MESSAGE"] = req.welcome_message
    if req.transfer_message is not None: updates["TRANSFER_MESSAGE"] = req.transfer_message
    if req.support_phone is not None: updates["SUPPORT_PHONE"] = req.support_phone
    if req.website_url is not None: updates["WEBSITE_URL"] = req.website_url
    if req.handoff_inactivity_hours is not None: updates["HANDOFF_INACTIVITY_HOURS"] = req.handoff_inactivity_hours
    if req.whatsapp_channel is not None: updates["WHATSAPP_CHANNEL"] = req.whatsapp_channel
    if req.meta_access_token is not None and not is_masked(req.meta_access_token): updates["META_ACCESS_TOKEN"] = req.meta_access_token
    if req.meta_phone_number_id is not None: updates["META_PHONE_NUMBER_ID"] = req.meta_phone_number_id.strip()
    if req.meta_waba_id is not None: updates["META_WABA_ID"] = req.meta_waba_id.strip()
    if req.meta_verify_token is not None: updates["META_VERIFY_TOKEN"] = req.meta_verify_token
    if req.meta_app_secret is not None and not is_masked(req.meta_app_secret): updates["META_APP_SECRET"] = req.meta_app_secret
    if req.meta_api_version is not None: updates["META_API_VERSION"] = req.meta_api_version
    if req.public_base_url is not None: updates["PUBLIC_BASE_URL"] = req.public_base_url.strip().rstrip("/")

    if "META_PHONE_NUMBER_ID" in updates:
        try:  # un mismo número de Meta no puede pertenecer a dos empresas
            tenant_registry.set_meta_phone(current_tenant(), updates["META_PHONE_NUMBER_ID"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    settings.update_settings(updates)
    if "COMPANY_NAME" in updates:
        tenant_registry.sync_name(current_tenant(), updates["COMPANY_NAME"])
    # Refrescar caché de conocimiento por si cambiaron instrucciones de marca
    knowledge_service.refresh_cache()
    logger.info("⚙️ Configuración de marca e IA guardada exitosamente en la Base de Datos.")
    return {"status": "updated", "persisted_in_db": True, "settings": get_app_settings()}

# ==============================================================
# ENDPOINT DE CHAT / PROCESAMIENTO DE IA (USADO POR BAILEYS Y WEB)
# ==============================================================
@arm_router.post("/chat", response_model=ChatResponse)
def chat_direct(request: ChatRequest, caller: str = Depends(require_auth)):
    """
    Procesa un mensaje de usuario a través del motor de IA (Gemini / OpenAI),
    inyectando el In-Memory Hot Cache en menos de 1 ms.
    Si la conversación fue derivada a un humano, la IA no responderá hasta que pasen las horas de inactividad.
    """
    user_text = (request.message or "").strip()
    has_audio = bool(request.audio_base64 and request.audio_base64.strip())
    has_image = bool(request.image_base64 and request.image_base64.strip())

    if not user_text and not has_audio and not has_image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe proporcionarse un mensaje de texto, nota de voz o imagen."
        )

    # Con Meta Cloud API como canal activo, el gateway Baileys no debe responder (respuesta vacía = silencio)
    if caller == "internal" and whatsapp_service.channel == "meta":
        logger.info(f"🔕 Mensaje de {request.session_id} recibido por Baileys ignorado: el canal activo es Meta Cloud API.")
        return ChatResponse(session_id=request.session_id, reply="", transferred_to_human=False)

    if request.contact_name:
        try:
            customer_service.note_contact(request.session_id, request.contact_name)
            if request.contact_avatar is not None:
                customer_service.set_avatar(request.session_id, request.contact_avatar)
        except Exception as e:
            logger.debug(f"No se pudo registrar el nombre de contacto: {e}")

    # Verificar si la conversación está en manos de un agente humano activo
    is_handoff_active, remaining_hours = lead_service.is_in_human_handoff(request.session_id, touch_activity=True)
    if is_handoff_active:
        # La IA no responde, pero el mensaje sí queda en el historial del cliente
        incoming = user_text or ("🎙️ [Nota de voz]" if has_audio else "🖼️ [Imagen]")
        lead_service.add_message(request.session_id, "user", incoming)
        logger.info(
            f"⏸️ [Agente Humano Activo] Mensaje de {request.session_id} omitido por la IA. "
            f"Conversación en manos humanas (Inactividad restante: {remaining_hours:.1f}h). Silencio absoluto sin mensajes al cliente."
        )
        return ChatResponse(
            session_id=request.session_id,
            reply="",
            transferred_to_human=True,
            human_handoff_active=True
        )

    reply = ai_service.generate_reply(
        session_id=request.session_id,
        user_message=user_text,
        audio_base64=request.audio_base64,
        audio_mime_type=request.audio_mime_type,
        image_base64=request.image_base64,
        image_mime_type=request.image_mime_type
    )

    is_transferred = lead_service.is_transferred(request.session_id)

    return ChatResponse(
        session_id=request.session_id,
        reply=reply,
        transferred_to_human=is_transferred
    )

# ==============================================================
# WEBHOOK PARA MENSAJES ENTRANTES DESDE WHATSAPP GATEWAY
# ==============================================================
@arm_router.post("/webhook")
async def receive_gateway_message(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"error": "JSON inválido"})

    parsed = whatsapp_service.parse_incoming_webhook(body)
    if not parsed:
        return JSONResponse(content={"status": "ignored", "reason": "Payload sin texto válido"}, status_code=status.HTTP_200_OK)

    from_number = parsed["from_number"]
    user_text = parsed["text"]

    logger.info(f"Mensaje entrante de +{from_number}: {user_text}")

    # Verificar si la conversación está en manos de un agente humano activo
    is_handoff_active, remaining_hours = lead_service.is_in_human_handoff(from_number, touch_activity=True)
    if is_handoff_active:
        logger.info(
            f"⏸️ [Agente Humano Activo] Mensaje de +{from_number} omitido por la IA. "
            f"Conversación en manos humanas (Inactividad restante: {remaining_hours:.1f}h)."
        )
        return JSONResponse(
            content={
                "status": "human_handoff_active",
                "message": f"Conversación en manos de un agente humano. IA en pausa ({remaining_hours:.1f}h de inactividad restantes).",
                "to": from_number,
                "inactivity_remaining_hours": round(remaining_hours, 2)
            },
            status_code=status.HTTP_200_OK
        )

    reply_text = ai_service.generate_reply(session_id=from_number, user_message=user_text)
    whatsapp_service.send_text_message(to_phone=from_number, message_text=reply_text)

    return JSONResponse(content={
        "status": "processed",
        "to": from_number,
        "reply": reply_text
    }, status_code=status.HTTP_200_OK)

# ==============================================================
# WEBHOOK OFICIAL DE META CLOUD API (PÚBLICO, PROTEGIDO POR FIRMA)
# ==============================================================
def _meta_phone_number_id(payload: dict) -> str:
    """phone_number_id del número de empresa que recibió el mensaje (solo para elegir empresa)."""
    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                pid = (change.get("value", {}).get("metadata", {}) or {}).get("phone_number_id")
                if pid:
                    return str(pid)
    except Exception:
        pass
    return ""

def _verify_meta_for_tenant(slug: str, mode, token) -> bool:
    if not tenant_registry.is_active(slug) or not tenant_registry.has_feature(slug, FEATURE_ARM):
        return False
    with tenant_context(slug):
        return meta_service.verify_subscription(mode, token)

@app.get("/webhook/meta")
@app.get("/webhook/meta/{tenant_slug}")
def verify_meta_webhook(request: Request, tenant_slug: str = ""):
    """Verificación de suscripción: Meta envía hub.verify_token y espera hub.challenge de vuelta.
    Con /webhook/meta/{empresa} se verifica contra esa empresa; sin ella, contra cualquiera que coincida."""
    params = request.query_params
    mode, token = params.get("hub.mode"), params.get("hub.verify_token")
    candidates = [normalize_slug(tenant_slug)] if tenant_slug else tenant_registry.active_slugs()
    if any(_verify_meta_for_tenant(slug, mode, token) for slug in candidates):
        logger.info("✅ Webhook de Meta verificado correctamente.")
        return PlainTextResponse(params.get("hub.challenge", ""))
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token de verificación inválido.")

@app.post("/webhook/meta")
@app.post("/webhook/meta/{tenant_slug}")
async def receive_meta_webhook(request: Request, background_tasks: BackgroundTasks, tenant_slug: str = ""):
    """Recibe mensajes de Meta; responde 200 de inmediato y procesa la IA en segundo plano.
    La empresa sale de la URL o, si no, del phone_number_id; la firma se valida con el App Secret DE ESA empresa."""
    raw_body = await request.body()
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSON inválido.")

    slug = normalize_slug(tenant_slug) if tenant_slug else (
        tenant_registry.find_by_meta_phone(_meta_phone_number_id(payload)) or DEFAULT_TENANT)
    if not tenant_registry.is_active(slug) or not tenant_registry.has_feature(slug, FEATURE_ARM):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firma inválida.")

    with tenant_context(slug):
        if not meta_service.verify_signature(raw_body, request.headers.get("X-Hub-Signature-256")):
            logger.warning("🔒 Webhook de Meta rechazado: firma inválida o App Secret no configurado.")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firma inválida.")
        if whatsapp_service.channel != "meta":
            return {"status": "ignored", "reason": "El canal activo no es Meta Cloud API."}
        messages = meta_service.extract_messages(payload)
    for message in messages:
        background_tasks.add_task(process_meta_message, message, slug)
    return {"status": "received", "messages": len(messages)}

def process_meta_message(message: dict, tenant_slug: Optional[str] = None):
    """Genera la respuesta de IA para un mensaje entrante de Meta y la envía por la Cloud API."""
    with tenant_context(tenant_slug or current_tenant()):
        _process_meta_message(message)

def _process_meta_message(message: dict):
    from_number = message["from_number"]
    is_handoff_active, remaining_hours = lead_service.is_in_human_handoff(from_number, touch_activity=True)
    if is_handoff_active:
        logger.info(f"⏸️ [Agente Humano Activo] Mensaje de +{from_number} (Meta) omitido por la IA ({remaining_hours:.1f}h restantes).")
        return

    audio_b64 = meta_service.download_media_base64(message["audio_media_id"]) if message["audio_media_id"] else None
    image_b64 = meta_service.download_media_base64(message["image_media_id"]) if message["image_media_id"] else None
    if not message["text"] and not audio_b64 and not image_b64:
        return

    reply = ai_service.generate_reply(
        session_id=from_number,
        user_message=message["text"],
        audio_base64=audio_b64,
        audio_mime_type=message["audio_mime_type"] or "audio/ogg",
        image_base64=image_b64,
        image_mime_type=message["image_mime_type"] or "image/jpeg"
    )
    if reply and reply.strip():
        meta_service.send_text_message(from_number, reply)

# ==============================================================
# CONFIGURACIÓN DEL CANAL DE WHATSAPP (BAILEYS / META)
# ==============================================================
@arm_router.get("/api/whatsapp/channel")
def get_whatsapp_channel(request: Request):
    """Resumen para el panel: canal activo, estado de ambos canales y datos para configurar Meta."""
    settings.load_db_overrides()
    base_url = settings.PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    webhook_path = "/webhook/meta" if current_tenant() == DEFAULT_TENANT else f"/webhook/meta/{current_tenant()}"
    return {
        "channel": whatsapp_service.channel,
        "meta": {
            "configured": meta_service.is_configured(),
            "missing_fields": meta_service.missing_fields(),
            "webhook_url": f"{base_url}{webhook_path}",
            "webhook_is_public_https": base_url.startswith("https://"),
        },
        "baileys": whatsapp_service.get_baileys_status(),
    }

@arm_router.post("/api/whatsapp/meta/test")
def test_meta_connection():
    """Prueba las credenciales de Meta consultando el número en Graph API."""
    settings.load_db_overrides()
    result = meta_service.get_status()
    result["missing_fields"] = meta_service.missing_fields()
    return result

# ==============================================================
# GESTIÓN DE AGENTES HUMANOS Y DERIVACIONES (HANDOFF)
# ==============================================================
@arm_router.get("/api/handoff/active")
def get_active_handoffs():
    """Lista las conversaciones activas derivadas a agentes humanos."""
    return {
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "active_handoffs": lead_service.list_active_handoffs()
    }

@arm_router.post("/api/handoff/{session_id}/release")
def release_session_handoff(session_id: str):
    """Reanuda inmediatamente la IA para una sesión transferida."""
    lead_service.release_handoff(session_id)
    logger.info(f"▶️ [Handoff Liberado] Sesión {session_id} liberada manualmente. IA reanudada.")
    return {"status": "released", "session_id": session_id}

@arm_router.post("/api/handoff/release-all")
def release_all_session_handoffs():
    """Reanuda inmediatamente la IA para todas las sesiones transferidas en lote."""
    released_count = lead_service.release_all_handoffs()
    logger.info(f"▶️ [Handoff Masivo Liberado] {released_count} sesiones liberadas. IA reanudada.")
    return {"status": "released_all", "count": released_count}

@arm_router.post("/api/handoff/{session_id}/pause")
def pause_session_handoff(
    session_id: str,
    reason: Optional[str] = "Pausado manualmente desde el portal",
    tag: Optional[str] = "ATENCIÓN HUMANA",
    notes: Optional[str] = ""
):
    """Pausa manualmente la IA para una sesión transferida a humano con tag y nota."""
    lead_service.pause_handoff(session_id, reason=reason, tag=tag, notes=notes)
    logger.info(f"⏸️ [Handoff Pausado] Sesión {session_id} pausada manualmente desde el portal (Tag: {tag}).")
    return {"status": "paused", "session_id": session_id, "reason": reason, "tag": tag, "notes": notes}

@arm_router.post("/api/handoff/pause")
def pause_session_handoff_body(req: PauseHandoffRequest):
    """Pausa manualmente la IA recibiendo session_id, reason, tag y notes en el cuerpo JSON."""
    lead_service.pause_handoff(
        req.session_id,
        reason=req.reason or "Pausado manualmente desde el portal",
        tag=req.tag or "ATENCIÓN HUMANA",
        notes=req.notes or ""
    )
    logger.info(f"⏸️ [Handoff Pausado] Sesión {req.session_id} pausada manualmente (Tag: {req.tag}).")
    return {"status": "paused", "session_id": req.session_id, "reason": req.reason, "tag": req.tag, "notes": req.notes}

@arm_router.post("/api/handoff/{session_id}/update")
@arm_router.patch("/api/handoff/{session_id}")
def update_session_handoff_meta(session_id: str, req: UpdateHandoffMetaRequest):
    """Actualiza la etiqueta y nota ejecutiva del asesor para una conversación transferida."""
    updated = lead_service.update_handoff_meta(session_id, tag=req.tag, notes=req.notes)
    logger.info(f"🏷️ [Handoff Meta Actualizado] Sesión {session_id} -> Tag: {req.tag}")
    return {"status": "updated" if updated else "noop", "session_id": session_id, "tag": req.tag, "notes": req.notes}

# ==============================================================
# ENVÍO PROACTIVO DE MENSAJES VÍA GATEWAY
# ==============================================================
@arm_router.post("/api/whatsapp/send")
@arm_router.post("/send")
def send_message_endpoint(request: SendMessageRequest):
    success = whatsapp_service.send_text_message(
        to_phone=request.to,
        message_text=request.message
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=whatsapp_service.last_send_error or "No se pudo enviar el mensaje a través del WhatsApp Gateway."
        )
    return {"status": "sent", "to": request.to}

@arm_router.get("/api/whatsapp/status")
@arm_router.get("/gateway-status")
def check_gateway_status():
    return whatsapp_service.get_status()

@arm_router.get("/api/whatsapp/qr")
def get_whatsapp_qr():
    """Devuelve los datos del código QR y estado actual de vinculación."""
    return whatsapp_service.get_qr()

@arm_router.post("/api/whatsapp/logout")
def logout_whatsapp():
    """Desvincula la sesión activa de WhatsApp."""
    success = whatsapp_service.logout()
    return {"success": success, "status": "DISCONNECTED"}

# ==============================================================
# GESTIÓN Y MONITOREO DE SESIONES Y LEADS
# ==============================================================
@arm_router.get("/sessions")
def list_sessions():
    sessions = lead_service.get_all_sessions()
    return {
        "total_active_sessions": len(sessions),
        "sessions": sessions
    }

@arm_router.delete("/sessions/{session_id}")
def reset_session(session_id: str):
    lead_service.reset_session(session_id)
    return {"status": "reset", "session_id": session_id}


# ==============================================================
# GESTIÓN DEL ECOSISTEMA DE MÓDULOS (ESTILO ODOO)
# ==============================================================
# ==============================================================
# CLIENTES (memoria del ARM): fichas, historial y resumen vivo
# ==============================================================
class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=40)
    tags: Optional[list[str]] = Field(None, max_length=15)
    notes: Optional[str] = Field(None, max_length=4000)
    stage: Optional[str] = Field(None, pattern="^(new|interested|customer|loyal|lost)$")


@arm_router.get("/api/customers")
def list_customers(search: str = "", stage: str = "", tag: str = "",
                   limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    """Fichas de clientes, de la conversación más reciente a la más antigua."""
    return customer_service.list(search=search, stage=stage, tag=tag, limit=limit, offset=offset)


@arm_router.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    return {"customer": customer}


@arm_router.patch("/api/customers/{customer_id}")
def update_customer(customer_id: int, data: CustomerUpdate):
    try:
        customer = customer_service.update(customer_id, **data.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    return {"customer": customer}


@arm_router.get("/api/customers/{customer_id}/messages")
def customer_messages(customer_id: int, before_id: Optional[int] = None, limit: int = Query(50, ge=1, le=200)):
    """Historial de la conversación, paginado hacia atrás (usa before_id del mensaje más antiguo recibido)."""
    return {"messages": customer_service.list_messages(customer_id, before_id=before_id, limit=limit)}


class AgentReply(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    actor: Optional[str] = Field("Asesor", max_length=100)
    take_over: bool = Field(True, description="Pausar la IA en este chat al responder")


class TakeOver(BaseModel):
    active: bool
    actor: Optional[str] = Field("Asesor", max_length=100)


@arm_router.get("/api/inbox")
def inbox(search: str = "", only: str = Query("", pattern="^(|human)$"), limit: int = Query(50, ge=1, le=200)):
    """Conversaciones para la bandeja del equipo, de la más reciente a la más antigua."""
    return {"conversations": customer_service.conversations(search=search, only=only, limit=limit)}


@arm_router.post("/api/customers/{customer_id}/reply")
def reply_to_customer(customer_id: int, data: AgentReply):
    """Un asesor responde desde el panel. Por defecto pausa la IA en ese chat para que no se crucen."""
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    sid = customer["session_id"]
    if customer.get("channel") != "whatsapp":
        # Chat del simulador o web: no hay a dónde enviarlo; nunca se reporta como entregado
        raise HTTPException(status_code=400, detail="Este chat no es de WhatsApp: el mensaje no se puede entregar al cliente.")
    if not whatsapp_service.send_text_message(sid, data.text.strip()):
        raise HTTPException(status_code=424, detail=whatsapp_service.last_send_error or "No se pudo enviar por WhatsApp.")
    if data.take_over and not lead_service.is_transferred(sid):
        lead_service.pause_handoff(sid, reason=f"Atendido por {data.actor or 'un asesor'} desde la bandeja",
                                   tag="ATENCIÓN HUMANA", notes="Respondido desde la bandeja del panel.")
    lead_service.add_message(sid, "human", data.text.strip())
    return {"status": "sent", "human": lead_service.is_transferred(sid)}


@arm_router.post("/api/customers/{customer_id}/takeover")
def take_over_conversation(customer_id: int, data: TakeOver):
    """Tomar el control (la IA deja de responder) o devolver la conversación a la IA."""
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    sid = customer["session_id"]
    if data.active:
        lead_service.pause_handoff(sid, reason=f"Tomado por {data.actor or 'un asesor'} desde la bandeja",
                                   tag="ATENCIÓN HUMANA", notes="Control tomado desde la bandeja del panel.")
    else:
        lead_service.release_handoff(sid)
    return {"human": lead_service.is_transferred(sid)}


class SpecialistUpdate(BaseModel):
    enabled: Optional[bool] = None
    instructions: Optional[str] = Field(None, max_length=1500)


class SpecialistsSwitch(BaseModel):
    enabled: bool


@arm_router.get("/api/agent/specialists")
def list_specialists():
    """Áreas especializadas del agente (Recepción, Ventas, Soporte) y si el modo especialistas está activo."""
    from services import agents
    return {"enabled": agents.specialists_enabled(), "agents": agents.get_profiles()}


@arm_router.put("/api/agent/specialists")
def switch_specialists(data: SpecialistsSwitch):
    from services import agents
    agents.set_specialists_enabled(data.enabled)
    return {"enabled": agents.specialists_enabled(), "agents": agents.get_profiles()}


@arm_router.patch("/api/agent/specialists/{key}")
def update_specialist(key: str, data: SpecialistUpdate):
    from services import agents
    try:
        return {"agent": agents.update_profile(key, data.enabled, data.instructions)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class PriceUpdate(BaseModel):
    model: str = Field(..., min_length=1, max_length=80)
    input: float = Field(..., ge=0)
    output: float = Field(..., ge=0)
    cached: float = Field(..., ge=0)


class ReportConfig(BaseModel):
    enabled: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=30)
    weekday: Optional[int] = Field(None, ge=0, le=6)
    hour: Optional[int] = Field(None, ge=0, le=23)


@arm_router.get("/api/agent/metrics")
def agent_metrics(days: int = Query(7, ge=1, le=90)):
    """Métricas del agente: conversaciones, automatización, ventas, proactividad, tiempos, tokens y costo estimado."""
    from services.metrics_service import metrics_service
    return metrics_service.summary(days)


@arm_router.get("/api/agent/prices")
def ai_prices():
    from services.metrics_service import metrics_service
    return {"prices": metrics_service.prices(), "active_model": ai_service.active_model}


@arm_router.put("/api/agent/prices")
def update_ai_price(data: PriceUpdate):
    from services.metrics_service import metrics_service
    try:
        return {"prices": metrics_service.save_price(data.model, data.input, data.output, data.cached)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@arm_router.get("/api/agent/weekly-report")
def weekly_report():
    from services.metrics_service import metrics_service
    return {"config": metrics_service.report_config(), "preview": metrics_service.weekly_report_text()}


@arm_router.put("/api/agent/weekly-report")
def update_weekly_report(data: ReportConfig):
    from services.metrics_service import metrics_service
    cfg = metrics_service.save_report_config(data.model_dump(exclude_none=True))
    return {"config": cfg, "preview": metrics_service.weekly_report_text()}


@arm_router.post("/api/agent/weekly-report/send")
def send_weekly_report():
    """Envía el reporte ahora mismo al WhatsApp del dueño (para probarlo)."""
    from services.metrics_service import metrics_service
    try:
        ok = metrics_service.send_weekly()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=424, detail=whatsapp_service.last_send_error or "No se pudo enviar por WhatsApp.")
    return {"status": "sent"}


@arm_router.get("/api/agent/tool-policies")
def tool_policies():
    """Acciones del agente y su regla: automático, pedir aprobación o apagada."""
    from services import agent_tools
    return {"tools": agent_tools.describe_tools()}


class ToolPolicyUpdate(BaseModel):
    policy: str = Field(..., pattern="^(auto|approve|off)$")


@arm_router.put("/api/agent/tool-policies/{tool_name}")
def update_tool_policy(tool_name: str, data: ToolPolicyUpdate):
    from services import agent_tools
    try:
        agent_tools.set_policy(tool_name, data.policy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"tools": agent_tools.describe_tools()}


@arm_router.post("/api/customers/{customer_id}/summary")
def refresh_customer_summary(customer_id: int):
    """Vuelve a analizar la conversación ahora mismo y actualiza resumen, datos clave, etapa y etiquetas."""
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    updated = customer_service.refresh_summary(customer["session_id"])
    if updated is None or updated.get("summary_updated_at") == customer.get("summary_updated_at"):
        raise HTTPException(status_code=424, detail="La IA no pudo generar el resumen. Revisa las claves de IA.")
    return {"customer": customer_service.get(customer_id)}


# ==============================================================
# AGENTE PROACTIVO: automatizaciones, bandeja de aprobación y límites
# ==============================================================
class PlaybookUpdate(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = Field(None, pattern="^(auto|approve)$")
    params: Optional[dict] = None


class GuardrailsUpdate(BaseModel):
    quiet_start: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    quiet_end: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    min_days_between: Optional[int] = Field(None, ge=1, le=90)


class TaskDecision(BaseModel):
    message: Optional[str] = Field(None, max_length=1000)
    actor: Optional[str] = Field("Admin", max_length=100)


@arm_router.get("/api/agent/playbooks")
def list_playbooks():
    return {"playbooks": automation_service.list_playbooks(), "guardrails": automation_service.guardrails(),
            "quiet_now": automation_service.in_quiet_hours()}


@arm_router.patch("/api/agent/playbooks/{key}")
def update_playbook(key: str, data: PlaybookUpdate):
    try:
        return {"playbook": automation_service.update_playbook(key, data.enabled, data.mode, data.params)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@arm_router.put("/api/agent/guardrails")
def update_guardrails(data: GuardrailsUpdate):
    return {"guardrails": automation_service.save_guardrails(data.model_dump(exclude_none=True))}


@arm_router.get("/api/agent/tasks")
def list_agent_tasks(status_filter: Optional[str] = Query(None, alias="status"), limit: int = Query(100, ge=1, le=500)):
    return {"tasks": automation_service.list_tasks(status=status_filter, limit=limit), "counts": automation_service.counts()}


@arm_router.post("/api/agent/tasks/{task_id}/approve")
def approve_agent_task(task_id: int, data: TaskDecision):
    """Aprueba (y opcionalmente edita) el mensaje. Se envía al instante, salvo en horario de silencio."""
    try:
        return {"task": automation_service.approve(task_id, data.message, data.actor or "Admin")}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@arm_router.post("/api/agent/tasks/{task_id}/reject")
def reject_agent_task(task_id: int, data: TaskDecision):
    try:
        return {"task": automation_service.reject(task_id, data.actor or "Admin")}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@arm_router.post("/api/agent/scan")
def run_agent_scan():
    """Revisa las automatizaciones ahora mismo (sin esperar al ciclo automático)."""
    return {"result": automation_service.scan()}


@router.get("/api/modules")
def list_system_modules():
    """Retorna la lista de todos los módulos disponibles con su estado (instalado/disponible)."""
    return module_registry.get_modules_with_status(db_service)

@router.post("/api/modules/{module_id}/install", dependencies=[Depends(require_superadmin)])
def install_system_module(module_id: str):
    """Instala un módulo del ecosistema (crea tablas y activa rutas/capacidades)."""
    try:
        manifest = module_registry.install(module_id, db_service, app)
        knowledge_service.refresh_cache()
        try:
            from services.gemini_service import gemini_service
            gemini_service._prompt_cache = {}
        except Exception:
            pass
        return {"status": "installed", "module": manifest}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error instalando módulo {module_id}: {e}")
        raise HTTPException(status_code=500, detail=f"No se pudo instalar el módulo: {e}")

@router.post("/api/modules/{module_id}/uninstall", dependencies=[Depends(require_superadmin)])
def uninstall_system_module(module_id: str):
    """Desinstala un módulo del ecosistema (desactiva rutas conservando datos)."""
    try:
        module_registry.uninstall(module_id, db_service)
        knowledge_service.refresh_cache()
        try:
            from services.gemini_service import gemini_service
            gemini_service._prompt_cache = {}
        except Exception:
            pass
        return {"status": "uninstalled", "module_id": module_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error desinstalando módulo {module_id}: {e}")
        raise HTTPException(status_code=500, detail=f"No se pudo desinstalar el módulo: {e}")

app.include_router(router)
app.include_router(arm_router)
app.include_router(tenants_router)
app.include_router(users_router)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG
    )
