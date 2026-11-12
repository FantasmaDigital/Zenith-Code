"""Clase principal del módulo de Impresión IoT & Comandas."""
import logging
from typing import Dict, Any
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.iot_printing.manifest import MANIFEST
from modules.iot_printing.router import router as iot_router
from modules.iot_printing.service import iot_printing_service

logger = logging.getLogger("asistente_operativo.modules.iot_printing")


class IotPrintingModule(ZenithModule):
    """Módulo IoT para administración y despacho hacia impresoras térmicas de red y USB."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return iot_router

    def on_install(self, db_service) -> None:
        logger.info("🖨️ Instalando módulo de Impresión IoT & Comandas...")
        iot_printing_service.init_tables(db_service)
        logger.info("✅ Módulo Impresión IoT instalado correctamente.")

    def on_load(self, db_service) -> None:
        iot_printing_service.init_tables(db_service)

    def on_uninstall(self, db_service) -> None:
        logger.info("🖨️ Módulo Impresión IoT desinstalado. La configuración de dispositivos se conserva.")

