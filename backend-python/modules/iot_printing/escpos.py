"""Generador universal de comandos ESC/POS y cliente de Socket TCP para impresoras de red."""
import socket
import time
from typing import Any, Dict, List, Optional, Tuple

# Comandos estándar ESC/POS
ESC = b"\x1b"
GS = b"\x1d"

CMD_INIT = ESC + b"@"
CMD_ALIGN_LEFT = ESC + b"a\x00"
CMD_ALIGN_CENTER = ESC + b"a\x01"
CMD_ALIGN_RIGHT = ESC + b"a\x02"

CMD_BOLD_ON = ESC + b"E\x01"
CMD_BOLD_OFF = ESC + b"E\x00"

CMD_DOUBLE_SIZE = GS + b"!\x11"
CMD_DOUBLE_HEIGHT = GS + b"!\x01"
CMD_NORMAL_SIZE = GS + b"!\x00"

CMD_CUT = GS + b"V\x41\x02"  # Corte total con avance
CMD_DRAWER_KICK = ESC + b"p\x00\x19\xfa"  # Pulso para gaveta


def _clean_text(text: str) -> bytes:
    """Convierte texto eliminando tildes complejas o codificando a cp850 / latin-1."""
    if not text:
        return b""
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U",
        "ñ": "n", "Ñ": "N"
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    try:
        return text.encode("cp850", errors="replace")
    except Exception:
        return text.encode("ascii", errors="replace")


def format_two_cols(left: str, right: str, width: int = 42) -> str:
    """Formatea dos columnas justificadas a los extremos para tickets."""
    max_left = width - len(right) - 1
    if len(left) > max_left:
        left = left[:max_left]
    spaces = width - len(left) - len(right)
    return left + (" " * max(1, spaces)) + right + "\n"


def send_raw_tcp(ip: str, port: int, payload: bytes, timeout: float = 3.5) -> Tuple[bool, str]:
    """Envía un payload de bytes directo a una impresora de red mediante TCP socket."""
    ip = (ip or "").strip()
    if not ip:
        return False, "Dirección IP no especificada."
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, int(port or 9100)))
            s.sendall(payload)
        return True, "Enviado con éxito a la impresora."
    except socket.timeout:
        return False, f"Timeout al conectar con la impresora en {ip}:{port} (sin respuesta en {timeout}s)."
    except ConnectionRefusedError:
        return False, f"Conexión rechazada por {ip}:{port}. Verifica que la impresora esté encendida y escuche en el puerto."
    except Exception as e:
        return False, f"Error de red hacia {ip}:{port}: {str(e)}"


def ping_printer(ip: str, port: int = 9100, timeout: float = 2.0) -> Tuple[bool, float, str]:
    """Verifica si la impresora responde en la IP y puerto especificados."""
    ip = (ip or "").strip()
    if not ip:
        return False, 0.0, "Dirección IP vacía."
    start = time.time()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, int(port or 9100)))
        elapsed_ms = round((time.time() - start) * 1000, 1)
        return True, elapsed_ms, f"Conectado exitosamente ({elapsed_ms} ms)"
    except Exception as e:
        return False, 0.0, str(e)


def build_test_receipt(printer_name: str, width_cols: int = 42, auto_cut: bool = True) -> bytes:
    """Construye un ticket de prueba de hardware."""
    buf = bytearray()
    buf.extend(CMD_INIT)
    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(CMD_DOUBLE_SIZE)
    buf.extend(_clean_text("ZENITH IOT PRINT\n"))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(_clean_text("PRUEBA DE IMPRESION\n"))
    buf.extend(_clean_text("------------------------------------------\n"[:width_cols] + b"\n"))
    buf.extend(CMD_ALIGN_LEFT)
    buf.extend(_clean_text(format_two_cols("Dispositivo:", printer_name, width_cols)))
    buf.extend(_clean_text(format_two_cols("Ancho:", f"{width_cols} cols", width_cols)))
    buf.extend(_clean_text(format_two_cols("Fecha:", time.strftime("%d/%m/%Y %H:%M"), width_cols)))
    buf.extend(_clean_text(format_two_cols("Estado:", "OK / ONLINE", width_cols)))
    buf.extend(_clean_text("------------------------------------------\n"[:width_cols] + b"\n"))
    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(_clean_text("Conexion TCP / ESC-POS correcta.\n\n\n\n"))
    if auto_cut:
        buf.extend(CMD_CUT)
    return bytes(buf)


def build_comanda_ticket(order: Dict[str, Any], width_cols: int = 42, auto_cut: bool = True) -> bytes:
    """Construye la comanda para cocina / barra."""
    buf = bytearray()
    buf.extend(CMD_INIT)
    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(CMD_DOUBLE_SIZE)
    buf.extend(CMD_BOLD_ON)
    buf.extend(_clean_text(f"*** COMANDA #{order.get('id', '0')} ***\n"))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(CMD_BOLD_OFF)

    order_type = order.get("order_type") or "delivery"
    type_label = "MESA / SALON" if order_type == "dine_in" else "PARA LLEVAR" if order_type == "pickup" else "DELIVERY"
    buf.extend(CMD_BOLD_ON)
    buf.extend(_clean_text(f"TIPO: {type_label}\n"))
    buf.extend(CMD_BOLD_OFF)
    buf.extend(_clean_text(f"Cliente: {order.get('customer_name') or 'Cliente'}\n"))
    buf.extend(_clean_text(f"Hora: {time.strftime('%H:%M:%S')}\n"))
    buf.extend(CMD_ALIGN_LEFT)
    buf.extend(_clean_text("=" * width_cols + "\n"))

    items = order.get("items") or []
    for it in items:
        qty = it.get("quantity") or 1
        name = it.get("item_name") or it.get("name") or "Platillo"
        notes = it.get("notes") or ""

        buf.extend(CMD_BOLD_ON)
        buf.extend(CMD_DOUBLE_HEIGHT)
        buf.extend(_clean_text(f"{qty}x  {name}\n"))
        buf.extend(CMD_NORMAL_SIZE)
        buf.extend(CMD_BOLD_OFF)
        if notes:
            buf.extend(_clean_text(f"   >> NOTA: {notes}\n"))

    buf.extend(_clean_text("=" * width_cols + "\n"))
    order_notes = order.get("notes") or ""
    if order_notes:
        buf.extend(CMD_BOLD_ON)
        buf.extend(_clean_text(f"OBS: {order_notes}\n"))
        buf.extend(CMD_BOLD_OFF)

    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(_clean_text("\n\n\n\n"))
    if auto_cut:
        buf.extend(CMD_CUT)
    return bytes(buf)


def build_invoice_ticket(
    invoice: Dict[str, Any],
    config_emisor: Optional[Dict[str, Any]] = None,
    width_cols: int = 42,
    auto_cut: bool = True,
    open_drawer: bool = False
) -> bytes:
    """Construye el ticket térmico para consumidor final o factura DTE con totales y QR."""
    cfg = config_emisor or {}
    buf = bytearray()
    buf.extend(CMD_INIT)

    if open_drawer:
        buf.extend(CMD_DRAWER_KICK)

    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(CMD_BOLD_ON)
    buf.extend(CMD_DOUBLE_SIZE)
    buf.extend(_clean_text(f"{cfg.get('nombre_comercial') or 'ZENITH'}\n"))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(CMD_BOLD_OFF)
    buf.extend(_clean_text(f"{cfg.get('razon_social') or 'EMPRESA'}\n"))
    buf.extend(_clean_text(f"NIT: {cfg.get('nit_emisor') or ''}  NRC: {cfg.get('nrc_emisor') or ''}\n"))
    buf.extend(_clean_text(f"{cfg.get('direccion_emisor') or ''}\n"))
    buf.extend(_clean_text(f"Tel: {cfg.get('telefono_emisor') or ''}\n"))
    buf.extend(_clean_text("-" * width_cols + "\n"))

    # Tipo de Comprobante
    dte_type = invoice.get("dte_type") or "01"
    tipo_str = "COMPROBANTE DE CREDITO FISCAL" if dte_type == "03" else "TICKET CONSUMIDOR FINAL" if dte_type == "00" else "FACTURA ELECTRONICA (DTE)"
    buf.extend(CMD_BOLD_ON)
    buf.extend(_clean_text(f"{tipo_str}\n"))
    buf.extend(CMD_BOLD_OFF)
    buf.extend(_clean_text(f"No: {invoice.get('invoice_number') or ''}\n"))

    if invoice.get("control_number"):
        buf.extend(_clean_text(f"Control: {invoice.get('control_number')}\n"))
    if invoice.get("generation_code"):
        buf.extend(_clean_text(f"Cod. Gen: {invoice.get('generation_code')}\n"))
    if invoice.get("reception_stamp"):
        buf.extend(_clean_text(f"Sello MH: {invoice.get('reception_stamp')}\n"))

    buf.extend(CMD_ALIGN_LEFT)
    buf.extend(_clean_text("-" * width_cols + "\n"))
    buf.extend(_clean_text(f"Cliente: {invoice.get('customer_name') or 'Cliente'}\n"))
    if invoice.get("customer_document"):
        buf.extend(_clean_text(f"Doc/NIT: {invoice.get('customer_document')}\n"))
    if invoice.get("customer_nrc"):
        buf.extend(_clean_text(f"NRC: {invoice.get('customer_nrc')}\n"))
    buf.extend(_clean_text(f"Fecha: {str(invoice.get('created_at', ''))[:19]}\n"))
    buf.extend(_clean_text("-" * width_cols + "\n"))

    # Items
    items = invoice.get("items") or []
    for it in items:
        qty = it.get("quantity") or 1
        name = it.get("name") or "Item"
        total = it.get("total") or 0.0
        line_str = f"{qty}x {name}"
        buf.extend(_clean_text(format_two_cols(line_str, f"${total:.2f}", width_cols)))

    buf.extend(_clean_text("-" * width_cols + "\n"))
    buf.extend(_clean_text(format_two_cols("Subtotal:", f"${invoice.get('subtotal', 0):.2f}", width_cols)))
    if invoice.get("iva", 0) > 0:
        buf.extend(_clean_text(format_two_cols("IVA 13%:", f"${invoice.get('iva', 0):.2f}", width_cols)))
    if invoice.get("retention", 0) > 0:
        buf.extend(_clean_text(format_two_cols("Retencion 1%:", f"-${invoice.get('retention', 0):.2f}", width_cols)))

    buf.extend(CMD_BOLD_ON)
    buf.extend(CMD_DOUBLE_SIZE)
    buf.extend(_clean_text(format_two_cols("TOTAL:", f"${invoice.get('total', 0):.2f}", width_cols)))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(CMD_BOLD_OFF)

    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(_clean_text(f"Metodo de pago: {(invoice.get('payment_method') or 'Efectivo').upper()}\n"))
    if invoice.get("qr_url"):
        buf.extend(_clean_text(f"\nConsulta tu DTE en linea:\n{invoice.get('qr_url')}\n"))

    buf.extend(_clean_text("\nGracias por su preferencia!\n\n\n\n"))
    if auto_cut:
        buf.extend(CMD_CUT)
    return bytes(buf)
