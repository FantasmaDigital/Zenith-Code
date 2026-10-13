import re
import logging
import requests
from bs4 import BeautifulSoup
from typing import Dict, Any
from services.encoding_utils import fix_mojibake

logger = logging.getLogger("asistente_operativo.scraper")

class WebScraperService:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
        }

    def scrape_url(self, url: str) -> Dict[str, Any]:
        """
        Descarga una página web, limpia el HTML y extrae el texto informativo relevante
        garantizando codificación UTF-8 pura sin mojibake.
        """
        url = url.strip()
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        try:
            response = requests.get(url, headers=self.headers, timeout=12)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error descargando {url}: {e}")
            raise ValueError(f"No se pudo acceder al sitio web: {e}")

        # Determinar encoding real: si el servidor web no especificó charset en Content-Type,
        # requests asume ISO-8859-1 por defecto, lo cual rompe acentos en español (mojibake).
        # Usamos apparent_encoding o UTF-8 como prioridad.
        encoding_to_use = "utf-8"
        if response.encoding and response.encoding.lower() not in ["iso-8859-1", "ascii"]:
            encoding_to_use = response.encoding
        elif response.apparent_encoding:
            encoding_to_use = response.apparent_encoding

        # Parsear directamente los bytes con BeautifulSoup indicando el encoding detectado
        soup = BeautifulSoup(response.content, "html.parser", from_encoding=encoding_to_use)

        # 1. Obtener título de la página
        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif soup.find("h1"):
            title = soup.find("h1").get_text().strip()
        else:
            title = f"Documento Web - {url}"

        title = fix_mojibake(title)

        # 2. Eliminar elementos ruidosos (scripts, estilos, banners, navegación masiva)
        for tag in soup(["script", "style", "noscript", "iframe", "svg", "button", "input", "form"]):
            tag.decompose()

        # Opcional: remover nav y footer si existen
        for tag in soup.find_all(["nav", "footer", "aside"]):
            tag.decompose()

        # 3. Extraer texto estructurado
        text_lines = []
        for element in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "span", "div"]):
            txt = element.get_text().strip()
            # Filtrar cadenas muy cortas o ruido de navegación
            if len(txt) > 25 and not any(txt in line for line in text_lines[-5:]):
                text_lines.append(txt)

        # Si el filtrado fue muy estricto, fallback a get_text global limpio
        if len(text_lines) < 3:
            raw_text = soup.get_text(separator="\n")
            cleaned_lines = [line.strip() for line in raw_text.splitlines() if len(line.strip()) > 20]
            clean_text = "\n".join(cleaned_lines)
        else:
            clean_text = "\n\n".join(text_lines)

        # Normalizar espacios excesivos
        clean_text = re.sub(r'\n{3,}', '\n\n', clean_text)

        # Limitar longitud si el sitio es gigantesco para no saturar memoria
        if len(clean_text) > 20000:
            clean_text = clean_text[:20000] + "\n\n[...Contenido truncado por límite de tamaño...]"

        clean_text = fix_mojibake(clean_text)

        return {
            "title": title[:200],
            "url": url,
            "content": clean_text
        }

    def discover_site_urls(self, base_url: str, max_urls: int = 50) -> Dict[str, Any]:
        """
        Rastrea el sitio web partiendo de base_url o sitemap.xml,
        extrayendo todas las URLs internas del mismo dominio para presentarlas al usuario antes de indexar.
        """
        import xml.etree.ElementTree as ET
        from urllib.parse import urlparse, urljoin, urldefrag

        base_url = base_url.strip()
        if not base_url.startswith("http://") and not base_url.startswith("https://"):
            base_url = "https://" + base_url

        parsed_root = urlparse(base_url)
        root_domain = parsed_root.netloc.lower()
        scheme = parsed_root.scheme

        discovered_urls = set()
        clean_root, _ = urldefrag(base_url)
        clean_root = clean_root.rstrip("/") + "/"
        discovered_urls.add(clean_root)

        # 1. Intentar descubrir desde /sitemap.xml
        sitemap_url = f"{scheme}://{root_domain}/sitemap.xml"
        try:
            s_resp = requests.get(sitemap_url, headers=self.headers, timeout=5)
            if s_resp.status_code == 200 and ("<urlset" in s_resp.text or "<sitemapindex" in s_resp.text):
                root = ET.fromstring(s_resp.content)
                for elem in root.iter():
                    if elem.tag.endswith("loc") and elem.text:
                        loc = elem.text.strip()
                        p_loc = urlparse(loc)
                        if p_loc.netloc.lower() == root_domain:
                            c_loc, _ = urldefrag(loc)
                            discovered_urls.add(c_loc)
                            if len(discovered_urls) >= max_urls:
                                break
        except Exception:
            pass

        # 2. Rastrear enlaces <a> de la página principal y páginas descubiertas
        urls_to_crawl = [base_url]
        crawled = set()

        while urls_to_crawl and len(discovered_urls) < max_urls:
            curr_url = urls_to_crawl.pop(0)
            if curr_url in crawled:
                continue
            crawled.add(curr_url)

            try:
                resp = requests.get(curr_url, headers=self.headers, timeout=7)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.content, "html.parser")
                    for a_tag in soup.find_all("a", href=True):
                        href = a_tag["href"].strip()
                        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
                            continue
                        full_url = urljoin(curr_url, href)
                        c_url, _ = urldefrag(full_url)
                        p = urlparse(c_url)

                        if p.netloc.lower() == root_domain:
                            ext = p.path.lower().split(".")[-1] if "." in p.path else ""
                            if ext not in ["jpg", "jpeg", "png", "gif", "svg", "webp", "pdf", "zip", "css", "js", "ico", "xml", "json"]:
                                if c_url not in discovered_urls:
                                    discovered_urls.add(c_url)
                                    if len(crawled) < 3 and len(discovered_urls) < max_urls:
                                        urls_to_crawl.append(c_url)
                                if len(discovered_urls) >= max_urls:
                                    break
            except Exception as e:
                logger.warning(f"Error explorando enlaces de {curr_url}: {e}")

        url_list = []
        for u in sorted(discovered_urls):
            p = urlparse(u)
            path_label = p.path if p.path else "/"
            if p.query:
                path_label += f"?{p.query}"
            url_list.append({
                "url": u,
                "path": path_label,
                "selected": True
            })

        return {
            "root_url": base_url,
            "domain": root_domain,
            "total_found": len(url_list),
            "urls": url_list
        }

scraper_service = WebScraperService()
