"""Rutas API para Facturación & DTE El Salvador."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from services.auth_service import require_auth
from modules.invoicing.models import InvoiceCreate, HaciendaConfigUpdate
from modules.invoicing.service import invoicing_service

logger = logging.getLogger("asistente_operativo.modules.invoicing")

router = APIRouter(prefix="/api/invoicing", tags=["Facturación & DTE"], dependencies=[Depends(require_auth)])


@router.get("/invoices")
def list_invoices(limit: int = Query(default=100, ge=1, le=500), dte_type: Optional[str] = None):
    try:
        return {"invoices": invoicing_service.list_invoices(limit=limit, dte_type=dte_type)}
    except Exception as e:
        logger.error(f"Error listando facturas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int):
    invoice = invoicing_service.get_invoice(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada.")
    return invoice


@router.post("/invoices", status_code=201)
def create_invoice(data: InvoiceCreate):
    try:
        invoice = invoicing_service.create_invoice(data.model_dump())
        return invoice
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error emitiendo factura: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
def get_config():
    try:
        return invoicing_service.get_config()
    except Exception as e:
        logger.error(f"Error obteniendo configuración de facturación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config")
def update_config(data: HaciendaConfigUpdate):
    try:
        updated = invoicing_service.save_config(data.model_dump(exclude_unset=True))
        return updated
    except Exception as e:
        logger.error(f"Error guardando configuración de facturación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
def get_stats():
    try:
        return invoicing_service.get_stats()
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de facturación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invoices/{invoice_id}/print")
def print_invoice(invoice_id: int):
    invoice = invoicing_service.get_invoice(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Factura no encontrada.")
    try:
        from modules.registry import module_registry
        from services.db_service import db_service
        if "iot_printing" in module_registry.get_installed(db_service):
            from modules.iot_printing.service import iot_printing_service
            success = iot_printing_service.print_invoice(invoice)
            return {"success": success, "message": "Impresión enviada a la impresora de caja."}
        return {"success": False, "message": "El módulo de impresión IoT no está instalado. Usa impresión directa del navegador."}
    except Exception as e:
        logger.error(f"Error imprimiendo factura: {e}")
        raise HTTPException(status_code=500, detail=str(e))

