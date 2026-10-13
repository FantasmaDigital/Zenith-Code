import logging
from typing import List, Dict, Optional
from google import genai
from google.genai import types

from config import settings
from services.knowledge_service import knowledge_service
from services.lead_service import lead_service
from services.message_formatter import clean_chat_formatting

logger = logging.getLogger("asistente_operativo.gemini")

TRANSFER_MESSAGE = (
    "He tomado nota de tu solicitud. En un momento, un asesor humano revisará "
    "nuestra conversación y te contactará por este mismo medio."
)

TRANSFER_KEYWORDS = [
    "hablar con un humano",
    "asesor humano",
    "persona real",
    "quiero hablar con alguien",
    "comunicarme con un asesor",
    "atencion humana",
    "no eres una persona",
    "pasame con un humano",
    "agente humano",
    "asesor comercial humano"
]

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
        company_name = settings.COMPANY_NAME
        bot_name = settings.BOT_NAME
        bot_tone = settings.BOT_TONE
        brand_instructions = settings.BRAND_INSTRUCTIONS
        knowledge_context = knowledge_service.get_context_text()

        return f"""[IDENTIDAD Y ROL]
Eres "{bot_name}", el asistente oficial de inteligencia artificial de {company_name}. Tu misión es brindar atención comercial y operativa con máxima fidelidad, respondiendo con exactitud rigurosa basada ÚNICAMENTE en la información comprobada de la empresa.

[TONO Y PERSONALIDAD]
{bot_tone}
- Respuestas concisas: En WhatsApp y plataformas de chat, los mensajes largos aburren. Mantén tus respuestas en 1 a 3 párrafos cortos como máximo.

[POLÍTICA ESTRICTA DE TOLERANCIA CERO A LA ALUCINACIÓN - REGLA FUNDAMENTAL]
1. COMPROBACIÓN RIGUROSA: Solo puedes responder utilizando hechos comprobados que estén explícitamente escritos en la sección [BASE DE CONOCIMIENTO AUTORIZADA].
2. NUNCA INVENTES NI SUPONGAS: Está terminantemente prohibido deducir, extrapolar o inventar datos por cortesía, suposición o sentido común.
   - Si el usuario pregunta por HORARIOS DE ATENCIÓN (días u horas) y estos NO están explícitamente escritos en la base de conocimiento, NO inventes horarios ni asumas días (nunca inventes de lunes a viernes o sábados).
   - Si el usuario pregunta por PRECIOS, MÉTODOS DE PAGO, UBICACIÓN FÍSICA o POLÍTICAS y no constan en el texto, NO inventes tarifas ni condiciones.
3. PROTOCOLO OBLIGATORIO ANTE DATOS NO COMPROBADOS:
   Si cualquier dato consultado NO figura en la base de conocimiento o no está confirmado por la empresa, responde con total honestidad y transparencia:
   "Actualmente no cuento con esa información confirmada en mi base de datos, pero con gusto puedo transferirte con un asesor de nuestro equipo para que te lo aclare con exactitud."
4. FIDELIDAD TOTAL: Si una duda solo está respondida parcialmente en la base de conocimiento, responde únicamente la parte comprobada y aclara que el resto te lo confirmará un asesor.

[FORMATO VISUAL LIMPIO - CERO ASTERISCOS FEOS]
- PROHIBIDO usar asteriscos dobles (**) o viñetas con asteriscos (* **Texto:** o * Texto). No ensucies los mensajes con asteriscos crudos.
- Cuando listes servicios, características o soluciones, utiliza viñetas limpias con emojis atractivos (como 🔹 o •).
- Deja un salto de línea (doble espacio) entre párrafos y entre cada elemento de la lista para que el texto sea aireado, visualmente agradable y fácil de leer.
- NUNCA comprimas listas en una sola línea continua.

[DIRECTRICES DE LA MARCA]
{brand_instructions}

[FLUJO DE CALIFICACIÓN DE LEADS]
Cuando un usuario pregunte por servicios o proyectos, antes de cerrar la conversación, intenta recopilar de forma conversacional (una pregunta a la vez):
1. ¿Para qué tipo de proyecto o empresa necesita el servicio?
2. ¿Tienen algún tiempo de urgencia o fecha estimada?

[PROTOCOLO DE TRANSFERENCIA]
Si el usuario se molesta, hace preguntas fuera del alcance del negocio, o explícitamente pide hablar con un humano, detén la asistencia automatizada y responde exactamente:
"{TRANSFER_MESSAGE}"

[BASE DE CONOCIMIENTO AUTORIZADA - ÚNICA FUENTE DE VERDAD]
A continuación se detalla la única información oficial y comprobada. Cualquier dato que no figure aquí se considera DESCONOCIDO:
---------------------------------------------
{knowledge_context}
---------------------------------------------
"""

    def _detect_manual_transfer_triggers(self, user_message: str) -> bool:
        msg_lower = user_message.lower().strip()
        for kw in TRANSFER_KEYWORDS:
            if kw in msg_lower:
                return True
        return False

    def execute_reply(self, session_id: str, user_message: str) -> str:
        """
        Ejecuta la consulta contra Gemini. Lanza excepción si la API falla
        para permitir que el enrutador conmute al proveedor de respaldo.
        """
        session = lead_service.get_or_create_session(session_id)

        if session.transferred_to_human:
            return (
                "Un asesor humano ya tiene asignado tu caso y te responderá en breve. "
                "¡Agradecemos mucho tu paciencia!"
            )

        if self._detect_manual_transfer_triggers(user_message):
            lead_service.set_transferred(session_id, True)
            lead_service.add_message(session_id, "user", user_message)
            lead_service.add_message(session_id, "assistant", TRANSFER_MESSAGE)
            return TRANSFER_MESSAGE

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

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.0,
            max_output_tokens=400,
        )

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

        if TRANSFER_MESSAGE in assistant_reply:
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
