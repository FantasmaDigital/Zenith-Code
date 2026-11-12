"""Herramientas y generador de estructura DTE para Ministerio de Hacienda de El Salvador."""
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

IVA_RATE = Decimal("0.13")
CENT = Decimal("0.01")


def generate_uuid() -> str:
    """Genera un Código de Generación en formato UUID v4 oficial en mayúsculas."""
    raw = str(uuid.uuid4()).upper()
    return raw


def format_control_number(dte_type: str, cod_est: str, cod_pto: str, sequence: int) -> str:
    """
    Formato oficial de Número de Control DTE MH El Salvador:
    DTE-{tipoDte:02d}-{codEstablecimiento}{codPtoVenta}-{correlativo:015d}
    Ejemplo: DTE-01-M001P001-000000000000045
    """
    clean_type = dte_type.zfill(2)
    clean_est = (cod_est or "M001").strip().upper()[:4].ljust(4, "0")
    clean_pto = (cod_pto or "P001").strip().upper()[:4].ljust(4, "0")
    seq_str = str(sequence).zfill(15)
    return f"DTE-{clean_type}-{clean_est}{clean_pto}-{seq_str}"


def calculate_amounts(items: List[Dict[str, Any]], dte_type: str = "01", apply_retention: bool = False) -> Dict[str, Any]:
    """
    Calcula subtotal, IVA (13%), retención (1% si aplica gran contribuyente) y total.
    En Factura (01) el precio de venta al consumidor final usualmente ya incluye IVA.
    En Crédito Fiscal (03) el precio base es neto y el IVA 13% se suma explícitamente.
    """
    subtotal_neto = Decimal("0.00")
    total_iva = Decimal("0.00")
    total_pagar = Decimal("0.00")
    formatted_items = []

    for it in items:
        qty = Decimal(str(it.get("quantity", 1)))
        price = Decimal(str(it.get("unit_price", 0)))
        item_total = (qty * price).quantize(CENT, rounding=ROUND_HALF_UP)

        if dte_type == "03":
            # Crédito fiscal: precio neto + IVA
            line_neto = item_total
            line_iva = (line_neto * IVA_RATE).quantize(CENT, rounding=ROUND_HALF_UP)
            line_total = line_neto + line_iva
        else:
            # Factura consumidor final: el precio incluye IVA
            line_total = item_total
            line_neto = (line_total / (Decimal("1") + IVA_RATE)).quantize(CENT, rounding=ROUND_HALF_UP)
            line_iva = line_total - line_neto

        subtotal_neto += line_neto
        total_iva += line_iva
        total_pagar += line_total

        formatted_items.append({
            "name": it.get("name", "Artículo"),
            "quantity": float(qty),
            "unit_price": float(price),
            "subtotal": float(line_neto),
            "iva": float(line_iva),
            "total": float(line_total),
            "notes": it.get("notes", "")
        })

    retention = Decimal("0.00")
    if apply_retention and dte_type == "03" and subtotal_neto >= Decimal("100.00"):
        retention = (subtotal_neto * Decimal("0.01")).quantize(CENT, rounding=ROUND_HALF_UP)
        total_pagar -= retention

    return {
        "items": formatted_items,
        "subtotal": float(subtotal_neto),
        "iva": float(total_iva),
        "retention": float(retention),
        "total": float(total_pagar)
    }


def build_dte_json(
    config: Dict[str, Any],
    invoice: Dict[str, Any],
    customer: Dict[str, Any],
    items: List[Dict[str, Any]],
    amounts: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Construye el JSON DTE oficial de acuerdo al esquema técnico del Ministerio de Hacienda de El Salvador.
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")

    dte_type = invoice.get("dte_type", "01")
    gen_code = invoice.get("generation_code") or generate_uuid()
    ctrl_num = invoice.get("control_number") or ""
    ambiente = config.get("environment", "00")  # 00 = Sandbox, 01 = Producción

    # 1. Identificación
    identificacion = {
        "version": 1 if dte_type == "01" else 3,
        "ambiente": ambiente,
        "tipoDte": dte_type,
        "numeroControl": ctrl_num,
        "codigoGeneracion": gen_code,
        "tipoModelo": 1,  # Previo
        "tipoOperacion": 1,  # Normal
        "tipoContingencia": None,
        "motivoContin": None,
        "fecEmi": date_str,
        "horEmi": time_str,
        "tipoMoneda": "USD"
    }

    # 2. Emisor
    emisor = {
        "nit": (config.get("nit_emisor") or "0614-010190-101-1").replace("-", ""),
        "nrc": (config.get("nrc_emisor") or "123456-7").replace("-", ""),
        "nombre": config.get("razon_social") or "EMPRESA DEMO S.A. DE C.V.",
        "codActividad": config.get("cod_actividad") or "56101",
        "descActividad": config.get("giro_actividad") or "Restaurantes y servicios de comida",
        "nombreComercial": config.get("nombre_comercial") or "Zenith Gastro Bar",
        "tipoEstablecimiento": "01",
        "direccion": {
            "departamento": "06",  # San Salvador
            "municipio": "14",
            "complemento": config.get("direccion_emisor") or "San Salvador, El Salvador"
        },
        "telefono": config.get("telefono_emisor") or "2222-0000",
        "correo": config.get("correo_emisor") or "facturacion@zenith.sv",
        "codEstablecimiento": config.get("cod_establecimiento") or "M001",
        "codPuntoVenta": config.get("cod_punto_venta") or "P001"
    }

    # 3. Receptor
    receptor: Dict[str, Any] = {
        "nombre": customer.get("name") or "CLIENTE GENERAL",
        "telefono": customer.get("phone") or "",
        "correo": customer.get("email") or ""
    }

    doc_num = (customer.get("document_number") or "").replace("-", "").strip()
    doc_type = customer.get("document_type") or "13"  # 13 = DUI, 36 = NIT, 03 = Pasaporte

    if dte_type == "03":
        # Crédito fiscal requiere NIT y NRC
        receptor["nit"] = doc_num or "06140101901021"
        receptor["nrc"] = (customer.get("nrc") or "1234567").replace("-", "")
        receptor["descActividad"] = customer.get("activity") or "Servicios Generales"
        receptor["direccion"] = {
            "departamento": "06",
            "municipio": "14",
            "complemento": customer.get("address") or "San Salvador"
        }
    else:
        # Factura normal consumidor final
        if doc_num:
            receptor["tipoDocumento"] = doc_type
            receptor["numDocumento"] = doc_num

    # 4. Cuerpo del documento (ítems)
    cuerpo = []
    for idx, item in enumerate(amounts["items"], start=1):
        cuerpo.append({
            "numItem": idx,
            "tipoItem": 1,  # Bienes
            "cantidad": item["quantity"],
            "codigo": None,
            "codTributo": None,
            "uniMedida": 59,  # Unidad
            "descripcion": item["name"],
            "precioUni": item["unit_price"],
            "montoDescu": 0.0,
            "ventaNoSuj": 0.0,
            "ventaExenta": 0.0,
            "ventaGravada": item["subtotal"] if dte_type == "03" else item["total"],
            "tributos": ["20"] if dte_type == "03" else None,  # Código 20 = IVA
            "ivaItem": item["iva"]
        })

    # 5. Resumen
    resumen = {
        "totalNoSuj": 0.0,
        "totalExenta": 0.0,
        "totalGravada": amounts["subtotal"] if dte_type == "03" else amounts["total"],
        "subTotalVentas": amounts["subtotal"] if dte_type == "03" else amounts["total"],
        "descuNoSuj": 0.0,
        "descuExenta": 0.0,
        "descuGravada": 0.0,
        "totalDescu": 0.0,
        "tributos": [{"codigo": "20", "descripcion": "Impuesto al Valor Agregado 13%", "valor": amounts["iva"]}] if dte_type == "03" else [],
        "subTotal": amounts["subtotal"],
        "ivaRete1": amounts["retention"],
        "reteRenta": 0.0,
        "montoTotalOperacion": amounts["total"],
        "totalNoGravado": 0.0,
        "totalPagar": amounts["total"],
        "totalLetras": f"{amounts['total']:.2f} DÓLARES",
        "condicionOperacion": 1,  # Contado
        "pagos": [
            {
                "codigo": "01",  # Efectivo
                "montoPago": amounts["total"],
                "referencia": invoice.get("payment_method") or "cash",
                "plazo": None,
                "periodo": None
            }
        ]
    }

    return {
        "identificacion": identificacion,
        "emisor": emisor,
        "receptor": receptor,
        "otrosDocumentos": None,
        "ventaTercero": None,
        "cuerpoDocumento": cuerpo,
        "resumen": resumen,
        "extension": None,
        "apendice": None
    }


def get_public_consult_url(environment: str, generation_code: str, emission_date: str) -> str:
    """Retorna la URL oficial para escanear el QR y consultar el DTE en Ministerio de Hacienda."""
    base = "https://admin.factura.gob.sv/consultaPublica"
    return f"{base}?ambiente={environment}&codGen={generation_code}&fechaEmi={emission_date}"

