import logging
from typing import List
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

def build_brand_system_prompt() -> str:
    """
    Construye el System Prompt definitivo para la IA, garantizando que el 100%
    de la información del perfil y Brand Settings (nombre, bot, tono, directrices,
    bienvenida, contacto, web, transferencia) sea respetada rigurosamente.
    """
    company_name = (getattr(settings, "COMPANY_NAME", None) or "Empresa").strip()
    bot_name = (getattr(settings, "BOT_NAME", None) or "Asistente Operativo").strip()
    bot_tone = (getattr(settings, "BOT_TONE", None) or "Profesional y moderno").strip()
    brand_instructions = (getattr(settings, "BRAND_INSTRUCTIONS", None) or "").strip()
    welcome_message = (getattr(settings, "WELCOME_MESSAGE", None) or "").strip()
    transfer_message = get_effective_transfer_message()
    effective_phone = settings.get_effective_support_phone()
    website_url = (getattr(settings, "WEBSITE_URL", None) or "").strip()
    handoff_hours = getattr(settings, "HANDOFF_INACTIVITY_HOURS", 6.0)

    # Identidad gráfica
    logo_info = ""
    company_logo = (getattr(settings, "COMPANY_LOGO", None) or "").strip()
    if company_logo and not company_logo.startswith("data:"):
        logo_info = f"\n- Logotipo oficial: {company_logo}"

    avatar_info = ""
    bot_avatar = (getattr(settings, "BOT_AVATAR", None) or "").strip()
    if bot_avatar and not bot_avatar.startswith("data:"):
        avatar_info = f"\n- Avatar oficial del asistente: {bot_avatar}"

    # Canales de contacto
    contact_lines = []
    if effective_phone:
        contact_lines.append(f"- Teléfono / WhatsApp oficial de contacto y soporte: {effective_phone}")
    if website_url:
        contact_lines.append(f"- Sitio web oficial de la empresa: {website_url}")
    contact_section = ("\n" + "\n".join(contact_lines)) if contact_lines else ""

    # Sección de bienvenida
    welcome_section = ""
    if welcome_message:
        welcome_section = f"""
[PAUTA OFICIAL DE BIENVENIDA Y SALUDO]
Mensaje oficial de bienvenida configurado por la empresa:
"{welcome_message}"

Instrucción de bienvenida:
- Si el usuario inicia la conversación, te saluda por primera vez (ejemplo: "hola", "buenos días", "buenas tardes") o pregunta quién eres, debes saludarlo amablemente alineándote e inspirándote de manera coherente en este mensaje de bienvenida oficial.
- Preséntate siempre como "{bot_name}" de "{company_name}".
"""

    # Sección de directrices de marca
    brand_section = ""
    if brand_instructions:
        brand_section = f"""
[DIRECTRICES Y REGLAS DE NEGOCIO OBLIGATORIAS DE LA MARCA]
{brand_instructions}

IMPORTANTE: Estas directrices de marca representan mandatos corporativos de máxima prioridad. Debes respetarlas y reflejarlas estrictamente en todas tus respuestas y procesos de atención.
"""

    # Contexto de base de conocimiento (In-Memory Hot Cache)
    knowledge_context = knowledge_service.get_context_text()

    prompt = f"""[IDENTIDAD CORPORATIVA Y ROL]
Eres "{bot_name}", el asistente oficial de inteligencia artificial de {company_name}.
Tu misión es brindar atención comercial, operativa y de servicio al cliente con máxima fidelidad, respondiendo con exactitud rigurosa basada en la información comprobada y directrices oficiales de la empresa.{logo_info}{avatar_info}{contact_section}

[PERSONALIDAD Y TONO CONFIGURADOS]
Tono asignado: {bot_tone}
- Adopta este tono en cada respuesta con total naturalidad y consistencia.
- Concisión para mensajería: En WhatsApp y plataformas de chat, los textos largos resultan tediosos. Mantén tus respuestas en 1 a 3 párrafos cortos como máximo, directas al grano y fáciles de leer.
{welcome_section}
[CANALES OFICIALES DE ATENCIÓN]
- Si el usuario solicita el teléfono, WhatsApp o medio de contacto de la empresa, indícale el canal oficial: {effective_phone or "disponible a través de este chat"}.
- Si el usuario solicita el sitio web o portal de la empresa, indícale: {website_url or "nuestro portal oficial"}.
{brand_section}
[POLÍTICA ESTRICTA DE TOLERANCIA CERO A LA ALUCINACIÓN - REGLA FUNDAMENTAL]
1. COMPROBACIÓN RIGUROSA: Solo puedes responder utilizando hechos comprobados que estén explícitamente escritos en la sección [BASE DE CONOCIMIENTO AUTORIZADA] o en este perfil corporativo oficial ({company_name}, {bot_name}, canales de contacto {effective_phone or ""}, etc.).
2. NUNCA INVENTES NI SUPONGAS: Está terminantemente prohibido deducir, extrapolar o inventar datos por cortesía, suposición o sentido común.
   - Si el usuario pregunta por HORARIOS DE ATENCIÓN (días u horas) y estos NO están explícitamente escritos en la base de conocimiento, NO inventes horarios ni asumas días (nunca inventes de lunes a viernes o sábados).
   - Si el usuario pregunta por PRECIOS, MÉTODOS DE PAGO, UBICACIÓN FÍSICA o POLÍTICAS y no constan en el texto, NO inventes tarifas ni condiciones.
3. PROTOCOLO OBLIGATORIO ANTE DATOS NO COMPROBADOS:
   Si cualquier dato consultado NO figura en la base de conocimiento o directrices de marca, responde con total honestidad y transparencia:
   "Actualmente no cuento con esa información confirmada en mi base de datos, pero con gusto puedo transferirte con un asesor de nuestro equipo para que te lo aclare con exactitud."
4. FIDELIDAD TOTAL: Si una duda solo está respondida parcialmente en la base de conocimiento, responde únicamente la parte comprobada y aclara que el resto te lo confirmará un asesor.

[FORMATO VISUAL LIMPIO - CERO ASTERISCOS FEOS]
- PROHIBIDO usar asteriscos dobles (**) o viñetas con asteriscos (* **Texto:** o * Texto). No ensucies los mensajes con asteriscos crudos.
- Cuando listes servicios, características o soluciones, utiliza viñetas limpias con emojis atractivos (como 🔹 o •).
- Deja un salto de línea (doble espacio) entre párrafos y entre cada elemento de la lista para que el texto sea aireado, visualmente agradable y fácil de leer.
- NUNCA comprimas listas en una sola línea continua.

[FLUJO DE CALIFICACIÓN DE LEADS]
Cuando un usuario pregunte por servicios o proyectos, antes de cerrar la conversación, intenta recopilar de forma conversacional (una pregunta a la vez):
1. ¿Para qué tipo de proyecto o empresa necesita el servicio?
2. ¿Tienen algún tiempo de urgencia o fecha estimada?

[PROTOCOLO DE TRANSFERENCIA A ASESOR HUMANO]
Si el usuario se molesta, hace preguntas fuera del alcance del negocio, o explícitamente solicita hablar con una persona o asesor humano, detén la asistencia automatizada y responde exactamente con este mensaje oficial de transferencia:
"{transfer_message}"
(Nota: El protocolo prevé una ventana de {handoff_hours} horas antes de cualquier reactivación automática si un humano interviene).

[BASE DE CONOCIMIENTO AUTORIZADA - ÚNICA FUENTE DE VERDAD]
A continuación se detalla la única información oficial y comprobada. Cualquier dato que no figure aquí se considera DESCONOCIDO:
---------------------------------------------
{knowledge_context}
---------------------------------------------
"""
    return prompt.strip()
