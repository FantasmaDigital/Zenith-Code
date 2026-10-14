import logging
from typing import List, Dict, Optional
from google import genai
from google.genai import types

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

logger = logging.getLogger("asistente_operativo.gemini")

TRANSFER_MESSAGE = DEFAULT_TRANSFER_MESSAGE

class GeminiService:
    @property
    def model(self) -> str:
        return settings.GEMINI_MODEL

    def _get_client(self) -> Optional[genai.Client]:
        key = settings.GEMINI_API_KEY.strip()
        if key and key != "tu_gemini_api_key_aqui":
            try:
                return genai.Client(api_key=key)
            except Exception as e:
                logger.error(f"Error al inicializar cliente de Gemini: {e}")
        return None

    def _build_system_prompt(self) -> str:
        return build_brand_system_prompt()

    def _detect_manual_transfer_triggers(self, user_message: str) -> bool:
        return detect_manual_transfer(user_message)

    def execute_reply(self, session_id: str, user_message: str) -> str:
        """
        Ejecuta la consulta contra Gemini. Lanza excepción si la API falla
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
            raise ValueError("GEMINI_API_KEY no configurada o formato inválido.")

        system_instruction = self._build_system_prompt()

        # Preparar historial
        contents: List[types.Content] = []
        recent_history = session.messages[-10:]

        for msg in recent_history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg["content"])]
                )
            )

        # Agregar mensaje actual
        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)]
            )
        )

        config_args = {
            "system_instruction": system_instruction,
            "temperature": 0.0,
            "max_output_tokens": 1500,
        }
        # En Gemini 2.5, deshabilitar thinking_budget para respuestas instantáneas y evitar que consuma el límite de tokens
        try:
            if hasattr(types, "ThinkingConfig"):
                config_args["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass

        config = types.GenerateContentConfig(**config_args)

        response = client.models.generate_content(
            model=self.model,
            contents=contents,
            config=config
        )
        assistant_reply = (response.text or "").strip()

        if not assistant_reply:
            assistant_reply = (
                "Actualmente no dispongo de ese dato específico. "
                "¿Podrías indicarme más detalles sobre tu requerimiento?"
            )

        # Formateo limpio: eliminar asteriscos toscos y estructurar con viñetas estéticas
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
            logger.error(f"Error en GeminiService: {e}")
            fallback = (
                "Disculpa el inconveniente, en este momento estamos teniendo una breve intermitencia técnica. "
                "Un asesor tomará contacto contigo pronto."
            )
            lead_service.add_message(session_id, "assistant", fallback)
            return fallback

gemini_service = GeminiService()
