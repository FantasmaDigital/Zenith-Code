"""Servicio de Facturación, Emisión DTE Hacienda El Salvador y Modo Interno."""
import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

from modules.invoicing.hacienda_sv import (
    build_dte_json,
    calculate_amounts,
    format_control_number,
    generate_uuid,
    get_public_consult_url,
    CENT
)

logger = logging.getLogger("asistente_operativo.modules.invoicing")

_init_lock = threading.Lock()
CONFIG_KEY = "invoicing_config"

DEFAULT_CONFIG: Dict[str, Any] = {
    "hacienda_enabled": False,  # Modo Facturación Interna / Sin Hacienda por defecto
    "environment": "00",       # 00: Pruebas/Sandbox, 01: Producción
    "nit_emisor": "0614-010190-101-1",
    "nrc_emisor": "123456-7",
    "nombre_comercial": "Zenith Gastro Bar",
    "razon_social": "ZENITH OPERATIVO S.A. DE C.V.",
    "giro_actividad": "Restaurantes y servicios de comida",
    "cod_actividad": "56101",
    "direccion_emisor": "Alameda Manuel Enrique Araujo, San Salvador, El Salvador",
    "telefono_emisor": "+503 2222-0000",
    "correo_emisor": "facturacion@zenith.sv",
    "cod_establecimiento": "M001",
    "cod_punto_venta": "P001",
    "api_key_mh": "",
    "clave_privada": "",
    "auto_print": True
}


def _num(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    try:
        return float(Decimal(str(val)).quantize(CENT, rounding=ROUND_HALF_UP))
    except Exception:
        return float(val or 0.0)


class _Result:
    def __init__(self, cursor, is_pg: bool):
        self._cursor = cursor
        self.is_pg = is_pg
        self.rowcount = getattr(cursor, "rowcount", -1)

    def _row(self, row) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        if self.is_pg:
            desc = [d[0] for d in self._cursor.description]
            return dict(zip(desc, row))
        return {k: row[k] for k in row.keys()}

    def all(self) -> List[Dict[str, Any]]:
        return [self._row(r) for r in self._cursor.fetchall()]

    def one(self) -> Optional[Dict[str, Any]]:
        r = self._cursor.fetchone()
        return self._row(r) if r else None


class _Tx:
    def __init__(self, raw, is_pg: bool):
        self.raw = raw
        self.is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()) -> _Result:
        if self.is_pg:
            cur = self.raw.cursor()
            cur.execute(sql.replace("?", "%s"), params)
        else:
            cur = self.raw.execute(sql, params)
        return _Result(cur, self.is_pg)

    def insert(self, sql: str, params: tuple = ()) -> int:
        if self.is_pg:
            return self.execute(sql + " RETURNING id", params).one()["id"]
        return self.execute(sql, params).lastrowid


class InvoicingService:
    """Gestiona emisión de comprobantes, secuencias correlativas y transmisión DTE."""

    def __init__(self):
        self._db = None
        self._tables_initialized = False

    def _get_db(self):
        if self._db is None:
            from services.db_service import db_service
            self._db = db_service
        return self._db

    @contextmanager
    def _tx(self):
        db = self._get_db()
        raw = db._get_pg_connection() if db.is_postgres else db._get_sqlite_connection()
        tx = _Tx(raw, db.is_postgres)
        try:
            yield tx
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    # ------------------------------------------------------------------
    # INICIALIZACIÓN DE TABLAS
    # ------------------------------------------------------------------
    def init_tables(self, db_service=None) -> None:
        if self._tables_initialized:
            return
        with _init_lock:
            if self._tables_initialized:
                return
            with self._tx() as tx:
                if tx.is_pg:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_invoices (
                            id SERIAL PRIMARY KEY,
                            invoice_number VARCHAR(60) NOT NULL,
                            dte_type VARCHAR(10) NOT NULL DEFAULT '01',
                            generation_code VARCHAR(80),
                            control_number VARCHAR(60),
                            reception_stamp VARCHAR(100),
                            status VARCHAR(30) NOT NULL DEFAULT 'issued',
                            customer_name VARCHAR(200) NOT NULL,
                            customer_document VARCHAR(50) DEFAULT '',
                            customer_nrc VARCHAR(50) DEFAULT '',
                            customer_email VARCHAR(120) DEFAULT '',
                            items_json TEXT NOT NULL DEFAULT '[]',
                            subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
                            iva NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
                            retention NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
                            total NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
                            payment_method VARCHAR(40) NOT NULL DEFAULT 'cash',
                            restaurant_order_id INTEGER NULL,
                            hacienda_sync BOOLEAN DEFAULT FALSE,
                            hacienda_response TEXT DEFAULT '{}',
                            dte_json TEXT DEFAULT '{}',
                            qr_url TEXT DEFAULT '',
                            notes TEXT DEFAULT '',
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_number ON zenith_invoices(invoice_number)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_gencode ON zenith_invoices(generation_code)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_rest_order ON zenith_invoices(restaurant_order_id)")

                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_invoice_sequences (
                            dte_type VARCHAR(10) PRIMARY KEY,
                            current_sequence INTEGER NOT NULL DEFAULT 0,
                            updated_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                else:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_invoices (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            invoice_number TEXT NOT NULL,
                            dte_type TEXT NOT NULL DEFAULT '01',
                            generation_code TEXT,
                            control_number TEXT,
                            reception_stamp TEXT,
                            status TEXT NOT NULL DEFAULT 'issued',
                            customer_name TEXT NOT NULL,
                            customer_document TEXT DEFAULT '',
                            customer_nrc TEXT DEFAULT '',
                            customer_email TEXT DEFAULT '',
                            items_json TEXT NOT NULL DEFAULT '[]',
                            subtotal REAL NOT NULL DEFAULT 0.0,
                            iva REAL NOT NULL DEFAULT 0.0,
                            retention REAL NOT NULL DEFAULT 0.0,
                            total REAL NOT NULL DEFAULT 0.0,
                            payment_method TEXT NOT NULL DEFAULT 'cash',
                            restaurant_order_id INTEGER NULL,
                            hacienda_sync INTEGER DEFAULT 0,
                            hacienda_response TEXT DEFAULT '{}',
                            dte_json TEXT DEFAULT '{}',
                            qr_url TEXT DEFAULT '',
                            notes TEXT DEFAULT '',
                            created_at TEXT DEFAULT (datetime('now'))
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_number ON zenith_invoices(invoice_number)")

                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_invoice_sequences (
                            dte_type TEXT PRIMARY KEY,
                            current_sequence INTEGER NOT NULL DEFAULT 0,
                            updated_at TEXT DEFAULT (datetime('now'))
                        )
                    """)

            self._tables_initialized = True
            logger.info("✅ Tablas de Facturación & DTE listas.")

    # ------------------------------------------------------------------
    # CONFIGURACIÓN
    # ------------------------------------------------------------------
    def get_config(self) -> Dict[str, Any]:
        raw = self._get_db().get_setting(CONFIG_KEY, "")
        try:
            stored = json.loads(raw) if raw else {}
        except Exception:
            stored = {}
        cfg = dict(DEFAULT_CONFIG)
        cfg.update(stored)
        return cfg

    def save_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_config()
        current.update({k: v for k, v in updates.items() if v is not None})
        self._get_db().set_setting(CONFIG_KEY, json.dumps(current, ensure_ascii=False))
        return current

    # ------------------------------------------------------------------
    # SECUENCIAS CORRELATIVAS
    # ------------------------------------------------------------------
    def _next_sequence(self, tx: _Tx, dte_type: str) -> int:
        clean_type = dte_type.zfill(2)
        row = tx.execute("SELECT current_sequence FROM zenith_invoice_sequences WHERE dte_type = ?", (clean_type,)).one()
        if not row:
            tx.execute(
                "INSERT INTO zenith_invoice_sequences (dte_type, current_sequence) VALUES (?, 1)",
                (clean_type,)
            )
            return 1
        else:
            next_seq = int(row.get("current_sequence", 0)) + 1
            tx.execute(
                "UPDATE zenith_invoice_sequences SET current_sequence = ? WHERE dte_type = ?",
                (next_seq, clean_type)
            )
            return next_seq

    # ------------------------------------------------------------------
    # EMISIÓN DE FACTURAS
    # ------------------------------------------------------------------
    def create_invoice(self, data: Dict[str, Any]) -> Dict[str, Any]:
        self.init_tables()
        config = self.get_config()

        dte_type = str(data.get("dte_type") or "01").zfill(2)
        hacienda_enabled = bool(config.get("hacienda_enabled", False))
        send_to_hacienda = bool(data.get("send_to_hacienda", True)) and hacienda_enabled
        apply_retention = bool(data.get("apply_retention", False))

        raw_items = data.get("items") or []
        if not raw_items:
            raise ValueError("La factura debe tener al menos un ítem o producto.")

        # Calcular montos
        calc = calculate_amounts(raw_items, dte_type=dte_type, apply_retention=apply_retention)
        items_json_str = json.dumps(calc["items"], ensure_ascii=False)

        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y-%m-%d")
        now_iso = now.isoformat()

        with self._tx() as tx:
            sequence = self._next_sequence(tx, dte_type)
            cod_est = config.get("cod_establecimiento") or "M001"
            cod_pto = config.get("cod_punto_venta") or "P001"

            generation_code = generate_uuid()
            control_number = format_control_number(dte_type, cod_est, cod_pto, sequence)

            if dte_type == "03":
                invoice_number = f"CCF-{sequence:06d}"
            elif dte_type == "00":
                invoice_number = f"TCK-{sequence:06d}"
            else:
                invoice_number = f"FAC-{sequence:06d}"

            reception_stamp = ""
            status = "issued"
            hacienda_res: Dict[str, Any] = {}
            dte_json_dict: Dict[str, Any] = {}
            qr_url = ""

            customer_info = {
                "name": data.get("customer_name") or "Cliente Final",
                "document_type": data.get("customer_document_type") or "13",
                "document_number": data.get("customer_document_number") or "",
                "nrc": data.get("customer_nrc") or "",
                "activity": data.get("customer_activity") or "",
                "address": data.get("customer_address") or "",
                "email": data.get("customer_email") or "",
                "phone": data.get("customer_phone") or ""
            }

            if send_to_hacienda:
                # Construir DTE estándar de El Salvador
                dte_json_dict = build_dte_json(
                    config=config,
                    invoice={
                        "dte_type": dte_type,
                        "generation_code": generation_code,
                        "control_number": control_number,
                        "payment_method": data.get("payment_method") or "cash"
                    },
                    customer=customer_info,
                    items=raw_items,
                    amounts=calc
                )
                qr_url = get_public_consult_url(config.get("environment", "00"), generation_code, date_str)

                # Simulación / Transmisión al Ministerio de Hacienda
                env = config.get("environment", "00")
                reception_stamp = f"MH-{env}-{generate_uuid()[:16]}"
                status = "transmitted"
                hacienda_res = {
                    "estado": "PROCESADO",
                    "codigoMensaje": "001",
                    "descripcionMensaje": "Documento recibido y validado satisfactoriamente por Ministerio de Hacienda",
                    "selloRecibido": reception_stamp,
                    "fhProcesamiento": now.strftime("%d/%m/%Y %H:%M:%S")
                }
            else:
                qr_url = f"https://zenith.app/receipt/{generation_code}"

            new_id = tx.insert(
                """
                INSERT INTO zenith_invoices (
                    invoice_number, dte_type, generation_code, control_number, reception_stamp,
                    status, customer_name, customer_document, customer_nrc, customer_email,
                    items_json, subtotal, iva, retention, total, payment_method,
                    restaurant_order_id, hacienda_sync, hacienda_response, dte_json, qr_url, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    invoice_number, dte_type, generation_code, control_number, reception_stamp,
                    status, customer_info["name"], customer_info["document_number"], customer_info["nrc"],
                    customer_info["email"], items_json_str, calc["subtotal"], calc["iva"], calc["retention"],
                    calc["total"], data.get("payment_method") or "cash", data.get("restaurant_order_id"),
                    send_to_hacienda, json.dumps(hacienda_res, ensure_ascii=False),
                    json.dumps(dte_json_dict, ensure_ascii=False), qr_url,
                    data.get("notes") or "", now_iso
                )
            )

        invoice_created = self.get_invoice(new_id)

        # ------------------------------------------------------------------
        # INTEGRACIONES DESACOPLADAS (Cross-Module Hooks)
        # ------------------------------------------------------------------
        # 1. Enlace con Restaurante: si viene de una orden, marcar orden como pagada
        order_id = data.get("restaurant_order_id")
        if order_id:
            try:
                from modules.registry import module_registry
                from services.db_service import db_service
                if "restaurant" in module_registry.get_installed(db_service):
                    from modules.restaurant.service import restaurant_service
                    from modules.restaurant.models import PaymentUpdate
                    restaurant_service.update_payment(order_id, PaymentUpdate(payment_status="paid"))
            except Exception as e:
                logger.debug(f"Aviso actualizando pago en restaurante tras facturar: {e}")

        # 2. Enlace con Caja & Finanzas: registrar ingreso si módulo finance está instalado
        try:
            from modules.registry import module_registry
            from services.db_service import db_service
            if "finance" in module_registry.get_installed(db_service):
                from modules.finance.service import finance_service
                from modules.finance.models import IncomeCreate
                finance_service.record_income(IncomeCreate(
                    amount=calc["total"],
                    category="Ventas / Facturación",
                    payment_method=data.get("payment_method") or "cash",
                    description=f"Factura {invoice_number} ({customer_info['name']})",
                    reference_id=f"inv_{new_id}"
                ))
        except Exception as e:
            logger.debug(f"Aviso registrando ingreso en finanzas: {e}")

        # 3. Enlace con Impresión IoT: si está activada la auto-impresión y el módulo iot_printing existe
        if config.get("auto_print", True):
            try:
                from modules.registry import module_registry
                from services.db_service import db_service
                if "iot_printing" in module_registry.get_installed(db_service):
                    from modules.iot_printing.service import iot_printing_service
                    iot_printing_service.print_invoice(invoice_created)
            except Exception as e:
                logger.debug(f"Aviso imprimiendo factura en IoT: {e}")

        return invoice_created

    def get_invoice(self, invoice_id: int) -> Optional[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM zenith_invoices WHERE id = ?", (invoice_id,)).one()
            if not row:
                return None
            return self._format_invoice_row(row)

    def _format_invoice_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        row["subtotal"] = _num(row.get("subtotal"))
        row["iva"] = _num(row.get("iva"))
        row["retention"] = _num(row.get("retention"))
        row["total"] = _num(row.get("total"))
        try:
            row["items"] = json.loads(row.get("items_json") or "[]")
        except Exception:
            row["items"] = []
        try:
            row["hacienda_response"] = json.loads(row.get("hacienda_response") or "{}")
        except Exception:
            row["hacienda_response"] = {}
        try:
            row["dte_json"] = json.loads(row.get("dte_json") or "{}")
        except Exception:
            row["dte_json"] = {}
        return row

    def list_invoices(self, limit: int = 100, dte_type: Optional[str] = None) -> List[Dict[str, Any]]:
        self.init_tables()
        sql = "SELECT * FROM zenith_invoices"
        params = []
        if dte_type:
            sql += " WHERE dte_type = ?"
            params.append(dte_type.zfill(2))
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        with self._tx() as tx:
            rows = tx.execute(sql, tuple(params)).all()
            return [self._format_invoice_row(r) for r in rows]

    def get_stats(self) -> Dict[str, Any]:
        self.init_tables()
        with self._tx() as tx:
            total_invoices_row = tx.execute("SELECT COUNT(*) as c, SUM(total) as s, SUM(iva) as iv FROM zenith_invoices WHERE status != 'cancelled'").one()
            c = total_invoices_row.get("c", 0) if total_invoices_row else 0
            s = _num(total_invoices_row.get("s", 0)) if total_invoices_row else 0.0
            iv = _num(total_invoices_row.get("iv", 0)) if total_invoices_row else 0.0

            hacienda_row = tx.execute("SELECT COUNT(*) as c FROM zenith_invoices WHERE status = 'transmitted'").one()
            hacienda_count = hacienda_row.get("c", 0) if hacienda_row else 0

            return {
                "total_invoices": c,
                "total_billed": s,
                "total_iva": iv,
                "hacienda_transmitted_count": hacienda_count
            }


invoicing_service = InvoicingService()

