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

@app.get("/")
def read_root():
    gateway_status = whatsapp_service.get_status()
    kb_stats = knowledge_service.get_stats()
    return {
        "status": "online",
        "agent": "Asistente Operativo",
        "company": settings.COMPANY_NAME,
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
    """Devuelve la configuración de marca, proveedor y claves de IA."""
    return {
        "company_name": settings.COMPANY_NAME,
        "bot_name": settings.BOT_NAME,
        "bot_tone": settings.BOT_TONE,
        "brand_instructions": settings.BRAND_INSTRUCTIONS,
        "ai_provider": settings.AI_PROVIDER,
        "gemini_api_key": settings.GEMINI_API_KEY,
        "gemini_model": settings.GEMINI_MODEL,
        "openai_api_key": settings.OPENAI_API_KEY,
        "openai_model": settings.OPENAI_MODEL
    }

@app.post("/api/settings")
def update_app_settings(req: UpdateSettingsRequest):
    """Actualiza en caliente la configuración de marca, proveedor y API keys."""
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

    settings.update_settings(updates)
    # Refrescar caché de conocimiento por si cambiaron instrucciones de marca
    knowledge_service.refresh_cache()
    logger.info("⚙️ Configuración de marca e IA actualizada con éxito.")
    return {"status": "updated", "settings": get_app_settings()}

# ==============================================================
# ENDPOINT DE CHAT / PROCESAMIENTO DE IA (USADO POR BAILEYS Y WEB)
# ==============================================================
@app.post("/chat", response_model=ChatResponse)
def chat_direct(request: ChatRequest):
    """
    Procesa un mensaje de usuario a través del motor de IA (Gemini / OpenAI),
    inyectando el In-Memory Hot Cache en menos de 1 ms.
    """
    if not request.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El mensaje no puede estar vacío."
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

    reply_text = ai_service.generate_reply(session_id=from_number, user_message=user_text)
    whatsapp_service.send_text_message(to_phone=from_number, message_text=reply_text)

    return JSONResponse(content={
        "status": "processed",
        "to": from_number,
        "reply": reply_text
    }, status_code=status.HTTP_200_OK)

# ==============================================================
# ENVÍO PROACTIVO DE MENSAJES VÍA GATEWAY
# ==============================================================
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

@app.get("/gateway-status")
def check_gateway_status():
    return whatsapp_service.get_status()

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
