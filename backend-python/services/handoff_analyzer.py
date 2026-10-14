import json
import logging
import re
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("asistente_operativo.handoff_analyzer")

ALLOWED_TAGS = [
    "COTIZACIÓN",
    "ECOMMERCE",
    "AUTOMATIZACIÓN",
    "DESARROLLO WEB",
    "VENTAS",
    "SOPORTE TÉCNICO",
    "RECLAMO",
    "CONSULTA GENERAL",
    "URGENTE",
    "ATENCIÓN HUMANA"
]

def rule_based_fallback(messages: List[Dict[str, str]], reason: str = "") -> Tuple[str, str]:
    """
    Clasificador heurístico ultra rápido sin dependencias externas.
    Garantiza que siempre haya una etiqueta precisa y una nota útil para el asesor
    incluso si las APIs de IA están offline o tienen latencia.
    """
    user_texts = [m.get("content", "").strip() for m in messages if m.get("role") == "user" and m.get("content")]
    all_user_str = " ".join(user_texts).lower()
    combined_str = f"{all_user_str} {reason.lower()}".strip()

    tag = "ATENCIÓN HUMANA"
    if any(k in combined_str for k in ["urgente", "emergencia", "inmediato", "ya mismo", "auxilio"]):
        tag = "URGENTE"
    elif any(k in combined_str for k in ["queja", "reclamo", "molest", "inconforme", "pesimo", "mal servicio"]):
        tag = "RECLAMO"
    elif any(k in combined_str for k in ["ecommerce", "e-commerce", "tienda online", "tienda virtual", "carrito", "shopify", "woocommerce", "pasarela", "catalogo de productos"]):
        tag = "ECOMMERCE"
    elif any(k in combined_str for k in ["automatiz", "automatizar", "bot", "flujo", "zapier", "make", "webhook", "crm", "proceso automatico", "ia automatica"]):
        tag = "AUTOMATIZACIÓN"
    elif any(k in combined_str for k in ["pagina web", "sitio web", "landing", "software", "desarrollo web", "aplicacion", "app web"]):
        tag = "DESARROLLO WEB"
    elif any(k in combined_str for k in ["cotiz", "precio", "cuanto cuesta", "cuánto cuesta", "costo", "tarifa", "presupuesto"]):
        tag = "COTIZACIÓN"
    elif any(k in combined_str for k in ["comprar", "adquirir", "pedido", "contratar", "plan", "pagar", "factura"]):
        tag = "VENTAS"
    elif any(k in combined_str for k in ["soporte", "error", "falla", "no funciona", "caido", "problema", "bug", "averia"]):
        tag = "SOPORTE TÉCNICO"
    elif any(k in combined_str for k in ["informacion", "horario", "ubicacion", "direccion", "duda", "consulta"]):
        tag = "CONSULTA GENERAL"

    last_user_msg = user_texts[-1] if user_texts else ""
    if last_user_msg:
        cleaned_snippet = re.sub(r"\s+", " ", last_user_msg).strip()
        if len(cleaned_snippet) > 160:
            cleaned_snippet = cleaned_snippet[:157] + "..."
        note = f"El cliente solicita: \"{cleaned_snippet}\". Requiere atención de un asesor."
    elif reason:
        note = f"Derivado por el sistema: {reason.strip()}."
    else:
        note = "El cliente solicita comunicarse directamente con un asesor humano."

    return tag, note

def analyze_handoff_intent(messages: List[Dict[str, str]], reason: str = "") -> Tuple[str, str]:
    """
    Analiza el historial de conversación para generar una etiqueta de clasificación directa
    y una nota ejecutiva concisa para el asesor humano.
    """
    if not messages:
        return rule_based_fallback(messages, reason)

    # Filtrar últimos 8 mensajes relevantes para dar contexto
    recent = messages[-8:]
    history_lines = []
    for m in recent:
        role = "Cliente" if m.get("role") == "user" else "Asistente IA"
        history_lines.append(f"{role}: {m.get('content', '').strip()}")
    conversation_str = "\n".join(history_lines)

    system_prompt = (
        "Eres un supervisor de atención al cliente. Tu función es analizar el chat de un cliente "
        "que fue transferido a un agente humano y generar: "
        "1) Un 'tag' de clasificación directa: [COTIZACIÓN, ECOMMERCE, AUTOMATIZACIÓN, DESARROLLO WEB, VENTAS, SOPORTE TÉCNICO, RECLAMO, URGENTE, CONSULTA GENERAL, ATENCIÓN HUMANA]. "
        "2) Una 'note' ejecutiva concisa (1 o 2 oraciones, máximo 35 palabras) que resuma exactamente qué busca el cliente "
        "y qué necesita, para que el asesor humano no tenga que leer todo el historial del chat.\n\n"
        "Debes responder EXCLUSIVAMENTE un objeto JSON válido con los campos 'tag' y 'note'."
    )

    prompt = f"{system_prompt}\n\nMotivo de derivación: {reason or 'Solicitud de asesor'}\n\nHistorial del chat:\n{conversation_str}\n\nJSON:"

    # Intentar con Gemini
    try:
        from config import settings
        from google import genai
        from google.genai import types

        api_key = settings.GEMINI_API_KEY.strip()
        if api_key and not api_key.startswith("AIzaSyFake"):
            client = genai.Client(api_key=api_key)
            config = types.GenerateContentConfig(
                temperature=0.1,
                max_output_tokens=200,
                response_mime_type="application/json"
            )
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL or "gemini-2.5-flash",
                contents=prompt,
                config=config
            )
            if response and response.text:
                data = json.loads(response.text.strip())
                tag = str(data.get("tag", "")).strip().upper()
                note = str(data.get("note", "")).strip()
                if tag in ALLOWED_TAGS and note:
                    return tag, note
                elif note:
                    fb_tag, _ = rule_based_fallback(messages, reason)
                    return fb_tag, note
    except Exception as e:
        logger.debug(f"Análisis con Gemini omitido o fallido ({e}), probando respaldo...")

    # Intentar con OpenAI de respaldo si está disponible
    try:
        from config import settings
        import openai

        api_key = settings.OPENAI_API_KEY.strip()
        if api_key and not api_key.startswith("sk-fake"):
            client = openai.OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL or "gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=200,
                response_format={"type": "json_object"}
            )
            choice = response.choices[0]
            if choice.message and choice.message.content:
                data = json.loads(choice.message.content.strip())
                tag = str(data.get("tag", "")).strip().upper()
                note = str(data.get("note", "")).strip()
                if tag in ALLOWED_TAGS and note:
                    return tag, note
                elif note:
                    fb_tag, _ = rule_based_fallback(messages, reason)
                    return fb_tag, note
    except Exception as e:
        logger.debug(f"Análisis con OpenAI omitido o fallido: {e}")

    # Fallback heurístico 100% robusto
    return rule_based_fallback(messages, reason)
