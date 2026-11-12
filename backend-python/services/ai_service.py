import logging
import time
from config import settings
from services.gemini_service import gemini_service
from services.openai_service import openai_service
from services.lead_service import lead_service
from services.message_formatter import clean_chat_formatting
from services.prompt_service import guard_reply, sanitize_user_message

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

    def _call_engine(
        self,
        engine_name: str,
        session_id: str,
        user_message: str = "",
        audio_base64: str = None,
        audio_mime_type: str = "audio/ogg",
        image_base64: str = None,
        image_mime_type: str = "image/jpeg",
        **kwargs
    ) -> str:
        from services import metrics_service as metrics
        metrics.start_run()
        started = time.monotonic()
        model = settings.GEMINI_MODEL if engine_name == "gemini" else settings.OPENAI_MODEL
        try:
            reply = self._run_engine(engine_name, session_id, user_message, audio_base64, audio_mime_type,
                                     image_base64, image_mime_type)
        except Exception as e:
            metrics.metrics_service.record_run(session_id, engine_name, model, started, "error", str(e))
            raise
        outcome = "ok" if engine_name == self.primary_provider else "fallback"
        metrics.metrics_service.record_run(session_id, engine_name, model, started, outcome)
        return reply

    def _run_engine(self, engine_name, session_id, user_message, audio_base64, audio_mime_type,
                    image_base64, image_mime_type) -> str:
        if engine_name == "gemini":
            reply = gemini_service.execute_reply(
                session_id=session_id,
                user_message=user_message,
                audio_base64=audio_base64,
                audio_mime_type=audio_mime_type,
                image_base64=image_base64,
                image_mime_type=image_mime_type
            )
        else:
            reply = openai_service.execute_reply(session_id=session_id, user_message=user_message or "[Audio/Imagen]")
        reply = clean_chat_formatting(reply)
        guarded = guard_reply(reply)
        if guarded != reply:
            # el historial debe guardar lo que realmente se envió, no la respuesta bloqueada
            lead_service.replace_last_assistant_message(session_id, guarded)
            return guarded
        return self._apply_module_actions(session_id, reply)

    @staticmethod
    def _apply_module_actions(session_id: str, reply: str) -> str:
        """Deja que los módulos activos actúen sobre la respuesta (p. ej. crear un pedido) y alinea el historial."""
        try:
            from modules.registry import module_registry
            processed = module_registry.process_reply(session_id, reply)
        except Exception as e:
            logger.error(f"Error aplicando acciones de módulos a la respuesta: {e}")
            return reply
        if processed != reply:
            # la IA (y el historial guardado) deben ver lo que realmente se le dijo al cliente
            lead_service.replace_last_assistant_message(session_id, processed)
        return processed

    def generate_reply(
        self,
        session_id: str,
        user_message: str = "",
        audio_base64: str = None,
        audio_mime_type: str = "audio/ogg",
        image_base64: str = None,
        image_mime_type: str = "image/jpeg"
    ) -> str:
        primary = self.primary_provider
        fallback = self.fallback_provider
        user_message = sanitize_user_message(user_message)

        # 1. Intentar con el proveedor principal
        try:
            return self._call_engine(
                primary,
                session_id,
                user_message,
                audio_base64=audio_base64,
                audio_mime_type=audio_mime_type,
                image_base64=image_base64,
                image_mime_type=image_mime_type
            )
        except Exception as primary_err:
            logger.warning(
                f"[AI Failover] ⚠️ Falló el proveedor principal ({primary.upper()}): {primary_err}. "
                f"Conmutando inmediatamente al proveedor de respaldo ({fallback.upper()})..."
            )

        # 2. Conmutar automáticamente al proveedor de respaldo
        try:
            reply = self._call_engine(
                fallback,
                session_id,
                user_message,
                audio_base64=audio_base64,
                audio_mime_type=audio_mime_type,
                image_base64=image_base64,
                image_mime_type=image_mime_type
            )
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
        history_entry = (user_message or "").strip()
        if audio_base64:
            history_entry = f"🎙️ [Nota de voz] {history_entry}".strip()
        if image_base64:
            history_entry = f"🖼️ [Comprobante / Imagen] {history_entry}".strip()
        lead_service.add_message(session_id, "user", history_entry or "[Audio/Imagen]")
        lead_service.add_message(session_id, "assistant", fallback_msg)
        return fallback_msg

ai_service = AIServiceRouter()
