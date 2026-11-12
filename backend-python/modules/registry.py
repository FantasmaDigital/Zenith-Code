"""Registro central de módulos Zenith: descubrimiento, instalación y carga dinámica."""
import importlib
import logging
import os
from typing import Dict, List, Any, Optional

from fastapi import Depends, FastAPI, HTTPException

from services.tenant_service import FEATURE_ARM, current_tenant, tenant_context, tenant_registry

logger = logging.getLogger("asistente_operativo.modules.registry")


class ModuleRegistry:
    """Gestiona el ciclo de vida completo de los módulos instalables de Zenith."""

    def __init__(self):
        # Módulos descubiertos: {module_id: ZenithModule instance}
        self._discovered: Dict[str, Any] = {}
        # Módulos activos por empresa: {empresa: {module_id: ZenithModule instance}}
        self._loaded_by_tenant: Dict[str, Dict[str, Any]] = {}
        # Routers ya montados en FastAPI (se montan una sola vez, valen para todas las empresas)
        self._mounted: set = set()
        self._modules_dir = os.path.dirname(__file__)

    @property
    def _loaded(self) -> Dict[str, Any]:
        """Módulos activos de la empresa en curso."""
        return self._loaded_by_tenant.setdefault(current_tenant(), {})

    # ------------------------------------------------------------------
    # DESCUBRIMIENTO
    # ------------------------------------------------------------------
    def discover(self) -> None:
        """Escanea la carpeta modules/ buscando paquetes con manifest.py."""
        self._discovered = {}
        try:
            for entry in os.scandir(self._modules_dir):
                if not entry.is_dir():
                    continue
                module_dir = entry.name
                if module_dir.startswith("_") or module_dir.startswith("."):
                    continue
                manifest_path = os.path.join(entry.path, "manifest.py")
                module_file = os.path.join(entry.path, "module.py")
                if not os.path.exists(manifest_path) or not os.path.exists(module_file):
                    continue
                try:
                    manifest_mod = importlib.import_module(f"modules.{module_dir}.manifest")
                    manifest = getattr(manifest_mod, "MANIFEST", None)
                    if manifest and isinstance(manifest, dict) and "id" in manifest:
                        mod_module = importlib.import_module(f"modules.{module_dir}.module")
                        # Buscar la clase que hereda ZenithModule
                        cls = None
                        for attr_name in dir(mod_module):
                            attr = getattr(mod_module, attr_name)
                            if (
                                isinstance(attr, type)
                                and attr.__name__ != "ZenithModule"
                                and hasattr(attr, "manifest")
                            ):
                                cls = attr
                                break
                        if cls is not None:
                            instance = cls()
                            self._discovered[manifest["id"]] = instance
                            logger.info(f"🔍 Módulo descubierto: {manifest['id']} - {manifest.get('name', '')}")
                except Exception as e:
                    logger.warning(f"Error al descubrir módulo '{module_dir}': {e}")
        except Exception as e:
            logger.error(f"Error escaneando carpeta de módulos: {e}")

    # ------------------------------------------------------------------
    # CONSULTAS
    # ------------------------------------------------------------------
    def get_available(self) -> List[Dict[str, Any]]:
        """Lista todos los módulos descubiertos con su manifest."""
        if not self._discovered:
            self.discover()
        return [m.manifest for m in self._discovered.values()]

    def get_installed(self, db_service) -> List[str]:
        """Consulta tabla zenith_modules en BD y retorna lista de module_ids instalados."""
        try:
            return db_service.get_installed_modules()
        except Exception as e:
            logger.error(f"Error consultando módulos instalados: {e}")
            return []

    @staticmethod
    def required_feature(manifest: Dict[str, Any]) -> str:
        """Producto del plan al que pertenece el módulo (los módulos sin `feature` son parte del ARM)."""
        return manifest.get("feature") or FEATURE_ARM

    def in_plan(self, manifest: Dict[str, Any]) -> bool:
        return tenant_registry.has_feature(current_tenant(), self.required_feature(manifest))

    def get_modules_with_status(self, db_service) -> List[Dict[str, Any]]:
        """Lista todos los módulos disponibles con su estado de instalación y si el plan los incluye."""
        if not self._discovered:
            self.discover()
        installed_ids = self.get_installed(db_service)
        result = []
        for mod_id, instance in self._discovered.items():
            info = dict(instance.manifest)
            info["installed"] = mod_id in installed_ids
            info["feature"] = self.required_feature(instance.manifest)
            info["in_plan"] = self.in_plan(instance.manifest)
            result.append(info)
        return result

    # ------------------------------------------------------------------
    # INSTALACIÓN / DESINSTALACIÓN
    # ------------------------------------------------------------------
    def install(self, module_id: str, db_service, app: Optional[FastAPI] = None) -> Dict[str, Any]:
        """
        Marca el módulo como instalado, llama on_install y registra su router en la app.
        Retorna el manifest actualizado o lanza excepción si no existe.
        """
        if not self._discovered:
            self.discover()
        instance = self._discovered.get(module_id)
        if instance is None:
            raise ValueError(f"Módulo '{module_id}' no encontrado.")

        if not self.in_plan(instance.manifest):
            raise ValueError(
                f"El plan de esta empresa no incluye el producto «{self.required_feature(instance.manifest)}» "
                f"necesario para «{instance.manifest.get('name', module_id)}»."
            )

        # Validar dependencias (módulos padre requeridos)
        depends = instance.manifest.get("depends") or []
        installed_ids = self.get_installed(db_service)
        missing = [dep for dep in depends if dep not in installed_ids]
        if missing:
            missing_names = []
            for m in missing:
                parent_inst = self._discovered.get(m)
                missing_names.append(parent_inst.manifest.get("name", m) if parent_inst else m)
            raise ValueError(
                f"El módulo '{instance.manifest.get('name', module_id)}' no puede instalarse de forma aislada; "
                f"requiere que esté instalado previamente su módulo operacional padre: {', '.join(missing_names)}."
            )

        try:
            instance.on_install(db_service)
        except Exception as e:
            logger.error(f"Error en on_install de '{module_id}': {e}")
            raise

        db_service.mark_module_installed(module_id)

        if app is not None:
            self._register_router(instance, app)

        self._loaded[module_id] = instance
        logger.info(f"✅ Módulo '{module_id}' instalado exitosamente.")
        manifest = dict(instance.manifest)
        manifest["installed"] = True
        return manifest

    def uninstall(self, module_id: str, db_service) -> None:
        """Marca el módulo como desinstalado y llama on_uninstall."""
        if not self._discovered:
            self.discover()
        instance = self._discovered.get(module_id)
        if instance is None:
            raise ValueError(f"Módulo '{module_id}' no encontrado.")

        # Validar que ningún módulo instalado dependa de este módulo
        installed_ids = self.get_installed(db_service)
        dependents = []
        for mod_id in installed_ids:
            if mod_id == module_id:
                continue
            child_inst = self._discovered.get(mod_id)
            if child_inst and module_id in (child_inst.manifest.get("depends") or []):
                dependents.append(child_inst.manifest.get("name", mod_id))
        if dependents:
            raise ValueError(
                f"No se puede desinstalar '{instance.manifest.get('name', module_id)}' porque es el módulo operacional padre "
                f"de: {', '.join(dependents)}. Debes desinstalar primero los módulos dependientes."
            )

        try:
            instance.on_uninstall(db_service)
        except Exception as e:
            logger.warning(f"Error en on_uninstall de '{module_id}': {e}")

        db_service.mark_module_uninstalled(module_id)
        self._loaded.pop(module_id, None)
        logger.info(f"🗑️ Módulo '{module_id}' desinstalado.")

    # ------------------------------------------------------------------
    # STARTUP
    # ------------------------------------------------------------------
    def load_installed(self, app: FastAPI, db_service) -> None:
        """Al startup, carga los módulos instalados de CADA empresa activa y monta sus routers (una vez)."""
        if not self._discovered:
            self.discover()
        try:
            from services.tenant_service import tenant_registry
            slugs = tenant_registry.active_slugs()
        except Exception as e:
            logger.error(f"No se pudo listar las empresas para cargar módulos: {e}")
            slugs = [current_tenant()]
        for slug in slugs:
            with tenant_context(slug):
                self._load_tenant(app, db_service)

    def _load_tenant(self, app: FastAPI, db_service) -> None:
        """Carga los módulos instalados de la empresa en curso."""
        for module_id in self.get_installed(db_service):
            instance = self._discovered.get(module_id)
            if instance is None:
                logger.warning(f"Módulo instalado '{module_id}' no encontrado en disco. Saltando.")
                continue
            if module_id not in self._loaded:
                try:
                    instance.on_load(db_service)
                except Exception as e:
                    logger.error(f"Error en on_load de '{module_id}': {e}")
                self._register_router(instance, app)
                self._loaded[module_id] = instance
                logger.info(f"🚀 Módulo '{module_id}' cargado en startup ({current_tenant()}).")

    def _register_router(self, instance, app: FastAPI) -> None:
        """Monta el APIRouter del módulo (una sola vez). Cada petición exige que su empresa lo tenga instalado."""
        module_id = instance.manifest.get("id", "?")
        if module_id in self._mounted:
            return
        try:
            router = instance.get_router()
            if router and router.routes:
                def require_installed(_mid=module_id, _inst=instance):
                    if _mid not in self._loaded:
                        raise HTTPException(status_code=403, detail=f"El módulo '{_mid}' no está instalado en esta empresa.")
                    if not self.in_plan(_inst.manifest):
                        raise HTTPException(status_code=403, detail=f"El plan de esta empresa no incluye el módulo '{_mid}'.")
                app.include_router(router, dependencies=[Depends(require_installed)])
            public = instance.get_public_router()
            if public and public.routes:
                app.include_router(public)
            self._mounted.add(module_id)
            logger.info(f"📡 Router del módulo '{module_id}' registrado en FastAPI.")
        except Exception as e:
            logger.error(f"Error registrando router del módulo '{module_id}': {e}")

    def get_tools(self) -> list:
        """Herramientas de todos los módulos activos."""
        tools = []
        for module_id, instance in self._loaded.items():
            if not self.in_plan(instance.manifest):
                continue
            try:
                tools += list(instance.get_tools() or [])
            except Exception as e:
                logger.warning(f"Error obteniendo herramientas del módulo '{module_id}': {e}")
        return tools

    def get_live_context(self) -> str:
        """Concatena el contexto en vivo de los módulos activos."""
        parts = []
        for module_id, instance in self._loaded.items():
            try:
                text = (instance.get_live_context() or "").strip()
                if text:
                    parts.append(text)
            except Exception as e:
                logger.warning(f"Error obteniendo contexto en vivo del módulo '{module_id}': {e}")
        return " ".join(parts)

    def get_welcome_override(self) -> Dict[str, str]:
        """Primer saludo no vacío definido por un módulo activo: {"module": id, "name": nombre, "text": saludo}."""
        for module_id, instance in self._loaded.items():
            try:
                text = (instance.get_welcome_override() or "").strip()
            except Exception as e:
                logger.warning(f"Error obteniendo saludo del módulo '{module_id}': {e}")
                continue
            if text:
                return {"module": module_id, "name": instance.manifest.get("name", module_id), "text": text}
        return {}

    def is_loaded(self, module_id: str) -> bool:
        """True si el módulo está instalado, activo en runtime e incluido en el plan de la empresa en curso."""
        instance = self._loaded.get(module_id)
        return instance is not None and self.in_plan(instance.manifest)

    # ------------------------------------------------------------------
    # EXTENSIONES DE PROMPT
    # ------------------------------------------------------------------
    def get_prompt_extensions(self) -> str:
        """Concatena las extensiones de prompt de todos los módulos instalados activos."""
        extensions = []
        for instance in self._loaded.values():
            try:
                ext = instance.get_prompt_extension()
                if ext and ext.strip():
                    extensions.append(ext.strip())
            except Exception as e:
                logger.warning(f"Error obteniendo extensión de prompt del módulo '{instance.manifest.get('id', '?')}': {e}")
        return "\n\n".join(extensions)

    # ------------------------------------------------------------------
    # POST-PROCESO DE RESPUESTAS
    # ------------------------------------------------------------------
    def process_reply(self, session_id: str, reply: str) -> str:
        """Deja que cada módulo activo actúe sobre la respuesta de la IA (p. ej. crear un pedido)."""
        for instance in self._loaded.values():
            try:
                reply = instance.process_reply(session_id, reply)
            except Exception as e:
                logger.error(f"Error en process_reply del módulo '{instance.manifest.get('id', '?')}': {e}")
        return reply


# Instancia global del registro de módulos
module_registry = ModuleRegistry()
