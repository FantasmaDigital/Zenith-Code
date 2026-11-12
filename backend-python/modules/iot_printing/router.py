"""Rutas API para Impresión IoT & Comandas."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from services.auth_service import require_auth
from modules.iot_printing.models import (
    PrinterCreate,
    PrinterUpdate,
    PrintTestRequest,
    PrintComandaRequest,
    PrintInvoiceRequest
)
from modules.iot_printing.service import iot_printing_service

logger = logging.getLogger("asistente_operativo.modules.iot_printing")

router = APIRouter(prefix="/api/iot", tags=["Impresión IoT"], dependencies=[Depends(require_auth)])


@router.get("/printers")
def list_printers():
    try:
        return {"printers": iot_printing_service.list_printers()}
    except Exception as e:
        logger.error(f"Error listando impresoras: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/printers", status_code=201)
def create_printer(data: PrinterCreate):
    try:
        printer = iot_printing_service.create_printer(data.model_dump())
        return printer
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error registrando impresora: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/printers/{printer_id}")
def update_printer(printer_id: int, data: PrinterUpdate):
    try:
        printer = iot_printing_service.update_printer(printer_id, data.model_dump(exclude_unset=True))
        return printer
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error actualizando impresora: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/printers/{printer_id}")
def delete_printer(printer_id: int):
    try:
        iot_printing_service.delete_printer(printer_id)
        return {"deleted": True, "id": printer_id}
    except Exception as e:
        logger.error(f"Error eliminando impresora: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/printers/{printer_id}/test")
def test_printer(printer_id: int):
    try:
        result = iot_printing_service.test_printer(printer_id)
        return result
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error en prueba de impresora: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/print/comanda")
def print_comanda(data: PrintComandaRequest):
    try:
        from modules.restaurant.service import restaurant_service
        order = restaurant_service.get_order(data.order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Orden no encontrada en Restaurante.")
        result = iot_printing_service.print_comanda(order, target_printer_id=data.printer_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error imprimiendo comanda: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/print/invoice")
def print_invoice(data: PrintInvoiceRequest):
    try:
        from modules.invoicing.service import invoicing_service
        invoice = invoicing_service.get_invoice(data.invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail="Factura no encontrada.")
        result = iot_printing_service.print_invoice(invoice, target_printer_id=data.printer_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error imprimiendo ticket de factura: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs")
def list_logs():
    try:
        return {"logs": iot_printing_service.list_logs()}
    except Exception as e:
        logger.error(f"Error listando logs de impresión: {e}")
        raise HTTPException(status_code=500, detail=str(e))

