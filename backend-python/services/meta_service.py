import base64
import hashlib
import hmac
import logging
from collections import OrderedDict
from typing import Any, Dict, List, Optional

import requests

from config import settings

logger = logging.getLogger("asistente_operativo.meta_cloud")

GRAPH_BASE_URL = "https://graph.facebook.com"
MAX_MEDIA_BYTES = 16 * 1024 * 1024
SEEN_IDS_LIMIT = 2000


class MetaCloudService:
    """
    Driver de la API oficial de WhatsApp Business (Meta Cloud API).
    - Envía texto con POST /{phone_number_id}/messages.
    - Recibe mensajes por webhook (/webhook/meta), verificando la firma X-Hub-Signature-256.
    - Descarga notas de voz e imágenes para el motor multimodal.
    """

    def __init__(self):
        # Meta reintenta webhooks que tardan: se ignoran los ids ya procesados
        self._seen_message_ids: "OrderedDict[str, bool]" = OrderedDict()

    # ---------------- Configuración ----------------
    @property
    def _graph_url(self) -> str:
        return f"{GRAPH_BASE_URL}/{settings.META_API_VERSION or 'v21.0'}"

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {settings.META_ACCESS_TOKEN}"}

    def is_configured(self) -> bool:
        return bool(settings.META_ACCESS_TOKEN and settings.META_PHONE_NUMBER_ID)

    def missing_fields(self) -> List[str]:
        required = {
            "META_ACCESS_TOKEN": "Token de acceso",
            "META_PHONE_NUMBER_ID": "Phone Number ID",
            "META_VERIFY_TOKEN": "Token de verificación del webhook",
            "META_APP_SECRET": "App Secret",
        }
        return [label for key, label in required.items() if not getattr(settings, key, "")]

    @staticmethod
    def _graph_error(response: requests.Response) -> str:
        try:
            err = response.json().get("error", {})
            return err.get("error_user_msg") or err.get("message") or response.text[:300]
        except ValueError:
            return response.text[:300]

    # ---------------- Envío ----------------
    def send_text_message(self, to_phone: str, message_text: str) -> Dict[str, Any]:
        """Envía texto libre. Fuera de la ventana de 24 h Meta lo rechaza (requiere plantilla)."""
        if not self.is_configured():
            return {"success": False, "error": "Meta Cloud API no está configurada."}
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": "".join(filter(str.isdigit, str(to_phone))),
            "type": "text",
            "text": {"preview_url": False, "body": message_text},
        }
        try:
            response = requests.post(
                f"{self._graph_url}/{settings.META_PHONE_NUMBER_ID}/messages",
                json=payload, headers=self._headers(), timeout=15
            )
            if response.ok:
                logger.info(f"Mensaje enviado a +{payload['to']} vía Meta Cloud API.")
                return {"success": True}
            error = self._graph_error(response)
            logger.error(f"Meta Cloud API rechazó el envío a +{payload['to']}: {error}")
            return {"success": False, "error": error}
        except requests.exceptions.RequestException as e:
            logger.error(f"Error de conexión con Meta Cloud API: {e}")
            return {"success": False, "error": str(e)}

    # ---------------- Estado ----------------
    def get_status(self) -> Dict[str, Any]:
        """Consulta el número en Graph API; mismo formato que el estado del gateway Baileys."""
        base = {"channel": "meta", "connected": False, "status": "NOT_CONFIGURED", "phone_number": None}
        if not self.is_configured():
            return base
        try:
            response = requests.get(
                f"{self._graph_url}/{settings.META_PHONE_NUMBER_ID}",
                params={"fields": "display_phone_number,verified_name,quality_rating"},
                headers=self._headers(), timeout=8
            )
            if not response.ok:
                return {**base, "status": "AUTH_ERROR", "error": self._graph_error(response)}
            data = response.json()
            phone = data.get("display_phone_number") or ""
            digits = "".join(filter(str.isdigit, phone))
            return {
                **base,
                "connected": True,
                "status": "CONNECTED",
                "phone_number": f"+{digits}" if digits else None,
                "verified_name": data.get("verified_name"),
                "quality_rating": data.get("quality_rating"),
            }
        except requests.exceptions.RequestException as e:
            return {**base, "status": "UNREACHABLE", "error": str(e)}

    # ---------------- Webhook ----------------
    def verify_subscription(self, mode: Optional[str], token: Optional[str]) -> bool:
        expected = settings.META_VERIFY_TOKEN
        return mode == "subscribe" and bool(expected and token) and hmac.compare_digest(token, expected)

    def verify_signature(self, raw_body: bytes, signature_header: Optional[str]) -> bool:
        """Valida X-Hub-Signature-256 = sha256=HMAC(app_secret, body). Sin App Secret no se acepta nada."""
        secret = settings.META_APP_SECRET
        if not secret or not signature_header or not signature_header.startswith("sha256="):
            return False
        expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature_header[7:], expected)

    def _is_new_message(self, message_id: str) -> bool:
        if not message_id:
            return True
        if message_id in self._seen_message_ids:
            return False
        self._seen_message_ids[message_id] = True
        while len(self._seen_message_ids) > SEEN_IDS_LIMIT:
            self._seen_message_ids.popitem(last=False)
        return True

    def extract_messages(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Normaliza el payload del webhook a [{from_number, text, audio_media_id, image_media_id, ...}].
        Ignora estados de entrega (sent/delivered/read), mensajes de otros números y duplicados.
        """
        messages = []
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                value = change.get("value") or {}
                metadata = value.get("metadata") or {}
                phone_id = metadata.get("phone_number_id")
                if settings.META_PHONE_NUMBER_ID and phone_id and phone_id != settings.META_PHONE_NUMBER_ID:
                    continue
                for msg in value.get("messages", []) or []:
                    if not self._is_new_message(msg.get("id", "")):
                        continue
                    msg_type = msg.get("type")
                    item = {
                        "from_number": "".join(filter(str.isdigit, str(msg.get("from", "")))),
                        "text": "",
                        "audio_media_id": None,
                        "audio_mime_type": None,
                        "image_media_id": None,
                        "image_mime_type": None,
                    }
                    if msg_type == "text":
                        item["text"] = (msg.get("text") or {}).get("body", "").strip()
                    elif msg_type == "audio":
                        item["audio_media_id"] = (msg.get("audio") or {}).get("id")
                        item["audio_mime_type"] = (msg.get("audio") or {}).get("mime_type") or "audio/ogg"
                    elif msg_type == "image":
                        image = msg.get("image") or {}
                        item["image_media_id"] = image.get("id")
                        item["image_mime_type"] = image.get("mime_type") or "image/jpeg"
                        item["text"] = (image.get("caption") or "").strip()
                    elif msg_type == "button":
                        item["text"] = (msg.get("button") or {}).get("text", "").strip()
                    elif msg_type == "interactive":
                        interactive = msg.get("interactive") or {}
                        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
                        item["text"] = (reply.get("title") or "").strip()
                    if item["from_number"] and (item["text"] or item["audio_media_id"] or item["image_media_id"]):
                        messages.append(item)
        return messages

    def download_media_base64(self, media_id: str) -> Optional[str]:
        """Descarga un adjunto (nota de voz o imagen) y lo devuelve en base64."""
        try:
            meta = requests.get(f"{self._graph_url}/{media_id}", headers=self._headers(), timeout=10)
            if not meta.ok:
                logger.error(f"No se pudo obtener el adjunto {media_id}: {self._graph_error(meta)}")
                return None
            info = meta.json()
            if int(info.get("file_size") or 0) > MAX_MEDIA_BYTES:
                logger.warning(f"Adjunto {media_id} demasiado grande ({info.get('file_size')} bytes); ignorado.")
                return None
            media = requests.get(info["url"], headers=self._headers(), timeout=20)
            if not media.ok:
                logger.error(f"Error descargando adjunto {media_id}: HTTP {media.status_code}")
                return None
            return base64.b64encode(media.content).decode("ascii")
        except (requests.exceptions.RequestException, KeyError, ValueError) as e:
            logger.error(f"Error descargando adjunto {media_id} de Meta: {e}")
            return None


meta_service = MetaCloudService()
