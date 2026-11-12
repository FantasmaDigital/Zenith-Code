"""Router FastAPI para el módulo Servicios Profesionales."""
import json
import logging
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException

from modules.services.models import (
    ServiceCreate, ServiceUpdate, BulkServicesCreate, ExtractRequest,
    LeadCreate, LeadUpdate,
    ProposalCreate, ProposalUpdate,
    ServicesConfigUpdate,
)
from modules.services.service import prof_services_service

try:
    from services.auth_service import require_auth
except ImportError:
    async def require_auth():
        return {}

try:
    from services.knowledge_service import knowledge_service
    from services.gemini_service import gemini_service
    from services.scraper_service import scraper_service
except ImportError:
    knowledge_service = None
    gemini_service = None
    scraper_service = None

logger = logging.getLogger("asistente_operativo.modules.services")

router = APIRouter(prefix="/api/services", tags=["Servicios Profesionales"])


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.get("/config")
async def get_config(_=Depends(require_auth)):
    cfg = prof_services_service.get_config()
    fallbacks = prof_services_service.get_profile_fallbacks()
    return {**cfg, "_profile_fallbacks": fallbacks}


@router.put("/config")
async def save_config(body: ServicesConfigUpdate, _=Depends(require_auth)):
    return prof_services_service.save_config(body.dict(exclude_none=True))


# ---------------------------------------------------------------------------
# Servicios ofrecidos & Extracción IA
# ---------------------------------------------------------------------------

@router.get("/services")
async def list_services(_=Depends(require_auth)):
    return prof_services_service.list_services()


@router.post("/services", status_code=201)
async def add_service(body: ServiceCreate, _=Depends(require_auth)):
    return prof_services_service.add_service(body.dict())


@router.post("/services/bulk", status_code=201)
async def add_services_bulk(body: BulkServicesCreate, _=Depends(require_auth)):
    data = [s.dict() for s in body.services]
    return prof_services_service.add_services_bulk(data)


@router.patch("/services/{service_id}")
async def update_service(service_id: int, body: ServiceUpdate, _=Depends(require_auth)):
    result = prof_services_service.update_service(service_id, body.dict(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return result


@router.delete("/services/{service_id}", status_code=204)
async def delete_service(service_id: int, _=Depends(require_auth)):
    prof_services_service.delete_service(service_id)


@router.post("/extract")
async def extract_services_from_content(body: ExtractRequest, _=Depends(require_auth)):
    """Extrae servicios estructurados a partir de un sitio web o de la base de conocimiento."""
    text_content = ""
    source_title = ""

    if body.source == "url":
        if not body.url or not body.url.strip():
            raise HTTPException(status_code=400, detail="Debes proporcionar una URL válida para analizar.")
        target_url = body.url.strip()
        if not target_url.startswith("http://") and not target_url.startswith("https://"):
            target_url = f"https://{target_url}"
        try:
            if not scraper_service:
                raise HTTPException(status_code=500, detail="Servicio de scraping no disponible.")
            scraped = scraper_service.scrape_url(target_url)
            text_content = scraped.get("text", "") or scraped.get("content", "")
            source_title = scraped.get("title", target_url)
        except Exception as e:
            logger.error(f"Error scraping {target_url}: {e}")
            raise HTTPException(status_code=424, detail=f"No se pudo acceder al sitio web: {str(e)}")
    else:
        # Extraer de documentos de la base de conocimiento
        try:
            if not knowledge_service:
                raise HTTPException(status_code=500, detail="Servicio de conocimiento no disponible.")
            docs = knowledge_service.list_documents()
            if body.doc_ids:
                docs = [d for d in docs if d.get("id") in body.doc_ids]

            if not docs:
                raise HTTPException(
                    status_code=400,
                    detail="No se encontraron documentos en la Base de Conocimiento. Ingresa una URL directa para analizar tu sitio web."
                )

            parts = []
            for d in docs:
                t = d.get("title", "Documento")
                c = d.get("content", "")
                if c.strip():
                    parts.append(f"--- Documento: {t} ---\n{c}")
            text_content = "\n\n".join(parts)
            source_title = f"{len(docs)} documento(s) de Base de Conocimiento"
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error reading knowledge docs: {e}")
            raise HTTPException(status_code=500, detail="Error leyendo documentos de conocimiento.")

    if not text_content or len(text_content.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="El contenido obtenido es insuficiente para detectar servicios. Verifica que la página contenga texto sobre tu oferta o ingresa una URL con tus servicios."
        )

    sample_text = text_content[:25000]

    if not gemini_service:
        raise HTTPException(status_code=500, detail="Servicio de IA no disponible.")

    client = gemini_service._get_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Motor de IA (Gemini) no configurado o clave de API no disponible."
        )

    system_instruction = (
        "Eres un consultor senior experto en catalogación de servicios empresariales y software. "
        "Analiza minuciosamente el texto provisto y extrae una lista estructurada de todos los servicios "
        "o soluciones que la empresa ofrece comercialmente a sus clientes. "
        "NO inventes servicios que no aparezcan ni se deduzcan claramente del contenido. "
        "Devuelve ÚNICAMENTE un array JSON válido de objetos con este formato exacto:\n"
        "[\n"
        "  {\n"
        "    \"name\": \"Nombre formal del servicio (ej. Desarrollo Web Full-Stack)\",\n"
        "    \"category\": \"Categoría clara (ej. Desarrollo Web, Móvil, Cloud, Consultoría, etc.)\",\n"
        "    \"description\": \"Resumen conciso del alcance, tecnologías o entregables\",\n"
        "    \"price_min\": 500, // número o null si no se menciona precio\n"
        "    \"price_max\": 3000, // número o null si no se menciona precio\n"
        "    \"duration_days\": 30 // número de días estimados o null\n"
        "  }\n"
        "]"
    )

    prompt = (
        f"Contenido del sitio web / documentación ({source_title}):\n\n"
        f"{sample_text}\n\n"
        "Extrae todos los servicios comerciales ofrecidos en el texto anterior."
    )

    try:
        response = client.models.generate_content(
            model=gemini_service.model,
            contents=prompt,
            config={
                "system_instruction": system_instruction,
                "response_mime_type": "application/json",
                "temperature": 0.2
            }
        )
        raw_json = response.text.strip()
        extracted = json.loads(raw_json)
        if isinstance(extracted, dict) and "services" in extracted:
            extracted = extracted["services"]
        if not isinstance(extracted, list):
            extracted = [extracted]
        return {
            "source": body.source,
            "source_title": source_title,
            "count": len(extracted),
            "services": extracted
        }
    except Exception as e:
        logger.error(f"Error generando servicios con Gemini: {e}")
        raise HTTPException(status_code=500, detail=f"Error en la extracción con IA: {str(e)}")


# ---------------------------------------------------------------------------
# Leads / CRM
# ---------------------------------------------------------------------------

@router.get("/leads")
async def list_leads(_=Depends(require_auth)):
    return prof_services_service.list_leads()


@router.get("/leads/{lead_id}/conversation")
async def get_lead_conversation(lead_id: int, _=Depends(require_auth)):
    lead = prof_services_service.get_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    messages = prof_services_service.get_lead_messages(lead_id)
    return {
        "lead": lead,
        "session_id": lead.get("session_id"),
        "conversation_text": lead.get("conversation_text"),
        "messages": messages
    }


@router.post("/leads", status_code=201)
async def add_lead(body: LeadCreate, _=Depends(require_auth)):
    return prof_services_service.add_lead(body.dict())


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: int, body: LeadUpdate, _=Depends(require_auth)):
    result = prof_services_service.update_lead(lead_id, body.dict(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return result


@router.delete("/leads/{lead_id}", status_code=204)
async def delete_lead(lead_id: int, _=Depends(require_auth)):
    prof_services_service.delete_lead(lead_id)


# ---------------------------------------------------------------------------
# Propuestas
# ---------------------------------------------------------------------------

@router.get("/proposals")
async def list_proposals(_=Depends(require_auth)):
    return prof_services_service.list_proposals()


@router.post("/proposals", status_code=201)
async def add_proposal(body: ProposalCreate, _=Depends(require_auth)):
    return prof_services_service.add_proposal(body.dict())


@router.patch("/proposals/{proposal_id}")
async def update_proposal(proposal_id: int, body: ProposalUpdate, _=Depends(require_auth)):
    result = prof_services_service.update_proposal(proposal_id, body.dict(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")
    return result


@router.delete("/proposals/{proposal_id}", status_code=204)
async def delete_proposal(proposal_id: int, _=Depends(require_auth)):
    prof_services_service.delete_proposal(proposal_id)


# ---------------------------------------------------------------------------
# Estadísticas
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_stats(_=Depends(require_auth)):
    return prof_services_service.get_stats()
