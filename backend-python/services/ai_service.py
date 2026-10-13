import logging
from config import settings
from services.gemini_service import gemini_service
from services.openai_service import openai_service
from services.lead_service import lead_service
from services.message_formatter import clean_chat_formatting

logger = logging.getLogger("asistente_operativo.ai_router")

class AIServiceRouter:
    """
    Enrutador central de IA con tolerancia a fallos y conmutación por error (Failover automático).
    Si el proveedor principal (Gemini u OpenAI) no conecta, tiene cuota agotada (429) o clave inválida,
    automáticamente conmuta al proveedor de respaldo de forma transparente.
    """
    @property
    def primary_provider(self) -> str:
        return settings.AI_PROVIDER.lower()

    @property
    def provider(self) -> str:
        return self.primary_provider

    @property
    def fallback_provider(self) -> str:
        return "openai" if self.primary_provider == "gemini" else "gemini"

    @property
    def active_model(self) -> str:
        if self.primary_provider == "gemini":
            return settings.GEMINI_MODEL
        return settings.OPENAI_MODEL

    def _call_engine(self, engine_name: str, session_id: str, user_message: str) -> str:
        if engine_name == "gemini":
            reply = gemini_service.execute_reply(session_id=session_id, user_message=user_message)
        else:
            reply = openai_service.execute_reply(session_id=session_id, user_message=user_message)
        return clean_chat_formatting(reply)

    def generate_reply(self, session_id: str, user_message: str) -> str:
        primary = self.primary_provider
        fallback = self.fallback_provider

        # 1. Intentar con el proveedor principal
        try:
            return self._call_engine(primary, session_id, user_message)
        except Exception as primary_err:
            logger.warning(
                f"[AI Failover] ⚠️ Falló el proveedor principal ({primary.upper()}): {primary_err}. "
                f"Conmutando inmediatamente al proveedor de respaldo ({fallback.upper()})..."
            )

        # 2. Conmutar automáticamente al proveedor de respaldo
        try:
            reply = self._call_engine(fallback, session_id, user_message)
            logger.info(
                f"[AI Failover] ✅ Respuesta generada exitosamente con el proveedor de respaldo ({fallback.upper()})."
            )
            return reply
        except Exception as fallback_err:
            logger.error(
                f"[AI Failover] ❌ Ambos proveedores de IA ({primary.upper()} y {fallback.upper()}) fallaron. "
                f"Detalle secundario: {fallback_err}"
            )

        # 3. Respuesta de contingencia si ambos motores fallan
        fallback_msg = (
            "Disculpa el inconveniente, en este momento estamos teniendo una breve intermitencia técnica. "
            "Un asesor tomará contacto contigo pronto."
        )
        lead_service.add_message(session_id, "user", user_message)
        lead_service.add_message(session_id, "assistant", fallback_msg)
        return fallback_msg

ai_service = AIServiceRouter()
