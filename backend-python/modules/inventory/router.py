"""Rutas API para el módulo de Inventario & Insumos."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from services.auth_service import require_auth
from modules.inventory.models import (
    ItemCreate, ItemUpdate, StockAdjustment,
    PurchaseCreate, WasteCreate, RecipeSaveRequest
)
from modules.inventory.service import inventory_service

logger = logging.getLogger("asistente_operativo.modules.inventory")

router = APIRouter(prefix="/api/inventory", tags=["Inventario & Insumos"], dependencies=[Depends(require_auth)])


def _user(request: Request) -> str:
    # Podría extraerse del token si está disponible
    return "Administrador"


# ------------------------------------------------------------------
# ARTÍCULOS E INSUMOS
# ------------------------------------------------------------------
@router.get("/items")
def list_items(
    category: Optional[str] = Query(None),
    item_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    low_stock_only: bool = Query(False)
):
    try:
        items = inventory_service.get_items(
            category=category,
            item_type=item_type,
            search=search,
            low_stock_only=low_stock_only
        )
        return {"items": items, "count": len(items)}
    except Exception as e:
        logger.error(f"Error listando ítems de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/items/{item_id}")
def get_item(item_id: int):
    item = inventory_service.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado.")
    return item


@router.post("/items", status_code=201)
def create_item(data: ItemCreate, request: Request):
    try:
        item = inventory_service.create_item(data.model_dump(), user=_user(request))
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creando artículo de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/items/{item_id}")
def update_item(item_id: int, data: ItemUpdate):
    try:
        item = inventory_service.update_item(item_id, data.model_dump(exclude_unset=True))
        return item
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error actualizando artículo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/items/{item_id}")
def delete_item(item_id: int):
    try:
        success = inventory_service.delete_item(item_id)
        return {"success": success, "deleted_id": item_id}
    except Exception as e:
        logger.error(f"Error eliminando artículo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/items/{item_id}/adjust")
def adjust_stock(item_id: int, data: StockAdjustment, request: Request):
    try:
        item = inventory_service.adjust_stock(
            item_id=item_id,
            new_stock=data.new_stock,
            reason=data.reason,
            notes=data.notes or "",
            user=_user(request)
        )
        return {"status": "adjusted", "item": item}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error ajustando stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# COMPRAS Y ENTRADAS
# ------------------------------------------------------------------
@router.post("/purchases", status_code=201)
def record_purchase(data: PurchaseCreate, request: Request):
    try:
        item = inventory_service.record_purchase(
            item_id=data.item_id,
            quantity=data.quantity,
            unit_cost=data.unit_cost,
            supplier=data.supplier or "",
            invoice_ref=data.invoice_ref or "",
            payment_method=data.payment_method,
            create_finance_expense=data.create_finance_expense,
            notes=data.notes or "",
            user=_user(request)
        )
        return {"status": "recorded", "item": item}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error registrando compra de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# MERMAS Y DESPERDICIOS
# ------------------------------------------------------------------
@router.post("/waste", status_code=201)
def record_waste(data: WasteCreate, request: Request):
    try:
        item = inventory_service.record_waste(
            item_id=data.item_id,
            quantity=data.quantity,
            reason=data.reason,
            notes=data.notes or "",
            user=_user(request)
        )
        return {"status": "recorded", "item": item}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error registrando merma de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# RECETAS / FICHAS TÉCNICAS (BOM)
# ------------------------------------------------------------------
@router.get("/recipes")
def list_all_recipes():
    try:
        return {"recipes": inventory_service.get_all_recipes()}
    except Exception as e:
        logger.error(f"Error listando recetas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recipes/{composite_id}")
def get_recipe(composite_id: int):
    try:
        recipe = inventory_service.get_recipe(composite_id)
        return {"composite_item_id": composite_id, "ingredients": recipe}
    except Exception as e:
        logger.error(f"Error obteniendo receta: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recipes")
def save_recipe(data: RecipeSaveRequest):
    try:
        ingredients_dicts = [i.model_dump() for i in data.ingredients]
        metadata = {}
        for f in ("name", "description", "category", "selling_price", "image_url"):
            val = getattr(data, f, None)
            if val is not None:
                metadata[f] = val

        updated = inventory_service.set_recipe(
            data.composite_item_id,
            ingredients_dicts,
            metadata=metadata if metadata else None
        )
        return {"composite_item_id": data.composite_item_id, "ingredients": updated}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error guardando receta: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# KARDEX DE MOVIMIENTOS
# ------------------------------------------------------------------
@router.get("/movements")
def get_movements(
    item_id: Optional[int] = Query(None),
    movement_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    try:
        movements = inventory_service.get_movements(
            item_id=item_id,
            movement_type=movement_type,
            limit=limit,
            offset=offset
        )
        return {"movements": movements, "count": len(movements)}
    except Exception as e:
        logger.error(f"Error obteniendo Kardex de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# MÉTRICAS Y SINCRONIZACIÓN
# ------------------------------------------------------------------
@router.get("/stats")
def get_stats():
    try:
        return inventory_service.get_stats()
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/low-stock")
def get_low_stock_alerts():
    try:
        items = inventory_service.get_low_stock_items()
        return {"low_stock_items": items, "count": len(items)}
    except Exception as e:
        logger.error(f"Error obteniendo alertas de stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-restaurant")
def sync_from_restaurant():
    try:
        imported = inventory_service.sync_from_restaurant_menu()
        return {"status": "ok", "imported_count": imported}
    except Exception as e:
        logger.error(f"Error sincronizando menú de restaurante a inventario: {e}")
        raise HTTPException(status_code=500, detail=str(e))

