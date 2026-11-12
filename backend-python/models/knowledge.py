from pydantic import BaseModel, Field
from typing import List

class TextKnowledgeRequest(BaseModel):
    title: str = Field(..., description="Título del documento de conocimiento")
    content: str = Field(..., description="Texto o especificaciones detalladas")
    category: str = Field(default="general", description="Categoría temática")

class UrlKnowledgeRequest(BaseModel):
    url: str = Field(..., description="URL del sitio web a scrapear e indexar")
    category: str = Field(default="sitio-web", description="Categoría temática")

class CrawlSiteRequest(BaseModel):
    url: str = Field(..., description="URL raíz del sitio a mapear")
    max_urls: int = Field(default=40, description="Límite máximo de URLs a descubrir")

class BatchIndexUrlsRequest(BaseModel):
    urls: List[str] = Field(..., description="Lista de URLs seleccionadas por el usuario")
    category: str = Field(default="sitio-web", description="Categoría temática")
