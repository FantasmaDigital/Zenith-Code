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
    @property
    def gateway_url(self) -> str:
        return settings.WHATSAPP_GATEWAY_URL

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
        Envía un mensaje de texto a un destinatario a través del Gateway de Baileys.
        """
        candidates = self._candidate_urls()
        payload = {
            "to": to_phone,
            "text": message_text
        }

        for base_url in candidates:
            endpoint = f"{base_url}/api/send"
            try:
                response = requests.post(endpoint, json=payload, timeout=10)
                if response.status_code in (200, 201):
                    logger.info(f"Mensaje enviado con éxito a +{to_phone} vía WhatsApp Gateway ({base_url}).")
                    return True
            except requests.exceptions.RequestException as e:
                logger.error(f"Error al enviar mensaje vía WhatsApp Gateway ({base_url}) a {to_phone}: {e}")

        return False

    def add_chat_label(self, to_phone: str, tag: str, note: Optional[str] = None) -> bool:
        """
        Asigna una etiqueta nativa en WhatsApp Business al chat del cliente a través del Gateway de Baileys.
        """
        candidates = self._candidate_urls()
        payload = {
            "to": to_phone,
            "tag": tag,
            "note": note or ""
        }

        for base_url in candidates:
            endpoint = f"{base_url}/api/chat/label"
            try:
                response = requests.post(endpoint, json=payload, timeout=8)
                if response.status_code in (200, 201):
                    logger.info(f"🏷️ Etiqueta WhatsApp Business [{tag}] asignada a +{to_phone} vía ({base_url}).")
                    return True
            except requests.exceptions.RequestException as e:
                logger.debug(f"Aviso al asignar etiqueta WhatsApp Business ({base_url}) a {to_phone}: {e}")

        return False

    def get_status(self) -> Dict[str, Any]:
        """
        Consulta el estado de conexión del Gateway de WhatsApp con resolución automática de red.
        """
        candidates = self._candidate_urls()
        last_error = None
        for base_url in candidates:
            endpoint = f"{base_url}/api/status"
            try:
                response = requests.get(endpoint, timeout=3)
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
        candidates = self._candidate_urls()
        last_error = None
        for base_url in candidates:
            endpoint = f"{base_url}/api/qr"
            try:
                response = requests.get(endpoint, timeout=3)
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
        candidates = self._candidate_urls()
        for base_url in candidates:
            endpoint = f"{base_url}/api/logout"
            try:
                response = requests.post(endpoint, headers={"Accept": "application/json"}, timeout=5)
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
