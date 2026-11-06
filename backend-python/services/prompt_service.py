import logging
from typing import List, Optional
from config import settings
from services.knowledge_service import knowledge_service

logger = logging.getLogger("asistente_operativo.prompt_service")

DEFAULT_TRANSFER_MESSAGE = (
    "He tomado nota de tu solicitud. En un momento, un asesor humano revisará "
    "nuestra conversación y te contactará por este mismo medio."
)

TRANSFER_KEYWORDS: List[str] = [
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

def get_effective_transfer_message() -> str:
    """Retorna el mensaje de transferencia configurado en la BD o el por defecto."""
    val = (getattr(settings, "TRANSFER_MESSAGE", None) or "").strip()
    return val if val else DEFAULT_TRANSFER_MESSAGE

def detect_manual_transfer(user_message: str) -> bool:
    """Detecta si el mensaje del usuario pide explícitamente pasar a un asesor humano."""
    msg_lower = (user_message or "").lower().strip()
    for kw in TRANSFER_KEYWORDS:
        if kw in msg_lower:
            return True
    return False

REPLY_TEMPERATURE = 0.6      # algo de variación para sonar humano, sin inventar datos
REPLY_MAX_TOKENS = 450       # mensajes de chat: cortos


def get_live_context(session_id: Optional[str] = None) -> str:
    """Nota breve que acompaña al mensaje actual (no se guarda en historial ni en el prompt cacheado):
    datos volátiles de los módulos + memoria del cliente."""
    parts = []
    try:
        from modules.registry import module_registry
        text = module_registry.get_live_context()
        if text:
            parts.append(f"[CONTEXTO EN VIVO, no lo menciones: {text}]")
    except Exception as e:
        logger.debug(f"Aviso consultando contexto en vivo: {e}")
    if session_id:
        try:
            from services.customer_service import customer_service
            memory = customer_service.memory_context(session_id)
            if memory:
                parts.append(memory)
        except Exception as e:
            logger.debug(f"Aviso consultando memoria del cliente: {e}")
    return "\n".join(parts)


def get_effective_welcome() -> dict:
    """
    Saludo único que usa la IA. Regla: el saludo del perfil es el predeterminado para cualquier negocio;
    si un módulo activo (p. ej. Restaurante) define su propio saludo, ese lo reemplaza. Nunca se mezclan.
    """
    try:
        from modules.registry import module_registry
        override = module_registry.get_welcome_override()
        if override:
            return {"text": override["text"], "source": override["module"], "source_name": override["name"]}
    except Exception as e:
        logger.debug(f"Aviso consultando saludo de módulos: {e}")
    text = (getattr(settings, "WELCOME_MESSAGE", None) or "").strip()
    return {"text": text, "source": "profile" if text else "", "source_name": "Perfil" if text else ""}


def build_brand_system_prompt(agent_key: Optional[str] = None) -> str:
    """
    Construye el System Prompt definitivo para la IA, garantizando que el 100%
    de la información del perfil y Brand Settings (nombre, bot, tono, directrices,
    bienvenida, contacto, web, transferencia) sea respetada rigurosamente.
    """
    company_name = (getattr(settings, "COMPANY_NAME", None) or "Empresa").strip()
    bot_name = (getattr(settings, "BOT_NAME", None) or "Asistente Operativo").strip()
    bot_tone = (getattr(settings, "BOT_TONE", None) or "Profesional y moderno").strip()
    brand_instructions = (getattr(settings, "BRAND_INSTRUCTIONS", None) or "").strip()
    welcome_message = get_effective_welcome()["text"]
    transfer_message = get_effective_transfer_message()
    effective_phone = settings.get_effective_support_phone()
    website_url = (getattr(settings, "WEBSITE_URL", None) or "").strip()
    welcome_section = ""
    if welcome_message:
        welcome_section = (f'\n[SALUDO]\nEn el primer mensaje o si preguntan quién eres, saluda inspirándote en: "{welcome_message}". '
                           f'Preséntate como {bot_name} de {company_name}.\n')

    brand_section = f"\n[REGLAS DE LA MARCA - MÁXIMA PRIORIDAD]\n{brand_instructions}\n" if brand_instructions else ""

    # Contexto de base de conocimiento (In-Memory Hot Cache)
    knowledge_context = knowledge_service.get_context_text()

    # Extensiones dinámicas de módulos instalados (p. ej. Menú de Restaurante)
    mod_extensions = ""
    restaurant_active = False
    try:
        from modules.registry import module_registry
        mod_extensions = (module_registry.get_prompt_extensions() or "").strip()
        restaurant_active = module_registry.is_loaded("restaurant")
    except Exception as e:
        logger.debug(f"Aviso consultando extensiones de módulos: {e}")

    sources = "la BASE DE CONOCIMIENTO" + (", los MÓDULOS ACTIVOS" if mod_extensions else "") + " y este perfil"
    if restaurant_active:
        flow = "- Es un restaurante: guía al cliente a ver el menú y pedir, según las reglas del módulo."
    else:
        flow = ("- Si preguntan por servicios o proyectos, averigua conversando (una pregunta a la vez) "
                "qué tipo de proyecto/empresa es y si hay fecha o urgencia.")

    contact = []
    if effective_phone:
        contact.append(f"teléfono/WhatsApp {effective_phone}")
    if website_url:
        contact.append(f"web {website_url}")
    contact_line = f"\n- Contacto oficial: {', '.join(contact)}." if contact else ""

    prompt = f"""Eres {bot_name}, quien atiende el chat de {company_name}. Hablas como una persona real del equipo: cercano, natural y útil.
Tono: {bot_tone}.{contact_line}
{welcome_section}{brand_section}
[ESTILO]
- Mensajes cortos de chat (1 a 3 párrafos breves), una pregunta a la vez. Español salvadoreño natural, sin jerga excesiva.
- Sin asteriscos ni markdown. Para listas usa viñetas • o emojis, un elemento por línea.

[VERDAD]
- Solo usa datos de {sources}. No inventes precios, horarios, pagos, ubicaciones ni políticas.
- Si no tienes un dato, dilo con naturalidad y ofrece pasarle con un asesor. Si solo sabes una parte, responde esa parte.
{flow}

[MULTIMEDIA]
- Notas de voz: entiéndelas (acento salvadoreño) y responde por escrito.
- Foto de comprobante de pago: confirma monto, fecha, referencia y banco que veas, y di que un asesor validará el pago.
- Foto de producto: identifícalo con el catálogo y orienta con precio y disponibilidad.

[HERRAMIENTAS]
- Tienes herramientas para actuar en el sistema; úsalas en lugar de prometer cosas que no puedes hacer.
- Si el cliente comparte un dato útil y estable (su nombre, una preferencia, alergia, dirección o zona habitual, forma de pago preferida), guárdalo con guardar_dato_cliente sin mencionarlo.
- Si el cliente se molesta, tiene un reclamo, pide una persona o pregunta algo fuera del negocio, usa transferir_a_asesor (el sistema le avisa). Si no puedes usarla, responde exactamente:
"{transfer_message}"

[BASE DE CONOCIMIENTO]
{knowledge_context}
"""

    if mod_extensions:
        prompt += f"\n\n[MÓDULOS ACTIVOS - DATOS OFICIALES]\n{mod_extensions}"

    # Rol del área especializada al final: todo lo anterior es idéntico entre áreas y se aprovecha el caché
    try:
        from services import agents
        role = agents.role_prompt(agent_key)
        if role:
            prompt += f"\n\n{role}"
    except Exception as e:
        logger.debug(f"Aviso construyendo el rol del área: {e}")

    return prompt.strip()
