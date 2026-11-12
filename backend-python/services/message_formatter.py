import re

def clean_chat_formatting(text: str) -> str:
    """
    Transforma respuestas con markdown técnico o asteriscos toscos
    en un formato visual limpio, elegante y legible para WhatsApp y Web Chat.

    Elimina:
    - Asteriscos dobles y triples (**, ***)
    - Viñetas crudas (* **Título:**, - **Título:**)
    - Asteriscos sueltos (* palabra *)
    - Listas comprimidas en un solo renglón sin saltos de línea

    Aplica:
    - Viñetas amigables y profesionales con '🔹 '
    - Saltos de línea claros y espaciados entre elementos
    - Máximo 2 saltos de línea consecutivos para evitar espacios vacíos gigantes
    """
    if not text:
        return ""

    # Normalizar saltos de línea a estándar Unix
    t = text.replace("\r\n", "\n").replace("\r", "\n")

    # 1. Separar listas que el modelo haya dejado pegadas en una sola línea:
    t = re.sub(r'(?<=[^\n])\s*\*\s*\*\*', r'\n\n🔹 ', t)
    t = re.sub(r'^\s*\*\s*\*\*', r'🔹 ', t, flags=re.MULTILINE)

    # 2. Convertir viñetas inline con bullets o guiones ' * ' o ' - ' que precedan mayúsculas
    t = re.sub(r'(?<=[^\n])\s+[\*\-]\s+(?=[A-ZÁÉÍÓÚa-záéíóú0-9])', r'\n\n🔹 ', t)

    # 3. Encabezados markdown como '### Título' -> 'Título' con salto
    t = re.sub(r'^\s*#{1,6}\s*', r'\n🔹 ', t, flags=re.MULTILINE)

    # 4. Convertir viñetas estándar al inicio de línea (* , - ) a '🔹 '
    t = re.sub(r'^\s*[\*\-]\s+', r'🔹 ', t, flags=re.MULTILINE)

    # 5. Numeraciones tipo '1. **Título:**' -> '1. Título:'
    t = re.sub(r'(\d+\.)\s*\*\*([^*]+)\*\*', r'\1 \2', t)

    # 6. Remover todos los asteriscos dobles y triples de negritas restantes (**texto** -> texto)
    t = t.replace('***', '').replace('**', '')

    # 7. Remover asteriscos cursivos o sueltos (*palabra* -> palabra)
    t = re.sub(r'(?<!\w)\*([^\*\n]+)\*(?!\w)', r'\1', t)

    # 8. Eliminar cualquier asterisco solitario que haya quedado
    t = t.replace('*', '')

    # 9. Limpiar formato de emojis de viñeta
    t = re.sub(r'🔹\s*🔹', r'🔹', t)
    t = re.sub(r'🔹(?=[A-Za-zÁÉÍÓÚáéíóú0-9])', r'🔹 ', t)

    # 10. Limpiar espacios raros antes de dos puntos (ej: "Título :" -> "Título:")
    t = re.sub(r'\s+:', ':', t)

    # 11. Normalizar saltos de línea múltiples (> 2 saltos seguidos -> \n\n)
    t = re.sub(r'\n{3,}', '\n\n', t)

    return t.strip()


GREETING_WORDS = {
    "hola", "buenas", "buenos dias", "buenos días", "buenas tardes", "buenas noches",
    "hey", "que tal", "qué tal", "saludos", "un saludo"
}

def is_pure_greeting(text: str) -> bool:
    """Detecta si el mensaje del usuario es únicamente un saludo breve."""
    cleaned = re.sub(r'[^\w\s]', '', (text or '').lower()).strip()
    return cleaned in GREETING_WORDS or (len(cleaned.split()) <= 2 and any(cleaned.startswith(w) for w in ["hola", "buenas"]))

def strip_repetitive_greeting(reply: str, has_history: bool, user_message: str = "") -> str:
    """
    Si la conversación ya está en curso (tiene historial) y el usuario no acaba de enviar un saludo puro,
    elimina saludos iniciales robóticos o presentaciones repetitivas
    (ej: '¡Hola! Claro que sí...', '¡Hola! Te saluda...', 'Soy Juan de...').
    """
    if not reply or not has_history:
        return reply

    # Si el usuario solo saludó (ej. 'hola'), se permite que el bot salude con naturalidad
    if is_pure_greeting(user_message):
        return reply

    t = reply.strip()

    # Patrón de saludos repetitivos al inicio de la respuesta
    pattern = r'^(?:¡?Hola\b[^.!?\n]*[.!?]?\s*|¡?Buenas\s+(?:tardes|noches|días)\b[^.!?\n]*[.!?]?\s*|Un gusto saludarte[^.!?\n]*[.!?]?\s*)+'
    cleaned = re.sub(pattern, '', t, flags=re.IGNORECASE).strip()

    # Remover también presentaciones repetitivas como "Soy [Bot] de [Empresa]."
    cleaned = re.sub(r'^(?:Soy\s+[^.!?\n]+(?:de|en)\s+[^.!?\n]+[.!?]?\s*)', '', cleaned, flags=re.IGNORECASE).strip()

    if cleaned and len(cleaned) > 5:
        return cleaned[0].upper() + cleaned[1:]

    return t
