"""Toma de pedidos por chat: instrucciones para la IA y procesamiento de sus etiquetas.

La IA no ejecuta herramientas; cuando el cliente confirma, agrega al final de su mensaje un bloque
[[PEDIDO]]{json}[[/PEDIDO]]. El backend lo valida con las reglas reales del restaurante, crea la orden y
reemplaza el bloque por una confirmación oficial con el total calculado por el servidor.
"""
import json
import logging
import re
from typing import Any, Dict, Optional

from modules.restaurant.models import OrderCreate, OrderItemIn
from modules.restaurant.service import (
    ACTIVE_STATUSES, ORDER_TYPE_LABELS, ORDER_TYPES, PAYMENT_LABELS, OrderError, _money, restaurant_service,
)

logger = logging.getLogger("asistente_operativo.modules.restaurant")

ORDER_TAG = re.compile(r"\[\[PEDIDO\]\](.*?)\[\[/PEDIDO\]\]", re.DOTALL | re.IGNORECASE)
STATUS_TAG = re.compile(r"\[\[ESTADO\]\]", re.IGNORECASE)
CANCEL_TAG = re.compile(r"\[\[CANCELAR\]\]", re.IGNORECASE)
ANY_TAG = re.compile(r"\[\[/?(?:PEDIDO|ESTADO|CANCELAR)\]\]", re.IGNORECASE)

TYPE_ALIASES = {"domicilio": "delivery", "delivery": "delivery", "envio": "delivery", "envío": "delivery",
                "recoger": "pickup", "pickup": "pickup", "llevar": "pickup",
                "local": "dine_in", "dine_in": "dine_in", "mesa": "dine_in"}
PAYMENT_ALIASES = {"efectivo": "cash", "cash": "cash", "transferencia": "transfer", "transfer": "transfer",
                   "tarjeta": "card", "card": "card"}


def build_prompt_extension() -> str:
    """Datos estables del restaurante + reglas de atención (se cachea; lo volátil va en build_live_context)."""
    service = restaurant_service
    config = service.get_config()
    ai = config.get("ai") or {}

    types = [f"{ORDER_TYPE_LABELS[t]} ({t})" for t in ORDER_TYPES if config["order_types"].get(t)]
    payments = [f"{PAYMENT_LABELS[p]} ({p})" for p in PAYMENT_LABELS if config["payment_methods"].get(p)]
    lines = ["[RESTAURANTE]"]
    if config["restaurant_name"]:
        lines.append(f"Nombre: {config['restaurant_name']}")
    if config["address"]:
        lines.append(f"Dirección: {config['address']}")
    lines.append(f"Horario: {service.hours_text(config)}")
    if config["closed_message"]:
        lines.append(f"Si está cerrado di: {config['closed_message']}")
    lines.append(f"Pedidos: {', '.join(types) or 'ninguno'}. Pagos: {', '.join(payments) or 'ninguno'}.")
    if config["payment_methods"].get("transfer") and config["transfer_info"]:
        lines.append(f"Transferencia: {config['transfer_info']}")
    if config["order_types"].get("delivery"):
        if config["zones"]:
            zones = "; ".join(
                f"{z['name']} {_money(z['fee'])}"
                + (f" mín {_money(z['min_order'])}" if z["min_order"] else "")
                + (f" ~{z['minutes'] + config['prep_minutes']}min" if z["minutes"] else "")
                for z in config["zones"])
            lines.append(f"Zonas de envío: {zones}")
        elif config["flat_delivery_fee"]:
            lines.append(f"Envío: {_money(config['flat_delivery_fee'])}")
    extra = f"Pedido mínimo {_money(config['min_order'])} sin envío. " if config["min_order"] else ""
    lines.append(f"{extra}Preparación ~{config['prep_minutes']} min.")
    if ai.get("menu_link"):
        lines.append(f"Carta con fotos: {ai['menu_link']}")
    lines.append("\n[CATÁLOGO E INVENTARIO OFICIAL DISPONIBLE]")
    lines.append(service.get_menu_text(with_ids=True, with_stock=True))
    lines.append(_behavior_rules(ai))
    if (ai.get("instructions") or "").strip():
        lines.append("Indicaciones del restaurante:\n" + ai["instructions"].strip())
    return "\n".join(lines)


def build_live_context() -> str:
    """Datos que cambian minuto a minuto. Van junto al mensaje del cliente, NO en el prompt cacheado."""
    service = restaurant_service
    config = service.get_config()
    is_open = service.is_open(config)
    local = service.local_now(config)
    status_str = "ABIERTO." if is_open else "CERRADO: no tomes pedidos."
    parts = [f"Restaurante {local.strftime('%H:%M')} {status_str}"]
    hours_info = service.hours_text(config)
    if hours_info:
        parts.append(f"Horario oficial vigente: {hours_info}.")
    available_items = service.list_menu(only_available=True)
    stock_summary = [f"{i['name']} ({i['stock']} disp.)" for i in available_items if i.get("stock") is not None]
    if stock_summary:
        parts.append(f"INVENTARIO EN VIVO (MÁXIMA CERTEZA): {', '.join(stock_summary)}.")
    cats_with_stock = sorted(list(set(i["category"].strip().title() for i in available_items if i.get("category"))))
    if cats_with_stock:
        parts.append(f"Categorías disponibles: {', '.join(cats_with_stock)}.")
    else:
        parts.append("Actualmente NO hay productos disponibles en la carta.")
    low = [f"{i['name']} ({i['stock']})" for i in service.list_menu(only_available=True)
           if i["stock"] is not None and i["stock"] <= 5]
    if low:
        parts.append("Poco stock: " + ", ".join(low) + ".")
    return " ".join(parts)


def _behavior_rules(ai: Dict[str, Any]) -> str:
    """Reglas de atención según la configuración de IA del restaurante (pestaña Configuración del módulo)."""
    r = [
        "\n[CÓMO ATENDER - AGENTE DE RELACIONES Y VENTAS (ARM)]",
        "- ROL: Eres un Asistente y Gestor de Relaciones (ARM) sumamente certero, empático y profesional.",
        "- Si el cliente SOLO SALUDA (ej. 'hola', 'buenas', 'buenos días'): saluda de forma cálida, cercana y natural. Pregunta en qué puedes colaborar hoy (por ejemplo ofreciendo ver la carta o tomar un pedido). NUNCA recites productos, precios ni menciones platos agotados en un saludo simple.",
        "- VERDAD ABSOLUTA DE INVENTARIO: Lees el inventario real en vivo. Todos los productos listados con stock > 0 (como Hamburguesa Angus BBQ con 350 unidades en inventario) TIENEN EXISTENCIAS DISPONIBLES DE SOBRA. JAMÁS digas que están agotados ni inventes que se acabaron.",
        "- PRODUCTOS NO DISPONIBLES: Si el cliente pregunta por productos que NO están en el menú o que están en stock 0 (como tacos, pizzas, pupusas, etc.), explica cordialmente que por el momento no dispones de ellos y ofrece con total seguridad las opciones que sí tienen stock disponible.",
    ]
    if ai.get("menu_style") == "full":
        r.append("- Si el cliente pide ver el menú o pregunta qué hay de comer: muéstralo completo organizado por categorías con sus precios y stock disponible.")
    else:
        r.append(
            "- CÓMO MOSTRAR EL MENÚ (REGLA: Primero categorías, luego productos):\n"
            "  * Si el cliente pide ver el menú o pregunta qué hay para comer/tomar: menciona ÚNICAMENTE las categorías disponibles (ej. 'Tenemos: Hamburguesas y Bebidas. ¿Cuál te gustaría ver?'). NO listes los productos específicos ni precios en este paso.\n"
            "  * Solo cuando el cliente elija o mencione una categoría concreta (ej. 'hamburguesas'): muestra inmediatamente la Hamburguesa Angus BBQ por $14.00, confirmando con entusiasmo que está disponible para preparar con stock en inventario."
        )
    if ai.get("menu_link"):
        r.append("- Si piden fotos o la carta, comparte el enlace.")
    r.append("- Nunca muestres los [id N].")
    if not ai.get("take_orders", True):
        r.append("- NO tomes pedidos aquí: si quieren pedir, responde con el mensaje oficial de transferencia.")
        return "\n".join(r)
    if ai.get("upsell", True):
        r.append("- Como buen vendedor: al agregar algo, confírmalo y pregunta si desea algo más sugiriendo un complemento o bebida REAL que sí esté en el MENÚ disponible con su precio exacto. No inventes productos. No insistas si dice que no.")
    else:
        r.append("- Al agregar algo, confírmalo y pregunta si desea algo más.")
    name_step = ", 4) nombre" if ai.get("ask_name", True) else ""
    r.append(f"""- Pide solo lo que falte, en orden: 1) productos (hasta que diga que es todo), 2) domicilio o recoger (si es domicilio: dirección y zona), 3) pago{name_step}.
- Con todo listo, resume productos, envío y total, y pregunta si está bien. Si está CERRADO, no tomes pedidos.
- Solo tras un sí explícito usa la herramienta crear_pedido con los [id N] del menú. El sistema valida y envía la confirmación oficial con número y total; no la repitas.
- Si crear_pedido responde que falta un dato, pregúntalo con naturalidad. Si da un error, explícalo y ofrece alternativas.
- ¿Cómo va mi pedido? → usa consultar_pedido. ¿Cancelar? → confirma primero y luego usa cancelar_pedido.
- Pago por transferencia: da los datos y pide la foto del comprobante.""")
    return "\n".join(r)


def _parse_order_payload(raw: str) -> Optional[Dict[str, Any]]:
    text = raw.strip()
    try:
        data = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(text[start:end + 1])
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _confirmation_text(order: Dict[str, Any], config: Dict[str, Any]) -> str:
    lines = [f"✅ ¡Pedido #{order['id']} registrado!", "", "🛒 Tu pedido:"]
    for item in order["items"]:
        note = f" ({item['notes']})" if item.get("notes") else ""
        lines.append(f"  • {item['quantity']} x {item['name']}{note}: {_money(item['subtotal'])}")
    lines.append("")
    lines.append(f"Subtotal: {_money(order['subtotal'])}")
    if order["delivery_fee"]:
        lines.append(f"Envío ({order['delivery_zone'] or 'domicilio'}): {_money(order['delivery_fee'])}")
    lines.append(f"💵 Total: {_money(order['total'])}")
    lines.append(f"📦 {ORDER_TYPE_LABELS.get(order['order_type'], order['order_type'])}"
                 + (f" · {order['delivery_address']}" if order["delivery_address"] else ""))
    lines.append(f"⏱️ Tiempo estimado: ~{order['estimated_minutes']} min")
    lines.append(f"💳 Pago: {PAYMENT_LABELS.get(order['payment_method'], order['payment_method'])}")
    if order["payment_method"] == "transfer":
        lines.append("Envíanos la foto del comprobante por este chat." +
                     (f"\n{config['transfer_info']}" if config["transfer_info"] else ""))
    lines.append("\nTe avisaremos por aquí cuando tu pedido avance.")
    return "\n".join(lines)


def create_order_result(session_id: str, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Valida y registra un pedido. Devuelve {ok, message, ...}; si falta un dato, `missing` dice cuál."""
    config = restaurant_service.get_config()
    if not isinstance(payload, dict):
        return {"ok": False, "missing": "productos", "message": "Uy, no me quedó claro tu pedido 😅 ¿Me repites qué vas a llevar?"}
    items = []
    for entry in payload.get("items") or payload.get("productos") or []:
        if not isinstance(entry, dict):
            continue
        menu_id = _to_int(entry.get("id") or entry.get("menu_item_id"))
        qty = _to_int(entry.get("qty") or entry.get("quantity") or entry.get("cantidad") or 1)
        if menu_id is None or qty is None or qty < 1:
            continue
        items.append(OrderItemIn(menu_item_id=menu_id, quantity=min(qty, 50),
                                 notes=str(entry.get("notes") or entry.get("notas") or "")[:200]))
    if not items:
        return {"ok": False, "missing": "productos", "message": "¡Va! ¿Qué te gustaría pedir? 😊"}

    # Tipo de pedido y pago: si falta y solo hay una opción, se asume; si hay varias, se pregunta.
    enabled_types = [t for t in ORDER_TYPES if config["order_types"].get(t)]
    order_type = TYPE_ALIASES.get(str(payload.get("type") or payload.get("tipo") or "").strip().lower())
    if order_type is None:
        if len(enabled_types) != 1:
            return {"ok": False, "missing": "tipo", "message": "¡Perfecto! ¿Te lo llevamos a domicilio o pasas a recogerlo? 🛵🛍️"}
        order_type = enabled_types[0]
    address = str(payload.get("address") or payload.get("direccion") or "").strip()
    if order_type == "delivery" and not address:
        return {"ok": False, "missing": "direccion", "message": "¡Casi listo! 🙌 ¿Me compartes la dirección donde te lo llevamos?"}

    enabled_payments = [p for p in PAYMENT_LABELS if config["payment_methods"].get(p)]
    payment = PAYMENT_ALIASES.get(str(payload.get("payment") or payload.get("pago") or "").strip().lower())
    if payment is None:
        if len(enabled_payments) != 1:
            options = " o ".join(PAYMENT_LABELS[p].lower() for p in enabled_payments)
            return {"ok": False, "missing": "pago", "message": f"¡Ya casi! ¿Cómo vas a pagar: {options}?"}
        payment = enabled_payments[0]
    try:
        order = restaurant_service.create_order(
            OrderCreate(
                session_id=session_id,
                customer_name=str(payload.get("name") or payload.get("nombre") or "Cliente")[:100],
                items=items,
                notes=str(payload.get("notes") or payload.get("notas") or "")[:300],
                order_type=order_type,
                delivery_address=address[:300],
                delivery_zone=str(payload.get("zone") or payload.get("zona") or "")[:80],
                payment_method=payment,
            ),
            source="bot", enforce_schedule=True)
    except OrderError as e:
        return {"ok": False, "error": str(e), "message": f"Uy, antes de anotarlo: {e} ¿Cómo lo dejamos? 🙂"}
    except Exception as e:
        logger.error(f"Error creando pedido desde el chat ({session_id}): {e}")
        return {"ok": False, "error": "falla del sistema",
                "message": "Uy, se me trabó el sistema al anotar tu pedido 😅 Ya le aviso a alguien del equipo para que te ayude."}
    if order.get("duplicate"):
        return {"ok": True, "duplicate": True, "order_id": order["id"], "total": order["total"],
                "message": f"Tranqui, tu pedido #{order['id']} ya quedó anotado 👍 Total: {_money(order['total'])}."}
    logger.info(f"🍽️ Pedido #{order['id']} creado por el bot para {session_id} (total {_money(order['total'])}).")
    return {"ok": True, "order_id": order["id"], "total": order["total"], "message": _confirmation_text(order, config)}


def _create_from_tag(session_id: str, payload_text: str) -> str:
    """Compatibilidad: etiqueta [[PEDIDO]] (antes de las herramientas nativas)."""
    return create_order_result(session_id, _parse_order_payload(payload_text))["message"]


def _latest_order(session_id: str) -> Optional[Dict[str, Any]]:
    orders = restaurant_service.list_orders(session_id=session_id, limit=1)
    return orders[0] if orders else None


def _status_text(session_id: str) -> str:
    order = _latest_order(session_id)
    if order is None:
        return "No encuentro pedidos registrados con este número."
    label = restaurant_service._status_label(order["status"]).capitalize()
    return (f"📋 Pedido #{order['id']}: {label}. Total {_money(order['total'])}"
            + (f" · ~{order['estimated_minutes']} min" if order["status"] in ACTIVE_STATUSES else "") + ".")


def _cancel_text(session_id: str) -> str:
    order = _latest_order(session_id)
    if order is None or order["status"] not in ACTIVE_STATUSES:
        return "No tienes un pedido activo para cancelar."
    if order["status"] != "pending":
        return (f"Tu pedido #{order['id']} ya está {restaurant_service._status_label(order['status'])} y no puedo "
                "cancelarlo desde aquí. Un asesor puede ayudarte.")
    restaurant_service.update_order_status(order["id"], "cancelled", "Cancelado por el cliente", notify=False)
    return f"❌ Listo, cancelé tu pedido #{order['id']}."


# ----------------------------------------------------------------------
# HERRAMIENTAS DEL AGENTE (function calling)
# ----------------------------------------------------------------------
def _tool_create_order(ctx, args: Dict[str, Any]) -> Dict[str, Any]:
    result = create_order_result(ctx.session_id, args)
    if result["ok"]:
        ctx.say(result["message"])  # confirmación oficial con el total del servidor
        return {"ok": True, "pedido": result["order_id"], "total": result["total"],
                "nota": "El sistema ya envió al cliente la confirmación oficial con el detalle y el total. "
                        "Responde solo una frase breve y cálida de cierre, sin repetir productos ni montos."}
    out = {"ok": False, "mensaje_sugerido": result["message"]}
    if result.get("missing"):
        out["falta"] = result["missing"]
    if result.get("error"):
        out["error"] = result["error"]
    return out


def _tool_order_status(ctx, args: Dict[str, Any]) -> Dict[str, Any]:
    order = _latest_order(ctx.session_id)
    if order is None:
        return {"ok": False, "error": "El cliente no tiene pedidos registrados con este número."}
    return {"ok": True, "pedido": order["id"], "estado": restaurant_service._status_label(order["status"]),
            "total": order["total"], "pago": "pagado" if order.get("payment_status") == "paid" else "pendiente",
            "minutos_estimados": order["estimated_minutes"] if order["status"] in ACTIVE_STATUSES else None,
            "resumen": _status_text(ctx.session_id)}


def _tool_cancel_order(ctx, args: Dict[str, Any]) -> Dict[str, Any]:
    if not args.get("confirmado"):
        return {"ok": False, "error": "Primero confirma con el cliente que quiere cancelar."}
    order = _latest_order(ctx.session_id)
    if order is None or order["status"] not in ACTIVE_STATUSES:
        return {"ok": False, "error": "El cliente no tiene un pedido activo."}
    if order["status"] != "pending":
        return {"ok": False, "error": f"El pedido #{order['id']} ya está {restaurant_service._status_label(order['status'])}; "
                                      "no se puede cancelar desde el chat. Ofrece pasar con un asesor."}
    restaurant_service.update_order_status(order["id"], "cancelled", str(args.get("motivo") or "Cancelado por el cliente")[:200],
                                           notify=False)
    return {"ok": True, "pedido": order["id"], "estado": "cancelado"}


def build_tools() -> list:
    from services.agent_tools import Tool
    config = restaurant_service.get_config()
    if not (config.get("ai") or {}).get("take_orders", True):
        return [Tool("consultar_pedido", "Consulta el estado real del último pedido del cliente.",
                     {"type": "object", "properties": {}}, _tool_order_status)]
    return [
        Tool(
            name="crear_pedido",
            description=("Registra el pedido del cliente. Úsala SOLO después de mostrar el resumen y de que el cliente "
                         "confirme de forma explícita (sí, dale, confirmo). El sistema valida horario, stock, zona y "
                         "pago y calcula el total. Si falta un dato, la respuesta indica cuál preguntar."),
            parameters={
                "type": "object",
                "properties": {
                    "productos": {
                        "type": "array",
                        "description": "Productos del menú.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "integer", "description": "Id del menú ([id N])."},
                                "cantidad": {"type": "integer", "minimum": 1},
                                "notas": {"type": "string", "description": "Indicaciones del producto (sin cebolla…)."},
                            },
                            "required": ["id", "cantidad"],
                        },
                    },
                    "tipo": {"type": "string", "enum": ["delivery", "pickup", "dine_in"]},
                    "direccion": {"type": "string", "description": "Dirección completa si es a domicilio."},
                    "zona": {"type": "string", "description": "Zona de entrega exacta de la lista."},
                    "pago": {"type": "string", "enum": ["cash", "transfer", "card"]},
                    "nombre": {"type": "string", "description": "Nombre del cliente."},
                    "notas": {"type": "string", "description": "Notas generales del pedido."},
                },
                "required": ["productos"],
            },
            handler=_tool_create_order,
        ),
        Tool("consultar_pedido", "Consulta el estado real del último pedido del cliente (úsala si pregunta cómo va).",
             {"type": "object", "properties": {}}, _tool_order_status),
        Tool(
            name="cancelar_pedido",
            description="Cancela el último pedido del cliente, solo si sigue pendiente y el cliente ya confirmó que quiere cancelarlo.",
            parameters={"type": "object", "properties": {
                "confirmado": {"type": "boolean", "description": "true solo si el cliente confirmó la cancelación."},
                "motivo": {"type": "string"}}, "required": ["confirmado"]},
            handler=_tool_cancel_order,
        ),
    ]


def sanitize_menu_hallucinations(session_id: str, reply: str) -> str:
    """
    Guardrail programático de producción:
    1. Si el cliente solo envió un saludo simple (ej. 'hola'), impide que la IA vomite productos o anuncie agotados.
    2. Si la IA declara erróneamente como 'agotado' un producto que actualmente TIENE STOCK disponible,
       corrige la contradicción de inmediato antes de enviarse al cliente.
    """
    if not reply:
        return reply

    try:
        from services.lead_service import lead_service
        session = lead_service.get_or_create_session(session_id)
        last_user_msg = ""
        for m in reversed(session.messages):
            if m.get("role") == "user":
                last_user_msg = (m.get("content") or "").strip()
                break

        # Caso 1: Saludo simple
        is_greeting = bool(re.fullmatch(
            r"(?i)\s*(hola+|buen[oa]s?\s*(d[ií]as?|tardes?|noches?)?|hey|qu[eé]\s*tal|saludos?)\s*[!.,]*\s*",
            last_user_msg
        ))
        if is_greeting and ("$" in reply or "agotad" in reply.lower()):
            # El usuario solo saludó pero la IA intentó vender o dar precios prematuramente
            c_name = session.customer_name if hasattr(session, "customer_name") and session.customer_name else ""
            saludo_nom = f", {c_name}" if c_name else ""
            logger.warning(f"🛡️ Guardrail: Suavizando saludo invasivo para sesión {session_id}.")
            return f"¡Hola{saludo_nom}! Qué gusto saludarte. ¿En qué te podemos ayudar hoy? Si gustas, con gusto te muestro nuestro menú o te tomo un pedido."

        # Caso 2: Corrección automática e infalible si la IA dice que un ítem con stock está agotado
        available_items = restaurant_service.list_menu(only_available=True)
        agotado_pattern = r"(?:se nos ha agotado[^\.\n]*|se nos agotó[^\.\n]*|la tenemos agotada[^\.\n]*|lo tenemos agotado[^\.\n]*|está agotad\w*[^\.\n]*|se encuentra agotad\w*[^\.\n]*|no tenemos disponible[^\.\n]*|no nos queda[^\.\n]*|se terminó[^\.\n]*|se nos terminó[^\.\n]*)"

        for item in available_items:
            name = item["name"]
            if name.lower() in reply.lower():
                pattern = rf"(?:el\s+|la\s+)?{re.escape(name)}[^.!?\n]*{agotado_pattern}"
                pattern_inv = rf"{agotado_pattern}[^.!?\n]*(?:el\s+|la\s+)?{re.escape(name)}"
                
                if re.search(pattern, reply, re.IGNORECASE) or re.search(pattern_inv, reply, re.IGNORECASE):
                    logger.warning(f"🛡️ Guardrail de Inventario: Corrigiendo falsa declaración de agotado para '{name}' (Stock: {item.get('stock')}).")
                    reply = re.sub(
                        pattern,
                        f"tenemos disponible {name} por {_money(item['price'])}",
                        reply,
                        flags=re.IGNORECASE
                    )
                    reply = re.sub(
                        pattern_inv,
                        f"tenemos disponible {name} por {_money(item['price'])}",
                        reply,
                        flags=re.IGNORECASE
                    )
    except Exception as e:
        logger.debug(f"Aviso en sanitize_menu_hallucinations: {e}")

    return reply


def process_reply(session_id: str, reply: str) -> str:
    """Convierte las etiquetas de la IA en acciones reales y sanitiza contradicciones de menú."""
    if not reply:
        return reply

    # 1. Aplicar guardrails deterministas de menú
    reply = sanitize_menu_hallucinations(session_id, reply)

    # 2. Procesar etiquetas de pedidos y estados
    if "[[" not in reply:
        return reply
    text = ORDER_TAG.sub(lambda m: "\n\n" + _create_from_tag(session_id, m.group(1)), reply)
    text = STATUS_TAG.sub(lambda m: _status_text(session_id), text)
    text = CANCEL_TAG.sub(lambda m: _cancel_text(session_id), text)
    text = ANY_TAG.sub("", text)  # etiquetas sueltas o sin cerrar
    return re.sub(r"\n{3,}", "\n\n", text).strip()
