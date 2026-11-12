"""Modelos Pydantic para el módulo Servicios Profesionales."""
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Extra


# ---------------------------------------------------------------------------
# Servicios ofrecidos
# ---------------------------------------------------------------------------

class ServiceCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    category: Optional[str] = "General"
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    duration_days: Optional[int] = None
    is_active: Optional[bool] = True


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    duration_days: Optional[int] = None
    is_active: Optional[bool] = None


class BulkServicesCreate(BaseModel):
    services: List[ServiceCreate]


class ExtractRequest(BaseModel):
    source: str = "knowledge"  # "knowledge" o "url"
    url: Optional[str] = None
    doc_ids: Optional[List[int]] = None


# ---------------------------------------------------------------------------
# Leads / CRM
# ---------------------------------------------------------------------------

LEAD_STATUSES = ["nuevo", "contactado", "propuesta", "negociacion", "cliente", "perdido"]

class LeadCreate(BaseModel):
    name: str
    company: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    service_interest: Optional[str] = ""
    status: Optional[str] = "nuevo"
    source: Optional[str] = "manual"
    notes: Optional[str] = ""


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    service_interest: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Propuestas
# ---------------------------------------------------------------------------

PROPOSAL_STATUSES = ["borrador", "enviada", "aceptada", "rechazada"]

class ProposalCreate(BaseModel):
    lead_id: int
    title: Optional[str] = ""
    services: Optional[str] = ""   # JSON lista de servicios seleccionados (nombres + precios)
    total_amount: Optional[float] = 0.0
    valid_days: Optional[int] = 14
    status: Optional[str] = "borrador"
    notes: Optional[str] = ""


class ProposalUpdate(BaseModel):
    title: Optional[str] = None
    services: Optional[str] = None
    total_amount: Optional[float] = None
    valid_days: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Configuración Enterprise del Módulo
# ---------------------------------------------------------------------------

class ServicesConfigUpdate(BaseModel):
    # Identidad Comercial
    business_type: Optional[str] = None
    business_name: Optional[str] = None
    tagline: Optional[str] = None
    website: Optional[str] = None
    portfolio_url: Optional[str] = None
    work_mode: Optional[str] = None
    currency: Optional[str] = None

    # Agente IA Comercial (ARM)
    response_style: Optional[str] = None
    ai_pitch: Optional[str] = None
    contact_cta: Optional[str] = None
    meeting_link: Optional[str] = None
    ai_greeting: Optional[str] = None
    special_instructions: Optional[str] = None
    show_prices: Optional[bool] = None
    show_duration: Optional[bool] = None
    mention_stack: Optional[bool] = None

    # Calificación de Leads
    ask_budget: Optional[bool] = None
    ask_timeline: Optional[bool] = None
    ask_requirements: Optional[bool] = None
    min_project_budget: Optional[float] = None

    # Modelo Comercial y Cobro
    pricing_models: Optional[List[str]] = None
    payment_terms: Optional[str] = None
    warranty_days: Optional[int] = None

    # Horarios Comerciales
    work_days: Optional[str] = None
    work_hours: Optional[str] = None
    timezone: Optional[str] = None
    out_of_hours_msg: Optional[str] = None

    class Config:
        extra = Extra.allow
