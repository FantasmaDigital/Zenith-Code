"""Rutas API para el módulo de Caja & Finanzas."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from services.auth_service import require_auth

from modules.finance.models import (
    CategoryCreate, CategoryUpdate, ReceiptUpload, ShiftCloseRequest, ShiftOpenRequest, TransactionCreate,
    TransactionVoid,
)
from modules.finance.service import finance_service

logger = logging.getLogger("asistente_operativo.modules.finance")

# Datos financieros: todas las rutas exigen sesión de administrador
router = APIRouter(prefix="/api/finance", tags=["Caja & Finanzas"], dependencies=[Depends(require_auth)])


# ------------------------------------------------------------------
# TURNOS Y CORTES DE CAJA
# ------------------------------------------------------------------
@router.get("/shifts/current")
def get_current_shift():
    """Retorna el turno de caja abierto actual o null si la caja está cerrada."""
    shift = finance_service.get_current_shift()
    return {"shift": shift, "is_open": shift is not None}


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


@router.post("/shifts/open")
def open_shift(data: ShiftOpenRequest, request: Request):
    """Abre un nuevo turno de caja con fondo inicial."""
    try:
        shift = finance_service.open_shift(
            opened_by=data.opened_by,
            initial_cash=data.initial_cash,
            notes=data.notes,
            client_ip=_ip(request)
        )
        return {"status": "opened", "shift": shift}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error abriendo turno de caja: {e}")
        raise HTTPException(status_code=500, detail="Error interno al abrir turno.")


@router.post("/shifts/close")
def close_shift(data: ShiftCloseRequest, request: Request):
    """Cierra el turno de caja actual (Corte Z), calcula la diferencia física y congela el arqueo."""
    try:
        shift = finance_service.close_shift(
            counted_cash=data.counted_cash,
            notes=data.notes,
            closed_by=data.closed_by or "Admin",
            client_ip=_ip(request),
            denominations=data.denominations
        )
        return {"status": "closed", "shift": shift}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error cerrando turno de caja: {e}")
        raise HTTPException(status_code=500, detail="Error interno al cerrar turno.")


@router.get("/shifts")
def list_shifts(limit: int = Query(default=30, ge=1, le=200)):
    """Historial de turnos y cortes de caja anteriores."""
    shifts = finance_service.list_shifts(limit=limit)
    return {"shifts": shifts}


@router.get("/shifts/current/ticket")
def get_current_shift_ticket():
    """Retorna el ticket térmico preliminar (Corte X) del turno abierto."""
    txt = finance_service.get_shift_ticket(None)
    return Response(content=txt, media_type="text/plain; charset=utf-8")


@router.get("/shifts/{shift_id}")
def get_shift_detail(shift_id: int):
    """Detalle de un turno específico."""
    shift = finance_service.get_shift(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Turno no encontrado.")
    return {"shift": shift}


@router.get("/shifts/{shift_id}/ticket")
def get_shift_ticket(shift_id: int):
    """Retorna el ticket térmico de 80mm de Corte de Caja."""
    txt = finance_service.get_shift_ticket(shift_id)
    return Response(content=txt, media_type="text/plain; charset=utf-8")


# ------------------------------------------------------------------
# LIBRO DE TRANSACCIONES / MOVIMIENTOS
# ------------------------------------------------------------------
@router.get("/transactions")
def list_transactions(
    limit: int = Query(default=200, ge=1, le=500),
    shift_id: Optional[int] = None,
    type: Optional[str] = None,
    payment_method: Optional[str] = None,
    source_module: Optional[str] = None,
    start: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
):
    """Lista las transacciones registradas con filtros opcionales."""
    try:
        txs = finance_service.list_transactions(
            limit=limit,
            shift_id=shift_id,
            type=type,
            payment_method=payment_method,
            source_module=source_module,
            start=start,
            end=end
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"transactions": txs}


@router.post("/transactions")
def create_transaction(data: TransactionCreate, request: Request):
    """Registra un movimiento manual (ingreso extraordinario o gasto operativo)."""
    try:
        tx = finance_service.record_transaction(
            type=data.type,
            category=data.category,
            amount=data.amount,
            payment_method=data.payment_method,
            source_module=data.source_module or "manual",
            source_reference_id=data.source_reference_id,
            description=data.description,
            created_by=data.created_by or "Admin",
            client_ip=_ip(request)
        )
        return {"status": "created", "transaction": tx}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creando transacción: {e}")
        raise HTTPException(status_code=500, detail="Error interno al registrar movimiento.")


@router.post("/transactions/{tx_id}/void")
def void_transaction(tx_id: int, data: TransactionVoid, request: Request):
    """Anula un movimiento manual del turno abierto. Nunca se borra: queda en el libro marcado como anulado."""
    try:
        tx = finance_service.void_transaction(tx_id, reason=data.reason, voided_by=data.voided_by or "Admin",
                                             client_ip=_ip(request))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada.")
    return {"status": "voided", "transaction": tx}


# ------------------------------------------------------------------
# RESUMEN Y REPORTES
# ------------------------------------------------------------------
@router.get("/summary")
def get_financial_summary(days: int = Query(default=30, ge=1, le=365)):
    """Resumen consolidado para dashboard financiero."""
    return finance_service.get_summary(days=days)


@router.get("/reports")
def get_report(
    start: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")
):
    """Estado de resultados del rango (fechas locales), por mes y categoría, comparado con el período anterior."""
    try:
        return finance_service.get_report(start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------
# CATEGORÍAS
# ------------------------------------------------------------------
@router.get("/categories")
def list_categories(include_inactive: bool = False):
    return {"categories": finance_service.list_categories(include_inactive=include_inactive)}


@router.post("/categories")
def create_category(data: CategoryCreate):
    try:
        return {"category": finance_service.create_category(data.label, data.type)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/categories/{key}")
def update_category(key: str, data: CategoryUpdate):
    try:
        cat = finance_service.update_category(key, label=data.label, active=data.active)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada.")
    return {"category": cat}


# ------------------------------------------------------------------
# COMPROBANTES
# ------------------------------------------------------------------
@router.put("/transactions/{tx_id}/receipt")
def upload_receipt(tx_id: int, data: ReceiptUpload, request: Request):
    try:
        tx = finance_service.set_receipt(tx_id, data.data_url, data.filename or "", client_ip=_ip(request))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada.")
    return {"transaction": tx}


@router.get("/transactions/{tx_id}/receipt")
def get_receipt(tx_id: int):
    receipt = finance_service.get_receipt(tx_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Este movimiento no tiene comprobante.")
    return receipt


@router.get("/audit")
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    entity: Optional[str] = Query(default=None, pattern="^(shift|transaction|category)$"),
    entity_id: Optional[int] = None
):
    """Bitácora de auditoría: aperturas, cierres, movimientos y anulaciones con usuario, IP y fecha."""
    return {"entries": finance_service.list_audit(limit=limit, entity=entity, entity_id=entity_id)}


@router.post("/sync-restaurant")
def sync_restaurant_sales():
    """Sincroniza retroactivamente órdenes de restaurante ya pagadas que falten en el libro contable."""
    count = finance_service.sync_unrecorded_restaurant_sales()
    return {"status": "synced", "count": count}

