"""Herramientas del agente (function calling nativo de Gemini / OpenAI).

El núcleo y cada módulo publican herramientas: nombre, descripción, parámetros (JSON Schema) y la función
que las ejecuta. El modelo decide cuándo usarlas; el servidor las ejecuta con las reglas reales del negocio.

Una herramienta puede añadir un **mensaje oficial** para el cliente (`ctx.say(...)`), por ejemplo la
confirmación de un pedido con el total calculado por el servidor: ese texto llega tal cual al cliente y el
modelo nunca lo reescribe.
"""
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.agent_tools")

MAX_TOOL_ROUNDS = 4
POLICY_SETTING_KEY = "AGENT_TOOL_POLICIES"
POLICIES = ("auto", "approve", "off")
# Acciones que nunca se pueden apagar ni retrasar: pasar a un humano debe funcionar siempre
LOCKED_TOOLS = {"transferir_a_asesor", "derivar_a_area"}

# Texto legible de cada acción para la conversación y la bandeja de aprobación
TOOL_LABELS = {
    "guardar_dato_cliente": "Guardar dato del cliente",
    "transferir_a_asesor": "Transferir a un asesor",
    "derivar_a_area": "Derivar a otra área",
    "crear_pedido": "Crear pedido",
    "consultar_pedido": "Consultar pedido",
    "cancelar_pedido": "Cancelar pedido",
    "guardar_lead": "Guardar Prospecto / CRM",
    "consultar_servicios": "Consultar Catálogo de Servicios",
    "registrar_reunion": "Registrar Reunión / Demo",
}


@dataclass
class ToolContext:
    session_id: str
    customer_messages: List[str] = field(default_factory=list)  # textos oficiales que se envían tal cual
    actions: List[Dict[str, Any]] = field(default_factory=list)  # registro de lo que hizo el agente
    end_turn: bool = False  # la herramienta ya respondió por completo (p. ej. transferencia a humano)
    approved: bool = False  # True cuando un humano ya aprobó la acción (se ejecuta sin volver a pedir permiso)
    reroute: Optional[str] = None  # otra área debe responder este mensaje (derivar_a_area)
    agent: Optional[str] = None  # área que está atendiendo

    def say(self, text: str) -> None:
        if text and text.strip():
            self.customer_messages.append(text.strip())


@dataclass
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable[[ToolContext, Dict[str, Any]], Dict[str, Any]]


# ----------------------------------------------------------------------
# HERRAMIENTAS DEL NÚCLEO
# ----------------------------------------------------------------------
def _remember(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from services.customer_service import customer_service
    saved = customer_service.remember(ctx.session_id, name=args.get("nombre"), fact=args.get("dato"),
                                      tag=args.get("etiqueta"))
    return {"ok": True, "guardado": saved}


def _handoff(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from services.lead_service import lead_service
    from services.prompt_service import get_effective_transfer_message
    reason = str(args.get("motivo") or "El cliente necesita atención humana")[:300]
    lead_service.set_transferred(ctx.session_id, True, reason=reason)
    ctx.say(get_effective_transfer_message())
    ctx.end_turn = True
    return {"ok": True, "nota": "Conversación transferida; el sistema ya avisó al cliente."}


def _reroute(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from services import agents
    area = str(args.get("area") or "").strip().lower()
    enabled = [p["key"] for p in agents.get_profiles() if p["enabled"]]
    if area not in enabled:
        return {"ok": False, "error": f"Área no disponible. Opciones: {', '.join(enabled)}."}
    if area == ctx.agent:
        return {"ok": False, "error": "Ya eres esa área; atiende tú al cliente."}
    ctx.reroute = area
    ctx.end_turn = True
    return {"ok": True, "nota": "El área indicada responderá al cliente."}


CORE_TOOLS = [
    Tool(
        name="guardar_dato_cliente",
        description=("Guarda en la ficha del cliente un dato útil y estable que acaba de compartir: su nombre, una "
                     "preferencia, alergia o restricción, su dirección o zona habitual, su forma de pago preferida. "
                     "Úsala en cuanto lo diga; no la uses para datos de un solo pedido."),
        parameters={
            "type": "object",
            "properties": {
                "nombre": {"type": "string", "description": "Nombre del cliente, si lo dijo."},
                "dato": {"type": "string", "description": "Dato clave breve, ej. 'Alérgico al maní'."},
                "etiqueta": {"type": "string", "description": "Etiqueta corta en minúsculas, ej. 'vegetariano'."},
            },
        },
        handler=_remember,
    ),
    Tool(
        name="transferir_a_asesor",
        description=("Pasa la conversación a una persona del equipo. Úsala si el cliente lo pide, está molesto, "
                     "tiene un reclamo o pregunta algo que no puedes resolver con la información disponible."),
        parameters={
            "type": "object",
            "properties": {"motivo": {"type": "string", "description": "Motivo breve para el asesor."}},
            "required": ["motivo"],
        },
        handler=_handoff,
    ),
    Tool(
        name="derivar_a_area",
        description=("Pasa este mensaje a otra área especializada del asistente (no a una persona) cuando el cliente "
                     "necesita algo que corresponde a esa área. El área nueva responde directamente."),
        parameters={
            "type": "object",
            "properties": {
                "area": {"type": "string", "enum": ["recepcion", "ventas", "soporte"]},
                "motivo": {"type": "string", "description": "Motivo breve."},
            },
            "required": ["area"],
        },
        handler=_reroute,
    ),
]


# ----------------------------------------------------------------------
# REGLAS POR ACCIÓN (automático / pedir aprobación / apagada)
# ----------------------------------------------------------------------
def get_policies() -> Dict[str, str]:
    try:
        from services.db_service import db_service
        raw = db_service.get_setting(POLICY_SETTING_KEY, "")
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}
    return {k: v for k, v in (data or {}).items() if v in POLICIES and k not in LOCKED_TOOLS}


def set_policy(tool_name: str, policy: str) -> Dict[str, str]:
    if policy not in POLICIES:
        raise ValueError("La regla debe ser 'auto', 'approve' u 'off'.")
    if tool_name in LOCKED_TOOLS:
        raise ValueError("Esta acción no se puede limitar: el cliente siempre debe poder hablar con una persona.")
    if tool_name not in {t.name for t in _registered_tools()}:
        raise ValueError("Acción no encontrada.")
    from services.db_service import db_service
    policies = get_policies()
    policies[tool_name] = policy
    db_service.set_setting(POLICY_SETTING_KEY, json.dumps(policies))
    return policies


def describe_tools() -> List[Dict[str, Any]]:
    """Para el panel: cada acción con su regla actual."""
    policies = get_policies()
    return [{"name": t.name, "label": TOOL_LABELS.get(t.name, t.name), "description": t.description,
             "policy": policies.get(t.name, "auto"), "locked": t.name in LOCKED_TOOLS}
            for t in _registered_tools()]


# ----------------------------------------------------------------------
# REGISTRO
# ----------------------------------------------------------------------
def all_tools(agent_key: Optional[str] = None) -> List[Tool]:
    """Herramientas que ve el modelo: sin las apagadas y, si atiende un área, solo las de esa área."""
    from services import agents
    policies = get_policies()
    allowed = agents.tool_names(agent_key)
    tools = [t for t in _registered_tools() if policies.get(t.name) != "off"]
    if allowed is None:
        return [t for t in tools if t.name != "derivar_a_area"]  # sin especialistas no hay a quién derivar
    return [t for t in tools if t.name in allowed]


def _registered_tools() -> List[Tool]:
    tools = list(CORE_TOOLS)
    try:
        from modules.registry import module_registry
        tools += module_registry.get_tools()
    except Exception as e:
        logger.warning(f"No se pudieron cargar las herramientas de los módulos: {e}")
    seen, unique = set(), []
    for t in tools:
        if t.name not in seen:
            seen.add(t.name)
            unique.append(t)
    return unique


def signature(tools: List[Tool]) -> str:
    """Huella del conjunto de herramientas (para el caché de Gemini: solo cambia al instalar módulos)."""
    raw = json.dumps([[t.name, t.description, t.parameters] for t in tools], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def execute(tools: List[Tool], name: str, args: Optional[Dict[str, Any]], ctx: ToolContext) -> Dict[str, Any]:
    """Ejecuta una herramienta; nunca lanza excepción (el modelo recibe el error y puede reaccionar)."""
    tool = next((t for t in tools if t.name == name), None)
    args = dict(args or {})
    if tool is None:
        result = {"ok": False, "error": f"La herramienta {name} no existe."}
    elif get_policies().get(name) == "approve" and not ctx.approved:
        # Acción delicada: queda en la bandeja de aprobación; un humano decide
        result = _request_approval(tool, args, ctx)
    else:
        try:
            result = tool.handler(ctx, args) or {"ok": True}
        except Exception as e:
            logger.error(f"Error ejecutando la herramienta {name} ({ctx.session_id}): {e}")
            result = {"ok": False, "error": "Falló la operación en el sistema. Ofrece pasar con un asesor."}
    ctx.actions.append({"tool": name, "args": args, "ok": bool(result.get("ok")), "result": result})
    logger.info(f"🛠️ [{ctx.session_id}] {name}({json.dumps(args, ensure_ascii=False)[:200]}) -> ok={result.get('ok')}")
    return result


def _request_approval(tool: Tool, args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    from services.automation_service import automation_service
    task = automation_service.request_tool_approval(ctx.session_id, tool.name, TOOL_LABELS.get(tool.name, tool.name), args)
    return {"ok": False, "pendiente_aprobacion": True, "solicitud": task["id"] if task else None,
            "nota": "Esta acción necesita aprobación del equipo. Dile al cliente, con naturalidad, que ya quedó "
                    "registrada su solicitud y que en breve se la confirman por este chat. No digas que ya está hecha."}


def action_summary(action: Dict[str, Any]) -> str:
    """Línea legible de lo que hizo el agente, para la conversación en la bandeja."""
    label = TOOL_LABELS.get(action["tool"], action["tool"])
    r = action.get("result") or {}
    if r.get("pendiente_aprobacion"):
        return f"⏳ {label}: esperando aprobación"
    if not action["ok"]:
        detail = r.get("falta") and f"falta {r['falta']}" or r.get("error") or "no se pudo"
        return f"⚠️ {label}: {detail}"
    if action["tool"] == "crear_pedido":
        return f"✅ Pedido #{r.get('pedido')} creado · ${float(r.get('total') or 0):.2f}"
    if action["tool"] == "cancelar_pedido":
        return f"✅ Pedido #{r.get('pedido')} cancelado"
    if action["tool"] == "guardar_dato_cliente":
        return f"✅ Ficha actualizada ({', '.join(r.get('guardado') or []) or 'sin cambios'})"
    if action["tool"] == "derivar_a_area":
        from services import agents
        area = (action.get("args") or {}).get("area")
        return agents.switch_note(area, (action.get("args") or {}).get("motivo") or "derivado por el agente") if area in agents.AGENTS else "🔀 Derivó a otra área"
    if action["tool"] == "consultar_pedido":
        return f"🔎 Consultó el pedido #{r.get('pedido')}"
    return f"✅ {label}"


def log_actions(ctx: ToolContext) -> None:
    """Deja en la conversación lo que hizo el agente (visible en la bandeja, no para el cliente ni el modelo)."""
    if not ctx.actions:
        return
    try:
        from services.customer_service import customer_service
        for action in ctx.actions:
            customer_service.record_message(ctx.session_id, "action", action_summary(action))
    except Exception as e:
        logger.debug(f"No se pudieron registrar las acciones del agente: {e}")


def compose_reply(model_text: str, ctx: ToolContext) -> str:
    """Respuesta final: texto del modelo + mensajes oficiales de las herramientas (o solo estos si el turno terminó)."""
    official = "\n\n".join(ctx.customer_messages)
    if ctx.end_turn:
        return official or (model_text or "").strip()
    parts = [p for p in ((model_text or "").strip(), official) if p]
    return "\n\n".join(parts)


# ----------------------------------------------------------------------
# FORMATOS POR PROVEEDOR
# ----------------------------------------------------------------------
def openai_tools(tools: List[Tool]) -> List[Dict[str, Any]]:
    return [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
            for t in tools]


def gemini_tools(tools: List[Tool]):
    from google.genai import types
    return [types.Tool(function_declarations=[
        types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.parameters)
        for t in tools])]
