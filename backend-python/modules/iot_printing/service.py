"""Servicio de Impresión IoT & Comandas ESC/POS."""
import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from modules.iot_printing.escpos import (
    build_comanda_ticket,
    build_invoice_ticket,
    build_test_receipt,
    ping_printer as raw_ping,
    send_raw_tcp
)

logger = logging.getLogger("asistente_operativo.modules.iot_printing")

_init_lock = threading.Lock()


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


class IotPrintingService:
    """Gestiona catálogo de impresoras, diagnóstico de conectividad y cola de impresión."""

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
                        CREATE TABLE IF NOT EXISTS zenith_printers (
                            id SERIAL PRIMARY KEY,
                            name VARCHAR(120) NOT NULL,
                            connection_type VARCHAR(30) NOT NULL DEFAULT 'network',
                            ip_address VARCHAR(80) DEFAULT '',
                            port INTEGER NOT NULL DEFAULT 9100,
                            role VARCHAR(30) NOT NULL DEFAULT 'kitchen',
                            paper_width VARCHAR(20) NOT NULL DEFAULT '80mm',
                            auto_cut BOOLEAN DEFAULT TRUE,
                            open_drawer BOOLEAN DEFAULT FALSE,
                            is_active BOOLEAN DEFAULT TRUE,
                            last_status VARCHAR(40) DEFAULT 'unknown',
                            last_ping_ms REAL DEFAULT 0.0,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            updated_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_print_role ON zenith_printers(role)")

                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_print_logs (
                            id SERIAL PRIMARY KEY,
                            printer_id INTEGER,
                            job_type VARCHAR(40) NOT NULL,
                            reference_id VARCHAR(80) DEFAULT '',
                            status VARCHAR(40) NOT NULL,
                            error_message TEXT DEFAULT '',
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                else:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_printers (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            name TEXT NOT NULL,
                            connection_type TEXT NOT NULL DEFAULT 'network',
                            ip_address TEXT DEFAULT '',
                            port INTEGER NOT NULL DEFAULT 9100,
                            role TEXT NOT NULL DEFAULT 'kitchen',
                            paper_width TEXT NOT NULL DEFAULT '80mm',
                            auto_cut INTEGER DEFAULT 1,
                            open_drawer INTEGER DEFAULT 0,
                            is_active INTEGER DEFAULT 1,
                            last_status TEXT DEFAULT 'unknown',
                            last_ping_ms REAL DEFAULT 0.0,
                            created_at TEXT DEFAULT (datetime('now')),
                            updated_at TEXT DEFAULT (datetime('now'))
                        )
                    """)

                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_print_logs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            printer_id INTEGER,
                            job_type TEXT NOT NULL,
                            reference_id TEXT DEFAULT '',
                            status TEXT NOT NULL,
                            error_message TEXT DEFAULT '',
                            created_at TEXT DEFAULT (datetime('now'))
                        )
                    """)

            self._tables_initialized = True
            logger.info("✅ Tablas del módulo IoT de Impresión listas.")

    # ------------------------------------------------------------------
    # GESTIÓN DE IMPRESORAS
    # ------------------------------------------------------------------
    def list_printers(self) -> List[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            return tx.execute("SELECT * FROM zenith_printers ORDER BY id ASC").all()

    def get_printer(self, printer_id: int) -> Optional[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            return tx.execute("SELECT * FROM zenith_printers WHERE id = ?", (printer_id,)).one()

    def create_printer(self, data: Dict[str, Any]) -> Dict[str, Any]:
        self.init_tables()
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError("El nombre de la impresora es obligatorio.")

        conn_type = data.get("connection_type") or "network"
        ip = (data.get("ip_address") or "").strip()
        port = int(data.get("port") or 9100)
        role = data.get("role") or "kitchen"
        paper_width = data.get("paper_width") or "80mm"
        auto_cut = bool(data.get("auto_cut", True))
        open_drawer = bool(data.get("open_drawer", False))
        is_active = bool(data.get("is_active", True))

        with self._tx() as tx:
            new_id = tx.insert(
                """
                INSERT INTO zenith_printers (
                    name, connection_type, ip_address, port, role,
                    paper_width, auto_cut, open_drawer, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, conn_type, ip, port, role, paper_width, auto_cut, open_drawer, is_active)
            )
        return self.get_printer(new_id)

    def update_printer(self, printer_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        self.init_tables()
        current = self.get_printer(printer_id)
        if not current:
            raise LookupError("Impresora no encontrada.")

        fields = []
        params = []
        for key in ("name", "connection_type", "ip_address", "role", "paper_width"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(str(data[key]).strip())

        if "port" in data and data["port"] is not None:
            fields.append("port = ?")
            params.append(int(data["port"]))

        for key in ("auto_cut", "open_drawer", "is_active"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(bool(data[key]))

        if not fields:
            return current

        params.append(printer_id)
        sql = f"UPDATE zenith_printers SET {', '.join(fields)} WHERE id = ?"
        with self._tx() as tx:
            tx.execute(sql, tuple(params))

        return self.get_printer(printer_id)

    def delete_printer(self, printer_id: int) -> bool:
        self.init_tables()
        with self._tx() as tx:
            tx.execute("DELETE FROM zenith_printers WHERE id = ?", (printer_id,))
        return True

    # ------------------------------------------------------------------
    # DIAGNÓSTICO Y TEST
    # ------------------------------------------------------------------
    def test_printer(self, printer_id: int) -> Dict[str, Any]:
        self.init_tables()
        printer = self.get_printer(printer_id)
        if not printer:
            raise LookupError("Impresora no encontrada.")

        conn_type = printer.get("connection_type") or "network"
        ip = (printer.get("ip_address") or "").strip()
        port = int(printer.get("port") or 9100)
        cols = 32 if printer.get("paper_width") == "58mm" else 42
        auto_cut = bool(printer.get("auto_cut", True))

        if conn_type == "network":
            ok, latency_ms, msg = raw_ping(ip, port)
            if not ok:
                self._update_status(printer_id, "offline", 0.0)
                self._log_job(printer_id, "test", "test", "error", msg)
                return {"online": False, "printed": False, "latency_ms": 0.0, "message": msg}

            # Enviar ticket de prueba
            payload = build_test_receipt(printer["name"], width_cols=cols, auto_cut=auto_cut)
            sent_ok, send_msg = send_raw_tcp(ip, port, payload)
            status_str = "online" if sent_ok else "error"
            self._update_status(printer_id, status_str, latency_ms)
            self._log_job(printer_id, "test", "test", "success" if sent_ok else "error", send_msg)
            return {"online": True, "printed": sent_ok, "latency_ms": latency_ms, "message": send_msg}
        else:
            return {"online": True, "printed": True, "latency_ms": 0.0, "message": "Impresora local lista para enviar trabajos."}

    def _update_status(self, printer_id: int, status: str, latency: float) -> None:
        with self._tx() as tx:
            tx.execute(
                "UPDATE zenith_printers SET last_status = ?, last_ping_ms = ? WHERE id = ?",
                (status, latency, printer_id)
            )

    def _log_job(self, printer_id: Optional[int], job_type: str, ref_id: str, status: str, error_msg: str = "") -> None:
        try:
            with self._tx() as tx:
                tx.execute(
                    """
                    INSERT INTO zenith_print_logs (printer_id, job_type, reference_id, status, error_message)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (printer_id, job_type, str(ref_id), status, error_msg[:400])
                )
        except Exception as e:
            logger.debug(f"Error guardando print log: {e}")

    # ------------------------------------------------------------------
    # ACCIONES DE IMPRESIÓN (COMANDAS Y FACTURAS)
    # ------------------------------------------------------------------
    def print_comanda(self, order: Dict[str, Any], target_printer_id: Optional[int] = None) -> Dict[str, Any]:
        """Envía comanda a las impresoras asignadas a 'kitchen' o 'all'."""
        self.init_tables()
        all_printers = self.list_printers()
        printers = [
            p for p in all_printers
            if p.get("is_active") and (
                (target_printer_id and p["id"] == target_printer_id) or
                (not target_printer_id and p.get("role") in ("kitchen", "all"))
            )
        ]

        if not printers:
            return {"success": False, "sent_count": 0, "message": "No hay impresoras de cocina activas."}

        sent = 0
        errors = []
        for p in printers:
            if p.get("connection_type") == "network":
                cols = 32 if p.get("paper_width") == "58mm" else 42
                payload = build_comanda_ticket(order, width_cols=cols, auto_cut=bool(p.get("auto_cut", True)))
                ok, msg = send_raw_tcp(p.get("ip_address"), p.get("port", 9100), payload)
                if ok:
                    sent += 1
                    self._log_job(p["id"], "comanda", str(order.get("id")), "success")
                else:
                    errors.append(f"{p['name']}: {msg}")
                    self._log_job(p["id"], "comanda", str(order.get("id")), "error", msg)

        return {
            "success": sent > 0,
            "sent_count": sent,
            "errors": errors,
            "message": f"Comanda enviada a {sent} impresora(s)." if sent > 0 else f"Fallo al imprimir: {'; '.join(errors)}"
        }

    def print_invoice(self, invoice: Dict[str, Any], target_printer_id: Optional[int] = None) -> Dict[str, Any]:
        """Envía factura o ticket a las impresoras asignadas a 'cashier' o 'all'."""
        self.init_tables()
        all_printers = self.list_printers()
        printers = [
            p for p in all_printers
            if p.get("is_active") and (
                (target_printer_id and p["id"] == target_printer_id) or
                (not target_printer_id and p.get("role") in ("cashier", "all"))
            )
        ]

        if not printers:
            return {"success": False, "sent_count": 0, "message": "No hay impresoras de caja activas."}

        # Datos de emisor de facturación si existe
        config_emisor = {}
        try:
            from modules.invoicing.service import invoicing_service
            config_emisor = invoicing_service.get_config()
        except Exception:
            pass

        sent = 0
        errors = []
        for p in printers:
            if p.get("connection_type") == "network":
                cols = 32 if p.get("paper_width") == "58mm" else 42
                payload = build_invoice_ticket(
                    invoice,
                    config_emisor=config_emisor,
                    width_cols=cols,
                    auto_cut=bool(p.get("auto_cut", True)),
                    open_drawer=bool(p.get("open_drawer", False))
                )
                ok, msg = send_raw_tcp(p.get("ip_address"), p.get("port", 9100), payload)
                if ok:
                    sent += 1
                    self._log_job(p["id"], "invoice", str(invoice.get("id")), "success")
                else:
                    errors.append(f"{p['name']}: {msg}")
                    self._log_job(p["id"], "invoice", str(invoice.get("id")), "error", msg)

        return {
            "success": sent > 0,
            "sent_count": sent,
            "errors": errors,
            "message": f"Ticket enviado a {sent} impresora(s)." if sent > 0 else f"Fallo al imprimir: {'; '.join(errors)}"
        }

    def list_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            return tx.execute("SELECT * FROM zenith_print_logs ORDER BY id DESC LIMIT ?", (limit,)).all()


iot_printing_service = IotPrintingService()

