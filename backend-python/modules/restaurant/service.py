"""Servicio de datos y reglas de negocio del módulo Restaurante & Pedidos."""
import json
import logging
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asistente_operativo.modules.restaurant")

CONFIG_SETTING_KEY = "RESTAURANT_CONFIG"
MAX_QTY_PER_ITEM = 50
DUPLICATE_WINDOW_SECONDS = 120

ORDER_TYPES = ("delivery", "pickup", "dine_in")
PAYMENT_METHODS = ("cash", "transfer", "card")
ACTIVE_STATUSES = ("pending", "confirmed", "preparing", "ready")
TERMINAL_STATUSES = ("delivered", "cancelled")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

ORDER_TYPE_LABELS = {"delivery": "A domicilio", "pickup": "Para recoger", "dine_in": "Comer en el local"}
PAYMENT_LABELS = {"cash": "Efectivo", "transfer": "Transferencia", "card": "Tarjeta"}
WEEKDAY_LABELS = {"mon": "Lunes", "tue": "Martes", "wed": "Miércoles", "thu": "Jueves",
                  "fri": "Viernes", "sat": "Sábado", "sun": "Domingo"}

DEFAULT_CONFIG: Dict[str, Any] = {
    "restaurant_name": "",
    "address": "",
    "accepting_orders": True,
    "utc_offset_hours": -6,  # El Salvador no usa horario de verano
    "order_types": {"delivery": True, "pickup": True, "dine_in": False},
    "hours": {d: {"closed": False, "open": "10:00", "close": "21:00"} for d in WEEKDAYS},
    "prep_minutes": 25,
    "min_order": 0.0,
    "zones": [],  # [{"name": "Centro", "fee": 2.0, "min_order": 0, "minutes": 15}]
    "flat_delivery_fee": 0.0,  # se usa solo si no hay zonas definidas
    "payment_methods": {"cash": True, "transfer": False, "card": False},
    "transfer_info": "",
    "closed_message": "",
    "notify_customer": True,
    # Comportamiento de la IA con el restaurante
    "ai": {
        "take_orders": True,        # False = la IA solo informa el menú y deriva pedidos a un asesor
        "menu_style": "categories",  # "categories" = primero categorías; "full" = menú completo de una vez
        "upsell": True,             # sugerir bebida/postre/acompañamiento una vez por pedido
        "ask_name": True,           # pedir el nombre del cliente antes de confirmar
        "menu_link": "",            # enlace a menú visual (PDF/imagen/web) para compartir
        "greeting": "",             # saludo específico del restaurante
        "instructions": "",         # reglas extra: promociones, combos, alergias, etc.
    },
}


class OrderError(ValueError):
    """Pedido rechazado por una regla de negocio; el mensaje es apto para mostrarse al cliente."""


def _clean(value: Any) -> Any:
    return float(value) if isinstance(value, Decimal) else value


def _parse_ts(value: Any) -> Optional[datetime]:
    """Convierte created_at de SQLite/PostgreSQL a datetime UTC con zona."""
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or "").strip().replace("T", " ")
        if not text:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(sep=" ")


def _money(value: float) -> str:
    return f"${float(value):.2f}"


def _merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = deepcopy(base)
    for key, value in (override or {}).items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


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
        row = self._cursor.fetchone()
        return self._row(row) if row is not None else None


class _Tx:
    """Envuelve una conexión PostgreSQL/SQLite con la misma interfaz (placeholders `?`)."""

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


class RestaurantService:
    """Menú, órdenes, configuración, estadísticas y avisos al cliente del restaurante."""

    def __init__(self):
        self._db = None

    # ------------------------------------------------------------------
    # INFRAESTRUCTURA
    # ------------------------------------------------------------------
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

    def _column_names(self, tx: _Tx, table: str) -> set:
        if tx.is_pg:
            rows = tx.execute("SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?", (table,)).all()
        else:
            rows = tx.execute(f"PRAGMA table_info({table})").all()
        return {r["name"] for r in rows}

    # ------------------------------------------------------------------
    # TABLAS Y MIGRACIONES (idempotentes: se ejecutan al instalar y en cada arranque)
    # ------------------------------------------------------------------
    def init_tables(self, db_service) -> None:
        self._db = db_service
        pg = db_service.is_postgres
        pk = "SERIAL PRIMARY KEY" if pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
        ts = "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP" if pg else "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        real = "DECIMAL(10,2)" if pg else "REAL"
        boolean = "BOOLEAN DEFAULT TRUE" if pg else "INTEGER DEFAULT 1"

        # Columnas añadidas después de la v1.0.0: (tabla, nombre, definición)
        new_columns = [
            ("restaurant_menu", "stock", "INTEGER"),
            ("restaurant_orders", "order_type", "TEXT DEFAULT 'delivery'"),
            ("restaurant_orders", "customer_phone", "TEXT DEFAULT ''"),
            ("restaurant_orders", "delivery_address", "TEXT DEFAULT ''"),
            ("restaurant_orders", "delivery_zone", "TEXT DEFAULT ''"),
            ("restaurant_orders", "subtotal", f"{real} DEFAULT 0"),
            ("restaurant_orders", "delivery_fee", f"{real} DEFAULT 0"),
            ("restaurant_orders", "payment_method", "TEXT DEFAULT 'cash'"),
            ("restaurant_orders", "payment_status", "TEXT DEFAULT 'pending'"),
            ("restaurant_orders", "cancel_reason", "TEXT DEFAULT ''"),
            ("restaurant_orders", "estimated_minutes", "INTEGER DEFAULT 0"),
            ("restaurant_orders", "source", "TEXT DEFAULT 'manual'"),
            ("restaurant_orders", "status_history", "TEXT DEFAULT '[]'"),
        ]
        with self._tx() as tx:
            tx.execute(f"""CREATE TABLE IF NOT EXISTS restaurant_menu (
                id {pk}, name TEXT NOT NULL, description TEXT DEFAULT '', price {real} NOT NULL DEFAULT 0,
                category TEXT DEFAULT 'General', available {boolean}, created_at {ts})""")
            tx.execute(f"""CREATE TABLE IF NOT EXISTS restaurant_orders (
                id {pk}, session_id TEXT NOT NULL, customer_name TEXT DEFAULT 'Cliente',
                items_json TEXT NOT NULL DEFAULT '[]', status TEXT DEFAULT 'pending', total {real} DEFAULT 0,
                notes TEXT DEFAULT '', created_at {ts}, updated_at {ts})""")
            tx.execute("CREATE INDEX IF NOT EXISTS idx_restaurant_orders_status ON restaurant_orders(status)")
            tx.execute("CREATE INDEX IF NOT EXISTS idx_restaurant_orders_session ON restaurant_orders(session_id)")
            for table, column, definition in new_columns:
                if column not in self._column_names(tx, table):
                    tx.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        logger.info(f"✅ Tablas del módulo Restaurante listas ({'PostgreSQL' if pg else 'SQLite'}).")

    # ------------------------------------------------------------------
    # CONFIGURACIÓN
    # ------------------------------------------------------------------
    def get_config(self) -> Dict[str, Any]:
        raw = self._get_db().get_setting(CONFIG_SETTING_KEY, "")
        try:
            stored = json.loads(raw) if raw else {}
        except (TypeError, ValueError):
            stored = {}
        return _merge(DEFAULT_CONFIG, stored if isinstance(stored, dict) else {})

    def save_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        config = _merge(self.get_config(), updates)
        config["utc_offset_hours"] = max(-12, min(14, int(config["utc_offset_hours"])))
        config["prep_minutes"] = max(0, int(config["prep_minutes"]))
        config["min_order"] = max(0.0, float(config["min_order"]))
        config["flat_delivery_fee"] = max(0.0, float(config["flat_delivery_fee"]))
        zones = []
        for zone in config.get("zones") or []:
            name = str(zone.get("name", "")).strip()
            if name:
                zones.append({
                    "name": name,
                    "fee": max(0.0, float(zone.get("fee", 0) or 0)),
                    "min_order": max(0.0, float(zone.get("min_order", 0) or 0)),
                    "minutes": max(0, int(zone.get("minutes", 0) or 0)),
                })
        config["zones"] = zones
        self._get_db().set_setting(CONFIG_SETTING_KEY, json.dumps(config, ensure_ascii=False))
        return config

    def local_now(self, config: Optional[Dict[str, Any]] = None, now: Optional[datetime] = None) -> datetime:
        config = config or self.get_config()
        return (now or _now_utc()).astimezone(timezone(timedelta(hours=config["utc_offset_hours"])))

    def is_open(self, config: Optional[Dict[str, Any]] = None, now: Optional[datetime] = None) -> bool:
        """Abierto ahora según el interruptor general y el horario semanal (soporta cierres pasada la medianoche)."""
        config = config or self.get_config()
        if not config["accepting_orders"]:
            return False
        local = self.local_now(config, now)
        minutes = local.hour * 60 + local.minute

        def to_min(text: str) -> int:
            hours, mins = str(text).split(":")[:2]
            return int(hours) * 60 + int(mins)

        def window(day_index: int):
            day = config["hours"].get(WEEKDAYS[day_index % 7]) or {}
            if day.get("closed"):
                return None
            try:
                return to_min(day.get("open", "00:00")), to_min(day.get("close", "00:00"))
            except (ValueError, IndexError):
                return None

        today = window(local.weekday())
        if today:
            start, end = today
            if end > start and start <= minutes < end:
                return True
            if end <= start and minutes >= start:  # cierra después de medianoche
                return True
        yesterday = window(local.weekday() - 1)
        if yesterday:
            start, end = yesterday
            if end <= start and minutes < end:
                return True
        return False

    def hours_text(self, config: Optional[Dict[str, Any]] = None) -> str:
        config = config or self.get_config()
        def slot(day: str) -> str:
            d = config["hours"].get(day) or {}
            return "cerrado" if d.get("closed") else f"{d.get('open')} a {d.get('close')}"

        # Agrupa días consecutivos con el mismo horario: "Lunes a Viernes: 10:00 a 21:00; Sábado: cerrado"
        groups = []  # [primer_día, último_día, horario]
        for day in WEEKDAYS:
            if groups and groups[-1][2] == slot(day):
                groups[-1][1] = day
            else:
                groups.append([day, day, slot(day)])
        if len(groups) == 1:
            return f"Todos los días: {groups[0][2]}"
        return "; ".join(
            (WEEKDAY_LABELS[a] if a == b else f"{WEEKDAY_LABELS[a]} a {WEEKDAY_LABELS[b]}") + f": {s}"
            for a, b, s in groups)

    # ------------------------------------------------------------------
    # MENÚ
    # ------------------------------------------------------------------
    @staticmethod
    def _menu_row(row: Dict[str, Any]) -> Dict[str, Any]:
        stock = row.get("stock")
        return {
            "id": row["id"], "name": row["name"], "description": row.get("description") or "",
            "price": float(row["price"]), "category": row.get("category") or "General",
            "available": bool(row["available"]), "stock": None if stock is None else int(stock),
            "created_at": str(row.get("created_at") or ""),
        }

    def list_menu(self, only_available: bool = False) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM restaurant_menu"
        if only_available:
            sql += " WHERE available = ?"
        sql += " ORDER BY category, name"
        with self._tx() as tx:
            rows = tx.execute(sql, (True,) if only_available else ()).all()
        return [self._menu_row(r) for r in rows]

    def get_menu_item(self, item_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM restaurant_menu WHERE id = ?", (item_id,)).one()
        return self._menu_row(row) if row else None

    def add_menu_item(self, data) -> Dict[str, Any]:
        stock = getattr(data, "stock", None)
        available = bool(data.available) and (stock is None or stock > 0)
        with self._tx() as tx:
            item_id = tx.insert(
                "INSERT INTO restaurant_menu (name, description, price, category, available, stock) VALUES (?, ?, ?, ?, ?, ?)",
                (data.name.strip(), data.description or "", data.price, (data.category or "General").strip(), available, stock),
            )
        return self.get_menu_item(item_id)

    def add_menu_items_bulk(self, items: List[Any]) -> List[Dict[str, Any]]:
        return [self.add_menu_item(item) for item in items]

    def update_menu_item(self, item_id: int, data) -> Optional[Dict[str, Any]]:
        fields = data.model_dump(exclude_unset=True)  # permite enviar stock=null para quitar el límite
        if not fields:
            return self.get_menu_item(item_id)
        if "name" in fields and fields["name"] is not None:
            fields["name"] = fields["name"].strip()
        fields = {k: v for k, v in fields.items() if v is not None or k == "stock"}
        if fields.get("stock") == 0:
            fields["available"] = False
        elif fields.get("stock") and "available" not in fields:
            fields["available"] = True  # reponer stock reactiva el producto
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        with self._tx() as tx:
            if tx.execute(f"UPDATE restaurant_menu SET {set_clause} WHERE id = ?", tuple(fields.values()) + (item_id,)).rowcount == 0:
                return None
        return self.get_menu_item(item_id)

    def delete_menu_item(self, item_id: int) -> bool:
        with self._tx() as tx:
            return tx.execute("DELETE FROM restaurant_menu WHERE id = ?", (item_id,)).rowcount > 0

    def get_menu_text(self, with_ids: bool = False, with_stock: bool = True) -> str:
        items = self.list_menu(only_available=True)
        if not items:
            return "El menú no tiene ítems disponibles en este momento."
        lines = ["MENÚ:"]
        current = None
        for item in items:
            if item["category"] != current:
                current = item["category"]
                lines.append(current.upper())
            ident = f"[id {item['id']}] " if with_ids else ""
            desc = f" - {item['description']}" if item["description"] else ""
            low = f" (quedan {item['stock']})" if with_stock and item["stock"] is not None and item["stock"] <= 5 else ""
            lines.append(f"- {ident}{item['name']}{desc}: {_money(item['price'])}{low}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # ÓRDENES
    # ------------------------------------------------------------------
    @staticmethod
    def _order_row(row: Dict[str, Any]) -> Dict[str, Any]:
        try:
            items = json.loads(row.get("items_json") or "[]")
        except ValueError:
            items = []
        try:
            history = json.loads(row.get("status_history") or "[]")
        except ValueError:
            history = []
        total = float(row.get("total") or 0)
        fee = float(row.get("delivery_fee") or 0)
        return {
            "id": row["id"], "session_id": row["session_id"],
            "customer_name": row.get("customer_name") or "Cliente",
            "customer_phone": row.get("customer_phone") or "",
            "items": items, "items_json": row.get("items_json") or "[]",
            "status": row.get("status") or "pending",
            "order_type": row.get("order_type") or "delivery",
            "delivery_address": row.get("delivery_address") or "",
            "delivery_zone": row.get("delivery_zone") or "",
            "subtotal": float(row.get("subtotal") or (total - fee)),
            "delivery_fee": fee, "total": total,
            "payment_method": row.get("payment_method") or "cash",
            "payment_status": row.get("payment_status") or "pending",
            "cancel_reason": row.get("cancel_reason") or "",
            "estimated_minutes": int(row.get("estimated_minutes") or 0),
            "source": row.get("source") or "manual",
            "status_history": history, "notes": row.get("notes") or "",
            "created_at": str(row.get("created_at") or ""), "updated_at": str(row.get("updated_at") or ""),
        }

    def get_order(self, order_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM restaurant_orders WHERE id = ?", (order_id,)).one()
        return self._order_row(row) if row else None

    def list_orders(self, status_filter: Optional[str] = None, order_type: Optional[str] = None,
                    search: Optional[str] = None, session_id: Optional[str] = None,
                    limit: int = 200) -> List[Dict[str, Any]]:
        clauses, params = [], []
        if status_filter == "active":
            clauses.append(f"status IN ({', '.join('?' for _ in ACTIVE_STATUSES)})")
            params.extend(ACTIVE_STATUSES)
        elif status_filter:
            clauses.append("status = ?")
            params.append(status_filter)
        if order_type:
            clauses.append("order_type = ?")
            params.append(order_type)
        if session_id:
            clauses.append("session_id = ?")
            params.append(session_id)
        if search:
            term = f"%{search.strip().lower()}%"
            clauses.append("(LOWER(customer_name) LIKE ? OR customer_phone LIKE ? OR CAST(id AS TEXT) = ?)")
            params.extend([term, f"%{search.strip()}%", search.strip().lstrip('#')])
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._tx() as tx:
            rows = tx.execute(f"SELECT * FROM restaurant_orders{where} ORDER BY id DESC LIMIT ?", tuple(params) + (limit,)).all()
        return [self._order_row(r) for r in rows]

    def create_order(self, data, source: str = "manual", enforce_schedule: bool = False) -> Dict[str, Any]:
        """
        Crea una orden validando disponibilidad, stock, zona, mínimos y pago. Los precios y el total
        siempre se calculan aquí (nunca se confía en montos enviados por el cliente o por la IA).
        `enforce_schedule=True` (pedidos del bot) rechaza pedidos fuera de horario o con la cocina cerrada.
        """
        config = self.get_config()
        if enforce_schedule and not self.is_open(config):
            raise OrderError(config["closed_message"] or
                             f"Por ahora no estamos tomando pedidos. Nuestro horario es: {self.hours_text(config)}.")

        order_type = getattr(data, "order_type", None) or "delivery"
        if order_type not in ORDER_TYPES or not config["order_types"].get(order_type):
            enabled = [ORDER_TYPE_LABELS[t] for t in ORDER_TYPES if config["order_types"].get(t)]
            raise OrderError(f"Ese tipo de pedido no está disponible. Opciones: {', '.join(enabled) or 'ninguna'}.")

        payment = getattr(data, "payment_method", None) or "cash"
        if payment not in PAYMENT_METHODS or not config["payment_methods"].get(payment):
            enabled = [PAYMENT_LABELS[p] for p in PAYMENT_METHODS if config["payment_methods"].get(p)]
            raise OrderError(f"Ese método de pago no está disponible. Opciones: {', '.join(enabled) or 'ninguna'}.")

        if not data.items:
            raise OrderError("El pedido no tiene productos.")

        requested: Dict[int, Dict[str, Any]] = {}
        for entry in data.items:
            slot = requested.setdefault(entry.menu_item_id, {"quantity": 0, "notes": []})
            slot["quantity"] += entry.quantity
            if entry.notes:
                slot["notes"].append(entry.notes.strip())

        with self._tx() as tx:
            order_items, subtotal = [], 0.0
            for menu_id, req in requested.items():
                row = tx.execute("SELECT * FROM restaurant_menu WHERE id = ?", (menu_id,)).one()
                if row is None:
                    raise OrderError(f"El producto con id {menu_id} no existe en el menú.")
                item = self._menu_row(row)
                if not item["available"]:
                    raise OrderError(f"«{item['name']}» no está disponible en este momento.")
                if req["quantity"] > MAX_QTY_PER_ITEM:
                    raise OrderError(f"Máximo {MAX_QTY_PER_ITEM} unidades de «{item['name']}» por pedido.")
                if item["stock"] is not None and req["quantity"] > item["stock"]:
                    raise OrderError(f"Solo quedan {item['stock']} unidades de «{item['name']}».")
                line = round(item["price"] * req["quantity"], 2)
                subtotal += line
                order_items.append({
                    "menu_item_id": menu_id, "name": item["name"], "price": item["price"],
                    "quantity": req["quantity"], "notes": "; ".join(req["notes"]), "subtotal": line,
                })
            subtotal = round(subtotal, 2)

            fee, zone_name, extra_minutes, address = 0.0, "", 0, (getattr(data, "delivery_address", "") or "").strip()
            minimum = config["min_order"]
            if order_type == "delivery":
                if not address:
                    raise OrderError("Para entrega a domicilio necesito la dirección.")
                if config["zones"]:
                    wanted = (getattr(data, "delivery_zone", "") or "").strip().lower()
                    zone = next((z for z in config["zones"] if z["name"].lower() == wanted), None)
                    if zone is None:
                        names = ", ".join(z["name"] for z in config["zones"])
                        raise OrderError(f"No tengo clara la zona de entrega. Zonas con cobertura: {names}.")
                    fee, zone_name, extra_minutes = zone["fee"], zone["name"], zone["minutes"]
                    minimum = max(minimum, zone["min_order"])
                else:
                    fee = config["flat_delivery_fee"]
            else:
                address = ""
            if subtotal < minimum:
                raise OrderError(f"El pedido mínimo{' para esa zona' if zone_name else ''} es {_money(minimum)} (sin envío).")

            total = round(subtotal + fee, 2)
            estimated = config["prep_minutes"] + extra_minutes
            session_id = data.session_id
            phone = "".join(ch for ch in session_id if ch.isdigit())
            phone = phone if len(phone) >= 8 else ""
            items_json = json.dumps(order_items, ensure_ascii=False)

            # Evita pedidos duplicados por reintentos del cliente o del webhook
            if source == "bot":
                recent = tx.execute(
                    "SELECT * FROM restaurant_orders WHERE session_id = ? ORDER BY id DESC LIMIT 1", (session_id,)
                ).one()
                if recent and recent["items_json"] == items_json and float(recent["total"]) == total:
                    created = _parse_ts(recent["created_at"])
                    if created and (_now_utc() - created).total_seconds() < DUPLICATE_WINDOW_SECONDS \
                            and recent["status"] not in TERMINAL_STATUSES:
                        order = self._order_row(recent)
                        order["duplicate"] = True
                        return order

            now = _now_utc()
            history = json.dumps([{"status": "pending", "at": _ts(now)}])
            order_id = tx.insert(
                """INSERT INTO restaurant_orders
                   (session_id, customer_name, customer_phone, items_json, status, order_type, delivery_address,
                    delivery_zone, subtotal, delivery_fee, total, payment_method, payment_status, estimated_minutes,
                    source, status_history, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)""",
                (session_id, (data.customer_name or "Cliente").strip(), phone, items_json, order_type, address,
                 zone_name, subtotal, fee, total, payment, estimated, source, history,
                 (data.notes or "").strip(), _ts(now), _ts(now)),
            )
            for menu_id, req in requested.items():  # descuenta stock y marca agotado
                tx.execute(
                    "UPDATE restaurant_menu SET stock = stock - ?, available = (stock - ? > 0) "
                    "WHERE id = ? AND stock IS NOT NULL", (req["quantity"], req["quantity"], menu_id))
        return self.get_order(order_id)

    def update_order_status(self, order_id: int, new_status: str, cancel_reason: str = "",
                            notify: bool = True) -> Optional[Dict[str, Any]]:
        """Cambia el estado, restituye stock si se cancela y avisa al cliente por WhatsApp."""
        order = self.get_order(order_id)
        if order is None:
            return None
        if order["status"] in TERMINAL_STATUSES and new_status != order["status"]:
            raise OrderError(f"El pedido #{order_id} ya está {self._status_label(order['status'])} y no puede cambiar.")
        if new_status == order["status"]:
            return order

        history = order["status_history"] + [{"status": new_status, "at": _ts(_now_utc())}]
        with self._tx() as tx:
            tx.execute(
                "UPDATE restaurant_orders SET status = ?, status_history = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
                (new_status, json.dumps(history), (cancel_reason or "").strip() if new_status == "cancelled" else order["cancel_reason"],
                 _ts(_now_utc()), order_id))
            if new_status == "cancelled":
                for line in order["items"]:
                    # Reactiva el producto solo si se había agotado por este stock
                    tx.execute(
                        "UPDATE restaurant_menu SET stock = stock + ?, "
                        "available = CASE WHEN stock <= 0 THEN ? ELSE available END "
                        "WHERE id = ? AND stock IS NOT NULL",
                        (line["quantity"], True, line["menu_item_id"]))
        updated = self.get_order(order_id)
        updated["notified"] = self._notify_status(updated) if notify else False
        return updated

    def set_payment_status(self, order_id: int, payment_status: str) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            if tx.execute("UPDATE restaurant_orders SET payment_status = ?, updated_at = ? WHERE id = ?",
                          (payment_status, _ts(_now_utc()), order_id)).rowcount == 0:
                return None
        updated = self.get_order(order_id)
        if updated:
            try:
                self._sync_finance_on_payment(updated, payment_status)
            except Exception as e:
                logger.debug(f"Aviso en sincronización con finanzas: {e}")
        return updated

    def _sync_finance_on_payment(self, order: Dict[str, Any], payment_status: str) -> None:
        """Notifica al módulo de Finanzas si está disponible."""
        ref_id = f"order_{order['id']}"
        try:
            from modules.finance.service import finance_service
            if payment_status == "paid":
                amt = float(order.get("total") or 0.0)
                if amt > 0:
                    finance_service.record_transaction(
                        type="income",
                        category="sale",
                        amount=amt,
                        payment_method=order.get("payment_method") or "cash",
                        source_module="restaurant",
                        source_reference_id=ref_id,
                        description=f"Cobro Comanda #{order['id']} ({order.get('customer_name') or 'Cliente'})",
                        created_by="Restaurante/Caja"
                    )
            else:
                finance_service.void_source_transaction("restaurant", ref_id)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # AVISOS AL CLIENTE
    # ------------------------------------------------------------------
    @staticmethod
    def _status_label(status: str) -> str:
        return {"pending": "pendiente", "confirmed": "confirmado", "preparing": "en preparación",
                "ready": "listo", "delivered": "entregado", "cancelled": "cancelado"}.get(status, status)

    def status_message(self, order: Dict[str, Any]) -> str:
        number, kind = order["id"], order["order_type"]
        status = order["status"]
        if status == "confirmed":
            return f"✅ ¡Tu pedido #{number} fue confirmado! Tiempo estimado: ~{order['estimated_minutes']} min."
        if status == "preparing":
            return f"👨‍🍳 Estamos preparando tu pedido #{number}."
        if status == "ready":
            if kind == "delivery":
                return f"🛵 ¡Tu pedido #{number} va en camino!"
            if kind == "pickup":
                return f"🛍️ ¡Tu pedido #{number} está listo para recoger!"
            return f"🍽️ ¡Tu pedido #{number} está listo!"
        if status == "delivered":
            return f"🎉 Pedido #{number} entregado. ¡Gracias por tu compra, buen provecho!"
        if status == "cancelled":
            reason = f" Motivo: {order['cancel_reason']}." if order["cancel_reason"] else ""
            return f"❌ Tu pedido #{number} fue cancelado.{reason}"
        return f"⏳ Tu pedido #{number} está pendiente de confirmación."

    def _notify_status(self, order: Dict[str, Any]) -> bool:
        if order["status"] == "pending" or not order["customer_phone"] or not self.get_config()["notify_customer"]:
            return False
        try:
            from services.whatsapp_service import whatsapp_service
            return bool(whatsapp_service.send_text_message(order["customer_phone"], self.status_message(order)))
        except Exception as e:
            logger.warning(f"No se pudo avisar al cliente del pedido #{order['id']}: {e}")
            return False

    # ------------------------------------------------------------------
    # TICKET DE COCINA
    # ------------------------------------------------------------------
    def build_ticket(self, order: Dict[str, Any]) -> str:
        config = self.get_config()
        created = _parse_ts(order["created_at"])
        when = self.local_now(config, created).strftime("%d/%m/%Y %H:%M") if created else ""
        lines = [config["restaurant_name"] or "PEDIDO", f"Pedido #{order['id']}  {when}",
                 f"{ORDER_TYPE_LABELS.get(order['order_type'], order['order_type'])}", "-" * 32]
        for it in order["items"]:
            lines.append(f"{it['quantity']} x {it['name']}  {_money(it['subtotal'])}")
            if it.get("notes"):
                lines.append(f"   * {it['notes']}")
        lines += ["-" * 32, f"Subtotal: {_money(order['subtotal'])}"]
        if order["delivery_fee"]:
            lines.append(f"Envío: {_money(order['delivery_fee'])}")
        lines.append(f"TOTAL: {_money(order['total'])}")
        lines.append(f"Pago: {PAYMENT_LABELS.get(order['payment_method'], order['payment_method'])} "
                     f"({'pagado' if order['payment_status'] == 'paid' else 'pendiente'})")
        lines.append(f"Cliente: {order['customer_name']} {order['customer_phone']}".strip())
        if order["delivery_address"]:
            lines.append(f"Entrega: {order['delivery_address']}" + (f" ({order['delivery_zone']})" if order["delivery_zone"] else ""))
        if order["notes"]:
            lines.append(f"Notas: {order['notes']}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # ESTADÍSTICAS
    # ------------------------------------------------------------------
    def get_stats(self, days: int = 7) -> Dict[str, Any]:
        config = self.get_config()
        days = max(1, min(int(days), 90))
        local_today = self.local_now(config).date()
        start_local = local_today - timedelta(days=days - 1)
        offset = timedelta(hours=config["utc_offset_hours"])
        cutoff = datetime.combine(start_local, datetime.min.time(), tzinfo=timezone.utc) - offset

        with self._tx() as tx:
            rows = tx.execute("SELECT * FROM restaurant_orders ORDER BY id DESC LIMIT 5000").all()
        orders = []
        for row in rows:
            created = _parse_ts(row["created_at"])
            if created and created >= cutoff:
                order = self._order_row(row)
                order["_local"] = created + offset
                orders.append(order)

        valid = [o for o in orders if o["status"] != "cancelled"]
        by_day = {(start_local + timedelta(days=i)).isoformat(): {"orders": 0, "sales": 0.0} for i in range(days)}
        by_hour = {h: 0 for h in range(24)}
        by_status: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        by_payment: Dict[str, int] = {}
        top: Dict[str, Dict[str, Any]] = {}
        for o in orders:
            by_status[o["status"]] = by_status.get(o["status"], 0) + 1
        for o in valid:
            day = o["_local"].date().isoformat()
            if day not in by_day:
                continue
            by_day[day]["orders"] += 1
            by_day[day]["sales"] = round(by_day[day]["sales"] + o["total"], 2)
            by_hour[o["_local"].hour] += 1
            by_type[o["order_type"]] = by_type.get(o["order_type"], 0) + 1
            by_payment[o["payment_method"]] = by_payment.get(o["payment_method"], 0) + 1
            for it in o["items"]:
                slot = top.setdefault(it["name"], {"name": it["name"], "quantity": 0, "revenue": 0.0})
                slot["quantity"] += it["quantity"]
                slot["revenue"] = round(slot["revenue"] + it["subtotal"], 2)

        today_key = local_today.isoformat()
        today = by_day.get(today_key, {"orders": 0, "sales": 0.0})
        sales = round(sum(o["total"] for o in valid), 2)
        with self._tx() as tx:
            low_stock = [self._menu_row(r) for r in tx.execute(
                "SELECT * FROM restaurant_menu WHERE stock IS NOT NULL AND stock <= 5 ORDER BY stock").all()]
        return {
            "days": days, "open_now": self.is_open(config),
            "today": {"orders": today["orders"], "sales": today["sales"],
                      "active": len([o for o in orders if o["status"] in ACTIVE_STATUSES])},
            "range": {"orders": len(valid), "sales": sales,
                      "avg_ticket": round(sales / len(valid), 2) if valid else 0.0,
                      "cancelled": by_status.get("cancelled", 0),
                      "paid_orders": len([o for o in valid if o["payment_status"] == "paid"]),
                      "bot_orders": len([o for o in valid if o["source"] == "bot"])},
            "by_day": [{"date": d, **v} for d, v in by_day.items()],
            "by_hour": [{"hour": h, "orders": n} for h, n in by_hour.items()],
            "by_status": by_status, "by_type": by_type, "by_payment": by_payment,
            "top_items": sorted(top.values(), key=lambda x: x["quantity"], reverse=True)[:8],
            "low_stock": low_stock,
        }


restaurant_service = RestaurantService()
