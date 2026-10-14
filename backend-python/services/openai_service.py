import logging
from typing import List, Dict, Optional
from openai import OpenAI
from config import settings
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services.message_formatter import clean_chat_formatting
from services.prompt_service import (
    DEFAULT_TRANSFER_MESSAGE,
    TRANSFER_KEYWORDS,
    build_brand_system_prompt,
    get_effective_transfer_message,
    detect_manual_transfer
)

logger = logging.getLogger("asistente_operativo.openai")

TRANSFER_MESSAGE = DEFAULT_TRANSFER_MESSAGE

class OpenAIService:
    @property
    def model(self) -> str:
        return settings.OPENAI_MODEL

    def _get_client(self) -> Optional[OpenAI]:
        key = settings.OPENAI_API_KEY.strip()
        if key and key != "tu_openai_api_key_aqui":
            try:
                return OpenAI(api_key=key)
            except Exception as e:
                logger.error(f"Error inicializando cliente de OpenAI: {e}")
        return None

    def _build_system_prompt(self) -> str:
        return build_brand_system_prompt()

    def _detect_manual_transfer_triggers(self, user_message: str) -> bool:
        return detect_manual_transfer(user_message)

    def execute_reply(self, session_id: str, user_message: str) -> str:
        """
        Ejecuta la consulta contra OpenAI. Lanza excepción si la API falla
        para permitir que el enrutador conmute al proveedor de respaldo.
        """
        session = lead_service.get_or_create_session(session_id)

        if session.transferred_to_human:
            return ""

        effective_transfer_msg = get_effective_transfer_message()

        if self._detect_manual_transfer_triggers(user_message):
            lead_service.set_transferred(session_id, True)
            lead_service.add_message(session_id, "user", user_message)
            lead_service.add_message(session_id, "assistant", effective_transfer_msg)
            return effective_transfer_msg

        client = self._get_client()
        if not client:
            raise ValueError("OPENAI_API_KEY no configurada o formato inválido.")

        system_prompt = self._build_system_prompt()
        messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]

        recent_history = session.messages[-10:]
        messages.extend(recent_history)
        messages.append({"role": "user", "content": user_message})

        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.0,
            max_tokens=1500
        )
        assistant_reply = (response.choices[0].message.content or "").strip()
        assistant_reply = clean_chat_formatting(assistant_reply)

        if (effective_transfer_msg and effective_transfer_msg in assistant_reply) or (DEFAULT_TRANSFER_MESSAGE in assistant_reply):
            lead_service.set_transferred(session_id, True)

        lead_service.add_message(session_id, "user", user_message)
        lead_service.add_message(session_id, "assistant", assistant_reply)
        return assistant_reply

    def generate_reply(self, session_id: str, user_message: str) -> str:
        try:
            return self.execute_reply(session_id, user_message)
        except Exception as e:
            logger.error(f"Error en OpenAIService: {e}")
            fallback = (
                "Disculpa el inconveniente, en este momento estamos teniendo una breve intermitencia técnica. "
                "Un asesor tomará contacto contigo pronto."
            )
            lead_service.add_message(session_id, "assistant", fallback)
            return fallback

openai_service = OpenAIService()
