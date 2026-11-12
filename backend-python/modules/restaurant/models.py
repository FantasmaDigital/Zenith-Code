"""Modelos Pydantic para el módulo de Restaurante & Pedidos."""
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Literal

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class MenuItemCreate(BaseModel):
    """Datos para crear un ítem del menú."""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = ""
    price: float = Field(..., ge=0)
    category: str = "General"
    available: bool = True
    stock: Optional[int] = Field(None, ge=0, description="Unidades disponibles; vacío = sin límite")
    image_url: Optional[str] = Field(default="", max_length=1000)


class MenuItemUpdate(BaseModel):
    """Datos para actualizar un ítem del menú (todos opcionales; stock=null quita el límite)."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    price: Optional[float] = Field(None, ge=0)
    category: Optional[str] = None
    available: Optional[bool] = None
    stock: Optional[int] = Field(None, ge=0)
    image_url: Optional[str] = Field(None, max_length=1000)


class MenuBulkCreate(BaseModel):
    items: List[MenuItemCreate] = Field(..., min_length=1, max_length=300)


class OrderItemIn(BaseModel):
    """Ítem individual dentro de una orden."""
    menu_item_id: int
    quantity: int = Field(..., ge=1, le=50)
    notes: Optional[str] = ""


class OrderCreate(BaseModel):
    """Datos para crear una nueva orden (los montos siempre los calcula el servidor)."""
    session_id: str = Field(..., min_length=1)
    customer_name: Optional[str] = "Cliente"
    items: List[OrderItemIn]
    notes: Optional[str] = ""
    order_type: Literal["delivery", "pickup", "dine_in"] = "delivery"
    delivery_address: Optional[str] = ""
    delivery_zone: Optional[str] = ""
    payment_method: Literal["cash", "transfer", "card"] = "cash"


class OrderStatusUpdate(BaseModel):
    """Actualización de estado de una orden."""
    status: Literal["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"]
    cancel_reason: Optional[str] = Field("", max_length=300)
    notify_customer: bool = True


class PaymentUpdate(BaseModel):
    payment_status: Literal["pending", "paid"]


class DayHours(BaseModel):
    closed: bool = False
    open: str = Field("10:00", pattern=HHMM)
    close: str = Field("21:00", pattern=HHMM)


class DeliveryZone(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    fee: float = Field(0, ge=0)
    min_order: float = Field(0, ge=0)
    minutes: int = Field(0, ge=0, le=240)


class RestaurantAIConfig(BaseModel):
    """Cómo la IA atiende al cliente del restaurante."""
    take_orders: Optional[bool] = None
    menu_style: Optional[Literal["categories", "full"]] = None
    upsell: Optional[bool] = None
    ask_name: Optional[bool] = None
    menu_link: Optional[str] = Field(None, max_length=500)
    greeting: Optional[str] = Field(None, max_length=500)
    instructions: Optional[str] = Field(None, max_length=2000)


class RestaurantConfigUpdate(BaseModel):
    """Configuración del restaurante; solo se actualizan los campos enviados."""
    restaurant_name: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=300)
    accepting_orders: Optional[bool] = None
    utc_offset_hours: Optional[int] = Field(None, ge=-12, le=14)
    order_types: Optional[Dict[Literal["delivery", "pickup", "dine_in"], bool]] = None
    hours: Optional[Dict[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"], DayHours]] = None
    prep_minutes: Optional[int] = Field(None, ge=0, le=240)
    min_order: Optional[float] = Field(None, ge=0)
    zones: Optional[List[DeliveryZone]] = Field(None, max_length=50)
    flat_delivery_fee: Optional[float] = Field(None, ge=0)
    payment_methods: Optional[Dict[Literal["cash", "transfer", "card"], bool]] = None
    transfer_info: Optional[str] = Field(None, max_length=500)
    closed_message: Optional[str] = Field(None, max_length=300)
    notify_customer: Optional[bool] = None
    ai: Optional[RestaurantAIConfig] = None
