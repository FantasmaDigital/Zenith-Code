"""Servicio de Base de Datos y Lógica de Negocio para Inventario, Insumos y Kardex Universal."""
import logging
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("asistente_operativo.modules.inventory")

_init_lock = threading.Lock()
CENT = Decimal("0.01")


def _num(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    try:
        return float(Decimal(str(val)).quantize(CENT, rounding=ROUND_HALF_UP))
    except Exception:
        return float(val or 0.0)


def _ts(dt: Optional[datetime] = None) -> str:
    now = dt or datetime.now(timezone.utc)
    return now.isoformat()


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


class InventoryService:
    """Gestiona catálogo de ítems, recetas (BOM), compras, mermas y Kardex."""

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
        """Crea tablas de inventario en el esquema de la empresa si no existen."""
        if self._tables_initialized:
            return
        with _init_lock:
            if self._tables_initialized:
                return
            with self._tx() as tx:
                # 1. Catálogo de Artículos / Insumos
                if tx.is_pg:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_items (
                            id SERIAL PRIMARY KEY,
                            sku VARCHAR(60),
                            name VARCHAR(160) NOT NULL,
                            description TEXT DEFAULT '',
                            category VARCHAR(80) DEFAULT 'general',
                            item_type VARCHAR(30) NOT NULL DEFAULT 'product',
                            unit VARCHAR(20) NOT NULL DEFAULT 'pza',
                            cost_price NUMERIC(12, 4) DEFAULT 0.0,
                            selling_price NUMERIC(12, 4) DEFAULT 0.0,
                            current_stock NUMERIC(12, 4) DEFAULT 0.0,
                            min_stock NUMERIC(12, 4) DEFAULT 0.0,
                            track_stock BOOLEAN DEFAULT TRUE,
                            image_url TEXT DEFAULT '',
                            is_active BOOLEAN DEFAULT TRUE,
                            restaurant_item_id INTEGER NULL,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            updated_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_items_name ON zenith_inventory_items(name)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_items_type ON zenith_inventory_items(item_type)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_items_active ON zenith_inventory_items(is_active)")
                    tx.execute("ALTER TABLE zenith_inventory_items ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''")
                else:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            sku TEXT,
                            name TEXT NOT NULL,
                            description TEXT DEFAULT '',
                            category TEXT DEFAULT 'general',
                            item_type TEXT NOT NULL DEFAULT 'product',
                            unit TEXT NOT NULL DEFAULT 'pza',
                            cost_price REAL DEFAULT 0.0,
                            selling_price REAL DEFAULT 0.0,
                            current_stock REAL DEFAULT 0.0,
                            min_stock REAL DEFAULT 0.0,
                            track_stock INTEGER DEFAULT 1,
                            image_url TEXT DEFAULT '',
                            is_active INTEGER DEFAULT 1,
                            restaurant_item_id INTEGER NULL,
                            created_at TEXT DEFAULT (datetime('now')),
                            updated_at TEXT DEFAULT (datetime('now'))
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_items_name ON zenith_inventory_items(name)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_items_type ON zenith_inventory_items(item_type)")
                    cols = [r["name"] for r in tx.execute("PRAGMA table_info(zenith_inventory_items)").all()]
                    if "image_url" not in cols:
                        tx.execute("ALTER TABLE zenith_inventory_items ADD COLUMN image_url TEXT DEFAULT ''")

                # 2. Recetas / Fichas Técnicas (BOM)
                if tx.is_pg:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_recipes (
                            id SERIAL PRIMARY KEY,
                            composite_item_id INTEGER NOT NULL REFERENCES zenith_inventory_items(id) ON DELETE CASCADE,
                            ingredient_item_id INTEGER NOT NULL REFERENCES zenith_inventory_items(id) ON DELETE CASCADE,
                            quantity NUMERIC(12, 4) NOT NULL,
                            unit VARCHAR(20) NOT NULL,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_recipes_composite ON zenith_inventory_recipes(composite_item_id)")
                else:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_recipes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            composite_item_id INTEGER NOT NULL,
                            ingredient_item_id INTEGER NOT NULL,
                            quantity REAL NOT NULL,
                            unit TEXT NOT NULL,
                            created_at TEXT DEFAULT (datetime('now')),
                            FOREIGN KEY (composite_item_id) REFERENCES zenith_inventory_items(id) ON DELETE CASCADE,
                            FOREIGN KEY (ingredient_item_id) REFERENCES zenith_inventory_items(id) ON DELETE CASCADE
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_recipes_composite ON zenith_inventory_recipes(composite_item_id)")

                # 3. Kardex de Movimientos
                if tx.is_pg:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_movements (
                            id SERIAL PRIMARY KEY,
                            item_id INTEGER NOT NULL REFERENCES zenith_inventory_items(id) ON DELETE CASCADE,
                            movement_type VARCHAR(40) NOT NULL,
                            quantity NUMERIC(12, 4) NOT NULL,
                            stock_before NUMERIC(12, 4) NOT NULL,
                            stock_after NUMERIC(12, 4) NOT NULL,
                            unit_cost NUMERIC(12, 4) DEFAULT 0.0,
                            total_cost NUMERIC(12, 4) DEFAULT 0.0,
                            source_module VARCHAR(40) DEFAULT 'manual',
                            source_reference_id VARCHAR(100),
                            notes TEXT DEFAULT '',
                            created_by VARCHAR(120) DEFAULT 'Sistema',
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_item ON zenith_inventory_movements(item_id)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON zenith_inventory_movements(movement_type)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_ref ON zenith_inventory_movements(source_module, source_reference_id)")
                else:
                    tx.execute("""
                        CREATE TABLE IF NOT EXISTS zenith_inventory_movements (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            item_id INTEGER NOT NULL,
                            movement_type TEXT NOT NULL,
                            quantity REAL NOT NULL,
                            stock_before REAL NOT NULL,
                            stock_after REAL NOT NULL,
                            unit_cost REAL DEFAULT 0.0,
                            total_cost REAL DEFAULT 0.0,
                            source_module TEXT DEFAULT 'manual',
                            source_reference_id TEXT,
                            notes TEXT DEFAULT '',
                            created_by TEXT DEFAULT 'Sistema',
                            created_at TEXT DEFAULT (datetime('now')),
                            FOREIGN KEY (item_id) REFERENCES zenith_inventory_items(id) ON DELETE CASCADE
                        )
                    """)
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_item ON zenith_inventory_movements(item_id)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON zenith_inventory_movements(movement_type)")
                    tx.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_ref ON zenith_inventory_movements(source_module, source_reference_id)")

            self._tables_initialized = True
            logger.info("✅ Tablas de Inventario & Insumos verificadas e inicializadas.")

    # ------------------------------------------------------------------
    # GESTIÓN DE ARTÍCULOS
    # ------------------------------------------------------------------
    def get_items(
        self,
        category: Optional[str] = None,
        item_type: Optional[str] = None,
        search: Optional[str] = None,
        low_stock_only: bool = False,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        self.init_tables()
        where = ["is_active IS TRUE" if is_active else "is_active IS FALSE"]
        params = []

        if category and category != "all":
            where.append("category = ?")
            params.append(category)

        if item_type and item_type != "all":
            where.append("item_type = ?")
            params.append(item_type)

        if search:
            where.append("(LOWER(name) LIKE ? OR LOWER(COALESCE(sku, '')) LIKE ?)")
            q = f"%{search.strip().lower()}%"
            params.extend([q, q])

        if low_stock_only:
            where.append("track_stock IS TRUE AND current_stock <= min_stock")

        sql = f"SELECT * FROM zenith_inventory_items WHERE {' AND '.join(where)} ORDER BY name ASC"
        with self._tx() as tx:
            rows = tx.execute(sql, tuple(params)).all()
            for r in rows:
                r["cost_price"] = _num(r.get("cost_price"))
                r["selling_price"] = _num(r.get("selling_price"))
                r["current_stock"] = _num(r.get("current_stock"))
                r["min_stock"] = _num(r.get("min_stock"))
                r["is_low_stock"] = bool(r.get("track_stock") and r["current_stock"] <= r["min_stock"])
                r["is_out_of_stock"] = bool(r.get("track_stock") and r["current_stock"] <= 0)
            return rows

    def get_item(self, item_id: int) -> Optional[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            row = tx.execute("SELECT * FROM zenith_inventory_items WHERE id = ?", (item_id,)).one()
            if not row:
                return None
            row["cost_price"] = _num(row.get("cost_price"))
            row["selling_price"] = _num(row.get("selling_price"))
            row["current_stock"] = _num(row.get("current_stock"))
            row["min_stock"] = _num(row.get("min_stock"))
            row["is_low_stock"] = bool(row.get("track_stock") and row["current_stock"] <= row["min_stock"])
            row["is_out_of_stock"] = bool(row.get("track_stock") and row["current_stock"] <= 0)
            return row

    def _sync_to_restaurant_menu(self, item: Dict[str, Any], action: str = "save") -> None:
        """
        Sincroniza un ítem comercial/plato creado o editado en Inventario hacia Restaurante.
        TOTALMENTE DESACOPLADO: Si el módulo restaurant no está cargado o instalado,
        no hace nada y no bloquea el inventario.
        IMPORTANTE: Las materias primas e insumos internos NUNCA se sincronizan a la carta.
        """
        try:
            # Las materias primas (carne molida, pan, queso) jamás van al menú de clientes
            if item.get("item_type") == "raw_material":
                return

            from modules.registry import module_registry
            from services.db_service import db_service
            if "restaurant" not in module_registry.get_installed(db_service):
                return
            from modules.restaurant.service import restaurant_service
            from modules.restaurant.models import MenuItemCreate, MenuItemUpdate

            item_id = item.get("id")
            rest_id = item.get("restaurant_item_id")
            name = (item.get("name") or "").strip()
            cat = (item.get("category") or "General").strip()
            price = _num(item.get("selling_price", 0.0))
            description = (item.get("description") or "").strip()
            image_url = (item.get("image_url") or "").strip()

            if action == "save":
                if rest_id:
                    restaurant_service.update_menu_item(rest_id, MenuItemUpdate(
                        name=name,
                        description=description,
                        category=cat,
                        price=price,
                        image_url=image_url
                    ))
                else:
                    created = restaurant_service.add_menu_item(MenuItemCreate(
                        name=name,
                        description=description,
                        category=cat,
                        price=price,
                        image_url=image_url,
                        available=True
                    ))
                    if created and created.get("id"):
                        with self._tx() as tx:
                            tx.execute(
                                "UPDATE zenith_inventory_items SET restaurant_item_id = ? WHERE id = ?",
                                (created["id"], item_id)
                            )
            elif action == "delete":
                if rest_id:
                    restaurant_service.delete_menu_item(rest_id)
        except Exception as e:
            logger.debug(f"Aviso en sincronización Inventario -> Restaurante: {e}")

    def create_item(self, data: Dict[str, Any], user: str = "Sistema") -> Dict[str, Any]:
        self.init_tables()
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError("El nombre del artículo es obligatorio.")

        item_type = data.get("item_type") or "product"
        if item_type not in ("product", "raw_material", "composite"):
            item_type = "product"

        unit = (data.get("unit") or "pza").strip().lower()
        cost_price = _num(data.get("cost_price"))
        selling_price = _num(data.get("selling_price"))
        initial_stock = _num(data.get("initial_stock"))
        min_stock = _num(data.get("min_stock"))
        track_stock = bool(data.get("track_stock", True))
        category = (data.get("category") or "General").strip()
        sku = (data.get("sku") or "").strip() or None
        description = (data.get("description") or "").strip()
        image_url = (data.get("image_url") or "").strip()
        restaurant_item_id = data.get("restaurant_item_id")

        now = _ts()
        with self._tx() as tx:
            new_id = tx.insert(
                """
                INSERT INTO zenith_inventory_items (
                    sku, name, description, category, item_type, unit,
                    cost_price, selling_price, current_stock, min_stock,
                    track_stock, image_url, is_active, restaurant_item_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (sku, name, description, category, item_type, unit,
                 cost_price, selling_price, initial_stock, min_stock,
                 track_stock, image_url, True, restaurant_item_id, now, now)
            )

            if initial_stock != 0:
                tx.execute(
                    """
                    INSERT INTO zenith_inventory_movements (
                        item_id, movement_type, quantity, stock_before, stock_after,
                        unit_cost, total_cost, source_module, notes, created_by, created_at
                    ) VALUES (?, 'initial', ?, 0.0, ?, ?, ?, 'manual', 'Stock inicial al crear artículo', ?, ?)
                    """,
                    (new_id, initial_stock, initial_stock, cost_price,
                     _num(initial_stock * cost_price), user, now)
                )

        created_item = self.get_item(new_id)
        if item_type in ("composite", "product") and not restaurant_item_id:
            self._sync_to_restaurant_menu(created_item, action="save")
            created_item = self.get_item(new_id)
        return created_item

    def update_item(self, item_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        self.init_tables()
        current = self.get_item(item_id)
        if not current:
            raise LookupError("Artículo no encontrado.")

        fields = []
        params = []
        for key in ("name", "sku", "description", "category", "item_type", "unit", "image_url", "restaurant_item_id"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(str(data[key]).strip() if isinstance(data[key], str) else data[key])

        for key in ("cost_price", "selling_price", "min_stock"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(_num(data[key]))

        for key in ("track_stock", "is_active"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(bool(data[key]))

        if not fields:
            return current

        fields.append("updated_at = ?")
        params.append(_ts())
        params.append(item_id)

        sql = f"UPDATE zenith_inventory_items SET {', '.join(fields)} WHERE id = ?"
        with self._tx() as tx:
            tx.execute(sql, tuple(params))

        updated = self.get_item(item_id)
        if updated.get("restaurant_item_id") or updated.get("item_type") in ("composite", "product"):
            self._sync_to_restaurant_menu(updated, action="save")
            updated = self.get_item(item_id)
        return updated

    def delete_item(self, item_id: int) -> bool:
        self.init_tables()
        item = self.get_item(item_id)
        with self._tx() as tx:
            # Si tiene movimientos en el Kardex, se hace soft-delete para no romper la auditoría
            count_row = tx.execute("SELECT COUNT(*) as c FROM zenith_inventory_movements WHERE item_id = ?", (item_id,)).one()
            has_movements = bool(count_row and count_row.get("c", 0) > 0)
            if has_movements:
                tx.execute("UPDATE zenith_inventory_items SET is_active = FALSE, updated_at = ? WHERE id = ?", (_ts(), item_id))
            else:
                tx.execute("DELETE FROM zenith_inventory_recipes WHERE composite_item_id = ? OR ingredient_item_id = ?", (item_id, item_id))
                tx.execute("DELETE FROM zenith_inventory_items WHERE id = ?", (item_id,))
        if item and item.get("restaurant_item_id"):
            self._sync_to_restaurant_menu(item, action="delete")
        return True

    # ------------------------------------------------------------------
    # MOVIMIENTOS: AJUSTES, COMPRAS, MERMAS
    # ------------------------------------------------------------------
    def adjust_stock(self, item_id: int, new_stock: float, reason: str, notes: str = "", user: str = "Sistema") -> Dict[str, Any]:
        self.init_tables()
        with self._tx() as tx:
            item = tx.execute("SELECT * FROM zenith_inventory_items WHERE id = ?", (item_id,)).one()
            if not item:
                raise LookupError("Artículo no encontrado.")

            stock_before = _num(item.get("current_stock"))
            stock_after = _num(new_stock)
            diff = _num(stock_after - stock_before)
            now = _ts()
            unit_cost = _num(item.get("cost_price"))
            total_cost = _num(abs(diff) * unit_cost)

            tx.execute(
                "UPDATE zenith_inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?",
                (stock_after, now, item_id)
            )

            tx.execute(
                """
                INSERT INTO zenith_inventory_movements (
                    item_id, movement_type, quantity, stock_before, stock_after,
                    unit_cost, total_cost, source_module, notes, created_by, created_at
                ) VALUES (?, 'adjustment', ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
                """,
                (item_id, diff, stock_before, stock_after, unit_cost, total_cost,
                 f"{reason}: {notes}".strip(": "), user, now)
            )

        return self.get_item(item_id)

    def record_purchase(
        self,
        item_id: int,
        quantity: float,
        unit_cost: float,
        supplier: str = "",
        invoice_ref: str = "",
        payment_method: str = "cash",
        create_finance_expense: bool = True,
        notes: str = "",
        user: str = "Sistema"
    ) -> Dict[str, Any]:
        """Registra compra/entrada de inventario, recalcula costo y opcionalmente crea egreso en Finanzas."""
        self.init_tables()
        qty = _num(quantity)
        cost = _num(unit_cost)
        if qty <= 0:
            raise ValueError("La cantidad debe ser mayor a cero.")

        total_cost = _num(qty * cost)

        with self._tx() as tx:
            item = tx.execute("SELECT * FROM zenith_inventory_items WHERE id = ?", (item_id,)).one()
            if not item:
                raise LookupError("Artículo no encontrado.")

            stock_before = _num(item.get("current_stock"))
            stock_after = _num(stock_before + qty)
            now = _ts()

            # Costo promedio ponderado si ya existía stock
            old_cost = _num(item.get("cost_price"))
            if stock_before > 0:
                new_avg_cost = _num(((stock_before * old_cost) + total_cost) / stock_after)
            else:
                new_avg_cost = cost

            tx.execute(
                "UPDATE zenith_inventory_items SET current_stock = ?, cost_price = ?, updated_at = ? WHERE id = ?",
                (stock_after, new_avg_cost, now, item_id)
            )

            note_text = f"Proveedor: {supplier}" if supplier else ""
            if invoice_ref:
                note_text = f"{note_text} | Factura: {invoice_ref}".strip(" | ")
            if notes:
                note_text = f"{note_text} | {notes}".strip(" | ")

            mov_id = tx.insert(
                """
                INSERT INTO zenith_inventory_movements (
                    item_id, movement_type, quantity, stock_before, stock_after,
                    unit_cost, total_cost, source_module, source_reference_id, notes, created_by, created_at
                ) VALUES (?, 'purchase', ?, ?, ?, ?, ?, 'inventory', ?, ?, ?, ?)
                """,
                (item_id, qty, stock_before, stock_after, cost, total_cost,
                 invoice_ref or f"purchase_{int(datetime.now().timestamp())}", note_text, user, now)
            )

        # Enlace automático a Finanzas: registra el gasto en caja chica si está activo
        if create_finance_expense and total_cost > 0:
            try:
                from modules.finance.service import finance_service
                finance_service.record_transaction(
                    type="expense",
                    category="supplies",
                    amount=total_cost,
                    payment_method=payment_method or "cash",
                    source_module="inventory",
                    source_reference_id=f"inv_purchase_{mov_id}",
                    description=f"Compra de insumo: {item['name']} ({qty} {item.get('unit', 'pza')})",
                    created_by=user
                )
            except Exception as e:
                logger.warning(f"Aviso al enlazar compra con Finanzas: {e}")

        return self.get_item(item_id)

    def record_waste(
        self,
        item_id: int,
        quantity: float,
        reason: str = "caducidad",
        notes: str = "",
        user: str = "Sistema"
    ) -> Dict[str, Any]:
        """Registra merma o desperdicio de insumo y actualiza el stock."""
        self.init_tables()
        qty = _num(quantity)
        if qty <= 0:
            raise ValueError("La cantidad debe ser mayor a cero.")

        with self._tx() as tx:
            item = tx.execute("SELECT * FROM zenith_inventory_items WHERE id = ?", (item_id,)).one()
            if not item:
                raise LookupError("Artículo no encontrado.")

            stock_before = _num(item.get("current_stock"))
            stock_after = _num(max(0.0, stock_before - qty))
            unit_cost = _num(item.get("cost_price"))
            total_loss = _num(qty * unit_cost)
            now = _ts()

            tx.execute(
                "UPDATE zenith_inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?",
                (stock_after, now, item_id)
            )

            full_notes = f"Merma ({reason})"
            if notes:
                full_notes = f"{full_notes}: {notes}"

            tx.execute(
                """
                INSERT INTO zenith_inventory_movements (
                    item_id, movement_type, quantity, stock_before, stock_after,
                    unit_cost, total_cost, source_module, notes, created_by, created_at
                ) VALUES (?, 'waste', ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
                """,
                (item_id, -qty, stock_before, stock_after, unit_cost, total_loss, full_notes, user, now)
            )

        return self.get_item(item_id)

    # ------------------------------------------------------------------
    # RECETAS / FICHAS TÉCNICAS (BOM)
    # ------------------------------------------------------------------
    def get_recipe(self, composite_item_id: int) -> List[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            rows = tx.execute(
                """
                SELECT r.id, r.composite_item_id, r.ingredient_item_id, r.quantity, r.unit,
                       i.name as ingredient_name, i.current_stock, i.unit as ingredient_unit,
                       i.cost_price as ingredient_cost
                FROM zenith_inventory_recipes r
                JOIN zenith_inventory_items i ON i.id = r.ingredient_item_id
                WHERE r.composite_item_id = ?
                ORDER BY i.name ASC
                """,
                (composite_item_id,)
            ).all()

            for r in rows:
                r["quantity"] = _num(r.get("quantity"))
                r["current_stock"] = _num(r.get("current_stock"))
                r["ingredient_cost"] = _num(r.get("ingredient_cost"))
                r["subtotal_cost"] = _num(r["quantity"] * r["ingredient_cost"])
            return rows

    def get_all_recipes(self) -> List[Dict[str, Any]]:
        """Retorna todos los ítems compuestos que tienen receta configurada."""
        self.init_tables()
        with self._tx() as tx:
            composites = tx.execute(
                """
                SELECT id, name, description, category, unit, selling_price, cost_price, current_stock, image_url, restaurant_item_id
                FROM zenith_inventory_items
                WHERE item_type = 'composite' AND is_active IS TRUE
                ORDER BY name ASC
                """
            ).all()

            results = []
            for c in composites:
                c["ingredients"] = self.get_recipe(c["id"])
                c["calculated_cost"] = _num(sum(ing["subtotal_cost"] for ing in c["ingredients"]))
                results.append(c)
            return results

    def set_recipe(self, composite_item_id: int, ingredients: List[Dict[str, Any]], metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Reemplaza la receta de un producto o plato compuesto y opcionalmente actualiza su presentación comercial."""
        self.init_tables()
        with self._tx() as tx:
            comp = tx.execute("SELECT id, item_type FROM zenith_inventory_items WHERE id = ?", (composite_item_id,)).one()
            if not comp:
                raise LookupError("Producto compuesto no encontrado.")

            tx.execute("DELETE FROM zenith_inventory_recipes WHERE composite_item_id = ?", (composite_item_id,))

            total_recipe_cost = Decimal("0.00")
            now = _ts()

            for ing in ingredients:
                ing_id = int(ing["ingredient_item_id"])
                qty = _num(ing["quantity"])
                if qty <= 0:
                    continue

                ing_item = tx.execute("SELECT cost_price, unit FROM zenith_inventory_items WHERE id = ?", (ing_id,)).one()
                unit = (ing.get("unit") or (ing_item["unit"] if ing_item else "pza")).strip().lower()

                tx.execute(
                    """
                    INSERT INTO zenith_inventory_recipes (composite_item_id, ingredient_item_id, quantity, unit, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (composite_item_id, ing_id, qty, unit, now)
                )

                if ing_item:
                    cost = _num(ing_item.get("cost_price"))
                    total_recipe_cost += Decimal(str(qty * cost))

            # Actualiza el costo unitario del plato compuesto con la suma de sus ingredientes
            tx.execute(
                "UPDATE zenith_inventory_items SET cost_price = ?, updated_at = ? WHERE id = ?",
                (_num(total_recipe_cost), now, composite_item_id)
            )

        # Si se enviaron metadatos comerciales (nombre, descripción, categoría, precio, foto), actualizar el ítem
        if metadata:
            update_data = {}
            for k in ("name", "description", "category", "selling_price", "image_url"):
                if k in metadata and metadata[k] is not None:
                    update_data[k] = metadata[k]
            if update_data:
                self.update_item(composite_item_id, update_data)
        else:
            # Re-sincronizar plato al menú con el costo calculado actualizado
            updated_item = self.get_item(composite_item_id)
            if updated_item:
                self._sync_to_restaurant_menu(updated_item, action="save")

        return self.get_recipe(composite_item_id)

    # ------------------------------------------------------------------
    # ENLACE AUTOMÁTICO CON RESTAURANTE (DEDUCCIÓN DE COMANDAS)
    # ------------------------------------------------------------------
    def deduct_order(self, order: Dict[str, Any]) -> None:
        """Deduce automáticamente insumos de recetas o productos de reventa cuando se confirma/cobra una orden."""
        self.init_tables()
        order_id = order.get("id")
        items = order.get("items") or []
        if not items or not order_id:
            return

        ref_id = f"order_{order_id}"
        now = _ts()

        with self._tx() as tx:
            # Evita deducciones dobles para la misma orden
            already = tx.execute(
                "SELECT id FROM zenith_inventory_movements WHERE source_module = 'restaurant' AND source_reference_id = ? LIMIT 1",
                (ref_id,)
            ).one()
            if already:
                return

            for it in items:
                ordered_qty = _num(it.get("quantity") or 1)
                item_name = (it.get("item_name") or it.get("name") or "").strip()
                item_id = it.get("item_id")

                # Buscar en catálogo por restaurant_item_id o por nombre exacto
                inv_item = None
                if item_id:
                    inv_item = tx.execute(
                        "SELECT * FROM zenith_inventory_items WHERE restaurant_item_id = ? AND is_active IS TRUE",
                        (item_id,)
                    ).one()
                if not inv_item and item_name:
                    inv_item = tx.execute(
                        "SELECT * FROM zenith_inventory_items WHERE LOWER(name) = ? AND is_active IS TRUE",
                        (item_name.lower(),)
                    ).one()

                if not inv_item:
                    continue

                # Caso 1: Tiene Receta (Compuesto / Plato elaborado)
                recipe_ingredients = tx.execute(
                    """
                    SELECT r.ingredient_item_id, r.quantity, i.name, i.current_stock, i.cost_price, i.track_stock
                    FROM zenith_inventory_recipes r
                    JOIN zenith_inventory_items i ON i.id = r.ingredient_item_id
                    WHERE r.composite_item_id = ?
                    """,
                    (inv_item["id"],)
                ).all()

                if recipe_ingredients:
                    for ing in recipe_ingredients:
                        if not ing.get("track_stock", 1):
                            continue
                        ing_id = ing["ingredient_item_id"]
                        deduct_qty = _num(ordered_qty * _num(ing["quantity"]))
                        stock_before = _num(ing["current_stock"])
                        stock_after = _num(stock_before - deduct_qty)
                        unit_cost = _num(ing["cost_price"])
                        total_cost = _num(deduct_qty * unit_cost)

                        tx.execute(
                            "UPDATE zenith_inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?",
                            (stock_after, now, ing_id)
                        )
                        tx.execute(
                            """
                            INSERT INTO zenith_inventory_movements (
                                item_id, movement_type, quantity, stock_before, stock_after,
                                unit_cost, total_cost, source_module, source_reference_id, notes, created_by, created_at
                            ) VALUES (?, 'sale', ?, ?, ?, ?, ?, 'restaurant', ?, ?, 'Restaurante', ?)
                            """,
                            (ing_id, -deduct_qty, stock_before, stock_after, unit_cost, total_cost,
                             ref_id, f"Venta orden #{order_id}: plato '{inv_item['name']}'", now)
                        )
                elif inv_item.get("track_stock", 1):
                    # Caso 2: Producto directo de reventa (Lata de soda, cerveza, snack)
                    stock_before = _num(inv_item["current_stock"])
                    stock_after = _num(stock_before - ordered_qty)
                    unit_cost = _num(inv_item["cost_price"])
                    total_cost = _num(ordered_qty * unit_cost)

                    tx.execute(
                        "UPDATE zenith_inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?",
                        (stock_after, now, inv_item["id"])
                    )
                    tx.execute(
                        """
                        INSERT INTO zenith_inventory_movements (
                            item_id, movement_type, quantity, stock_before, stock_after,
                            unit_cost, total_cost, source_module, source_reference_id, notes, created_by, created_at
                        ) VALUES (?, 'sale', ?, ?, ?, ?, ?, 'restaurant', ?, ?, 'Restaurante', ?)
                        """,
                        (inv_item["id"], -ordered_qty, stock_before, stock_after, unit_cost, total_cost,
                         ref_id, f"Venta directa orden #{order_id}", now)
                    )

    def void_order_deductions(self, order_id: int) -> None:
        """Revierte las deducciones de una orden si es cancelada o reembolsada."""
        self.init_tables()
        ref_id = f"order_{order_id}"
        with self._tx() as tx:
            movs = tx.execute(
                "SELECT * FROM zenith_inventory_movements WHERE source_module = 'restaurant' AND source_reference_id = ?",
                (ref_id,)
            ).all()

            now = _ts()
            for m in movs:
                # La cantidad guardada era negativa (-deduct_qty), por lo que restar -qty equivale a sumar
                restore_qty = abs(_num(m["quantity"]))
                item_id = m["item_id"]
                item = tx.execute("SELECT current_stock FROM zenith_inventory_items WHERE id = ?", (item_id,)).one()
                if item:
                    new_stock = _num(item["current_stock"]) + restore_qty
                    tx.execute("UPDATE zenith_inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, item_id))

            # Elimina los movimientos de la orden para que no queden duplicados
            tx.execute("DELETE FROM zenith_inventory_movements WHERE source_module = 'restaurant' AND source_reference_id = ?", (ref_id,))

    # ------------------------------------------------------------------
    # HISTORIAL DE KARDEX & AUDITORÍA
    # ------------------------------------------------------------------
    def get_movements(
        self,
        item_id: Optional[int] = None,
        movement_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        self.init_tables()
        where = ["1=1"]
        params = []

        if item_id:
            where.append("m.item_id = ?")
            params.append(item_id)

        if movement_type and movement_type != "all":
            where.append("m.movement_type = ?")
            params.append(movement_type)

        params.extend([limit, offset])
        sql = f"""
            SELECT m.*, i.name as item_name, i.unit as item_unit, i.item_type
            FROM zenith_inventory_movements m
            JOIN zenith_inventory_items i ON i.id = m.item_id
            WHERE {' AND '.join(where)}
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT ? OFFSET ?
        """
        with self._tx() as tx:
            rows = tx.execute(sql, tuple(params)).all()
            for r in rows:
                r["quantity"] = _num(r.get("quantity"))
                r["stock_before"] = _num(r.get("stock_before"))
                r["stock_after"] = _num(r.get("stock_after"))
                r["unit_cost"] = _num(r.get("unit_cost"))
                r["total_cost"] = _num(r.get("total_cost"))
            return rows

    # ------------------------------------------------------------------
    # MÉTRICAS Y ALERTAS
    # ------------------------------------------------------------------
    def get_stats(self) -> Dict[str, Any]:
        self.init_tables()
        with self._tx() as tx:
            items = tx.execute("SELECT * FROM zenith_inventory_items WHERE is_active IS TRUE").all()

            total_items = len(items)
            raw_materials = sum(1 for i in items if i.get("item_type") == "raw_material")
            products = sum(1 for i in items if i.get("item_type") == "product")
            composites = sum(1 for i in items if i.get("item_type") == "composite")

            total_valuation = sum(_num(i.get("current_stock")) * _num(i.get("cost_price")) for i in items)
            low_stock_count = sum(1 for i in items if i.get("track_stock") and _num(i.get("current_stock")) <= _num(i.get("min_stock")))
            out_of_stock_count = sum(1 for i in items if i.get("track_stock") and _num(i.get("current_stock")) <= 0)

            # Mermas del mes
            start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            waste_row = tx.execute(
                """
                SELECT SUM(total_cost) as total_waste
                FROM zenith_inventory_movements
                WHERE movement_type = 'waste' AND created_at >= ?
                """,
                (_ts(start_of_month),)
            ).one()
            month_waste = _num(waste_row.get("total_waste")) if waste_row else 0.0

            return {
                "total_items": total_items,
                "raw_materials_count": raw_materials,
                "products_count": products,
                "composites_count": composites,
                "total_valuation": _num(total_valuation),
                "low_stock_count": low_stock_count,
                "out_of_stock_count": out_of_stock_count,
                "month_waste_total": month_waste
            }

    def get_low_stock_items(self) -> List[Dict[str, Any]]:
        self.init_tables()
        with self._tx() as tx:
            rows = tx.execute(
                """
                SELECT id, name, item_type, unit, current_stock, min_stock, cost_price
                FROM zenith_inventory_items
                WHERE is_active IS TRUE AND track_stock IS TRUE AND current_stock <= min_stock
                ORDER BY current_stock ASC
                """
            ).all()
            for r in rows:
                r["current_stock"] = _num(r.get("current_stock"))
                r["min_stock"] = _num(r.get("min_stock"))
                r["cost_price"] = _num(r.get("cost_price"))
            return rows

    def sync_restaurant_item(self, item_data: Any, action: str = "save") -> Optional[int]:
        """
        Sincroniza en tiempo real un plato o bebida del Restaurante con Inventario.
        - Si action es 'delete': desactiva el ítem en inventario conservando historial.
        - Si action es 'save'/'create'/'update': crea o actualiza el producto/receta.
        """
        try:
            self.init_tables()
            item_dict = item_data if isinstance(item_data, dict) else (
                item_data.model_dump() if hasattr(item_data, "model_dump") else dict(item_data)
            )
            item_id = item_dict.get("id")
            name = (item_dict.get("name") or "").strip()
            cat = (item_dict.get("category") or "General").strip()
            price = _num(item_dict.get("price"))
            now = _ts()

            with self._tx() as tx:
                if action == "delete":
                    if item_id:
                        tx.execute(
                            "UPDATE zenith_inventory_items SET is_active = ?, updated_at = ? WHERE restaurant_item_id = ?",
                            (False, now, item_id)
                        )
                    return None

                existing = None
                if item_id:
                    existing = tx.execute(
                        "SELECT id, item_type FROM zenith_inventory_items WHERE restaurant_item_id = ?",
                        (item_id,)
                    ).one()
                if not existing and name:
                    existing = tx.execute(
                        "SELECT id, item_type FROM zenith_inventory_items WHERE LOWER(name) = ?",
                        (name.lower(),)
                    ).one()

                if existing:
                    tx.execute(
                        """
                        UPDATE zenith_inventory_items
                        SET name = ?, category = ?, selling_price = ?, restaurant_item_id = ?, is_active = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (name, cat, price, item_id, True, now, existing["id"])
                    )
                    return existing["id"]
                else:
                    is_drink = any(w in name.lower() or w in cat.lower() for w in ("soda", "coca", "bebida", "cerveza", "agua", "jugo", "refresco"))
                    item_type = "product" if is_drink else "composite"
                    sku = f"REST-{item_id}" if item_id else None

                    new_id = tx.insert(
                        """
                        INSERT INTO zenith_inventory_items (
                            name, sku, category, item_type, unit, cost_price, selling_price,
                            current_stock, min_stock, track_stock, is_active, restaurant_item_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'pza', 0.0, ?, 0.0, 5.0, ?, ?, ?, ?, ?)
                        """,
                        (name, sku, cat, item_type, price, True, True, item_id, now, now)
                    )
                    return new_id
        except Exception as e:
            logger.warning(f"Error sincronizando ítem de restaurante con inventario: {e}")
            return None

    def check_availability(self, restaurant_item_id: int, quantity: float = 1.0) -> Tuple[bool, str, float]:
        """
        Verifica si un plato o producto de restaurante puede venderse según el stock real en inventario.
        Retorna (is_available, reason, available_quantity).
        - Si es producto terminado (product): verifica que zenith_inventory_items.current_stock >= quantity.
        - Si es compuesto (composite):
            - Si tiene receta configurada: verifica que cada insumo/materia prima tenga stock suficiente para preparar 'quantity'.
            - Si NO tiene receta ni stock físico directo registrado: retorna False (Stock: 0).
        """
        self.init_tables()
        with self._tx() as tx:
            item = tx.execute(
                "SELECT * FROM zenith_inventory_items WHERE restaurant_item_id = ? AND is_active IS TRUE",
                (restaurant_item_id,)
            ).one()
            if not item:
                return False, "Artículo no registrado en inventario (Stock: 0)", 0.0

            item_type = item.get("item_type") or "composite"
            curr_stock = _num(item.get("current_stock"))

            # Si es producto de reventa directa
            if item_type == "product":
                if curr_stock <= 0:
                    return False, "Sin stock en inventario (Stock: 0)", 0.0
                if curr_stock < quantity:
                    return False, f"Solo quedan {curr_stock:g} unidades en inventario", curr_stock
                return True, "Disponible", curr_stock

            # Si es plato compuesto / elaborado
            recipes = tx.execute(
                """
                SELECT r.quantity as req_qty, i.name as ing_name, i.current_stock as ing_stock, i.unit as ing_unit
                FROM zenith_inventory_recipes r
                JOIN zenith_inventory_items i ON i.id = r.ingredient_item_id
                WHERE r.composite_item_id = ?
                """,
                (item["id"],)
            ).all()

            if not recipes:
                # No se ha configurado receta: si no se le ha cargado stock físico directo, sale a 0
                if curr_stock <= 0:
                    return False, "Sin receta configurada ni stock en inventario (Stock: 0)", 0.0
                if curr_stock < quantity:
                    return False, f"Solo quedan {curr_stock:g} unidades en inventario", curr_stock
                return True, "Disponible", curr_stock

            # Verificar disponibilidad de cada insumo en la receta
            max_producible = float("inf")
            for r in recipes:
                req_per_unit = _num(r["req_qty"])
                ing_stock = _num(r["ing_stock"])
                total_needed = req_per_unit * quantity
                if total_needed > 0:
                    producible = ing_stock / req_per_unit
                    if producible < max_producible:
                        max_producible = producible
                if ing_stock <= 0 or ing_stock < total_needed:
                    return (
                        False,
                        f"Insumo «{r['ing_name']}» insuficiente para preparar el pedido (Disponible: {ing_stock:g} {r['ing_unit']}, Requerido: {total_needed:g} {r['ing_unit']})",
                        max(0.0, max_producible)
                    )

            return True, "Disponible", max_producible

    def sync_from_restaurant_menu(self) -> int:
        """Importa automáticamente los platos del menú del restaurante que no existan en inventario."""
        self.init_tables()
        imported = 0
        with self._tx() as tx:
            # Revisa si la tabla restaurant_menu existe
            check = tx.execute(
                "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_name = 'restaurant_menu'"
                if tx.is_pg else
                "SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='restaurant_menu'"
            ).one()
            if not check or check.get("c", 0) == 0:
                return 0

            menu_items = tx.execute(
                "SELECT * FROM restaurant_menu WHERE available IS TRUE" if tx.is_pg else "SELECT * FROM restaurant_menu WHERE available = 1"
            ).all()
            now = _ts()
            for m in menu_items:
                m_id = m["id"]
                name = m["name"].strip()
                cat = m.get("category") or "General"
                price = _num(m.get("price"))

                exists = tx.execute(
                    "SELECT id FROM zenith_inventory_items WHERE restaurant_item_id = ? OR LOWER(name) = ?",
                    (m_id, name.lower())
                ).one()
                if not exists:
                    is_drink = any(w in name.lower() or w in cat.lower() for w in ("soda", "coca", "bebida", "cerveza", "agua", "jugo", "refresco"))
                    item_type = "product" if is_drink else "composite"
                    sku = f"REST-{m_id}"
                    initial_stock = _num(m.get("stock")) if m.get("stock") is not None else 0.0

                    tx.insert(
                        """
                        INSERT INTO zenith_inventory_items (
                            name, sku, category, item_type, unit, cost_price, selling_price,
                            current_stock, min_stock, track_stock, is_active, restaurant_item_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'pza', 0.0, ?, ?, 5.0, ?, ?, ?, ?, ?)
                        """,
                        (name, sku, cat, item_type, price, initial_stock, True, True, m_id, now, now)
                    )
                    # Con inventario activo, si en restaurante el stock era null o 0, se sincroniza a 0 hasta que se ingrese stock
                    tx.execute("UPDATE restaurant_menu SET stock = ? WHERE id = ?", (int(initial_stock), m_id))
                    imported += 1
                else:
                    tx.execute(
                        "UPDATE zenith_inventory_items SET restaurant_item_id = ?, selling_price = ?, updated_at = ? WHERE id = ?",
                        (m_id, price, now, exists["id"])
                    )

        return imported


inventory_service = InventoryService()
