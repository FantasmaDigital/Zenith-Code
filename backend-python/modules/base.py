"""Clase base abstracta para todos los módulos Zenith."""
from abc import ABC, abstractmethod
from fastapi import APIRouter
from typing import Dict, Any


class ZenithModule(ABC):
    @property
    @abstractmethod
    def manifest(self) -> Dict[str, Any]:
        """Retorna el manifest del módulo con: id, name, description, version, icon, category, author."""
        ...

    def get_router(self) -> APIRouter:
        """Retorna el APIRouter con las rutas del módulo. Override si el módulo tiene rutas."""
        return APIRouter()

    def on_install(self, db_service) -> None:
        """Ejecutado al instalar el módulo. Crear tablas, datos iniciales, etc."""
        pass

    def on_load(self, db_service) -> None:
        """Ejecutado en cada arranque para módulos ya instalados (migraciones, caches). Opcional."""
        pass

    def on_uninstall(self, db_service) -> None:
        """Ejecutado al desinstalar el módulo. Limpiar datos si aplica."""
        pass

    def get_prompt_extension(self) -> str:
        """Retorna texto adicional para el system prompt de la IA. Override si aplica."""
        return ""

    def get_tools(self) -> list:
        """Herramientas que el agente puede usar (lista de services.agent_tools.Tool). Opcional."""
        return []

    def get_live_context(self) -> str:
        """Datos que cambian a menudo (hora, stock...). Se envían junto al mensaje, fuera del prompt cacheado."""
        return ""

    def get_welcome_override(self) -> str:
        """Saludo propio del módulo; si no está vacío reemplaza al saludo del perfil. Opcional."""
        return ""

    def process_reply(self, session_id: str, reply: str) -> str:
        """Permite al módulo transformar la respuesta de la IA antes de enviarla (acciones, etiquetas). Opcional."""
        return reply
