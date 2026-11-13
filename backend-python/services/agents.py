"""Agentes especializados: Recepción, Ventas y pedidos, Soporte y reclamos.

Todos comparten la identidad de la marca, la base de conocimiento y los datos de los módulos; cambian su
rol, sus herramientas y sus instrucciones. Un enrutador elige el agente de cada mensaje sin llamar a la IA:
  1. Señales claras en el mensaje (p. ej. «queja», «quiero pedir») llevan al área correspondiente.
  2. Si no, la conversación sigue con el agente que la venía atendiendo (pegajoso por unas horas).
  3. Si no hay ninguno, empieza Recepción.
Además, un agente puede derivar a otro dentro de la misma respuesta con la herramienta `derivar_a_area`.
"""
import json
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.agents")

SETTING_KEY = "AGENT_PROFILES"
STICKY_HOURS = 6
DEFAULT_AGENT = "recepcion"

AGENTS: Dict[str, Dict[str, Any]] = {
    "recepcion": {
        "name": "Recepción",
        "description": "Saluda, da información general del negocio y resuelve dudas. Deriva a Ventas o Soporte cuando hace falta.",
        "role": ("Eres la recepción del negocio: saludas, das información general (horarios, ubicación, servicios) y "
                 "resuelves dudas con la base de conocimiento. Si el cliente quiere comprar, pedir o cotizar, usa "
                 "derivar_a_area con «ventas». Si tiene una queja o un problema con un pedido, usa derivar_a_area con «soporte»."),
        "tools": ["guardar_dato_cliente", "transferir_a_asesor", "derivar_a_area", "consultar_pedido",
                  "guardar_lead", "registrar_reunion", "consultar_servicios"],
        "keywords": [],
        "locked": True,  # siempre activa: es el punto de entrada
    },
    "ventas": {
        "name": "Ventas y pedidos",
        "description": "Ayuda a elegir, sugiere complementos y cierra la venta o el pedido.",
        "role": ("Eres el área de ventas: tu meta es ayudar al cliente a elegir y cerrar la compra o el pedido, con "
                 "trato cálido y de buen vendedor (sugiere un complemento, resuelve objeciones, facilita el siguiente "
                 "paso). Si el cliente tiene un reclamo, usa derivar_a_area con «soporte»."),
        # Las herramientas de Servicios (CRM) solo existen si ese módulo está activo
        "tools": ["guardar_dato_cliente", "transferir_a_asesor", "derivar_a_area", "crear_pedido", "consultar_pedido",
                  "guardar_lead", "registrar_reunion", "consultar_servicios"],
        "keywords": ["quiero pedir", "quisiera pedir", "hacer un pedido", "quiero ordenar", "para llevar", "a domicilio",
                     "menu", "carta", "precio*", "cuanto cuesta", "cuanto vale", "cotiz*", "comprar", "quiero comprar",
                     "promocion", "combo", "me das", "me regalas", "agregame", "quiero un", "quiero una", "quiero dos"],
    },
    "soporte": {
        "name": "Soporte y reclamos",
        "description": "Atiende quejas y problemas con pedidos con empatía; consulta, cancela si se puede y escala a un humano cuando hay compensación.",
        "role": ("Eres el área de soporte: atiendes quejas y problemas con empatía real. Primero reconoce el problema y "
                 "discúlpate sin excusas; luego consulta el pedido si aplica y propone lo que sí puedes hacer (cancelar si "
                 "sigue pendiente). No prometas reembolsos, descuentos ni compensaciones: para eso usa transferir_a_asesor "
                 "con un motivo claro. Si el cliente en realidad quiere comprar, usa derivar_a_area con «ventas»."),
        "tools": ["guardar_dato_cliente", "transferir_a_asesor", "derivar_a_area", "consultar_pedido", "cancelar_pedido"],
        "keywords": ["queja", "reclamo", "reclamar", "llego frio", "llego mal", "vino mal", "vino frio", "no ha llegado",
                     "no llega", "nunca llego", "llego tarde", "muy tarde", "se tardo", "demora*", "equivocad*", "incomplet*", "me falto", "faltaba", "devolucion",
                     "reembolso", "devuelvan", "pesimo", "malisimo", "estafa", "problema con mi pedido", "cancelar mi pedido"],
    },
}


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", (text or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text)


# ----------------------------------------------------------------------
# CONFIGURACIÓN (panel)
# ----------------------------------------------------------------------
def _stored() -> Dict[str, Any]:
    try:
        from services.db_service import db_service
        raw = db_service.get_setting(SETTING_KEY, "")
        data = json.loads(raw) if raw else {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def specialists_enabled() -> bool:
    return bool(_stored().get("_enabled", True))


def get_profiles() -> List[Dict[str, Any]]:
    stored = _stored()
    out = []
    for key, a in AGENTS.items():
        s = stored.get(key) or {}
        out.append({
            "key": key, "name": a["name"], "description": a["description"], "role": a["role"],
            "tools": a["tools"], "locked": bool(a.get("locked")),
            "enabled": True if a.get("locked") else bool(s.get("enabled", True)),
            "instructions": s.get("instructions", ""),
        })
    return out


def update_profile(key: str, enabled: Optional[bool] = None, instructions: Optional[str] = None) -> Dict[str, Any]:
    if key not in AGENTS:
        raise ValueError("Agente no encontrado.")
    if enabled is False and AGENTS[key].get("locked"):
        raise ValueError("Recepción no se puede desactivar: es el punto de entrada de cada conversación.")
    from services.db_service import db_service
    stored = _stored()
    entry = dict(stored.get(key) or {})
    if enabled is not None:
        entry["enabled"] = bool(enabled)
    if instructions is not None:
        entry["instructions"] = instructions.strip()[:1500]
    stored[key] = entry
    db_service.set_setting(SETTING_KEY, json.dumps(stored, ensure_ascii=False))
    return next(p for p in get_profiles() if p["key"] == key)


def set_specialists_enabled(enabled: bool) -> None:
    from services.db_service import db_service
    stored = _stored()
    stored["_enabled"] = bool(enabled)
    db_service.set_setting(SETTING_KEY, json.dumps(stored, ensure_ascii=False))


def _enabled_keys() -> List[str]:
    return [p["key"] for p in get_profiles() if p["enabled"]]


# ----------------------------------------------------------------------
# ENRUTADOR
# ----------------------------------------------------------------------
def _matches(text: str, keyword: str) -> bool:
    """Palabra o frase completa; con «*» al final, cualquier palabra que empiece así (cotiz* -> cotización)."""
    if keyword.endswith("*"):
        return re.search(r"\b" + re.escape(keyword[:-1]), text) is not None
    return re.search(r"\b" + re.escape(keyword) + r"\b", text) is not None


def detect_area(text: str) -> Optional[str]:
    """Área sugerida por señales claras del mensaje (soporte tiene prioridad sobre ventas)."""
    t = _norm(text)
    if not t:
        return None
    enabled = _enabled_keys()
    for key in ("soporte", "ventas"):
        if key in enabled and any(_matches(t, k) for k in AGENTS[key]["keywords"]):
            return key
    return None


def route(session_id: str, text: str, now: Optional[datetime] = None) -> tuple:
    """(agente que atiende este mensaje, nota de cambio de área o None).
    Agente None = modo de un solo agente, sin especialistas. La nota se registra en la conversación
    después del mensaje del cliente (para que el orden en la bandeja sea correcto)."""
    if not specialists_enabled():
        return None, None
    from services.customer_service import customer_service
    enabled = _enabled_keys()
    signal = detect_area(text)
    current = customer_service.get_agent(session_id)
    now = now or datetime.now(timezone.utc)
    sticky = None
    if current and current.get("agent") in enabled and current.get("at"):
        try:
            if now - datetime.fromisoformat(current["at"]) < timedelta(hours=STICKY_HOURS):
                sticky = current["agent"]
        except ValueError:
            pass
    chosen = signal or sticky or DEFAULT_AGENT
    previous = (current or {}).get("agent")
    customer_service.set_agent(session_id, chosen)  # renueva la ventana pegajosa con cada mensaje
    note = None
    if previous and previous != chosen:
        note = switch_note(chosen, "señales en el mensaje" if signal else "nueva conversación")
        logger.info(f"🔀 [{session_id}] {previous} -> {chosen}")
    return chosen, note


def route_to(session_id: str, agent_key: str) -> None:
    """El agente derivó a otra área: desde ahora la atiende esa área."""
    from services.customer_service import customer_service
    customer_service.set_agent(session_id, agent_key)


def log_note(session_id: str, note: str) -> None:
    from services.customer_service import customer_service
    try:
        customer_service.record_message(session_id, "action", note)
    except Exception as e:
        logger.debug(f"No se pudo registrar el cambio de área: {e}")


def switch_note(agent_key: str, reason: str = "") -> str:
    return f"🔀 Atiende: {AGENTS[agent_key]['name']}" + (f" ({reason})" if reason else "")


# ----------------------------------------------------------------------
# PROMPT Y HERRAMIENTAS POR AGENTE
# ----------------------------------------------------------------------
def role_prompt(agent_key: Optional[str]) -> str:
    if not agent_key or agent_key not in AGENTS:
        return ""
    profile = next(p for p in get_profiles() if p["key"] == agent_key)
    others = [p for p in get_profiles() if p["enabled"] and p["key"] != agent_key]
    lines = [f"[ÁREA QUE ATIENDE ESTE MENSAJE: {profile['name'].upper()}]", profile["role"]]
    if others:
        lines.append("Otras áreas disponibles para derivar_a_area: " + ", ".join(f"«{p['key']}» ({p['name']})" for p in others) + ".")
        lines.append("Al derivar no se lo anuncies al cliente; el área nueva responde directamente.")
    if profile["instructions"]:
        lines.append(f"Indicaciones del negocio para esta área:\n{profile['instructions']}")
    return "\n".join(lines)


def tool_names(agent_key: Optional[str]) -> Optional[List[str]]:
    """Herramientas permitidas para el agente (None = todas, modo de un solo agente)."""
    if not agent_key or agent_key not in AGENTS:
        return None
    return list(AGENTS[agent_key]["tools"])
