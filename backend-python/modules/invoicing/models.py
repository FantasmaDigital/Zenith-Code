"""Modelos Pydantic para el módulo de Facturación & DTE El Salvador."""
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class InvoiceItemIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    quantity: float = Field(default=1.0, gt=0)
    unit_price: float = Field(..., ge=0)
    notes: Optional[str] = Field(default="", max_length=200)


class InvoiceCreate(BaseModel):
    # Datos de cliente / receptor
    customer_name: str = Field(default="Cliente Final", max_length=200)
    customer_document_type: Optional[str] = Field(default="13", max_length=10)  # 13=DUI, 36=NIT, 03=Pasaporte
    customer_document_number: Optional[str] = Field(default="", max_length=40)
    customer_nrc: Optional[str] = Field(default="", max_length=30)  # Para CCF (03)
    customer_activity: Optional[str] = Field(default="", max_length=160)  # Giro comercial para CCF
    customer_address: Optional[str] = Field(default="", max_length=250)
    customer_email: Optional[str] = Field(default="", max_length=120)
    customer_phone: Optional[str] = Field(default="", max_length=40)

    # Tipo de comprobante: '01' Factura, '03' Crédito Fiscal, '00' Ticket Interno
    dte_type: str = Field(default="01", max_length=10)
    items: List[InvoiceItemIn] = Field(..., min_length=1)
    payment_method: Literal["cash", "card", "transfer", "qr"] = "cash"
    notes: Optional[str] = Field(default="", max_length=500)

    # Enlaces opcionales
    restaurant_order_id: Optional[int] = None
    apply_retention: bool = False
    send_to_hacienda: bool = True  # Si está activa la integración


class HaciendaConfigUpdate(BaseModel):
    hacienda_enabled: Optional[bool] = None
    environment: Optional[Literal["00", "01"]] = None  # 00: Pruebas/Sandbox, 01: Producción
    nit_emisor: Optional[str] = Field(None, max_length=25)
    nrc_emisor: Optional[str] = Field(None, max_length=25)
    nombre_comercial: Optional[str] = Field(None, max_length=150)
    razon_social: Optional[str] = Field(None, max_length=150)
    giro_actividad: Optional[str] = Field(None, max_length=200)
    cod_actividad: Optional[str] = Field(None, max_length=20)
    direccion_emisor: Optional[str] = Field(None, max_length=250)
    telefono_emisor: Optional[str] = Field(None, max_length=30)
    correo_emisor: Optional[str] = Field(None, max_length=100)
    cod_establecimiento: Optional[str] = Field(None, max_length=10)
    cod_punto_venta: Optional[str] = Field(None, max_length=10)
    api_key_mh: Optional[str] = Field(None, max_length=500)
    clave_privada: Optional[str] = Field(None, max_length=500)
    auto_print: Optional[bool] = None  # Imprimir ticket automáticamente al emitir

