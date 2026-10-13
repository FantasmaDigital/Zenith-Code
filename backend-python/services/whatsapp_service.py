import logging
import requests
from typing import Dict, Any, Optional
from config import settings

logger = logging.getLogger("asistente_operativo.whatsapp_gateway")

class WhatsAppGatewayService:
    """
    Servicio de integración con el microservicio in-house de WhatsApp (Baileys).
    Utiliza 'requests' para enviar mensajes y consultar el estado sin depender de Meta.
    """
    def __init__(self):
        self.gateway_url = settings.WHATSAPP_GATEWAY_URL

    def send_text_message(self, to_phone: str, message_text: str) -> bool:
        """
        Envía un mensaje de texto a un destinatario a través del Gateway local de Baileys.
        """
        endpoint = f"{self.gateway_url}/api/send"
        payload = {
            "to": to_phone,
            "text": message_text
        }

        try:
            response = requests.post(endpoint, json=payload, timeout=10)
            response.raise_for_status()
            logger.info(f"Mensaje enviado con éxito a +{to_phone} vía WhatsApp Gateway.")
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"Error al enviar mensaje vía WhatsApp Gateway a {to_phone}: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Detalle Gateway: {e.response.text}")
            return False

    def get_status(self) -> Dict[str, Any]:
        """
        Consulta el estado de conexión del Gateway de WhatsApp.
        """
        endpoint = f"{self.gateway_url}/api/status"
        try:
            response = requests.get(endpoint, timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.warning(f"No se pudo consultar el estado del WhatsApp Gateway: {e}")
            return {
                "status": "UNREACHABLE",
                "connected": False,
                "error": str(e)
            }

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
