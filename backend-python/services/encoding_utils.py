import re
import unicodedata
from typing import Optional

# Patrones típicos de caracteres UTF-8 mal interpretados como Latin-1 o Windows-1252
MOJIBAKE_PATTERNS = [
    "Ã¡", "Ã©", "Ã­", "Ã³", "Ãº", "Ã±", "Ã‘", "Ã‰", "Ã“", "Ãš",
    "Ã ", "Ã‚", "Ãª", "Ã®", "Ã´", "Ã»", "Ã¼", "Ãœ", "Â¿", "Â¡",
    "â€", "â€™", "â€œ", "â€", "Ã§", "Ã‡", "\xc3\xad", "\xc3\x89"
]

def fix_mojibake(text: Optional[str]) -> str:
    """
    Detecta y repara automáticamente texto en español con problemas de codificación (mojibake),
    por ejemplo: 'IngenierÃ­a' -> 'Ingeniería', 'Ã‰lite' -> 'Élite'.
    """
    if not text:
        return ""

    s = text

    # Si se detecta alguno de los patrones de mojibake típicos
    if any(p in s for p in MOJIBAKE_PATTERNS):
        # Intento 1: Codificar como latin1 y decodificar como utf-8
        try:
            candidate = s.encode("latin1").decode("utf-8")
            s = candidate
        except (UnicodeEncodeError, UnicodeDecodeError):
            # Intento 2: Codificar como cp1252 y decodificar como utf-8
            try:
                candidate = s.encode("cp1252").decode("utf-8")
                s = candidate
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass

    # Normalización canónica Unicode NFC (combina acentos con letras, ej: e + ´ -> é)
    s = unicodedata.normalize("NFC", s)

    # Eliminar caracteres de control invisibles indeseados (excepto saltos de línea y tabulación)
    s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)

    return s
