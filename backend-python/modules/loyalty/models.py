"""Modelos Pydantic del módulo de Tarjetas de Fidelidad."""
from typing import List, Optional
from pydantic import BaseModel, Field


class ProgramCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(default="points", pattern="^(points|stamps)$")
    points_per_currency: float = Field(default=1.0, ge=0, le=10000)  # solo programas por puntos
    stamps_goal: int = Field(default=10, ge=1, le=1000)              # solo programas por sellos
    reward_description: str = Field(default="", max_length=300)       # premio al completar los sellos
    expiry_days: int = Field(default=0, ge=0, le=3650)                # 0 = los puntos no vencen
    terms: str = Field(default="", max_length=2000)
    stamp_cooldown_minutes: int = Field(default=60, ge=0, le=10080)   # espera mínima entre sellos (0 = sin espera)


class ProgramUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    points_per_currency: Optional[float] = Field(default=None, ge=0, le=10000)
    stamps_goal: Optional[int] = Field(default=None, ge=1, le=1000)
    reward_description: Optional[str] = Field(default=None, max_length=300)
    expiry_days: Optional[int] = Field(default=None, ge=0, le=3650)
    terms: Optional[str] = Field(default=None, max_length=2000)
    stamp_cooldown_minutes: Optional[int] = Field(default=None, ge=0, le=10080)
    active: Optional[bool] = None


class CardCreate(BaseModel):
    program_id: int
    customer_name: str = Field(..., min_length=1, max_length=160)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=500)


class CardUpdate(BaseModel):
    customer_name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default=None, pattern="^(active|blocked)$")


class EarnRequest(BaseModel):
    purchase_amount: float = Field(default=0.0, ge=0, le=10_000_000)  # programas por puntos (sellos: siempre 1)
    reference: str = Field(default="", max_length=100)                 # n.º de ticket / pedido (evita duplicados)
    notes: str = Field(default="", max_length=300)


class RedeemRequest(BaseModel):
    reward_id: Optional[int] = None  # puntos: recompensa del catálogo; sellos: se canjea la meta completa
    reference: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=300)


class AdjustRequest(BaseModel):
    delta: int = Field(..., ge=-1_000_000, le=1_000_000)
    reason: str = Field(..., min_length=1, max_length=300)


class RewardCreate(BaseModel):
    program_id: int
    name: str = Field(..., min_length=1, max_length=160)
    cost: int = Field(..., ge=1, le=10_000_000)
    description: str = Field(default="", max_length=500)


class RewardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    cost: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    description: Optional[str] = Field(default=None, max_length=500)
    active: Optional[bool] = None


class StampAutoRequest(BaseModel):
    """Tarjetas ya verificadas guardadas en el teléfono del cliente."""
    card_tokens: List[str] = Field(default_factory=list, max_length=10)


class CodeRequest(BaseModel):
    contact: str = Field(..., min_length=3, max_length=190)  # correo o WhatsApp


class VerifyRequest(BaseModel):
    contact: str = Field(..., min_length=3, max_length=190)
    code: str = Field(default="", max_length=10)  # vacío si la empresa no tiene canal para enviar códigos
    customer_name: str = Field(default="", max_length=160)  # solo si es su primera tarjeta
