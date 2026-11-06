import logging
from typing import List, Dict, Optional
from openai import OpenAI
from config import settings
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services.message_formatter import clean_chat_formatting
import json

from services import agent_tools, agents, metrics_service as metrics
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

    def _build_system_prompt(self, agent_key: Optional[str] = None) -> str:
        return build_brand_system_prompt(agent_key)

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

        agent_key, agent_note = agents.route(session_id, user_message or "")
        messages: List[Dict] = [{"role": "system", "content": ""}]

        recent_history = session.messages[-10:]
        messages.extend(recent_history)
        live = get_live_context(session_id)  # datos volátiles fuera del system prompt para no romper el caché
        messages.append({"role": "user", "content": f"{live}\n{user_message}" if live else user_message})

        # Bucle de herramientas; si el área deriva a otra, la nueva responde en este mismo turno (una vez)
        base_messages = messages[1:]

        def run_agent(area):
            convo = [{"role": "system", "content": self._build_system_prompt(area)}] + list(base_messages)
            return self._tool_loop(client, convo, area, session_id)

        model_text, ctx = run_agent(agent_key)
        if ctx.reroute:
            first = ctx
            agents.route_to(session_id, ctx.reroute)
            model_text, ctx = run_agent(ctx.reroute)
            ctx.actions = first.actions + ctx.actions
        assistant_reply = clean_chat_formatting(agent_tools.compose_reply(model_text, ctx))

        already_transferred = any(a["tool"] == "transferir_a_asesor" and a["ok"] for a in ctx.actions)
        if not already_transferred and (
                (effective_transfer_msg and effective_transfer_msg in assistant_reply) or (DEFAULT_TRANSFER_MESSAGE in assistant_reply)):
            lead_service.set_transferred(session_id, True)

        lead_service.add_message(session_id, "user", user_message)
        if agent_note:
            agents.log_note(session_id, agent_note)
        agent_tools.log_actions(ctx)
        lead_service.add_message(session_id, "assistant", assistant_reply)
        return assistant_reply

    def _tool_loop(self, client, messages: List[Dict], area, session_id: str):
        tools = agent_tools.all_tools(area)
        ctx = agent_tools.ToolContext(session_id=session_id, agent=area)
        metrics.note_agent(area)
        model_text = ""
        for _ in range(agent_tools.MAX_TOOL_ROUNDS):
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=REPLY_TEMPERATURE,
                max_tokens=REPLY_MAX_TOKENS,
                tools=agent_tools.openai_tools(tools) if tools else None,
                # El prompt de sistema es idéntico entre mensajes: OpenAI lo sirve desde su caché (más barato);
                # la clave agrupa las peticiones en el mismo nodo para maximizar los aciertos.
                prompt_cache_key="zenith-system-prompt"
            )
            metrics.openai_usage(response)
            msg = response.choices[0].message
            calls = msg.tool_calls or []
            metrics.note_tools([c.function.name for c in calls])
            if not calls:
                model_text = (msg.content or "").strip()
                break
            messages.append(msg.model_dump(exclude_none=True))
            for call in calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                except ValueError:
                    args = {}
                result = agent_tools.execute(tools, call.function.name, args, ctx)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)})
            if ctx.end_turn:
                break
        return model_text, ctx

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
