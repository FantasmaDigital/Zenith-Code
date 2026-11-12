import base64
import logging
from typing import Optional, List, Tuple
from google.genai import types

logger = logging.getLogger("asistente_operativo.multimodal")

class MultimodalService:
    """
    Servicio de dominio para sanitizar, decodificar y estructurar
    contenido multimedia (notas de voz y comprobantes de transferencia)
    hacia los modelos de inteligencia artificial multimodal.
    """

    @staticmethod
    def sanitize_mime_type(mime: Optional[str], default: str = "audio/ogg") -> str:
        """Limpia codecs o parámetros extra del tipo MIME (ej: 'audio/ogg; codecs=opus' -> 'audio/ogg')."""
        if not mime or not mime.strip():
            return default
        return mime.split(";")[0].strip().lower()

    @classmethod
    def decode_base64_media(cls, base64_str: Optional[str]) -> Optional[bytes]:
        """Decodifica un string base64 de manera segura, manejando padding y prefijos data-url."""
        if not base64_str or not base64_str.strip():
            return None

        clean_str = base64_str.strip()
        if "," in clean_str:
            clean_str = clean_str.split(",", 1)[1].strip()

        # Corregir padding si viene incompleto
        missing_padding = len(clean_str) % 4
        if missing_padding:
            clean_str += "=" * (4 - missing_padding)

        try:
            return base64.b64decode(clean_str)
        except Exception as e:
            logger.error(f"[MultimodalService] Error decodificando payload base64: {e}")
            return None

    @classmethod
    def build_gemini_parts(
        cls,
        text: Optional[str] = "",
        audio_base64: Optional[str] = None,
        audio_mime_type: Optional[str] = "audio/ogg",
        image_base64: Optional[str] = None,
        image_mime_type: Optional[str] = "image/jpeg"
    ) -> Tuple[List[types.Part], str]:
        """
        Construye la lista de partes de Gemini (texto, audio y/o imagen) y genera
        la descripción de registro para el historial conversacional.
        """
        parts: List[types.Part] = []
        history_labels: List[str] = []

        clean_text = (text or "").strip()
        if clean_text:
            parts.append(types.Part.from_text(text=clean_text))

        if audio_base64:
            audio_bytes = cls.decode_base64_media(audio_base64)
            if audio_bytes:
                clean_mime = cls.sanitize_mime_type(audio_mime_type, default="audio/ogg")
                parts.append(types.Part.from_bytes(data=audio_bytes, mime_type=clean_mime))
                parts.append(types.Part.from_text(text="[Nota de voz del cliente: respóndele lo que dice.]"))
                history_labels.append("🎙️ [Nota de voz]")
                logger.info(f"[MultimodalService] Audio procesado exitosamente ({len(audio_bytes)} bytes, {clean_mime})")

        if image_base64:
            image_bytes = cls.decode_base64_media(image_base64)
            if image_bytes:
                clean_mime = cls.sanitize_mime_type(image_mime_type, default="image/jpeg")
                parts.append(types.Part.from_bytes(data=image_bytes, mime_type=clean_mime))
                parts.append(types.Part.from_text(text="[Imagen del cliente: respóndele según lo que muestra.]"))
                history_labels.append("🖼️ [Comprobante / Imagen]")
                logger.info(f"[MultimodalService] Imagen procesada exitosamente ({len(image_bytes)} bytes, {clean_mime})")

        if not parts:
            parts.append(types.Part.from_text(text="[Mensaje sin contenido visible]"))

        # Construir entrada limpia para el historial
        labels_prefix = " ".join(history_labels)
        if labels_prefix and clean_text:
            history_summary = f"{labels_prefix} {clean_text}"
        elif labels_prefix:
            history_summary = labels_prefix
        else:
            history_summary = clean_text or "[Mensaje]"

        return parts, history_summary

multimodal_service = MultimodalService()
