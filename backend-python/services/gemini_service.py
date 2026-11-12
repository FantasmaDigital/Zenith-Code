import base64
import hashlib
import logging
import time
from typing import List, Dict, Optional
from google import genai
from google.genai import types

from config import settings
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services import agent_tools, agents, metrics_service as metrics
from services.multimodal_service import multimodal_service
from services.message_formatter import clean_chat_formatting, strip_repetitive_greeting
from services.prompt_service import (
    DEFAULT_TRANSFER_MESSAGE,
    TRANSFER_KEYWORDS,
    build_brand_system_prompt,
    get_effective_transfer_message,
    detect_manual_transfer,
    get_live_context,
    REPLY_TEMPERATURE,
    REPLY_MAX_TOKENS,
)

logger = logging.getLogger("asistente_operativo.gemini")

TRANSFER_MESSAGE = DEFAULT_TRANSFER_MESSAGE

CACHE_TTL_SECONDS = 3600


class GeminiService:
    def __init__(self):
        # (modelo, hash del prompt) -> (nombre del caché en Gemini, expira_en)
        self._prompt_cache: Dict[tuple, tuple] = {}

    def _get_cached_prompt(self, client: genai.Client, system_instruction: str, tools=None,
                           tools_sig: str = "") -> Optional[str]:
        """
        Sube las instrucciones del sistema una sola vez al caché de contexto de Gemini y reutiliza
        su nombre en cada mensaje: el prompt se cobra a tarifa de caché en lugar de releerse completo.
        Se regenera solo cuando cambian las directrices/base de conocimiento (cambia el hash) o expira.
        Devuelve None si no se puede cachear (p. ej. prompt menor al mínimo de tokens del modelo).
        """
        # Las herramientas viajan dentro del caché (Gemini no permite enviarlas aparte con un caché)
        key = (self.model, hashlib.sha256(system_instruction.encode("utf-8")).hexdigest(), tools_sig)
        entry = self._prompt_cache.get(key)
        if entry and entry[1] > time.time() + 60:
            return entry[0]
        try:
            cache = client.caches.create(
                model=self.model,
                config=types.CreateCachedContentConfig(
                    system_instruction=system_instruction,
                    tools=tools or None,
                    ttl=f"{CACHE_TTL_SECONDS}s",
                    display_name="zenith-system-prompt",
                ),
            )
        except Exception as e:
            logger.info(f"Caché de contexto no disponible, se envía el prompt completo: {e}")
            self._prompt_cache = {key: (None, time.time() + CACHE_TTL_SECONDS)}  # no reintentar en cada mensaje
            return None
        self._prompt_cache = {key: (cache.name, time.time() + CACHE_TTL_SECONDS)}
        return cache.name

    def _generate(self, client: genai.Client, system_instruction: str, contents, config_args: dict,
                  tools=None, tools_sig: str = ""):
        cache_name = self._get_cached_prompt(client, system_instruction, tools, tools_sig)
        if cache_name:
            try:
                return client.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(cached_content=cache_name, **config_args),
                )
            except Exception as e:
                # Caché borrado/expirado en el servidor: olvidarlo y reintentar con el prompt completo
                logger.warning(f"Fallo usando caché de contexto ({cache_name}): {e}")
                self._prompt_cache = {}
        return client.models.generate_content(
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=system_instruction, tools=tools or None, **config_args),
        )


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

    def _build_system_prompt(self, agent_key: Optional[str] = None) -> str:
        return build_brand_system_prompt(agent_key)

    def _detect_manual_transfer_triggers(self, user_message: str) -> bool:
        return detect_manual_transfer(user_message)

    def execute_reply(
        self,
        session_id: str,
        user_message: str = "",
        audio_base64: Optional[str] = None,
        audio_mime_type: Optional[str] = "audio/ogg",
        image_base64: Optional[str] = None,
        image_mime_type: Optional[str] = "image/jpeg"
    ) -> str:
        """
        Ejecuta la consulta multimodal contra Gemini (texto, notas de voz, imágenes/comprobantes).
        Lanza excepción si la API falla para permitir que el enrutador conmute al proveedor de respaldo.
        """
        session = lead_service.get_or_create_session(session_id)

        if session.transferred_to_human:
            return ""

        effective_transfer_msg = get_effective_transfer_message()

        if user_message and self._detect_manual_transfer_triggers(user_message):
            lead_service.set_transferred(session_id, True)
            lead_service.add_message(session_id, "user", user_message)
            lead_service.add_message(session_id, "assistant", effective_transfer_msg)
            return effective_transfer_msg

        client = self._get_client()
        if not client:
            raise ValueError("GEMINI_API_KEY no configurada o formato inválido.")

        # Área especializada que atiende este mensaje (Recepción, Ventas, Soporte)
        agent_key, agent_note = agents.route(session_id, user_message or "")

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

        # Construir partes del mensaje actual (texto, nota de voz y/o comprobante) vía servicio de dominio
        current_parts, history_entry = multimodal_service.build_gemini_parts(
            text=user_message,
            audio_base64=audio_base64,
            audio_mime_type=audio_mime_type,
            image_base64=image_base64,
            image_mime_type=image_mime_type
        )

        # Datos volátiles (hora, abierto/cerrado, stock) van aquí y no en el system prompt, para que este
        # sea idéntico entre mensajes y se sirva desde el caché de contexto.
        live = get_live_context(session_id)
        if live:
            current_parts = [types.Part.from_text(text=live)] + list(current_parts)

        contents.append(
            types.Content(
                role="user",
                parts=current_parts
            )
        )

        config_args = {
            "temperature": REPLY_TEMPERATURE,
            "max_output_tokens": REPLY_MAX_TOKENS,
        }
        # En Gemini 2.5, deshabilitar thinking_budget para respuestas instantáneas
        try:
            if hasattr(types, "ThinkingConfig"):
                config_args["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass

        # Bucle de herramientas: el modelo pide acciones, el servidor las ejecuta y le devuelve el resultado.
        # Si el área deriva a otra (derivar_a_area), la nueva área responde en este mismo turno (una vez).
        base_contents = list(contents)

        def run_agent(area: Optional[str]):
            convo = list(base_contents)
            system_instruction = self._build_system_prompt(area)
            tools = agent_tools.all_tools(area)
            gemini_tools = agent_tools.gemini_tools(tools) if tools else None
            tools_sig = agent_tools.signature(tools) if tools else ""
            run_ctx = agent_tools.ToolContext(session_id=session_id, agent=area)
            metrics.note_agent(area)
            response = None
            for _ in range(agent_tools.MAX_TOOL_ROUNDS):
                response = self._generate(client, system_instruction, convo, config_args, gemini_tools, tools_sig)
                metrics.gemini_usage(response)
                calls = response.function_calls or []
                metrics.note_tools([c.name for c in calls])
                if not calls:
                    break
                convo.append(response.candidates[0].content)
                results = [
                    types.Part.from_function_response(
                        name=call.name, response=agent_tools.execute(tools, call.name, call.args, run_ctx))
                    for call in calls
                ]
                convo.append(types.Content(role="tool", parts=results))
                if run_ctx.end_turn:
                    break
            text = ""
            if response is not None and not run_ctx.end_turn:
                try:
                    text = (response.text or "").strip()
                except Exception:
                    text = ""
            return text, run_ctx

        model_text, ctx = run_agent(agent_key)
        if ctx.reroute:
            first = ctx
            agents.route_to(session_id, ctx.reroute)
            model_text, ctx = run_agent(ctx.reroute)
            ctx.actions = first.actions + ctx.actions  # la bandeja muestra la derivación y lo que hizo la nueva área
        assistant_reply = agent_tools.compose_reply(model_text, ctx)

        if not assistant_reply:
            assistant_reply = (
                "Actualmente no dispongo de ese dato específico. "
                "¿Podrías indicarme más detalles sobre tu requerimiento?"
            )

        # Formateo limpio: eliminar asteriscos toscos y estructurar con viñetas estéticas
        assistant_reply = clean_chat_formatting(assistant_reply)
        has_history = len(recent_history) > 0
        assistant_reply = strip_repetitive_greeting(assistant_reply, has_history=has_history, user_message=user_message)

        already_transferred = any(a["tool"] == "transferir_a_asesor" and a["ok"] for a in ctx.actions)
        if not already_transferred and (
                (effective_transfer_msg and effective_transfer_msg in assistant_reply) or (DEFAULT_TRANSFER_MESSAGE in assistant_reply)):
            lead_service.set_transferred(session_id, True)

        lead_service.add_message(session_id, "user", history_entry)
        if agent_note:
            agents.log_note(session_id, agent_note)
        agent_tools.log_actions(ctx)
        lead_service.add_message(session_id, "assistant", assistant_reply)
        return assistant_reply

    def generate_reply(
        self,
        session_id: str,
        user_message: str = "",
        audio_base64: Optional[str] = None,
        audio_mime_type: Optional[str] = "audio/ogg",
        image_base64: Optional[str] = None,
        image_mime_type: Optional[str] = "image/jpeg"
    ) -> str:
        try:
            return self.execute_reply(
                session_id=session_id,
                user_message=user_message,
                audio_base64=audio_base64,
                audio_mime_type=audio_mime_type,
                image_base64=image_base64,
                image_mime_type=image_mime_type
            )
        except Exception as e:
            logger.error(f"Error en GeminiService: {e}")
            fallback = (
                "Disculpa el inconveniente, en este momento estamos teniendo una breve intermitencia técnica. "
                "Un asesor tomará contacto contigo pronto."
            )
            lead_service.add_message(session_id, "assistant", fallback)
            return fallback

gemini_service = GeminiService()
