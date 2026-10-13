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
    # Ejemplo: "incluyen: * **Desarrollo:** ... * **API:** ..."
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
    # Si quedó '🔹 🔹' o '🔹  '
    t = re.sub(r'🔹\s*🔹', r'🔹', t)
    t = re.sub(r'🔹(?=[A-Za-zÁÉÍÓÚáéíóú0-9])', r'🔹 ', t)

    # 10. Limpiar espacios raros antes de dos puntos (ej: "Título :" -> "Título:")
    t = re.sub(r'\s+:', ':', t)

    # 11. Normalizar saltos de línea múltiples (> 2 saltos seguidos -> \n\n)
    t = re.sub(r'\n{3,}', '\n\n', t)

    return t.strip()
