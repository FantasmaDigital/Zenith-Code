import logging
import requests
from typing import Dict, Any, Optional
from config import settings
from services.meta_service import meta_service

logger = logging.getLogger("asistente_operativo.whatsapp_gateway")

class WhatsAppGatewayService:
    """
    Servicio de integración con el microservicio in-house de WhatsApp (Baileys).
    Utiliza 'requests' para enviar mensajes y consultar el estado sin depender de Meta.
    """
    def __init__(self):
        # Último error de envío (p. ej. ventana de 24 h de Meta) para mostrarlo en el panel
        self.last_send_error: Optional[str] = None

    @property
    def channel(self) -> str:
        """Canal activo: 'meta' (Cloud API oficial) o 'baileys' (gateway in-house)."""
        return "meta" if settings.WHATSAPP_CHANNEL == "meta" else "baileys"

    @property
    def gateway_url(self) -> str:
        return settings.WHATSAPP_GATEWAY_URL

    @staticmethod
    def _auth_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Headers con la clave interna compartida que exige el gateway."""
        headers = {"X-Internal-Key": settings.INTERNAL_API_KEY}
        if extra:
            headers.update(extra)
        return headers

    def _candidate_urls(self) -> list[str]:
        """
        Retorna candidatos de conexión resolviendo automáticamente entre Docker y host local.
        """
        primary = self.gateway_url
        candidates = [primary]
        if "localhost" in primary or "127.0.0.1" in primary:
            docker_url = primary.replace("localhost", "whatsapp-gateway").replace("127.0.0.1", "whatsapp-gateway")
            if docker_url not in candidates:
                candidates.append(docker_url)
        elif "whatsapp-gateway" in primary:
            local_url = primary.replace("whatsapp-gateway", "localhost")
            if local_url not in candidates:
                candidates.append(local_url)
        return candidates

    def send_text_message(self, to_phone: str, message_text: str) -> bool:
        """
        Envía un mensaje de texto por el canal activo (Meta Cloud API o Gateway de Baileys).
        """
        self.last_send_error = None
        if self.channel == "meta":
            result = meta_service.send_text_message(to_phone, message_text)
            self.last_send_error = result.get("error")
            return bool(result.get("success"))

        candidates = self._candidate_urls()
        payload = {
            "to": to_phone,
            "text": message_text
        }

        for base_url in candidates:
            endpoint = f"{base_url}/api/send"
            try:
                response = requests.post(endpoint, json=payload, headers=self._auth_headers(), timeout=10)
                if response.status_code in (200, 201):
                    logger.info(f"Mensaje enviado con éxito a +{to_phone} vía WhatsApp Gateway ({base_url}).")
                    return True
            except requests.exceptions.RequestException as e:
                logger.error(f"Error al enviar mensaje vía WhatsApp Gateway ({base_url}) a {to_phone}: {e}")

        return False

    def add_chat_label(self, to_phone: str, tag: str, note: Optional[str] = None) -> bool:
        """
        Asigna una etiqueta nativa en WhatsApp Business al chat del cliente a través del Gateway de Baileys.
        Meta Cloud API no expone etiquetas de chat, así que en ese canal no aplica.
        """
        if self.channel == "meta":
            return False
        candidates = self._candidate_urls()
        payload = {
            "to": to_phone,
            "tag": tag,
            "note": note or ""
        }

        for base_url in candidates:
            endpoint = f"{base_url}/api/chat/label"
            try:
                response = requests.post(endpoint, json=payload, headers=self._auth_headers(), timeout=8)
                if response.status_code in (200, 201):
                    logger.info(f"🏷️ Etiqueta WhatsApp Business [{tag}] asignada a +{to_phone} vía ({base_url}).")
                    return True
            except requests.exceptions.RequestException as e:
                logger.debug(f"Aviso al asignar etiqueta WhatsApp Business ({base_url}) a {to_phone}: {e}")

        return False

    def get_status(self) -> Dict[str, Any]:
        """Estado del canal activo, con el mismo formato para Meta y Baileys."""
        if self.channel == "meta":
            return meta_service.get_status()
        return {**self.get_baileys_status(), "channel": "baileys"}

    def get_baileys_status(self) -> Dict[str, Any]:
        """
        Consulta el estado de conexión del Gateway de WhatsApp con resolución automática de red.
        """
        candidates = self._candidate_urls()
        last_error = None
        for base_url in candidates:
            endpoint = f"{base_url}/api/status"
            try:
                response = requests.get(endpoint, headers=self._auth_headers(), timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    data["resolved_url"] = base_url
                    user_data = data.get("user") or {}
                    user_id = str(user_data.get("id") or "")
                    if user_id:
                        raw_num = user_id.split(":")[0].split("@")[0]
                        data["phone_number"] = f"+{raw_num}" if raw_num else ""
                    else:
                        data["phone_number"] = ""
                    return data
            except requests.exceptions.RequestException as e:
                last_error = e

        logger.warning(f"No se pudo consultar el estado del WhatsApp Gateway en {candidates}: {last_error}")
        return {
            "status": "UNREACHABLE",
            "connected": False,
            "error": str(last_error)
        }

    def get_qr(self) -> Dict[str, Any]:
        """
        Obtiene el código QR y estado desde el WhatsApp Gateway.
        """
        if self.channel == "meta":
            return {"status": "NOT_APPLICABLE", "qrString": None, "qrDataUrl": None, "channel": "meta"}
        candidates = self._candidate_urls()
        last_error = None
        for base_url in candidates:
            endpoint = f"{base_url}/api/qr"
            try:
                response = requests.get(endpoint, headers=self._auth_headers(), timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    data["resolved_url"] = base_url
                    return data
            except requests.exceptions.RequestException as e:
                last_error = e

        logger.warning(f"No se pudo consultar el QR del WhatsApp Gateway en {candidates}: {last_error}")
        return {
            "status": "UNREACHABLE",
            "qrString": None,
            "qrDataUrl": None,
            "error": str(last_error)
        }

    def logout(self) -> bool:
        """
        Desvincula la sesión activa de WhatsApp en el Gateway.
        """
        if self.channel == "meta":
            return False
        candidates = self._candidate_urls()
        for base_url in candidates:
            endpoint = f"{base_url}/api/logout"
            try:
                response = requests.post(endpoint, headers=self._auth_headers({"Accept": "application/json"}), timeout=5)
                if response.status_code in (200, 302):
                    return True
            except requests.exceptions.RequestException as e:
                logger.error(f"Error al desvincular sesión en {base_url}: {e}")
        return False

    @staticmethod
    def parse_incoming_webhook(payload: Dict[str, Any]) -> Optional[Dict[str, str]]:
        """
        Normaliza mensajes entrantes provenientes del gateway o webhook HTTP.
        Soporta formato { sender/from_number, message/text }.
        """
        sender = payload.get("sender") or payload.get("from_number") or payload.get("from")
        text = payload.get("message") or payload.get("text") or payload.get("body")

        if sender and text:
            # Limpiar caracteres no numéricos del número
            clean_sender = "".join(filter(str.isdigit, str(sender)))
            return {
                "from_number": clean_sender,
                "text": str(text).strip()
            }
        return None

whatsapp_service = WhatsAppGatewayService()
