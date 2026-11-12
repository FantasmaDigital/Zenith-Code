"""Modelos Pydantic para el módulo de Inventario & Insumos."""
from typing import List, Optional
from pydantic import BaseModel, Field


class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    sku: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default="", max_length=500)
    category: str = Field(default="general", max_length=80)
    item_type: str = Field(default="product", max_length=30)  # 'product', 'raw_material', 'composite'
    unit: str = Field(default="pza", max_length=20)  # 'pza', 'kg', 'g', 'l', 'ml', 'caja', etc.
    cost_price: float = Field(default=0.0, ge=0)
    selling_price: float = Field(default=0.0, ge=0)
    initial_stock: float = Field(default=0.0)
    min_stock: float = Field(default=0.0, ge=0)
    track_stock: bool = True
    image_url: Optional[str] = Field(default="", max_length=1000)
    restaurant_item_id: Optional[int] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=160)
    sku: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=80)
    item_type: Optional[str] = Field(default=None, max_length=30)
    unit: Optional[str] = Field(default=None, max_length=20)
    cost_price: Optional[float] = Field(default=None, ge=0)
    selling_price: Optional[float] = Field(default=None, ge=0)
    min_stock: Optional[float] = Field(default=None, ge=0)
    track_stock: Optional[bool] = None
    image_url: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None
    restaurant_item_id: Optional[int] = None


class StockAdjustment(BaseModel):
    new_stock: float = Field(...)
    reason: str = Field(..., min_length=1, max_length=200)
    notes: Optional[str] = Field(default="", max_length=500)


class PurchaseCreate(BaseModel):
    item_id: int = Field(...)
    quantity: float = Field(..., gt=0)
    unit_cost: float = Field(..., ge=0)
    supplier: Optional[str] = Field(default="", max_length=160)
    invoice_ref: Optional[str] = Field(default="", max_length=100)
    payment_method: str = Field(default="cash", max_length=40)  # 'cash', 'card', 'transfer', 'qr'
    create_finance_expense: bool = True
    notes: Optional[str] = Field(default="", max_length=500)


class WasteCreate(BaseModel):
    item_id: int = Field(...)
    quantity: float = Field(..., gt=0)
    reason: str = Field(default="caducidad", max_length=100)  # 'caducidad', 'preparacion', 'danado', 'otro'
    notes: Optional[str] = Field(default="", max_length=500)


class RecipeIngredient(BaseModel):
    ingredient_item_id: int = Field(...)
    quantity: float = Field(..., gt=0)
    unit: Optional[str] = Field(default=None, max_length=20)


class RecipeSaveRequest(BaseModel):
    composite_item_id: int = Field(...)
    ingredients: List[RecipeIngredient] = Field(default_factory=list)
    # Presentación comercial opcional para actualizar el plato y el menú simultáneamente:
    name: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=80)
    selling_price: Optional[float] = Field(default=None, ge=0)
    image_url: Optional[str] = Field(default=None, max_length=1000)

