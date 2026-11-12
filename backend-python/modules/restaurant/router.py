"""Router FastAPI para el módulo de Restaurante & Pedidos."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from services.auth_service import require_auth
from modules.restaurant.models import (
    MenuBulkCreate, MenuItemCreate, MenuItemUpdate, OrderCreate, OrderStatusUpdate,
    PaymentUpdate, RestaurantConfigUpdate,
)
from modules.restaurant.service import OrderError, restaurant_service

logger = logging.getLogger("asistente_operativo.modules.restaurant")

router = APIRouter(prefix="/api/restaurant", tags=["Restaurante"], dependencies=[Depends(require_auth)])


# ==============================================================
# CONFIGURACIÓN
# ==============================================================
@router.get("/config")
def get_config():
    """Configuración del restaurante (horarios, zonas, pagos) y si está abierto ahora."""
    config = restaurant_service.get_config()
    return {"config": config, "open_now": restaurant_service.is_open(config),
            "local_time": restaurant_service.local_now(config).strftime("%H:%M")}


@router.put("/config")
def update_config(data: RestaurantConfigUpdate):
    """Actualiza solo los campos enviados."""
    config = restaurant_service.save_config(data.model_dump(exclude_none=True))
    return {"status": "updated", "config": config, "open_now": restaurant_service.is_open(config)}


# ==============================================================
# MENÚ
# ==============================================================
@router.get("/menu")
def list_menu_items(only_available: bool = Query(False, description="Solo mostrar ítems disponibles")):
    return {"items": restaurant_service.list_menu(only_available=only_available)}


def _is_inventory_installed() -> bool:
    try:
        from modules.registry import module_registry
        from services.db_service import db_service
        return "inventory" in module_registry.get_installed(db_service)
    except Exception:
        return False


@router.post("/menu")
def add_menu_item(data: MenuItemCreate):
    if _is_inventory_installed():
        raise HTTPException(
            status_code=400,
            detail="El módulo de Inventario está activo. El catálogo comercial y platillos deben crearse desde Inventario & Insumos para mantener el Kardex y existencias centralizados."
        )
    return {"status": "created", "item": restaurant_service.add_menu_item(data)}


@router.post("/menu/bulk")
def add_menu_items_bulk(data: MenuBulkCreate):
    """Carga varios productos de una vez (útil para importar el menú completo)."""
    if _is_inventory_installed():
        raise HTTPException(
            status_code=400,
            detail="El módulo de Inventario está activo. La importación del catálogo debe realizarse desde Inventario & Insumos."
        )
    items = restaurant_service.add_menu_items_bulk(data.items)
    return {"status": "created", "count": len(items), "items": items}


@router.patch("/menu/{item_id}")
def update_menu_item(item_id: int, data: MenuItemUpdate):
    if _is_inventory_installed():
        # Si inventario está instalado, en restaurante solo se permite pausar/activar disponibilidad diaria
        fields = data.model_dump(exclude_unset=True)
        is_only_availability = set(fields.keys()).issubset({"available"})
        if not is_only_availability:
            raise HTTPException(
                status_code=400,
                detail="El catálogo está administrado por Inventario. El nombre, precio, categoría y stock deben modificarse desde Inventario & Insumos."
            )
    try:
        item = restaurant_service.update_menu_item(item_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if item is None:
        raise HTTPException(status_code=404, detail="Ítem de menú no encontrado.")
    return {"status": "updated", "item": item}


@router.delete("/menu/{item_id}")
def delete_menu_item(item_id: int):
    if _is_inventory_installed():
        raise HTTPException(
            status_code=400,
            detail="El módulo de Inventario está activo. Para eliminar o desactivar un platillo, hazlo desde Inventario & Insumos."
        )
    if not restaurant_service.delete_menu_item(item_id):
        raise HTTPException(status_code=404, detail="Ítem de menú no encontrado.")
    return {"status": "deleted", "id": item_id}


# ==============================================================
# ÓRDENES
# ==============================================================
@router.get("/orders")
def list_orders(
    status: Optional[str] = Query(None, description="Estado, o 'active' para pendientes/en curso"),
    order_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Nombre, teléfono o número de pedido"),
    limit: int = Query(200, ge=1, le=500),
):
    return {"orders": restaurant_service.list_orders(status, order_type, search, limit=limit)}


@router.post("/orders")
def create_order(data: OrderCreate):
    """Crea un pedido manual (desde el panel). No aplica el horario: el personal puede registrar a cualquier hora."""
    try:
        return {"status": "created", "order": restaurant_service.create_order(data, source="manual")}
    except OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creando orden: {e}")
        raise HTTPException(status_code=500, detail="Error al crear la orden.")


@router.get("/orders/{order_id}")
def get_order(order_id: int):
    order = restaurant_service.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Orden no encontrada.")
    return order


@router.get("/orders/{order_id}/ticket", response_class=PlainTextResponse)
def get_order_ticket(order_id: int):
    """Ticket de texto para cocina o impresión."""
    order = restaurant_service.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Orden no encontrada.")
    return restaurant_service.build_ticket(order)


@router.patch("/orders/{order_id}/status")
def update_order_status(order_id: int, data: OrderStatusUpdate):
    """Cambia el estado, avisa al cliente por WhatsApp y repone stock si se cancela."""
    try:
        order = restaurant_service.update_order_status(
            order_id, data.status, cancel_reason=data.cancel_reason or "", notify=data.notify_customer)
    except OrderError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if order is None:
        raise HTTPException(status_code=404, detail="Orden no encontrada.")
    return {"status": "updated", "order": order, "customer_notified": bool(order.get("notified"))}


@router.patch("/orders/{order_id}/payment")
def update_order_payment(order_id: int, data: PaymentUpdate):
    order = restaurant_service.set_payment_status(order_id, data.payment_status)
    if order is None:
        raise HTTPException(status_code=404, detail="Orden no encontrada.")
    return {"status": "updated", "order": order}


# ==============================================================
# ESTADÍSTICAS
# ==============================================================
@router.get("/stats")
def get_stats(days: int = Query(7, ge=1, le=90)):
    return restaurant_service.get_stats(days)
