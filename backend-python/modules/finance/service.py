"""Servicio de Caja Chica, Turnos y Finanzas Universales para Zenith."""
import json
from decimal import ROUND_HALF_UP, Decimal
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional

logger = logging.getLogger("asistente_operativo.modules.finance")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _ts(dt: datetime) -> str:
    return dt.isoformat()


CENT = Decimal("0.01")


def _money(value: Any) -> Decimal:
    """Monto exacto a 2 decimales. Todas las sumas se hacen en Decimal (nunca en float) para no perder centavos."""
    if value is None or value == "":
        return Decimal("0.00")
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _f(value: Decimal) -> float:
    """Decimal -> float de 2 decimales para JSON."""
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


# Tipos de movimiento: income/expense afectan la utilidad; withdrawal/deposit solo mueven efectivo del cajón
TX_TYPES = ("income", "expense", "withdrawal", "deposit")
CASH_MOVEMENT_TYPES = ("withdrawal", "deposit")

# Dólar estadounidense (El Salvador): billetes y monedas para el arqueo
DENOMINATIONS = ("100", "50", "20", "10", "5", "1", "0.25", "0.10", "0.05", "0.01")

DEFAULT_CATEGORIES = (
    # (clave, nombre, tipo, de sistema)
    ("sale", "Venta", "income", True),
    ("manual_income", "Ingreso extra", "income", False),
    ("supplies", "Insumos y comida", "expense", False),
    ("services", "Servicios (luz, agua, gas)", "expense", False),
    ("payroll", "Planilla / sueldos", "expense", False),
    ("rent", "Alquiler", "expense", False),
    ("maintenance", "Mantenimiento", "expense", False),
    ("refund", "Reembolso a cliente", "expense", True),
    ("other", "Otro gasto", "expense", False),
)

MAX_RECEIPT_BYTES = 2_000_000  # ~1.5 MB de imagen en base64
RECEIPT_PREFIXES = ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,", "data:application/pdf;base64,")

# Columnas del libro (sin el comprobante, que puede pesar)
TX_COLUMNS = ("id, shift_id, type, category, amount, payment_method, source_module, source_reference_id, description, "
              "created_by, created_at, voided_at, void_reason, voided_by, receipt_name, "
              "CASE WHEN receipt_data IS NULL THEN 0 ELSE 1 END AS has_receipt")

DEFAULT_UTC_OFFSET = -6  # El Salvador (sin horario de verano)


def _utc_offset() -> int:
    """Zona horaria del negocio: la del restaurante si está configurada; si no, El Salvador."""
    try:
        from modules.restaurant.service import restaurant_service
        return int(restaurant_service.get_config().get("utc_offset_hours", DEFAULT_UTC_OFFSET))
    except Exception:
        return DEFAULT_UTC_OFFSET


def _local_str(value: Optional[str]) -> str:
    """ISO en UTC -> 'AAAA-MM-DD HH:MM:SS' en hora local del negocio (para tickets)."""
    if not value:
        return ""
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone(timedelta(hours=_utc_offset()))).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return str(value)[:19].replace("T", " ")


def _local_tz() -> timezone:
    return timezone(timedelta(hours=_utc_offset()))


def _local_day_bounds(start: str, end: str):
    """Fechas locales 'AAAA-MM-DD' (inclusive) -> límites ISO en UTC [desde, hasta)."""
    tz = _local_tz()
    d0 = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=tz)
    d1 = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=1)
    if d1 <= d0:
        raise ValueError("La fecha final debe ser igual o posterior a la inicial.")
    if (d1 - d0).days > 731:
        raise ValueError("El rango máximo es de 2 años.")
    return _ts(d0.astimezone(timezone.utc)), _ts(d1.astimezone(timezone.utc)), d0, d1


def _clean(val: Any) -> Any:
    if isinstance(val, datetime):
        return val.isoformat()
    return val


class _Result:
    def __init__(self, cursor, is_pg: bool):
        self._cursor = cursor
        self._is_pg = is_pg

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    def _row(self, row) -> Dict[str, Any]:
        if self._is_pg:
            names = [d[0] for d in self._cursor.description]
            return {n: _clean(v) for n, v in zip(names, row)}
        return {k: _clean(row[k]) for k in row.keys()}

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


class FinanceService:
    """Gestiona sesiones de caja (turnos/cortes) y libro diario de transacciones."""

    def __init__(self):
        self._db = None

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
        """Crea las tablas de finanzas si no existen (PostgreSQL y SQLite)."""
        db = db_service or self._get_db()
        is_pg = db.is_postgres

        id_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
        real_type = "NUMERIC(12,2)" if is_pg else "REAL"

        with self._tx() as tx:
            # 1. Tabla de turnos / cortes de caja
            tx.execute(f"""
                CREATE TABLE IF NOT EXISTS finance_shifts (
                    id {id_type},
                    opened_by VARCHAR(100),
                    opened_at VARCHAR(40) NOT NULL,
                    closed_at VARCHAR(40),
                    initial_cash {real_type} DEFAULT 0.0,
                    expected_cash {real_type} DEFAULT 0.0,
                    counted_cash {real_type} DEFAULT 0.0,
                    difference {real_type} DEFAULT 0.0,
                    total_sales_cash {real_type} DEFAULT 0.0,
                    total_sales_card {real_type} DEFAULT 0.0,
                    total_sales_transfer {real_type} DEFAULT 0.0,
                    total_sales_other {real_type} DEFAULT 0.0,
                    total_expenses_cash {real_type} DEFAULT 0.0,
                    total_expenses_other {real_type} DEFAULT 0.0,
                    notes TEXT,
                    status VARCHAR(20) DEFAULT 'open',
                    created_at VARCHAR(40),
                    updated_at VARCHAR(40)
                );
            """)

            # 2. Tabla de transacciones / movimientos contables
            tx.execute(f"""
                CREATE TABLE IF NOT EXISTS finance_transactions (
                    id {id_type},
                    shift_id INTEGER,
                    type VARCHAR(20) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    amount {real_type} NOT NULL,
                    payment_method VARCHAR(30) DEFAULT 'cash',
                    source_module VARCHAR(50) DEFAULT 'manual',
                    source_reference_id VARCHAR(100),
                    description TEXT,
                    created_by VARCHAR(100),
                    created_at VARCHAR(40) NOT NULL
                );
            """)

            # Columnas de anulación (los movimientos nunca se borran, se anulan)
            if is_pg:
                cols = {r["column_name"] for r in tx.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'finance_transactions'").all()}
            else:
                cols = {r["name"] for r in tx.execute("PRAGMA table_info(finance_transactions)").all()}
            for col, definition in (("voided_at", "VARCHAR(40)"), ("void_reason", "TEXT"), ("voided_by", "VARCHAR(100)"),
                                    ("receipt_data", "TEXT"), ("receipt_name", "VARCHAR(200)")):
                if col not in cols:
                    tx.execute(f"ALTER TABLE finance_transactions ADD COLUMN {col} {definition}")

            if is_pg:
                shift_cols = {r["column_name"] for r in tx.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'finance_shifts'").all()}
            else:
                shift_cols = {r["name"] for r in tx.execute("PRAGMA table_info(finance_shifts)").all()}
            for col, definition in (("total_withdrawals", f"{real_type} DEFAULT 0.0"), ("total_deposits", f"{real_type} DEFAULT 0.0"),
                                    ("cash_count_json", "TEXT"), ("closed_by", "VARCHAR(100)")):
                if col not in shift_cols:
                    tx.execute(f"ALTER TABLE finance_shifts ADD COLUMN {col} {definition}")

            # Categorías administrables
            tx.execute(f"""
                CREATE TABLE IF NOT EXISTS finance_categories (
                    id {id_type},
                    key VARCHAR(50) NOT NULL UNIQUE,
                    label VARCHAR(100) NOT NULL,
                    type VARCHAR(20) NOT NULL,
                    active INTEGER DEFAULT 1,
                    is_system INTEGER DEFAULT 0
                );
            """)
            existing_keys = {r["key"] for r in tx.execute("SELECT key FROM finance_categories").all()}
            for key, label, ctype, system in DEFAULT_CATEGORIES:
                if key not in existing_keys:
                    tx.execute("INSERT INTO finance_categories (key, label, type, active, is_system) VALUES (?, ?, ?, 1, ?)",
                               (key, label, ctype, 1 if system else 0))

            # 3. Índices de rendimiento
            try:
                tx.execute("CREATE INDEX IF NOT EXISTS idx_fin_tx_shift ON finance_transactions(shift_id);")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_fin_tx_source ON finance_transactions(source_module, source_reference_id);")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_fin_shifts_status ON finance_shifts(status);")
            except Exception as e:
                logger.debug(f"Aviso creando índices de finanzas: {e}")

            # 4. Bitácora de auditoría: quién hizo qué y cuándo (no se edita ni se borra)
            tx.execute(f"""
                CREATE TABLE IF NOT EXISTS finance_audit_log (
                    id {id_type},
                    action VARCHAR(40) NOT NULL,
                    entity VARCHAR(20) NOT NULL,
                    entity_id INTEGER,
                    actor VARCHAR(100),
                    client_ip VARCHAR(64),
                    detail TEXT,
                    created_at VARCHAR(40) NOT NULL
                );
            """)
            tx.execute("CREATE INDEX IF NOT EXISTS idx_fin_audit_entity ON finance_audit_log(entity, entity_id)")

        # 5. Solo una caja abierta a la vez (lo garantiza la base de datos, no solo el código).
        #    En transacción aparte: si hay datos viejos con 2 turnos abiertos, no debe tumbar el resto.
        try:
            with self._tx() as tx:
                tx.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_one_open_shift ON finance_shifts(status) WHERE status = 'open'")
        except Exception as e:
            logger.warning(f"No se pudo crear la restricción de una sola caja abierta (¿hay 2 turnos abiertos?): {e}")

        logger.info("✅ Tablas de Caja & Finanzas verificadas correctamente.")

    # ------------------------------------------------------------------
    # AUDITORÍA
    # ------------------------------------------------------------------
    @staticmethod
    def _audit(tx, action: str, entity: str, entity_id: Optional[int], actor: str, detail: str = "",
               client_ip: Optional[str] = None) -> None:
        tx.execute(
            "INSERT INTO finance_audit_log (action, entity, entity_id, actor, client_ip, detail, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (action, entity, entity_id, (actor or "Admin")[:100], (client_ip or "")[:64], detail[:1000], _ts(_now_utc())))

    def list_audit(self, limit: int = 100, entity: Optional[str] = None, entity_id: Optional[int] = None) -> List[Dict[str, Any]]:
        sql, params = "SELECT * FROM finance_audit_log WHERE 1=1", []
        if entity:
            sql += " AND entity = ?"
            params.append(entity)
        if entity_id is not None:
            sql += " AND entity_id = ?"
            params.append(entity_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._tx() as tx:
            return tx.execute(sql, tuple(params)).all()

    @staticmethod
    def _open_shift_id(tx) -> Optional[int]:
        row = tx.execute("SELECT id FROM finance_shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").one()
        return row["id"] if row else None

    # ------------------------------------------------------------------
    # GESTIÓN DE TURNOS Y CORTES DE CAJA
    # ------------------------------------------------------------------
    def get_current_shift(self) -> Optional[Dict[str, Any]]:
        """Retorna el turno de caja abierto actual con sus totales calculados en vivo."""
        with self._tx() as tx:
            shift = tx.execute(
                "SELECT * FROM finance_shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1"
            ).one()
            if not shift:
                return None

            # Calcular totales en tiempo real a partir de las transacciones asociadas
            shift_id = shift["id"]
            rows = tx.execute(
                "SELECT type, payment_method, amount FROM finance_transactions WHERE shift_id = ? AND voided_at IS NULL",
                (shift_id,)
            ).all()

            zero = Decimal("0.00")
            sales = {"cash": zero, "card": zero, "transfer": zero, "other": zero}
            expenses_cash = expenses_other = zero
            withdrawals = deposits = zero

            for r in rows:
                m = (r.get("payment_method") or "cash").lower()
                amt = _money(r.get("amount"))
                if r.get("type") == "income":
                    if m == "cash":
                        sales["cash"] += amt
                    elif m in ("card", "tarjeta", "terminal"):
                        sales["card"] += amt
                    elif m in ("transfer", "transferencia", "qr", "bizum"):
                        sales["transfer"] += amt
                    else:
                        sales["other"] += amt
                elif r.get("type") == "expense":
                    if m == "cash":
                        expenses_cash += amt
                    else:
                        expenses_other += amt
                elif r.get("type") == "withdrawal":
                    withdrawals += amt
                elif r.get("type") == "deposit":
                    deposits += amt

            init_cash = _money(shift.get("initial_cash"))
            total_income = sum(sales.values(), zero)
            total_expense = expenses_cash + expenses_other

            shift["initial_cash"] = _f(init_cash)
            shift["total_sales_cash"] = _f(sales["cash"])
            shift["total_sales_card"] = _f(sales["card"])
            shift["total_sales_transfer"] = _f(sales["transfer"])
            shift["total_sales_other"] = _f(sales["other"])
            shift["total_expenses_cash"] = _f(expenses_cash)
            shift["total_expenses_other"] = _f(expenses_other)
            shift["total_withdrawals"] = _f(withdrawals)
            shift["total_deposits"] = _f(deposits)
            shift["expected_cash"] = _f(init_cash + sales["cash"] + deposits - expenses_cash - withdrawals)
            shift["total_income"] = _f(total_income)
            shift["total_expense"] = _f(total_expense)
            shift["net_balance"] = _f(total_income - total_expense)

            return shift

    def open_shift(self, opened_by: str = "Caja Principal", initial_cash: float = 0.0, notes: str = "",
                   client_ip: Optional[str] = None) -> Dict[str, Any]:
        """Abre un nuevo turno de caja chica."""
        current = self.get_current_shift()
        if current:
            raise ValueError(f"Ya existe un turno de caja abierto (#{current['id']}). Debes cerrarlo antes de abrir uno nuevo.")

        now_str = _ts(_now_utc())
        fund = _f(_money(initial_cash))
        try:
            shift_id = self._insert_shift(opened_by, fund, notes, now_str, client_ip)
        except Exception as e:
            # Dos aperturas simultáneas: la restricción única de la BD rechaza la segunda
            if "uq_fin_one_open_shift" in str(e) or "UNIQUE" in str(e).upper():
                raise ValueError("Ya existe un turno de caja abierto. Debes cerrarlo antes de abrir uno nuevo.")
            raise

        logger.info(f"💵 Turno de caja #{shift_id} abierto por {opened_by} con fondo ${fund:.2f}")
        return self.get_shift(shift_id)

    def _insert_shift(self, opened_by, fund, notes, now_str, client_ip) -> int:
        with self._tx() as tx:
            shift_id = tx.insert("""
                INSERT INTO finance_shifts (
                    opened_by, opened_at, initial_cash, expected_cash, counted_cash, difference,
                    total_sales_cash, total_sales_card, total_sales_transfer, total_sales_other,
                    total_expenses_cash, total_expenses_other, notes, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, ?, 'open', ?, ?)
            """, (opened_by or "Caja Principal", now_str, fund, fund, notes or "", now_str, now_str))

            # Cobros registrados mientras la caja estaba cerrada: entran a este turno para que cuadren en el arqueo
            adopted = tx.execute(
                "UPDATE finance_transactions SET shift_id = ? WHERE shift_id IS NULL AND voided_at IS NULL",
                (shift_id,)
            ).rowcount
            detail = f"Fondo inicial ${fund:.2f}" + (f"; {adopted} cobro(s) hechos con la caja cerrada se asignaron a este turno" if adopted else "")
            self._audit(tx, "shift_open", "shift", shift_id, opened_by, detail, client_ip)
        if adopted:
            logger.info(f"💵 {adopted} movimiento(s) registrados sin caja abierta se asignaron al turno #{shift_id}.")
        return shift_id

    @staticmethod
    def count_denominations(denominations: Dict[str, int]) -> Decimal:
        """Suma un conteo {'20': 3, '0.25': 8, ...}. Rechaza denominaciones desconocidas o cantidades negativas."""
        total = Decimal("0.00")
        for key, qty in (denominations or {}).items():
            norm = _money(key)
            match = next((d for d in DENOMINATIONS if _money(d) == norm), None)
            if match is None:
                raise ValueError(f"Denominación no válida: {key}")
            if int(qty) < 0:
                raise ValueError("Las cantidades no pueden ser negativas.")
            total += _money(match) * int(qty)
        return total

    def close_shift(self, counted_cash: Optional[float] = None, notes: str = "", closed_by: str = "Admin",
                    client_ip: Optional[str] = None, denominations: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        """Cierra el turno actual (Corte Z), calcula sobrante/faltante y congela métricas."""
        current = self.get_current_shift()
        if not current:
            raise ValueError("No hay ningún turno de caja abierto para cerrar.")

        shift_id = current["id"]
        expected_cash = _f(_money(current.get("expected_cash")))
        cash_count_json = None
        if denominations:
            # El conteo por billete/moneda manda: el total lo calcula el servidor
            counted = _f(self.count_denominations(denominations))
            cash_count_json = json.dumps({k: int(v) for k, v in denominations.items() if int(v) > 0})
        elif counted_cash is None:
            raise ValueError("Indica el efectivo contado o el conteo por denominación.")
        else:
            counted = _f(_money(counted_cash))
        difference = _f(_money(counted) - _money(expected_cash))
        now_str = _ts(_now_utc())

        merged_notes = current.get("notes") or ""
        if notes:
            merged_notes = f"{merged_notes} | Cierre: {notes}".strip(" |")

        with self._tx() as tx:
            tx.execute("""
                UPDATE finance_shifts SET
                    closed_at = ?,
                    counted_cash = ?,
                    difference = ?,
                    expected_cash = ?,
                    total_sales_cash = ?,
                    total_sales_card = ?,
                    total_sales_transfer = ?,
                    total_sales_other = ?,
                    total_expenses_cash = ?,
                    total_expenses_other = ?,
                    total_withdrawals = ?,
                    total_deposits = ?,
                    cash_count_json = ?,
                    closed_by = ?,
                    notes = ?,
                    status = 'closed',
                    updated_at = ?
                WHERE id = ?
            """, (
                now_str,
                counted,
                difference,
                expected_cash,
                current.get("total_sales_cash", 0.0),
                current.get("total_sales_card", 0.0),
                current.get("total_sales_transfer", 0.0),
                current.get("total_sales_other", 0.0),
                current.get("total_expenses_cash", 0.0),
                current.get("total_expenses_other", 0.0),
                current.get("total_withdrawals", 0.0),
                current.get("total_deposits", 0.0),
                cash_count_json,
                (closed_by or "Admin")[:100],
                merged_notes,
                now_str,
                shift_id
            ))
            self._audit(tx, "shift_close", "shift", shift_id, closed_by,
                        f"Esperado ${expected_cash:.2f}, contado ${counted:.2f}, diferencia ${difference:.2f}", client_ip)

        logger.info(f"🔒 Turno de caja #{shift_id} cerrado. Esperado: ${expected_cash:.2f}, Contado: ${counted:.2f}, Diferencia: ${difference:.2f}")
        return self.get_shift(shift_id)

    def get_shift(self, shift_id: int) -> Optional[Dict[str, Any]]:
        """Obtiene el detalle de un turno por su ID."""
        with self._tx() as tx:
            shift = tx.execute("SELECT * FROM finance_shifts WHERE id = ?", (shift_id,)).one()
            if not shift:
                return None
            if shift.get("status") == "open":
                return self.get_current_shift()
            return shift

    def list_shifts(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Lista el historial de turnos y cortes ordenados del más reciente al más antiguo."""
        with self._tx() as tx:
            return tx.execute("SELECT * FROM finance_shifts ORDER BY id DESC LIMIT ?", (limit,)).all()

    # ------------------------------------------------------------------
    # LIBRO DIARIO / TRANSACCIONES
    # ------------------------------------------------------------------
    def record_transaction(
        self,
        type: str,
        category: str,
        amount: float,
        payment_method: str = "cash",
        source_module: str = "manual",
        source_reference_id: Optional[str] = None,
        description: str = "",
        created_by: str = "Admin",
        shift_id: Optional[int] = None,
        client_ip: Optional[str] = None
    ) -> Dict[str, Any]:
        """Registra un movimiento contable (ingreso o gasto)."""
        amt = _f(_money(amount))
        if amt <= 0:
            raise ValueError("El monto de la transacción debe ser mayor a 0.")

        now_str = _ts(_now_utc())
        clean_method = (payment_method or "cash").lower()
        clean_type = (type or "expense").lower()
        if clean_type not in TX_TYPES:
            raise ValueError(f"Tipo de movimiento no válido: {type}")
        if clean_type in CASH_MOVEMENT_TYPES:
            # Retiros y depósitos son siempre de efectivo del cajón y no afectan la utilidad
            clean_method, category = "cash", "cash_movement"

        with self._tx() as tx:
            if clean_type not in CASH_MOVEMENT_TYPES:
                cat = tx.execute("SELECT type, active FROM finance_categories WHERE key = ?", (category or "",)).one()
                if not cat:
                    raise ValueError(f"La categoría «{category}» no existe.")
                if cat["type"] != clean_type:
                    raise ValueError(f"La categoría «{category}» es de {'ingresos' if cat['type'] == 'income' else 'gastos'}.")
                if not int(cat["active"]) and source_module == "manual":
                    raise ValueError(f"La categoría «{category}» está desactivada.")
            # Turno abierto (consulta directa: sin recalcular totales ni sincronizar, evita recursión y bloqueos)
            assigned_shift_id = shift_id if shift_id is not None else self._open_shift_id(tx)
            # Si tiene source_reference_id, verificar si ya existe para evitar duplicados
            if source_reference_id:
                existing = tx.execute(
                    "SELECT id, shift_id, voided_at FROM finance_transactions WHERE source_module = ? AND source_reference_id = ?",
                    (source_module, str(source_reference_id))
                ).one()
                if existing:
                    logger.info(f"Transacción ya registrada previamente ({source_module}:{source_reference_id}). Actualizando.")
                    target_shift = existing["shift_id"]
                    if existing.get("voided_at"):
                        target_shift = assigned_shift_id  # se vuelve a cobrar: cuenta en el turno actual
                    tx.execute("""
                        UPDATE finance_transactions SET
                            amount = ?,
                            payment_method = ?,
                            description = ?,
                            shift_id = ?,
                            voided_at = NULL,
                            void_reason = NULL,
                            voided_by = NULL
                        WHERE id = ?
                    """, (amt, clean_method, description, target_shift, existing["id"]))
                    return tx.execute("SELECT * FROM finance_transactions WHERE id = ?", (existing["id"],)).one()

            tx_id = tx.insert("""
                INSERT INTO finance_transactions (
                    shift_id, type, category, amount, payment_method,
                    source_module, source_reference_id, description, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                assigned_shift_id,
                clean_type,
                category or "other",
                amt,
                clean_method,
                source_module or "manual",
                str(source_reference_id) if source_reference_id else None,
                description or "",
                created_by or "Admin",
                now_str
            ))
            self._audit(tx, "tx_create", "transaction", tx_id, created_by,
                        f"{clean_type} {category} ${amt:.2f} ({clean_method}) {description or ''}".strip(), client_ip)

            return tx.execute("SELECT * FROM finance_transactions WHERE id = ?", (tx_id,)).one()

    def _shift_status(self, tx, shift_id: Optional[int]) -> Optional[str]:
        if shift_id is None:
            return None
        row = tx.execute("SELECT status FROM finance_shifts WHERE id = ?", (shift_id,)).one()
        return row["status"] if row else None

    def void_transaction(self, tx_id: int, reason: str, voided_by: str = "Admin",
                         client_ip: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Anula un movimiento manual. Nunca se borra: queda en el libro con motivo, usuario y fecha.
        No se permite si pertenece a un corte cerrado (el corte Z queda congelado) ni si viene de otro módulo.
        """
        reason = (reason or "").strip()
        if len(reason) < 3:
            raise ValueError("Indica el motivo de la anulación.")
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM finance_transactions WHERE id = ?", (tx_id,)).one()
            if not row:
                return None
            if row.get("voided_at"):
                raise ValueError(f"El movimiento #{tx_id} ya está anulado.")
            if (row.get("source_module") or "manual") != "manual":
                raise ValueError(f"El movimiento #{tx_id} viene del módulo «{row['source_module']}»; se revierte desde ese módulo.")
            if self._shift_status(tx, row.get("shift_id")) == "closed":
                raise ValueError(f"El movimiento #{tx_id} pertenece al corte #{row['shift_id']}, que ya está cerrado. "
                                 "Registra un movimiento de ajuste en el turno actual.")
            tx.execute("UPDATE finance_transactions SET voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?",
                       (_ts(_now_utc()), reason[:300], (voided_by or "Admin")[:100], tx_id))
            self._audit(tx, "tx_void", "transaction", tx_id, voided_by, reason, client_ip)
            logger.info(f"🚫 Movimiento #{tx_id} anulado por {voided_by}: {reason}")
            return tx.execute("SELECT * FROM finance_transactions WHERE id = ?", (tx_id,)).one()

    def void_source_transaction(self, source_module: str, source_reference_id: str) -> bool:
        """
        Revierte el cobro de un pedido externo (p. ej. se desmarca como pagado).
        Turno abierto o sin turno: se anula. Turno ya cerrado: se registra un reembolso en el turno actual,
        así el corte Z cerrado no cambia y la devolución queda trazable.
        """
        ref = str(source_reference_id)
        with self._tx() as tx:
            row = tx.execute(
                "SELECT * FROM finance_transactions WHERE source_module = ? AND source_reference_id = ? AND voided_at IS NULL",
                (source_module, ref)
            ).one()
            if not row:
                return False
            if self._shift_status(tx, row.get("shift_id")) != "closed":
                tx.execute("UPDATE finance_transactions SET voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?",
                           (_ts(_now_utc()), f"Cobro revertido en {source_module}", source_module, row["id"]))
                self._audit(tx, "tx_void", "transaction", row["id"], source_module, f"Cobro revertido en {source_module} ({ref})")
                return True
        self.record_transaction(
            type="expense",
            category="refund",
            amount=_f(_money(row["amount"])),
            payment_method=row.get("payment_method") or "cash",
            source_module=source_module,
            source_reference_id=f"{ref}:refund",
            description=f"Reembolso de {row.get('description') or ref} (corte #{row['shift_id']} ya cerrado)",
            created_by=source_module,
        )
        return True

    def list_transactions(
        self,
        limit: int = 200,
        shift_id: Optional[int] = None,
        type: Optional[str] = None,
        payment_method: Optional[str] = None,
        source_module: Optional[str] = None,
        start: Optional[str] = None,
        end: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Lista transacciones con filtros opcionales (fechas locales AAAA-MM-DD, inclusive)."""

        sql = f"SELECT {TX_COLUMNS} FROM finance_transactions WHERE 1=1"
        params = []
        if start and end:
            since, until, _, _ = _local_day_bounds(start, end)
            sql += " AND created_at >= ? AND created_at < ?"
            params += [since, until]

        if shift_id is not None:
            sql += " AND shift_id = ?"
            params.append(shift_id)
        if type and type != "all":
            sql += " AND type = ?"
            params.append(type.lower())
        if payment_method and payment_method != "all":
            sql += " AND payment_method = ?"
            params.append(payment_method.lower())
        if source_module and source_module != "all":
            sql += " AND source_module = ?"
            params.append(source_module.lower())

        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        with self._tx() as tx:
            return tx.execute(sql, tuple(params)).all()

    # ------------------------------------------------------------------
    # RESUMEN Y REPORTES (P&L CONSOLIDADO)
    # ------------------------------------------------------------------
    def get_summary(self, days: int = 30) -> Dict[str, Any]:
        """Calcula el resumen financiero global: ventas, gastos, P&L y métricas por canal."""

        with self._tx() as tx:
            # Obtener todas las transacciones de los últimos X días
            since = _ts(_now_utc() - timedelta(days=days))
            all_txs = tx.execute(
                f"SELECT {TX_COLUMNS} FROM finance_transactions WHERE created_at >= ? AND voided_at IS NULL "
                "AND type IN ('income', 'expense') ORDER BY id DESC",
                (since,)
            ).all()

            zero = Decimal("0.00")
            total_income = total_expense = zero
            by_method = {"cash": zero, "card": zero, "transfer": zero, "other": zero}
            by_source: Dict[str, Decimal] = {}
            by_category: Dict[str, Decimal] = {}

            for t in all_txs:
                amt = _money(t.get("amount"))
                m = (t.get("payment_method") or "cash").lower()
                if t.get("type") == "income":
                    total_income += amt
                    by_method[m if m in by_method else "other"] += amt
                    src = t.get("source_module") or "manual"
                    by_source[src] = by_source.get(src, zero) + amt
                else:
                    total_expense += amt
                    cat = t.get("category") or "other"
                    by_category[cat] = by_category.get(cat, zero) + amt

            current_shift = self.get_current_shift()
            open_shift_active = current_shift is not None

            return {
                "total_income": _f(total_income),
                "total_expense": _f(total_expense),
                "net_profit": _f(total_income - total_expense),
                "by_method": {k: _f(v) for k, v in by_method.items()},
                "by_source": {k: _f(v) for k, v in by_source.items()},
                "by_category": {k: _f(v) for k, v in by_category.items()},
                "total_transactions": len(all_txs),
                "period_days": days,
                "has_open_shift": open_shift_active,
                "current_shift_id": current_shift.get("id") if current_shift else None
            }

    # ------------------------------------------------------------------
    # CATEGORÍAS
    # ------------------------------------------------------------------
    def list_categories(self, include_inactive: bool = False) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM finance_categories" + ("" if include_inactive else " WHERE active = 1") + " ORDER BY type, label"
        with self._tx() as tx:
            rows = tx.execute(sql).all()
        for r in rows:
            r["active"], r["is_system"] = bool(int(r["active"])), bool(int(r["is_system"]))
        return rows

    def create_category(self, label: str, ctype: str, actor: str = "Admin") -> Dict[str, Any]:
        import re
        import unicodedata
        label = (label or "").strip()
        if len(label) < 2:
            raise ValueError("El nombre de la categoría es muy corto.")
        if ctype not in ("income", "expense"):
            raise ValueError("El tipo debe ser ingreso o gasto.")
        base = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().lower()
        key = re.sub(r"[^a-z0-9]+", "_", base).strip("_")[:40] or "categoria"
        with self._tx() as tx:
            taken = {r["key"] for r in tx.execute("SELECT key FROM finance_categories").all()}
            if any(r for r in tx.execute("SELECT 1 FROM finance_categories WHERE LOWER(label) = ?", (label.lower(),)).all()):
                raise ValueError(f"Ya existe una categoría llamada «{label}».")
            final, n = key, 2
            while final in taken:
                final, n = f"{key}_{n}", n + 1
            tx.execute("INSERT INTO finance_categories (key, label, type, active, is_system) VALUES (?, ?, ?, 1, 0)",
                       (final, label[:100], ctype))
            self._audit(tx, "category_create", "category", None, actor, f"{final}: {label} ({ctype})")
            return tx.execute("SELECT * FROM finance_categories WHERE key = ?", (final,)).one()

    def update_category(self, key: str, label: Optional[str] = None, active: Optional[bool] = None,
                        actor: str = "Admin") -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM finance_categories WHERE key = ?", (key,)).one()
            if not row:
                return None
            if active is False and int(row["is_system"]):
                raise ValueError("Las categorías del sistema (Venta, Reembolso) no se pueden desactivar.")
            if label is not None:
                if len(label.strip()) < 2:
                    raise ValueError("El nombre de la categoría es muy corto.")
                tx.execute("UPDATE finance_categories SET label = ? WHERE key = ?", (label.strip()[:100], key))
            if active is not None:
                tx.execute("UPDATE finance_categories SET active = ? WHERE key = ?", (1 if active else 0, key))
            self._audit(tx, "category_update", "category", None, actor,
                        f"{key}: " + ", ".join(x for x in (f"nombre={label}" if label else "",
                                                             f"activa={active}" if active is not None else "") if x))
            return tx.execute("SELECT * FROM finance_categories WHERE key = ?", (key,)).one()

    # ------------------------------------------------------------------
    # REPORTES
    # ------------------------------------------------------------------
    def _period_totals(self, tx, since: str, until: str) -> Dict[str, Any]:
        rows = tx.execute(
            "SELECT type, category, payment_method, amount, created_at FROM finance_transactions "
            "WHERE created_at >= ? AND created_at < ? AND voided_at IS NULL", (since, until)).all()
        zero = Decimal("0.00")
        out = {"income": zero, "expense": zero, "withdrawals": zero, "deposits": zero,
               "by_category": {}, "by_method": {}, "months": {}, "count": 0}
        tz = _local_tz()
        for r in rows:
            amt, t = _money(r["amount"]), r["type"]
            if t == "withdrawal":
                out["withdrawals"] += amt
                continue
            if t == "deposit":
                out["deposits"] += amt
                continue
            out["count"] += 1
            month = datetime.fromisoformat(r["created_at"]).astimezone(tz).strftime("%Y-%m")
            m = out["months"].setdefault(month, {"income": zero, "expense": zero})
            key = (t, r["category"] or "other")
            out["by_category"][key] = out["by_category"].get(key, zero) + amt
            if t == "income":
                out["income"] += amt
                m["income"] += amt
                method = (r["payment_method"] or "cash").lower()
                out["by_method"][method] = out["by_method"].get(method, zero) + amt
            else:
                out["expense"] += amt
                m["expense"] += amt
        return out

    def get_report(self, start: str, end: str) -> Dict[str, Any]:
        """Estado de resultados del rango (fechas locales inclusive), por mes y categoría, vs. el período anterior."""
        since, until, d0, d1 = _local_day_bounds(start, end)
        length = d1 - d0
        prev_since, prev_until = _ts((d0 - length).astimezone(timezone.utc)), since
        with self._tx() as tx:
            cur = self._period_totals(tx, since, until)
            prev = self._period_totals(tx, prev_since, prev_until)
            labels = {r["key"]: r["label"] for r in tx.execute("SELECT key, label FROM finance_categories").all()}

        def change(now: Decimal, before: Decimal) -> Optional[float]:
            if before == 0:
                return None
            return float(((now - before) / abs(before) * 100).quantize(Decimal("0.1")))

        net, prev_net = cur["income"] - cur["expense"], prev["income"] - prev["expense"]
        return {
            "start": start, "end": end, "days": length.days,
            "income": _f(cur["income"]), "expense": _f(cur["expense"]), "net": _f(net),
            "margin_pct": float((net / cur["income"] * 100).quantize(Decimal("0.1"))) if cur["income"] else None,
            "withdrawals": _f(cur["withdrawals"]), "deposits": _f(cur["deposits"]),
            "transactions": cur["count"],
            "by_method": {k: _f(v) for k, v in cur["by_method"].items()},
            "by_category": sorted(
                [{"type": t, "key": k, "label": labels.get(k, k), "amount": _f(v)} for (t, k), v in cur["by_category"].items()],
                key=lambda x: (x["type"], -x["amount"])),
            "monthly": [{"month": mo, "income": _f(v["income"]), "expense": _f(v["expense"]),
                         "net": _f(v["income"] - v["expense"])} for mo, v in sorted(cur["months"].items())],
            "previous": {
                "start": (d0 - length).strftime("%Y-%m-%d"), "end": (d0 - timedelta(days=1)).strftime("%Y-%m-%d"),
                "income": _f(prev["income"]), "expense": _f(prev["expense"]), "net": _f(prev_net),
                "income_change_pct": change(cur["income"], prev["income"]),
                "expense_change_pct": change(cur["expense"], prev["expense"]),
                "net_change_pct": change(net, prev_net),
            },
        }

    # ------------------------------------------------------------------
    # COMPROBANTES (foto de factura / recibo)
    # ------------------------------------------------------------------
    def set_receipt(self, tx_id: int, data_url: str, filename: str = "", actor: str = "Admin",
                    client_ip: Optional[str] = None) -> Optional[Dict[str, Any]]:
        data_url = (data_url or "").strip()
        if not data_url.startswith(RECEIPT_PREFIXES):
            raise ValueError("El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF.")
        if len(data_url) > MAX_RECEIPT_BYTES:
            raise ValueError("El comprobante es demasiado grande (máximo ~1.5 MB).")
        with self._tx() as tx:
            row = tx.execute("SELECT id, voided_at FROM finance_transactions WHERE id = ?", (tx_id,)).one()
            if not row:
                return None
            if row.get("voided_at"):
                raise ValueError("No se puede adjuntar un comprobante a un movimiento anulado.")
            tx.execute("UPDATE finance_transactions SET receipt_data = ?, receipt_name = ? WHERE id = ?",
                       (data_url, (filename or "comprobante")[:200], tx_id))
            self._audit(tx, "receipt_attach", "transaction", tx_id, actor, filename or "comprobante", client_ip)
            return tx.execute(f"SELECT {TX_COLUMNS} FROM finance_transactions WHERE id = ?", (tx_id,)).one()

    def get_receipt(self, tx_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.execute("SELECT receipt_data, receipt_name FROM finance_transactions WHERE id = ?", (tx_id,)).one()
        if not row or not row.get("receipt_data"):
            return None
        return {"data_url": row["receipt_data"], "filename": row.get("receipt_name") or "comprobante"}

    # ------------------------------------------------------------------
    # SINCRONIZACIÓN AUTOMÁTICA CON RESTAURANTE Y OTROS MÓDULOS
    # ------------------------------------------------------------------
    def sync_unrecorded_restaurant_sales(self) -> int:
        """
        Escanea la tabla restaurant_orders e importa automáticamente a finance_transactions
        aquellas órdenes pagadas que aún no tengan registro financiero.
        """
        synced_count = 0
        try:
            with self._tx() as tx:
                # Comprobar si existe la tabla restaurant_orders
                check_table = tx.execute("""
                    SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'restaurant_orders'
                """ if tx.is_pg else """
                    SELECT 1 FROM sqlite_master WHERE type='table' AND name='restaurant_orders'
                """).one()

                if not check_table:
                    return 0

                # Solo los pedidos pagados SIN movimiento contable (una consulta, no una por pedido)
                ref_expr = "'order_' || CAST(o.id AS TEXT)" if tx.is_pg else "'order_' || o.id"
                pending = tx.execute(f"""
                    SELECT o.id, o.total, o.payment_method, o.customer_name
                    FROM restaurant_orders o
                    LEFT JOIN finance_transactions f
                      ON f.source_module = 'restaurant' AND f.source_reference_id = {ref_expr}
                    WHERE o.payment_status = 'paid' AND f.id IS NULL
                """).all()
            for o in pending:
                if _money(o.get("total")) > 0:
                    self.record_transaction(
                        type="income",
                        category="sale",
                        amount=o.get("total"),
                        payment_method=o.get("payment_method") or "cash",
                        source_module="restaurant",
                        source_reference_id=f"order_{o['id']}",
                        description=f"Venta Restaurante #{o['id']} ({o.get('customer_name') or 'Cliente'})",
                        created_by="Bot/Restaurante"
                    )
                    synced_count += 1
        except Exception as e:
            logger.warning(f"Aviso durante sincronización de ventas de restaurante: {e}")

        if synced_count > 0:
            logger.info(f"🔄 Se sincronizaron {synced_count} órdenes pagadas de restaurante a Finanzas.")
        return synced_count

    # ------------------------------------------------------------------
    # TICKET TÉRMICO DE CORTE DE CAJA (CORTE X / CORTE Z)
    # ------------------------------------------------------------------
    def get_shift_ticket(self, shift_id: Optional[int] = None) -> str:
        """Genera el texto plano formateado para ticket de 80mm de Corte de Caja."""
        shift = self.get_shift(shift_id) if shift_id else self.get_current_shift()
        if not shift:
            return "NO HAY TURNO DE CAJA ACTIVO."

        is_closed = shift.get("status") == "closed"
        tipo_corte = "CORTE FINAL Z" if is_closed else "CORTE PARCIAL X"

        opened_dt = _local_str(shift.get("opened_at"))
        closed_dt = _local_str(shift.get("closed_at")) if is_closed else "EN CURSO"

        init_cash = float(shift.get("initial_cash") or 0.0)
        sales_cash = float(shift.get("total_sales_cash") or 0.0)
        sales_card = float(shift.get("total_sales_card") or 0.0)
        sales_trans = float(shift.get("total_sales_transfer") or 0.0)
        sales_other = float(shift.get("total_sales_other") or 0.0)
        exp_cash = float(shift.get("total_expenses_cash") or 0.0)
        exp_other = float(shift.get("total_expenses_other") or 0.0)
        withdrawals = float(shift.get("total_withdrawals") or 0.0)
        deposits = float(shift.get("total_deposits") or 0.0)
        expected = float(shift.get("expected_cash") or 0.0)
        counted = float(shift.get("counted_cash") or 0.0)
        diff = float(shift.get("difference") or 0.0)

        total_ventas = sales_cash + sales_card + sales_trans + sales_other
        total_egresos = exp_cash + exp_other

        lines = [
            "================================",
            "        ZENITH STUDIO           ",
            "     CONTROL DE CAJA CHICA      ",
            f"       *** {tipo_corte} ***       ",
            "================================",
            f"Turno #:      {shift['id']}",
            f"Cajero/a:     {shift.get('opened_by') or 'Caja'}",
            f"Apertura:     {opened_dt}",
            f"Cierre:       {closed_dt}",
            "--------------------------------",
            "         VENTAS / INGRESOS      ",
            "--------------------------------",
            f"Ventas Efectivo:     ${sales_cash:>8.2f}",
            f"Ventas Tarjeta:      ${sales_card:>8.2f}",
            f"Ventas Transfer/QR:  ${sales_trans:>8.2f}",
            f"Otros Ingresos:      ${sales_other:>8.2f}",
            "--------------------------------",
            f"TOTAL VENTAS:        ${total_ventas:>8.2f}",
            "--------------------------------",
            "        EGRESOS / GASTOS        ",
            "--------------------------------",
            f"Gastos en Efectivo:  ${exp_cash:>8.2f}",
            f"Otros Gastos:        ${exp_other:>8.2f}",
            f"TOTAL EGRESOS:       ${total_egresos:>8.2f}",
            "================================",
            "       ARQUEO DE EFECTIVO       ",
            "================================",
            f"(+) Fondo Inicial:   ${init_cash:>8.2f}",
            f"(+) Ventas Efectivo: ${sales_cash:>8.2f}",
            f"(-) Gastos Efectivo: ${exp_cash:>8.2f}",
        ]
        if deposits:
            lines.append(f"(+) Depositos caja:  ${deposits:>8.2f}")
        if withdrawals:
            lines.append(f"(-) Retiros caja:    ${withdrawals:>8.2f}")
        lines += [
            "--------------------------------",
            f"(=) EFECTIVO TEORICO:${expected:>8.2f}",
        ]

        if is_closed and shift.get("cash_count_json"):
            try:
                counts = json.loads(shift["cash_count_json"])
                lines += ["--------------------------------", "     CONTEO POR DENOMINACION    "]
                for d in DENOMINATIONS:
                    if counts.get(d):
                        lines.append(f"  ${d:>6} x {int(counts[d]):>4} = ${float(_money(d) * int(counts[d])):>8.2f}")
            except (TypeError, ValueError):
                pass

        if is_closed:
            diff_label = "CUADRADO EXACTO" if abs(diff) < 0.01 else ("SOBRANTE (+)" if diff > 0 else "FALTANTE (-)")
            lines.extend([
                f"(=) EFECTIVO CONTADO:${counted:>8.2f}",
                "--------------------------------",
                f"DIFERENCIA:          ${diff:>8.2f}",
                f"ESTADO ARQUEO:       {diff_label}",
            ])
        else:
            lines.append("ESTADO:              TURNO ABIERTO (EN VIVO)")

        if shift.get("notes"):
            lines.extend([
                "--------------------------------",
                f"NOTAS: {shift.get('notes')}",
            ])

        lines.extend([
            "================================",
            f"Impreso: {_local_str(_ts(_now_utc()))}",
            "   --- COMPROBANTE DE CAJA ---  \n\n\n\n"
        ])

        return "\n".join(lines)


finance_service = FinanceService()

