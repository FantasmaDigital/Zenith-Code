"""Rutas del módulo de Tarjetas de Fidelidad: panel (con login) y vista pública de la tarjeta (sin login)."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from services.auth_service import current_claims, require_auth
from services.tenant_service import FEATURE_LOYALTY, normalize_slug, tenant_context, tenant_registry
from modules.loyalty.models import (
    AdjustRequest, CardCreate, CardUpdate, CodeRequest, EarnRequest, ProgramCreate, ProgramUpdate, RedeemRequest,
    RewardCreate, RewardUpdate, StampAutoRequest, VerifyRequest,
)
from modules.loyalty import notify
from modules.loyalty.service import LoyaltyError, loyalty_service

logger = logging.getLogger("asistente_operativo.modules.loyalty")

router = APIRouter(prefix="/api/loyalty", tags=["Tarjetas de Fidelidad"], dependencies=[Depends(require_auth)])
public_router = APIRouter(prefix="/api/public/loyalty", tags=["Tarjetas de Fidelidad (público)"])


def _user(authorization: Optional[str]) -> str:
    """Quién hizo el movimiento (queda en el historial de la tarjeta)."""
    claims = current_claims(authorization) or {}
    if claims.get("uid") is not None:
        try:
            from services.user_service import user_service
            user = user_service.get_user(str(claims["tenant"]), int(claims["uid"])) or {}
            return str(user.get("name") or user.get("email") or user.get("phone") or f"Usuario {claims['uid']}")[:160]
        except Exception:
            return f"Usuario {claims['uid']}"
    if claims:
        return "Plataforma" if claims.get("sa") else "Administrador"
    return "Sistema"


def _card_link(request: Request, card: dict) -> str:
    """Enlace público de la tarjeta para el comprobante. Solo se usa el Origin si es un origen permitido del panel."""
    from config import settings
    from services.tenant_service import current_tenant
    origin = (request.headers.get("origin") or "").rstrip("/")
    if not origin or origin not in [o.rstrip("/") for o in settings.ALLOWED_ORIGINS]:
        return ""
    return f"{origin}/?tarjeta={card['public_token']}&empresa={current_tenant()}"


def _receipt(request: Request, card_id: int, result: dict, kind: str) -> None:
    if result.get("duplicate"):
        return
    card = loyalty_service.get_card(card_id)
    if card:
        notify.send_receipt_async(card_id, result, kind, _card_link(request, card))


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LoyaltyError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------
# PROGRAMAS
# ------------------------------------------------------------------
@router.get("/programs")
def list_programs():
    return {"programs": loyalty_service.list_programs()}


@router.post("/programs", status_code=201)
def create_program(data: ProgramCreate):
    return _guard(loyalty_service.create_program, data.model_dump())


@router.patch("/programs/{program_id}")
def update_program(program_id: int, data: ProgramUpdate):
    return _guard(loyalty_service.update_program, program_id, data.model_dump())


# ------------------------------------------------------------------
# TARJETAS
# ------------------------------------------------------------------
@router.get("/cards")
def list_cards(program_id: Optional[int] = None, search: str = Query("", max_length=100),
               status: str = Query("", pattern="^(|active|blocked)$"),
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    return {"cards": loyalty_service.list_cards(program_id, search, status, limit, offset)}


@router.get("/cards/lookup")
def lookup_card(q: str = Query(..., min_length=1, max_length=100)):
    card = loyalty_service.find_card(q)
    if not card:
        raise HTTPException(status_code=404, detail="No se encontró ninguna tarjeta con ese código o teléfono.")
    return card


@router.post("/cards", status_code=201)
def create_card(data: CardCreate):
    return _guard(loyalty_service.create_card, data.model_dump())


@router.get("/cards/{card_id}")
def get_card(card_id: int):
    card = loyalty_service.get_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada.")
    return {**card, "transactions": loyalty_service.card_transactions(card_id)}


@router.patch("/cards/{card_id}")
def update_card(card_id: int, data: CardUpdate):
    return _guard(loyalty_service.update_card, card_id, data.model_dump())


@router.post("/cards/{card_id}/earn")
def earn(card_id: int, data: EarnRequest, request: Request, authorization: Optional[str] = Header(default=None)):
    result = _guard(loyalty_service.earn, card_id, data.purchase_amount, data.reference, data.notes,
                    _user(authorization))
    _receipt(request, card_id, result, "earn")
    return result


@router.post("/cards/{card_id}/redeem")
def redeem(card_id: int, data: RedeemRequest, request: Request, authorization: Optional[str] = Header(default=None)):
    result = _guard(loyalty_service.redeem, card_id, data.reward_id, data.reference, data.notes, _user(authorization))
    _receipt(request, card_id, result, "redeem")
    return result


@router.post("/cards/{card_id}/adjust")
def adjust(card_id: int, data: AdjustRequest, authorization: Optional[str] = Header(default=None)):
    return _guard(loyalty_service.adjust, card_id, data.delta, data.reason, _user(authorization))


# ------------------------------------------------------------------
# RECOMPENSAS Y REPORTES
# ------------------------------------------------------------------
@router.get("/rewards")
def list_rewards(program_id: Optional[int] = None):
    return {"rewards": loyalty_service.list_rewards(program_id)}


@router.post("/rewards", status_code=201)
def create_reward(data: RewardCreate):
    return _guard(loyalty_service.create_reward, data.model_dump())


@router.patch("/rewards/{reward_id}")
def update_reward(reward_id: int, data: RewardUpdate):
    return _guard(loyalty_service.update_reward, reward_id, data.model_dump())


@router.get("/programs/{program_id}/qr")
def program_qr(program_id: int):
    """QR fijo para imprimir y pegar en el local (programas por sellos)."""
    return {"qr_token": _guard(loyalty_service.program_qr_token, program_id), "channels": notify.channels()}


@router.post("/programs/{program_id}/qr/regenerate")
def regenerate_program_qr(program_id: int):
    """Invalida el QR impreso (p. ej. si alguien lo compartió) y crea otro: habrá que reimprimirlo."""
    return {"qr_token": _guard(loyalty_service.program_qr_token, program_id, True)}


@router.get("/requests")
def pending_requests():
    """Solicitudes de sello esperando aprobación en caja (el panel las consulta cada pocos segundos)."""
    return {"requests": loyalty_service.pending_requests()}


@router.post("/requests/{request_id}/approve")
def approve_request(request_id: int, request: Request, authorization: Optional[str] = Header(default=None)):
    result = _guard(loyalty_service.decide_request, request_id, True, _user(authorization))
    _receipt(request, result["card_id"], result, "earn")
    return result


@router.post("/requests/{request_id}/reject")
def reject_request(request_id: int, authorization: Optional[str] = Header(default=None)):
    return _guard(loyalty_service.decide_request, request_id, False, _user(authorization))


@router.get("/stats")
def stats(program_id: Optional[int] = None):
    return loyalty_service.stats(program_id)


# ------------------------------------------------------------------
# VISTA PÚBLICA (enlace que recibe el cliente final)
# ------------------------------------------------------------------
def _public_tenant(tenant: str):
    """Valida la empresa de la URL pública; devuelve su slug o lanza 404."""
    from modules.registry import module_registry
    slug = normalize_slug(tenant)
    not_found = HTTPException(status_code=404, detail="No encontrado.")
    if not tenant_registry.is_active(slug) or not tenant_registry.has_feature(slug, FEATURE_LOYALTY):
        raise not_found
    with tenant_context(slug):
        if not module_registry.is_loaded("loyalty"):
            raise not_found
    return slug


def _with_card(out: dict) -> dict:
    """Agrega la tarjeta dibujable (con la marca de la empresa) a una respuesta pública."""
    if out.get("needs_name") or out.get("needs_verification") or not out.get("card_token"):
        return out
    view = loyalty_service.public_view(out["card_token"]) or {}
    view["company"] = _company_branding()
    return {**out, "card": view}


@public_router.get("/{tenant}/stamp/{qr_token}")
def public_stamp_info(tenant: str, qr_token: str):
    """Lo que ve el cliente al escanear el QR impreso: el programa y cómo puede identificarse."""
    slug = _public_tenant(tenant)
    with tenant_context(slug):
        program = loyalty_service.program_by_qr(qr_token)
        if not program:
            raise HTTPException(status_code=404, detail="Este código QR ya no es válido.")
        return {"program": {"name": program["name"], "stamps_goal": program["stamps_goal"],
                            "reward_description": program["reward_description"]},
                "company": _company_branding(), "channels": notify.channels()}


@public_router.post("/{tenant}/stamp/{qr_token}")
def public_stamp_saved(tenant: str, qr_token: str, data: StampAutoRequest):
    """Teléfono con tarjeta ya identificada: crea la solicitud de sello (la aprueba el cajero)."""
    slug = _public_tenant(tenant)
    with tenant_context(slug):
        return _with_card(_guard(loyalty_service.request_from_saved_card, qr_token, data.card_tokens))


@public_router.post("/{tenant}/stamp/{qr_token}/code")
def public_stamp_code(tenant: str, qr_token: str, data: CodeRequest):
    """Envía el código de verificación al correo o WhatsApp del cliente (si hay canal para hacerlo)."""
    slug = _public_tenant(tenant)
    with tenant_context(slug):
        program = loyalty_service.program_by_qr(qr_token)
        if not program:
            raise HTTPException(status_code=404, detail="Este código QR ya no es válido.")
        kind, contact = _guard(loyalty_service.normalize_contact, data.contact)
        if not loyalty_service.code_required(kind, notify.channels()):
            # Sin canal para enviar códigos: el cajero valida en persona al aprobar el sello
            return {"code_required": False}
        created = _guard(loyalty_service.create_code, program["id"], contact)
        try:
            notify.send_code(contact, created["channel"], created["code"])
        except Exception as e:
            logger.warning(f"No se pudo enviar el código de fidelidad: {e}")
            raise HTTPException(status_code=424, detail="No pudimos enviar el código. Intenta de nuevo en un momento.")
        return {"code_required": True, "sent_via": created["channel"], "contact": _mask(contact)}


@public_router.post("/{tenant}/stamp/{qr_token}/verify")
def public_stamp_verify(tenant: str, qr_token: str, data: VerifyRequest):
    """Identifica al cliente (código si aplica), crea o encuentra su tarjeta y deja la solicitud de sello."""
    slug = _public_tenant(tenant)
    with tenant_context(slug):
        out = _guard(loyalty_service.identify, qr_token, data.contact, data.code, data.customer_name,
                     notify.channels())
        return _with_card(out)


@public_router.get("/{tenant}/requests/{request_token}")
def public_request_status(tenant: str, request_token: str):
    """El teléfono del cliente consulta si el cajero ya aprobó su sello."""
    slug = _public_tenant(tenant)
    with tenant_context(slug):
        status = loyalty_service.request_status(request_token)
        if not status:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
        return _with_card(status)


def _mask(contact: str) -> str:
    if "@" in contact:
        user, _, domain = contact.partition("@")
        return f"{user[:2]}***@{domain}"
    return f"***{contact[-4:]}"


@public_router.get("/{tenant}/cards/{token}")
def public_card(tenant: str, token: str):
    """La empresa sale de la URL; el token largo y aleatorio de la tarjeta es la única credencial."""
    from modules.registry import module_registry
    slug = normalize_slug(tenant)
    not_found = HTTPException(status_code=404, detail="Tarjeta no encontrada.")
    if not tenant_registry.is_active(slug) or not tenant_registry.has_feature(slug, FEATURE_LOYALTY):
        raise not_found
    with tenant_context(slug):
        if not module_registry.is_loaded("loyalty"):
            raise not_found
        view = loyalty_service.public_view(token)
        if not view:
            raise not_found
        view["company"] = _company_branding()
        return view


def _company_branding() -> dict:
    """Nombre y color de la empresa en curso, para dibujar la tarjeta del cliente."""
    try:
        from config import settings
        settings.load_db_overrides()
        return {"name": (settings.COMPANY_NAME or "").strip(), "primary_color": (settings.PRIMARY_COLOR or "").strip()}
    except Exception as e:
        logger.debug(f"Sin marca para la tarjeta pública: {e}")
        return {}
