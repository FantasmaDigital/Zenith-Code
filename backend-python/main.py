import logging
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import uvicorn

from config import settings
from services.ai_service import ai_service
from services.whatsapp_service import whatsapp_service
from services.lead_service import lead_service
from services.knowledge_service import knowledge_service
from services.scraper_service import scraper_service

# Configuración de logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("asistente_operativo.api")

app = FastAPI(
    title=f"Asistente Operativo - {settings.COMPANY_NAME}",
    description="Backend de IA con Gestión Dinámica de Conocimiento, Scraper y WhatsApp Gateway In-House.",
    version="2.1.0"
)

# Habilitar CORS para permitir el frontend en React (Vite)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modelos para la API REST
class ChatRequest(BaseModel):
    session_id: str = Field(default="demo-user", description="ID del usuario o número de teléfono")
    message: str = Field(..., description="Mensaje enviado por el usuario")

class ChatResponse(BaseModel):
    session_id: str
    reply: str
    transferred_to_human: bool
    human_handoff_active: bool = False

class SendMessageRequest(BaseModel):
    to: str = Field(..., description="Número de teléfono de destino (ej. 50371234567)")
    message: str = Field(..., description="Texto del mensaje a enviar")

class TextKnowledgeRequest(BaseModel):
    title: str = Field(..., description="Título del documento de conocimiento")
    content: str = Field(..., description="Texto o especificaciones detalladas")
    category: str = Field(default="general", description="Categoría temática")

class UrlKnowledgeRequest(BaseModel):
    url: str = Field(..., description="URL del sitio web a scrapear e indexar")
    category: str = Field(default="sitio-web", description="Categoría temática")

class CrawlSiteRequest(BaseModel):
    url: str = Field(..., description="URL raíz del sitio a mapear")
    max_urls: int = Field(default=40, description="Límite máximo de URLs a descubrir")

class BatchIndexUrlsRequest(BaseModel):
    urls: list[str] = Field(..., description="Lista de URLs seleccionadas por el usuario")
    category: str = Field(default="sitio-web", description="Categoría temática")

class UpdateSettingsRequest(BaseModel):
    company_name: Optional[str] = Field(None, description="Nombre de la empresa o marca")
    bot_name: Optional[str] = Field(None, description="Nombre del asistente")
    bot_tone: Optional[str] = Field(None, description="Tono y estilo de comunicación")
    brand_instructions: Optional[str] = Field(None, description="Directrices especiales de la marca")
    ai_provider: Optional[str] = Field(None, description="Proveedor de IA: gemini u openai")
    gemini_api_key: Optional[str] = Field(None, description="API Key de Google Gemini")
    gemini_model: Optional[str] = Field(None, description="Modelo de Gemini")
    openai_api_key: Optional[str] = Field(None, description="API Key de OpenAI")
    openai_model: Optional[str] = Field(None, description="Modelo de OpenAI")
    whatsapp_gateway_url: Optional[str] = Field(None, description="URL del WhatsApp Gateway")
    company_logo: Optional[str] = Field(None, description="Logo de la empresa en base64 o URL")
    bot_avatar: Optional[str] = Field(None, description="Avatar del asistente en base64 o URL")
    primary_color: Optional[str] = Field(None, description="Color de acento de marca (Hex)")
    welcome_message: Optional[str] = Field(None, description="Mensaje de bienvenida inicial")
    transfer_message: Optional[str] = Field(None, description="Mensaje de derivación a humano")
    support_phone: Optional[str] = Field(None, description="Teléfono oficial de soporte/ventas")
    website_url: Optional[str] = Field(None, description="Sitio web oficial de la marca")
    handoff_inactivity_hours: Optional[float] = Field(None, description="Horas de inactividad para reanudar IA tras transferir a humano", ge=0.1, le=168.0)

class PauseHandoffRequest(BaseModel):
    session_id: str = Field(..., description="ID de sesión o número de WhatsApp")
    reason: Optional[str] = Field(default="Pausado manualmente desde el portal", description="Motivo de la pausa")
    tag: Optional[str] = Field(default="ATENCIÓN HUMANA", description="Etiqueta de categorización directa")
    notes: Optional[str] = Field(default="", description="Nota ejecutiva para el asesor")

class UpdateHandoffMetaRequest(BaseModel):
    tag: Optional[str] = Field(None, description="Nueva etiqueta del chat")
    notes: Optional[str] = Field(None, description="Nueva nota para el asesor")

@app.on_event("startup")
def startup_event():
    """Garantiza la sincronización de tablas y persistencia de settings al arrancar."""
    logger.info("Iniciando Asistente Operativo...")
    settings.load_db_overrides()
    logger.info("✅ Ajustes de marca, modelos y API keys sincronizados con la Base de Datos.")

@app.get("/")
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
@app.get("/api/knowledge")
def list_knowledge():
    """Devuelve todos los documentos y páginas web indexadas en la BD."""
    return {"items": knowledge_service.list_documents()}

@app.post("/api/knowledge/text")
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

@app.post("/api/knowledge/url")
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

@app.post("/api/knowledge/crawl")
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

@app.post("/api/knowledge/batch-urls")
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

@app.delete("/api/knowledge/{item_id}")
def delete_knowledge(item_id: int):
    """Elimina un documento de la BD y recompila el caché de IA."""
    deleted = knowledge_service.delete_document(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    return {"status": "deleted", "id": item_id}

@app.post("/api/knowledge/sync")
def sync_knowledge_cache():
    """Fuerza la recompilación en memoria RAM del Hot Cache."""
    knowledge_service.refresh_cache()
    return {"status": "synchronized", "stats": knowledge_service.get_stats()}

@app.get("/api/knowledge/stats")
def get_knowledge_stats():
    """Métricas del sistema de almacenamiento y caché."""
    return knowledge_service.get_stats()

# ==============================================================
# ENDPOINTS REST DE CONFIGURACIÓN DE MARCA Y CLAVES IA
# ==============================================================
@app.get("/api/settings")
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
        "gemini_api_key": settings.GEMINI_API_KEY,
        "gemini_model": settings.GEMINI_MODEL,
        "openai_api_key": settings.OPENAI_API_KEY,
        "openai_model": settings.OPENAI_MODEL,
        "whatsapp_gateway_url": settings.WHATSAPP_GATEWAY_URL,
        "company_logo": settings.COMPANY_LOGO,
        "bot_avatar": settings.BOT_AVATAR,
        "primary_color": settings.PRIMARY_COLOR,
        "welcome_message": settings.WELCOME_MESSAGE,
        "transfer_message": settings.TRANSFER_MESSAGE,
        "support_phone": settings.SUPPORT_PHONE,
        "effective_support_phone": settings.get_effective_support_phone(),
        "detected_whatsapp_phone": (whatsapp_service.get_status().get("phone_number") or ""),
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "website_url": settings.WEBSITE_URL,
        "database_type": kb_stats["database_type"],
        "persisted_in_db": True
    }

@app.post("/api/settings")
def update_app_settings(req: UpdateSettingsRequest):
    """Actualiza en caliente la configuración de marca, proveedor y API keys en BD y memoria."""
    updates = {}
    if req.company_name is not None: updates["COMPANY_NAME"] = req.company_name
    if req.bot_name is not None: updates["BOT_NAME"] = req.bot_name
    if req.bot_tone is not None: updates["BOT_TONE"] = req.bot_tone
    if req.brand_instructions is not None: updates["BRAND_INSTRUCTIONS"] = req.brand_instructions
    if req.ai_provider is not None: updates["AI_PROVIDER"] = req.ai_provider
    if req.gemini_api_key is not None: updates["GEMINI_API_KEY"] = req.gemini_api_key
    if req.gemini_model is not None: updates["GEMINI_MODEL"] = req.gemini_model
    if req.openai_api_key is not None: updates["OPENAI_API_KEY"] = req.openai_api_key
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

    settings.update_settings(updates)
    # Refrescar caché de conocimiento por si cambiaron instrucciones de marca
    knowledge_service.refresh_cache()
    logger.info("⚙️ Configuración de marca e IA guardada exitosamente en la Base de Datos.")
    return {"status": "updated", "persisted_in_db": True, "settings": get_app_settings()}

# ==============================================================
# ENDPOINT DE CHAT / PROCESAMIENTO DE IA (USADO POR BAILEYS Y WEB)
# ==============================================================
@app.post("/chat", response_model=ChatResponse)
def chat_direct(request: ChatRequest):
    """
    Procesa un mensaje de usuario a través del motor de IA (Gemini / OpenAI),
    inyectando el In-Memory Hot Cache en menos de 1 ms.
    Si la conversación fue derivada a un humano, la IA no responderá hasta que pasen las horas de inactividad.
    """
    if not request.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El mensaje no puede estar vacío."
        )

    # Verificar si la conversación está en manos de un agente humano activo
    is_handoff_active, remaining_hours = lead_service.is_in_human_handoff(request.session_id, touch_activity=True)
    if is_handoff_active:
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
        user_message=request.message.strip()
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
@app.post("/webhook")
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
# GESTIÓN DE AGENTES HUMANOS Y DERIVACIONES (HANDOFF)
# ==============================================================
@app.get("/api/handoff/active")
def get_active_handoffs():
    """Lista las conversaciones activas derivadas a agentes humanos."""
    return {
        "handoff_inactivity_hours": settings.HANDOFF_INACTIVITY_HOURS,
        "active_handoffs": lead_service.list_active_handoffs()
    }

@app.post("/api/handoff/{session_id}/release")
def release_session_handoff(session_id: str):
    """Reanuda inmediatamente la IA para una sesión transferida."""
    lead_service.release_handoff(session_id)
    logger.info(f"▶️ [Handoff Liberado] Sesión {session_id} liberada manualmente. IA reanudada.")
    return {"status": "released", "session_id": session_id}

@app.post("/api/handoff/release-all")
def release_all_session_handoffs():
    """Reanuda inmediatamente la IA para todas las sesiones transferidas en lote."""
    released_count = lead_service.release_all_handoffs()
    logger.info(f"▶️ [Handoff Masivo Liberado] {released_count} sesiones liberadas. IA reanudada.")
    return {"status": "released_all", "count": released_count}

@app.post("/api/handoff/{session_id}/pause")
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

@app.post("/api/handoff/pause")
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

@app.post("/api/handoff/{session_id}/update")
@app.patch("/api/handoff/{session_id}")
def update_session_handoff_meta(session_id: str, req: UpdateHandoffMetaRequest):
    """Actualiza la etiqueta y nota ejecutiva del asesor para una conversación transferida."""
    updated = lead_service.update_handoff_meta(session_id, tag=req.tag, notes=req.notes)
    logger.info(f"🏷️ [Handoff Meta Actualizado] Sesión {session_id} -> Tag: {req.tag}")
    return {"status": "updated" if updated else "noop", "session_id": session_id, "tag": req.tag, "notes": req.notes}

# ==============================================================
# ENVÍO PROACTIVO DE MENSAJES VÍA GATEWAY
# ==============================================================
@app.post("/api/whatsapp/send")
@app.post("/send")
def send_message_endpoint(request: SendMessageRequest):
    success = whatsapp_service.send_text_message(
        to_phone=request.to,
        message_text=request.message
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo enviar el mensaje a través del WhatsApp Gateway."
        )
    return {"status": "sent", "to": request.to}

@app.get("/api/whatsapp/status")
@app.get("/gateway-status")
def check_gateway_status():
    return whatsapp_service.get_status()

@app.get("/api/whatsapp/qr")
def get_whatsapp_qr():
    """Devuelve los datos del código QR y estado actual de vinculación."""
    return whatsapp_service.get_qr()

@app.post("/api/whatsapp/logout")
def logout_whatsapp():
    """Desvincula la sesión activa de WhatsApp."""
    success = whatsapp_service.logout()
    return {"success": success, "status": "DISCONNECTED"}

# ==============================================================
# GESTIÓN Y MONITOREO DE SESIONES Y LEADS
# ==============================================================
@app.get("/sessions")
def list_sessions():
    sessions = lead_service.get_all_sessions()
    return {
        "total_active_sessions": len(sessions),
        "sessions": sessions
    }

@app.delete("/sessions/{session_id}")
def reset_session(session_id: str):
    lead_service.reset_session(session_id)
    return {"status": "reset", "session_id": session_id}

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG
    )
