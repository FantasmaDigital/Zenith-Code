"""Módulo Restaurante & Pedidos para Zenith."""
import logging
from typing import Dict, Any
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.restaurant.manifest import MANIFEST
from modules.restaurant.router import router as restaurant_router
from modules.restaurant.service import restaurant_service
from modules.restaurant import chat_orders

logger = logging.getLogger("asistente_operativo.modules.restaurant")


class RestaurantModule(ZenithModule):
    """Módulo de gestión de restaurante, menú y pedidos vía WhatsApp."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return restaurant_router

    def on_install(self, db_service) -> None:
        logger.info("🍽️ Instalando módulo Restaurante & Pedidos...")
        restaurant_service.init_tables(db_service)
        logger.info("✅ Módulo Restaurante instalado correctamente.")

    def on_load(self, db_service) -> None:
        """En cada arranque: aplica migraciones de columnas nuevas a instalaciones existentes."""
        restaurant_service.init_tables(db_service)

    def on_uninstall(self, db_service) -> None:
        logger.info("🗑️ Módulo Restaurante desinstalado. Las tablas de datos se conservan.")

    def get_prompt_extension(self) -> str:
        try:
            return chat_orders.build_prompt_extension()
        except Exception as e:
            logger.warning(f"Error obteniendo extensión de prompt del restaurante: {e}")
            return ""

    def get_tools(self) -> list:
        return chat_orders.build_tools()

    def get_live_context(self) -> str:
        try:
            return chat_orders.build_live_context()
        except Exception as e:
            logger.warning(f"Error obteniendo contexto en vivo del restaurante: {e}")
            return ""

    def get_welcome_override(self) -> str:
        try:
            return (restaurant_service.get_config().get("ai") or {}).get("greeting") or ""
        except Exception as e:
            logger.warning(f"Error obteniendo saludo del restaurante: {e}")
            return ""

    def process_reply(self, session_id: str, reply: str) -> str:
        return chat_orders.process_reply(session_id, reply)
