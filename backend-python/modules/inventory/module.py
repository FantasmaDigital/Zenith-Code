"""Clase principal del módulo de Control de Inventario & Insumos."""
import logging
from typing import Dict, Any
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.inventory.manifest import MANIFEST
from modules.inventory.router import router as inventory_router
from modules.inventory.service import inventory_service

logger = logging.getLogger("asistente_operativo.modules.inventory")


class InventoryModule(ZenithModule):
    """Módulo de Control de Inventario, Insumos, Fichas Técnicas (BOM) y Kardex."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return inventory_router

    def on_install(self, db_service) -> None:
        logger.info("📦 Instalando módulo Inventario & Insumos...")
        inventory_service.init_tables(db_service)
        try:
            imported = inventory_service.sync_from_restaurant_menu()
            if imported > 0:
                logger.info(f"📦 Se importaron automáticamente {imported} platos/bebidas del restaurante al inventario.")
        except Exception as e:
            logger.debug(f"Aviso en sincronización inicial de inventario con restaurante: {e}")
        logger.info("✅ Módulo Inventario & Insumos instalado correctamente.")

    def on_load(self, db_service) -> None:
        inventory_service.init_tables(db_service)
        try:
            inventory_service.sync_from_restaurant_menu()
        except Exception as e:
            logger.debug(f"Aviso en sincronización en on_load: {e}")

    def on_uninstall(self, db_service) -> None:
        logger.info("🗑️ Módulo Inventario desinstalado. Los registros históricos del Kardex se conservan.")

    def get_prompt_extension(self) -> str:
        return (
            "Tienes acceso al estado del inventario en vivo. Si el cliente pregunta si un producto o plato "
            "está disponible y se encuentra en la lista de agotados, indícaselo cordialmente y sugiere una alternativa."
        )

    def get_live_context(self) -> str:
        try:
            low_items = inventory_service.get_low_stock_items()
            out_of_stock = [i["name"] for i in low_items if i.get("current_stock", 0) <= 0]
            if out_of_stock:
                return (
                    f"⚠️ PRODUCTOS AGOTADOS EN INVENTARIO (NO DISPONIBLES HOY): {', '.join(out_of_stock)}. "
                    "Si te los piden, avisa de inmediato que se han agotado."
                )
        except Exception:
            pass
        return ""

