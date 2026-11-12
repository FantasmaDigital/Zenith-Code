"""Clase principal del módulo de Tarjetas de Fidelidad."""
import logging
from typing import Any, Dict, List

from fastapi import APIRouter

from modules.base import ZenithModule
from modules.loyalty.manifest import MANIFEST
from modules.loyalty.router import public_router, router as loyalty_router
from modules.loyalty.service import loyalty_service, normalize_phone

logger = logging.getLogger("asistente_operativo.modules.loyalty")


def _tool_consultar_tarjeta(ctx, args: Dict[str, Any]) -> Dict[str, Any]:
    """El agente consulta la tarjeta del cliente con el que habla (su sesión es su número de WhatsApp)."""
    phone = normalize_phone(args.get("telefono") or ctx.session_id)
    card = loyalty_service.find_card(phone) if phone else None
    if not card:
        return {"ok": False, "nota": "El cliente no tiene tarjeta de fidelidad registrada con ese teléfono."}
    view = loyalty_service.public_view(card["public_token"]) or {}
    program = view.get("program", {})
    out = {"ok": True, "cliente": card["customer_name"], "programa": program.get("name"),
           "tipo": program.get("kind"), "saldo": card["balance"], "estado": card["status"]}
    if program.get("kind") == "stamps":
        out["meta_sellos"] = program.get("stamps_goal")
        out["premio"] = program.get("reward_description")
    else:
        out["recompensas"] = view.get("rewards", [])
    return out


class LoyaltyModule(ZenithModule):
    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return loyalty_router

    def get_public_router(self) -> APIRouter:
        return public_router

    def on_install(self, db_service) -> None:
        loyalty_service.init_tables(db_service)
        logger.info("💳 Módulo Tarjetas de Fidelidad instalado.")

    def on_load(self, db_service) -> None:
        loyalty_service.init_tables(db_service)

    def get_tools(self) -> List:
        # Solo se usa si la empresa también tiene el ARM (el agente es quien llama herramientas)
        from services.agent_tools import Tool
        return [Tool(
            name="consultar_tarjeta_fidelidad",
            description=("Consulta el saldo de puntos o sellos y las recompensas disponibles de la tarjeta de "
                         "fidelidad del cliente. Úsala cuando pregunte por sus puntos, sellos o premios."),
            parameters={"type": "object", "properties": {
                "telefono": {"type": "string", "description": "Teléfono del cliente (opcional; por defecto el de la conversación)"},
            }},
            handler=_tool_consultar_tarjeta,
        )]

    def get_prompt_extension(self) -> str:
        return ("PROGRAMA DE FIDELIDAD: la empresa tiene tarjetas de lealtad. Si el cliente pregunta por sus puntos, "
                "sellos o premios, usa la herramienta consultar_tarjeta_fidelidad; no inventes saldos.")
