"""Modelos Pydantic para el módulo de Impresión IoT & Comandas."""
from typing import Literal, Optional
from pydantic import BaseModel, Field


class PrinterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    connection_type: Literal["network", "usb", "browser"] = "network"
    ip_address: Optional[str] = Field(default="", max_length=60)
    port: int = Field(default=9100, ge=1, le=65535)
    role: Literal["kitchen", "cashier", "all"] = "kitchen"
    paper_width: Literal["80mm", "58mm"] = "80mm"
    auto_cut: bool = True
    open_drawer: bool = False
    is_active: bool = True


class PrinterUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    connection_type: Optional[Literal["network", "usb", "browser"]] = None
    ip_address: Optional[str] = Field(None, max_length=60)
    port: Optional[int] = Field(None, ge=1, le=65535)
    role: Optional[Literal["kitchen", "cashier", "all"]] = None
    paper_width: Optional[Literal["80mm", "58mm"]] = None
    auto_cut: Optional[bool] = None
    open_drawer: Optional[bool] = None
    is_active: Optional[bool] = None


class PrintTestRequest(BaseModel):
    printer_id: int


class PrintComandaRequest(BaseModel):
    order_id: int
    printer_id: Optional[int] = None  # Si es null, envía a todas las de cocina


class PrintInvoiceRequest(BaseModel):
    invoice_id: int
    printer_id: Optional[int] = None  # Si es null, envía a todas las de caja

