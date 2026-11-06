import logging
from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, Query, Request, HTTPException, status
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
from services.auth_service import auth_service, require_auth, mask_secret, is_masked
from services.meta_service import meta_service
from services.db_service import db_service
from modules.registry import module_registry

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

# CORS restringido a los orígenes del panel (ALLOWED_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Internal-Key"],
)

# Todas las rutas de `router` exigen token de administrador o la clave interna del gateway
router = APIRouter(dependencies=[Depends(require_auth)])

# Los esquemas y modelos REST se encuentran desacoplados en el paquete `models/`

@app.on_event("startup")
def startup_event():
    """Garantiza la sincronización de tablas y persistencia de settings al arrancar."""
    logger.info("Iniciando Asistente Operativo...")
    settings.load_db_overrides()
    try:
        customer_service.init_tables()
    except Exception as e:
        logger.error(f"No se pudo preparar la memoria de clientes: {e}")
    try:
        from services.metrics_service import metrics_service
        metrics_service.init_tables()
    except Exception as e:
        logger.error(f"No se pudieron preparar las métricas del agente: {e}")
    try:
        automation_service.init_tables()
        automation_service.start()
    except Exception as e:
        logger.error(f"No se pudo iniciar el agente proactivo: {e}")
    try:
        module_registry.load_installed(app, db_service)
    except Exception as mod_err:
        logger.warning(f"Aviso cargando modulos: {mod_err}")
    logger.info("✅ Ajustes de marca, modelos y API keys sincronizados con la Base de Datos.")

# ==============================================================
# AUTENTICACIÓN DEL PANEL (RUTAS PÚBLICAS)
# ==============================================================
class LoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)

@app.get("/health")
def health_check():
    """Chequeo de vida público, sin datos de configuración."""
    return {"status": "online"}

@app.get("/api/public/branding")
def public_branding():
    """Identidad visual para la pantalla de inicio de sesión (pública: solo nombre, logo y color, nada privado)."""
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
    return auth_service.login(req.password, client_ip)

@router.get("/api/auth/check")
def check_auth():
    """Permite al panel confirmar que su token sigue vigente."""
    return {"authenticated": True}

@router.get("/")
def read_root():
    settings.load_db_overrides()
    gateway_status = whatsapp_service.get_status()
    kb_stats = knowledge_service.get_stats()
    effective_phone = settings.get_effective_support_phone()
    return {
        "status": "online",
        "agent": settings.BOT_NAME,
        "company": settings.COMPANY_NAME,
        "company_name": settings.COMPANY_NAME,
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
    return RedirectResponse(url="http://localhost:5173", status_code=307)

# ==============================================================
# ENDPOINTS REST DE GESTIÓN DINÁMICA DE CONOCIMIENTO
# ==============================================================
@router.get("/api/knowledge")
def list_knowledge():
    """Devuelve todos los documentos y páginas web indexadas en la BD."""
    return {"items": knowledge_service.list_documents()}

@router.post("/api/knowledge/text")
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

@router.post("/api/knowledge/url")
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

@router.post("/api/knowledge/crawl")
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

@router.post("/api/knowledge/batch-urls")
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

@router.delete("/api/knowledge/{item_id}")
def delete_knowledge(item_id: int):
    """Elimina un documento de la BD y recompila el caché de IA."""
    deleted = knowledge_service.delete_document(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    return {"status": "deleted", "id": item_id}

@router.post("/api/knowledge/sync")
def sync_knowledge_cache():
    """Fuerza la recompilación en memoria RAM del Hot Cache."""
    knowledge_service.refresh_cache()
    return {"status": "synchronized", "stats": knowledge_service.get_stats()}

@router.get("/api/knowledge/stats")
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

    settings.update_settings(updates)
    # Refrescar caché de conocimiento por si cambiaron instrucciones de marca
    knowledge_service.refresh_cache()
    logger.info("⚙️ Configuración de marca e IA guardada exitosamente en la Base de Datos.")
    return {"status": "updated", "persisted_in_db": True, "settings": get_app_settings()}

# ==============================================================
# ENDPOINT DE CHAT / PROCESAMIENTO DE IA (USADO POR BAILEYS Y WEB)
# ==============================================================
@router.post("/chat", response_model=ChatResponse)
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
@router.post("/webhook")
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
@app.get("/webhook/meta")
def verify_meta_webhook(request: Request):
    """Verificación de suscripción: Meta envía hub.verify_token y espera hub.challenge de vuelta."""
    params = request.query_params
    if meta_service.verify_subscription(params.get("hub.mode"), params.get("hub.verify_token")):
        logger.info("✅ Webhook de Meta verificado correctamente.")
        return PlainTextResponse(params.get("hub.challenge", ""))
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token de verificación inválido.")

@app.post("/webhook/meta")
async def receive_meta_webhook(request: Request, background_tasks: BackgroundTasks):
    """Recibe mensajes de Meta; responde 200 de inmediato y procesa la IA en segundo plano."""
    raw_body = await request.body()
    if not meta_service.verify_signature(raw_body, request.headers.get("X-Hub-Signature-256")):
        logger.warning("🔒 Webhook de Meta rechazado: firma inválida o App Secret no configurado.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firma inválida.")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSON inválido.")

    if whatsapp_service.channel != "meta":
        return {"status": "ignored", "reason": "El canal activo no es Meta Cloud API."}

    messages = meta_service.extract_messages(payload)
    for message in messages:
        background_tasks.add_task(process_meta_message, message)
    return {"status": "received", "messages": len(messages)}

def process_meta_message(message: dict):
    """Genera la respuesta de IA para un mensaje entrante de Meta y la envía por la Cloud API."""
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
@router.get("/api/whatsapp/channel")
def get_whatsapp_channel(request: Request):
    """Resumen para el panel: canal activo, estado de ambos canales y datos para configurar Meta."""
    settings.load_db_overrides()
    base_url = settings.PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return {
        "channel": whatsapp_service.channel,
        "meta": {
            "configured": meta_service.is_configured(),
            "missing_fields": meta_service.missing_fields(),
            "webhook_url": f"{base_url}/webhook/meta",
            "webhook_is_public_https": base_url.startswith("https://"),
        },
        "baileys": whatsapp_service.get_baileys_status(),
    }

@router.post("/api/whatsapp/meta/test")
def test_meta_connection():
    """Prueba las credenciales de Meta consultando el número en Graph API."""
    settings.load_db_overrides()
    result = meta_service.get_status()
    result["missing_fields"] = meta_service.missing_fields()
    return result

# ==============================================================
# GESTIÓN DE AGENTES HUMANOS Y DERIVACIONES (HANDOFF)
# ==============================================================
@router.get("/api/handoff/active")
def get_active_handoffs():
    """Lista las conversaciones activas derivadas a agentes humanos."""
    return {
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "active_handoffs": lead_service.list_active_handoffs()
    }

@router.post("/api/handoff/{session_id}/release")
def release_session_handoff(session_id: str):
    """Reanuda inmediatamente la IA para una sesión transferida."""
    lead_service.release_handoff(session_id)
    logger.info(f"▶️ [Handoff Liberado] Sesión {session_id} liberada manualmente. IA reanudada.")
    return {"status": "released", "session_id": session_id}

@router.post("/api/handoff/release-all")
def release_all_session_handoffs():
    """Reanuda inmediatamente la IA para todas las sesiones transferidas en lote."""
    released_count = lead_service.release_all_handoffs()
    logger.info(f"▶️ [Handoff Masivo Liberado] {released_count} sesiones liberadas. IA reanudada.")
    return {"status": "released_all", "count": released_count}

@router.post("/api/handoff/{session_id}/pause")
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

@router.post("/api/handoff/pause")
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

@router.post("/api/handoff/{session_id}/update")
@router.patch("/api/handoff/{session_id}")
def update_session_handoff_meta(session_id: str, req: UpdateHandoffMetaRequest):
    """Actualiza la etiqueta y nota ejecutiva del asesor para una conversación transferida."""
    updated = lead_service.update_handoff_meta(session_id, tag=req.tag, notes=req.notes)
    logger.info(f"🏷️ [Handoff Meta Actualizado] Sesión {session_id} -> Tag: {req.tag}")
    return {"status": "updated" if updated else "noop", "session_id": session_id, "tag": req.tag, "notes": req.notes}

# ==============================================================
# ENVÍO PROACTIVO DE MENSAJES VÍA GATEWAY
# ==============================================================
@router.post("/api/whatsapp/send")
@router.post("/send")
def send_message_endpoint(request: SendMessageRequest):
    success = whatsapp_service.send_text_message(
        to_phone=request.to,
        message_text=request.message
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=whatsapp_service.last_send_error or "No se pudo enviar el mensaje a través del WhatsApp Gateway."
        )
    return {"status": "sent", "to": request.to}

@router.get("/api/whatsapp/status")
@router.get("/gateway-status")
def check_gateway_status():
    return whatsapp_service.get_status()

@router.get("/api/whatsapp/qr")
def get_whatsapp_qr():
    """Devuelve los datos del código QR y estado actual de vinculación."""
    return whatsapp_service.get_qr()

@router.post("/api/whatsapp/logout")
def logout_whatsapp():
    """Desvincula la sesión activa de WhatsApp."""
    success = whatsapp_service.logout()
    return {"success": success, "status": "DISCONNECTED"}

# ==============================================================
# GESTIÓN Y MONITOREO DE SESIONES Y LEADS
# ==============================================================
@router.get("/sessions")
def list_sessions():
    sessions = lead_service.get_all_sessions()
    return {
        "total_active_sessions": len(sessions),
        "sessions": sessions
    }

@router.delete("/sessions/{session_id}")
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


@router.get("/api/customers")
def list_customers(search: str = "", stage: str = "", tag: str = "",
                   limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    """Fichas de clientes, de la conversación más reciente a la más antigua."""
    return customer_service.list(search=search, stage=stage, tag=tag, limit=limit, offset=offset)


@router.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    return {"customer": customer}


@router.patch("/api/customers/{customer_id}")
def update_customer(customer_id: int, data: CustomerUpdate):
    try:
        customer = customer_service.update(customer_id, **data.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    return {"customer": customer}


@router.get("/api/customers/{customer_id}/messages")
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


@router.get("/api/inbox")
def inbox(search: str = "", only: str = Query("", pattern="^(|human)$"), limit: int = Query(50, ge=1, le=200)):
    """Conversaciones para la bandeja del equipo, de la más reciente a la más antigua."""
    return {"conversations": customer_service.conversations(search=search, only=only, limit=limit)}


@router.post("/api/customers/{customer_id}/reply")
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
        raise HTTPException(status_code=502, detail=whatsapp_service.last_send_error or "No se pudo enviar por WhatsApp.")
    if data.take_over and not lead_service.is_transferred(sid):
        lead_service.pause_handoff(sid, reason=f"Atendido por {data.actor or 'un asesor'} desde la bandeja",
                                   tag="ATENCIÓN HUMANA", notes="Respondido desde la bandeja del panel.")
    lead_service.add_message(sid, "human", data.text.strip())
    return {"status": "sent", "human": lead_service.is_transferred(sid)}


@router.post("/api/customers/{customer_id}/takeover")
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


@router.get("/api/agent/specialists")
def list_specialists():
    """Áreas especializadas del agente (Recepción, Ventas, Soporte) y si el modo especialistas está activo."""
    from services import agents
    return {"enabled": agents.specialists_enabled(), "agents": agents.get_profiles()}


@router.put("/api/agent/specialists")
def switch_specialists(data: SpecialistsSwitch):
    from services import agents
    agents.set_specialists_enabled(data.enabled)
    return {"enabled": agents.specialists_enabled(), "agents": agents.get_profiles()}


@router.patch("/api/agent/specialists/{key}")
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


@router.get("/api/agent/metrics")
def agent_metrics(days: int = Query(7, ge=1, le=90)):
    """Métricas del agente: conversaciones, automatización, ventas, proactividad, tiempos, tokens y costo estimado."""
    from services.metrics_service import metrics_service
    return metrics_service.summary(days)


@router.get("/api/agent/prices")
def ai_prices():
    from services.metrics_service import metrics_service
    return {"prices": metrics_service.prices(), "active_model": ai_service.active_model}


@router.put("/api/agent/prices")
def update_ai_price(data: PriceUpdate):
    from services.metrics_service import metrics_service
    try:
        return {"prices": metrics_service.save_price(data.model, data.input, data.output, data.cached)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/agent/weekly-report")
def weekly_report():
    from services.metrics_service import metrics_service
    return {"config": metrics_service.report_config(), "preview": metrics_service.weekly_report_text()}


@router.put("/api/agent/weekly-report")
def update_weekly_report(data: ReportConfig):
    from services.metrics_service import metrics_service
    cfg = metrics_service.save_report_config(data.model_dump(exclude_none=True))
    return {"config": cfg, "preview": metrics_service.weekly_report_text()}


@router.post("/api/agent/weekly-report/send")
def send_weekly_report():
    """Envía el reporte ahora mismo al WhatsApp del dueño (para probarlo)."""
    from services.metrics_service import metrics_service
    try:
        ok = metrics_service.send_weekly()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=502, detail=whatsapp_service.last_send_error or "No se pudo enviar por WhatsApp.")
    return {"status": "sent"}


@router.get("/api/agent/tool-policies")
def tool_policies():
    """Acciones del agente y su regla: automático, pedir aprobación o apagada."""
    from services import agent_tools
    return {"tools": agent_tools.describe_tools()}


class ToolPolicyUpdate(BaseModel):
    policy: str = Field(..., pattern="^(auto|approve|off)$")


@router.put("/api/agent/tool-policies/{tool_name}")
def update_tool_policy(tool_name: str, data: ToolPolicyUpdate):
    from services import agent_tools
    try:
        agent_tools.set_policy(tool_name, data.policy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"tools": agent_tools.describe_tools()}


@router.post("/api/customers/{customer_id}/summary")
def refresh_customer_summary(customer_id: int):
    """Vuelve a analizar la conversación ahora mismo y actualiza resumen, datos clave, etapa y etiquetas."""
    customer = customer_service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    updated = customer_service.refresh_summary(customer["session_id"])
    if updated is None or updated.get("summary_updated_at") == customer.get("summary_updated_at"):
        raise HTTPException(status_code=502, detail="La IA no pudo generar el resumen. Revisa las claves de IA.")
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


@router.get("/api/agent/playbooks")
def list_playbooks():
    return {"playbooks": automation_service.list_playbooks(), "guardrails": automation_service.guardrails(),
            "quiet_now": automation_service.in_quiet_hours()}


@router.patch("/api/agent/playbooks/{key}")
def update_playbook(key: str, data: PlaybookUpdate):
    try:
        return {"playbook": automation_service.update_playbook(key, data.enabled, data.mode, data.params)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/agent/guardrails")
def update_guardrails(data: GuardrailsUpdate):
    return {"guardrails": automation_service.save_guardrails(data.model_dump(exclude_none=True))}


@router.get("/api/agent/tasks")
def list_agent_tasks(status_filter: Optional[str] = Query(None, alias="status"), limit: int = Query(100, ge=1, le=500)):
    return {"tasks": automation_service.list_tasks(status=status_filter, limit=limit), "counts": automation_service.counts()}


@router.post("/api/agent/tasks/{task_id}/approve")
def approve_agent_task(task_id: int, data: TaskDecision):
    """Aprueba (y opcionalmente edita) el mensaje. Se envía al instante, salvo en horario de silencio."""
    try:
        return {"task": automation_service.approve(task_id, data.message, data.actor or "Admin")}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/agent/tasks/{task_id}/reject")
def reject_agent_task(task_id: int, data: TaskDecision):
    try:
        return {"task": automation_service.reject(task_id, data.actor or "Admin")}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/agent/scan")
def run_agent_scan():
    """Revisa las automatizaciones ahora mismo (sin esperar al ciclo automático)."""
    return {"result": automation_service.scan()}


@router.get("/api/modules")
def list_system_modules():
    """Retorna la lista de todos los módulos disponibles con su estado (instalado/disponible)."""
    return module_registry.get_modules_with_status(db_service)

@router.post("/api/modules/{module_id}/install")
def install_system_module(module_id: str):
    """Instala un módulo del ecosistema (crea tablas y activa rutas/capacidades)."""
    try:
        manifest = module_registry.install(module_id, db_service, app)
        return {"status": "installed", "module": manifest}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error instalando módulo {module_id}: {e}")
        raise HTTPException(status_code=500, detail=f"No se pudo instalar el módulo: {e}")

@router.post("/api/modules/{module_id}/uninstall")
def uninstall_system_module(module_id: str):
    """Desinstala un módulo del ecosistema (desactiva rutas conservando datos)."""
    try:
        module_registry.uninstall(module_id, db_service)
        return {"status": "uninstalled", "module_id": module_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error desinstalando módulo {module_id}: {e}")
        raise HTTPException(status_code=500, detail=f"No se pudo desinstalar el módulo: {e}")

app.include_router(router)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG
    )
