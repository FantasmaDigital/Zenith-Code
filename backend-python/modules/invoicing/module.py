"""Clase principal del módulo de Facturación & DTE El Salvador."""
import logging
from typing import Dict, Any
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.invoicing.manifest import MANIFEST
from modules.invoicing.router import router as invoicing_router
from modules.invoicing.service import invoicing_service

logger = logging.getLogger("asistente_operativo.modules.invoicing")


class InvoicingModule(ZenithModule):
    """Módulo de Facturación Comercial y DTE (Ministerio de Hacienda El Salvador)."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return invoicing_router

    def on_install(self, db_service) -> None:
        logger.info("🧾 Instalando módulo Facturación & DTE El Salvador...")
        invoicing_service.init_tables(db_service)
        logger.info("✅ Módulo Facturación & DTE instalado correctamente.")

    def on_load(self, db_service) -> None:
        invoicing_service.init_tables(db_service)

    def on_uninstall(self, db_service) -> None:
        logger.info("🧾 Módulo Facturación desinstalado. Los registros fiscales e historial de facturas se conservan.")

    def get_prompt_extension(self) -> str:
        return (
            "Puedes consultar e informar sobre facturación. Si un cliente solicita comprobante de pago o factura, "
            "indícale que se le emitirá automáticamente su Ticket o Factura Electrónica (DTE) con código QR de Hacienda."
        )

