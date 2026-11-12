"""Mensajes al cliente final: código de verificación y comprobantes de cada movimiento.

Canales: correo (SMTP de la plataforma) y WhatsApp (solo si la empresa tiene el ARM con WhatsApp conectado).
Los comprobantes se envían en segundo plano: si el envío falla, el sello o canje ya quedó registrado.
"""
import html
import logging
import threading
from typing import Any, Dict, Optional

from services.tenant_service import FEATURE_ARM, current_tenant, tenant_registry, thread_target

logger = logging.getLogger("asistente_operativo.modules.loyalty")


def _company() -> Dict[str, str]:
    try:
        from config import settings
        settings.load_db_overrides()
        return {"name": (settings.COMPANY_NAME or "").strip() or "Tu negocio",
                "color": (settings.PRIMARY_COLOR or "").strip() or "#3ecf8e"}
    except Exception:
        return {"name": "Tu negocio", "color": "#3ecf8e"}


def email_available() -> bool:
    try:
        from services.email_service import email_service
        return email_service.is_configured()
    except Exception:
        return False


def whatsapp_available() -> bool:
    """WhatsApp de la empresa: es parte del ARM, así que una empresa solo-fidelidad no lo tiene."""
    if not tenant_registry.has_feature(current_tenant(), FEATURE_ARM):
        return False
    try:
        from services.whatsapp_service import whatsapp_service
        if whatsapp_service.channel == "meta":
            from services.meta_service import meta_service
            return meta_service.is_configured()
        return bool(whatsapp_service.get_status().get("connected"))
    except Exception as e:
        logger.debug(f"WhatsApp no disponible para fidelidad: {e}")
        return False


def channels() -> Dict[str, bool]:
    return {"email": email_available(), "whatsapp": whatsapp_available()}


def _send_email(to: str, subject: str, text: str, body_html: str) -> None:
    from services.email_service import email_service
    email_service.send(to, subject, text, body_html)


def _send_whatsapp(phone: str, text: str) -> None:
    from services.whatsapp_service import whatsapp_service
    if not whatsapp_service.send_text_message(phone, text):
        raise RuntimeError(whatsapp_service.last_send_error or "WhatsApp no aceptó el mensaje.")


def _html_wrap(company: Dict[str, str], title: str, inner: str, link: str = "") -> str:
    button = (f'<p style="margin:24px 0 0"><a href="{html.escape(link)}" style="background:{company["color"]};'
              f'color:#09090b;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">'
              f'Ver mi tarjeta</a></p>') if link else ""
    return (f'<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#18181b">'
            f'<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#71717a">'
            f'{html.escape(company["name"])}</div>'
            f'<h2 style="margin:6px 0 16px">{html.escape(title)}</h2>{inner}{button}'
            f'<p style="margin-top:28px;font-size:11px;color:#a1a1aa">Recibiste este mensaje por tu tarjeta de '
            f'fidelidad de {html.escape(company["name"])}.</p></div>')


def send_code(contact: str, channel: str, code: str) -> str:
    """Envía el código de verificación. Devuelve el canal usado o lanza RuntimeError con un mensaje para el cliente."""
    company = _company()
    text = f"{company['name']}: tu código para sumar sellos es {code}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje."
    if channel == "email":
        if not email_available():
            raise RuntimeError("Por ahora no podemos enviar correos. Usa tu número de WhatsApp o pide tu sello en caja.")
        inner = (f'<p>Tu código para sumar sellos es:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">'
                 f'{code}</p><p style="color:#71717a">Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>')
        _send_email(contact, f"Tu código: {code}", text, _html_wrap(company, "Verifica tu tarjeta", inner))
        return "email"
    if not whatsapp_available():
        raise RuntimeError("Por ahora no podemos enviar mensajes de WhatsApp. Usa tu correo o pide tu sello en caja.")
    _send_whatsapp(contact, text)
    return "whatsapp"


def receipt_lines(card: Dict[str, Any], program: Dict[str, Any], result: Dict[str, Any], kind: str):
    """Título y líneas del comprobante (separado del envío para poder probarlo)."""
    stamps = program.get("kind") == "stamps"
    unit = "sellos" if stamps else "puntos"
    if kind == "redeem":
        title = "¡Canjeaste tu recompensa!"
        lines = [f"Recompensa: {result.get('reward') or 'recompensa'}", f"Saldo actual: {result.get('balance')} {unit}"]
    else:
        title = "¡Sumaste un sello!" if stamps else f"¡Sumaste {result.get('points')} puntos!"
        if stamps:
            goal = int(program.get("stamps_goal") or 0)
            bal = int(result.get("balance") or 0)
            lines = [f"Llevas {bal} de {goal} sellos."]
            lines.append(f"¡Completaste tu tarjeta! Pide tu {program.get('reward_description') or 'premio'} en caja."
                         if bal >= goal else f"Te faltan {goal - bal} para tu {program.get('reward_description') or 'premio'}.")
        else:
            lines = [f"Saldo actual: {result.get('balance')} puntos."]
    lines.append(f"Programa: {program.get('name')} · Tarjeta {card.get('code')}")
    return title, lines


def send_receipt(card: Dict[str, Any], program: Dict[str, Any], result: Dict[str, Any], kind: str,
                 link: str = "") -> Optional[str]:
    """Comprobante del movimiento al correo o WhatsApp del cliente. Devuelve el canal usado o None."""
    company = _company()
    title, lines = receipt_lines(card, program, result, kind)
    text = f"{company['name']} — {title}\n" + "\n".join(lines) + (f"\nTu tarjeta: {link}" if link else "")
    try:
        if card.get("email") and email_available():
            inner = "".join(f"<p style='margin:4px 0'>{html.escape(line)}</p>" for line in lines)
            _send_email(card["email"], f"{company['name']}: {title}", text, _html_wrap(company, title, inner, link))
            return "email"
        if card.get("phone") and whatsapp_available():
            _send_whatsapp(card["phone"], text)
            return "whatsapp"
    except Exception as e:
        logger.warning(f"No se pudo enviar el comprobante de la tarjeta {card.get('code')}: {e}")
    return None


def send_receipt_async(card_id: int, result: Dict[str, Any], kind: str, link: str = "") -> None:
    """Envía el comprobante en un hilo (con la empresa en curso) para no demorar la respuesta."""
    from modules.loyalty.service import loyalty_service

    def job():
        card = loyalty_service.get_card(card_id)
        if not card:
            return
        program = loyalty_service.get_program(card["program_id"]) or {}
        send_receipt(card, program, result, kind, link)

    threading.Thread(target=thread_target(job), name="loyalty-receipt", daemon=True).start()
