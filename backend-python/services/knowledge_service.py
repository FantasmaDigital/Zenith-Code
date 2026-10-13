import os
import time
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from services.db_service import db_service
from services.scraper_service import scraper_service

logger = logging.getLogger("asistente_operativo.knowledge")

class KnowledgeService:
    def __init__(self, knowledge_dir: Optional[Path] = None):
        if knowledge_dir is None:
            self.knowledge_dir = Path(__file__).resolve().parent.parent / "knowledge"
        else:
            self.knowledge_dir = knowledge_dir

        # In-Memory Hot Cache para latencia ultra-baja (0 ms) al responder en WhatsApp
        self._hot_cache: Optional[str] = None
        self._cache_timestamp: float = 0
        self.refresh_cache()

    def refresh_cache(self) -> str:
        """
        Recompila y almacena en memoria RAM todo el conocimiento (archivos locales + BD).
        Toma menos de 5ms y permite que cada consulta del IA responda al instante.
        """
        t0 = time.perf_counter()
        context_parts = []

        # 1. Cargar archivos base del catálogo (JSON, Markdown)
        if self.knowledge_dir.exists():
            for file_path in sorted(self.knowledge_dir.glob("*.*")):
                if file_path.suffix.lower() in [".json", ".md", ".txt"]:
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        context_parts.append(
                            f"=== DOCUMENTO BASE: {file_path.name} ===\n{content}\n"
                        )
                    except Exception as e:
                        logger.error(f"Error leyendo archivo {file_path.name}: {e}")

        # 2. Cargar documentos, sitios web y textos ingresados desde la Base de Datos
        try:
            db_items = db_service.get_all_items()
            for item in db_items:
                source_info = f"Fuente: {item.get('source_type', 'texto').upper()}"
                if item.get("source_url"):
                    source_info += f" ({item['source_url']})"
                
                context_parts.append(
                    f"=== CONOCIMIENTO DINÁMICO: {item['title']} [{source_info}] [Categoría: {item.get('category', 'general')}] ===\n"
                    f"{item['content']}\n"
                )
        except Exception as e:
            logger.error(f"Error cargando conocimiento desde BD: {e}")

        if not context_parts:
            self._hot_cache = "Base de conocimiento vacía."
        else:
            self._hot_cache = "\n\n".join(context_parts)

        self._cache_timestamp = time.time()
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(f"⚡ In-Memory Hot Cache refrescado en {elapsed:.2f} ms ({len(context_parts)} fuentes compiladas).")
        return self._hot_cache

    def get_context_text(self) -> str:
        """
        Devuelve el contexto completo precompilado en memoria RAM en 0.001 ms.
        """
        if self._hot_cache is None:
            return self.refresh_cache()
        return self._hot_cache

    def add_text_document(self, title: str, content: str, category: str = "general") -> Dict[str, Any]:
        """Agrega un texto o política a la BD y actualiza el caché de IA."""
        item = db_service.add_item(
            title=title,
            content=content,
            source_type="text",
            category=category
        )
        self.refresh_cache()
        return item

    def add_web_source(self, url: str, category: str = "web") -> Dict[str, Any]:
        """Scrapea un sitio web, extrae su texto limpio, lo guarda en BD y actualiza el caché."""
        scraped = scraper_service.scrape_url(url)
        item = db_service.add_item(
            title=scraped["title"],
            content=scraped["content"],
            source_type="url",
            source_url=scraped["url"],
            category=category
        )
        self.refresh_cache()
        return item

    def delete_document(self, item_id: int) -> bool:
        """Elimina un documento y recompila el caché."""
        deleted = db_service.delete_item(item_id)
        if deleted:
            self.refresh_cache()
        return deleted

    def list_documents(self) -> List[Dict[str, Any]]:
        """Devuelve la lista de documentos en BD."""
        return db_service.get_all_items()

    def get_stats(self) -> Dict[str, Any]:
        """Métricas de rendimiento y capacidad."""
        return {
            "cached": self._hot_cache is not None,
            "cache_size_chars": len(self._hot_cache or ""),
            "cache_timestamp": self._cache_timestamp,
            "total_db_items": db_service.count_items(),
            "database_type": "PostgreSQL" if db_service.is_postgres else "SQLite"
        }

knowledge_service = KnowledgeService()
