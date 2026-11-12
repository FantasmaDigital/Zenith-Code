"""Clase principal del módulo de Caja & Finanzas."""
import logging
from typing import Dict, Any
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.finance.manifest import MANIFEST
from modules.finance.router import router as finance_router
from modules.finance.service import finance_service

logger = logging.getLogger("asistente_operativo.modules.finance")


class FinanceModule(ZenithModule):
    """Módulo de Control de Caja Chica, Turnos/Cortes y Finanzas Universales."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return finance_router

    def on_install(self, db_service) -> None:
        logger.info("💵 Instalando módulo Caja & Finanzas...")
        finance_service.init_tables(db_service)
        # Sincronizar de inmediato ventas previas de restaurantes si existen
        try:
            finance_service.sync_unrecorded_restaurant_sales()
        except Exception as e:
            logger.debug(f"Aviso en sincronización inicial de finanzas: {e}")
        logger.info("✅ Módulo Caja & Finanzas instalado correctamente.")

    def on_load(self, db_service) -> None:
        """En cada arranque: verifica tablas y recupera cobros del restaurante que no llegaron al libro.
        (El restaurante avisa a Finanzas en cada cobro; esto solo cubre cobros hechos con el módulo apagado.)"""
        finance_service.init_tables(db_service)
        try:
            finance_service.sync_unrecorded_restaurant_sales()
        except Exception as e:
            logger.debug(f"Aviso en sincronización de arranque de finanzas: {e}")

    def on_uninstall(self, db_service) -> None:
        logger.info("🗑️ Módulo Caja & Finanzas desinstalado. Los datos históricos se conservan.")

    def get_prompt_extension(self) -> str:
        # El bot no necesita atender transacciones directamente por WhatsApp por seguridad
        return ""

