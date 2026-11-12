"""Modelos Pydantic para el módulo de Caja & Finanzas."""
from typing import Dict, Literal, Optional
from pydantic import BaseModel, Field


class ShiftOpenRequest(BaseModel):
    opened_by: Optional[str] = Field(default="Caja Principal", max_length=100)
    initial_cash: float = Field(default=0.0, ge=0.0, description="Fondo de cambio inicial en efectivo")
    notes: Optional[str] = Field(default="", max_length=500)


class ShiftCloseRequest(BaseModel):
    counted_cash: Optional[float] = Field(default=None, ge=0.0, description="Total contado (si no se envía el conteo por denominación)")
    denominations: Optional[Dict[str, int]] = Field(default=None, description="Conteo por billete/moneda: {'20': 3, '0.25': 8}")
    closed_by: Optional[str] = Field(default="Admin", max_length=100)
    notes: Optional[str] = Field(default="", max_length=500)


class TransactionCreate(BaseModel):
    type: str = Field(default="expense", pattern="^(income|expense|withdrawal|deposit)$")
    category: str = Field(default="supplies", max_length=50)
    amount: float = Field(gt=0.0)
    payment_method: str = Field(default="cash", pattern="^(cash|card|transfer|other)$")
    source_module: Optional[str] = Field(default="manual", max_length=50)
    source_reference_id: Optional[str] = Field(default=None, max_length=100)
    description: str = Field(min_length=1, max_length=500)
    created_by: Optional[str] = Field(default="Admin", max_length=100)



class TransactionVoid(BaseModel):
    reason: str = Field(min_length=3, max_length=300, description="Motivo de la anulación")
    voided_by: Optional[str] = Field(default="Admin", max_length=100)


class CategoryCreate(BaseModel):
    label: str = Field(min_length=2, max_length=100)
    type: Literal["income", "expense"]


class CategoryUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=2, max_length=100)
    active: Optional[bool] = None


class ReceiptUpload(BaseModel):
    data_url: str = Field(min_length=30, description="Imagen o PDF en data URL base64")
    filename: Optional[str] = Field(default="comprobante", max_length=200)
