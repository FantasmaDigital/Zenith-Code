"""Lógica y datos del módulo de Tarjetas de Fidelidad.

Independiente del ARM: no importa nada del agente, WhatsApp ni clientes. Cada empresa guarda sus tablas en su
propia base/esquema (el contexto de empresa lo resuelve db_service).
"""
import logging
import math
import re
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.tenant_service import TenantReadyMixin

logger = logging.getLogger("asistente_operativo.modules.loyalty")

_init_lock = threading.Lock()
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O ni 1/I para dictarlo en mostrador
CODE_LEN = 8
CODE_TTL_MINUTES = 10           # vigencia del código de verificación enviado al cliente
CODE_MAX_ATTEMPTS = 5           # intentos fallidos antes de pedir un código nuevo
CODE_RESEND_SECONDS = 60        # espera para pedir otro código al mismo contacto
CODE_MAX_PER_HOUR = 5           # códigos por contacto y hora (evita usar la plataforma para spam)
REQUEST_TTL_MINUTES = 5         # la solicitud de sello vence si nadie en caja la aprueba
REQUEST_CODE_ALPHABET = "ACDEFHJKLMNPRTUVWXY34679"  # código corto que el cajero compara en la pantalla del cliente
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
DEFAULT_STAMP_COOLDOWN_MIN = 60  # espera mínima entre dos sellos de la misma tarjeta


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_phone(raw: Optional[str]) -> str:
    return re.sub(r"\D", "", raw or "")[:20]


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


class _Tx:
    """Conexión de la empresa en curso con placeholders `?` para SQLite y PostgreSQL."""

    def __init__(self, raw, is_pg: bool):
        self.raw = raw
        self.is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()):
        if self.is_pg:
            cur = self.raw.cursor()
            cur.execute(sql.replace("?", "%s"), params)
        else:
            cur = self.raw.execute(sql, params)
        return cur

    def all(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        cur = self.execute(sql, params)
        if cur.description is None:
            return []
        names = [d[0] for d in cur.description]
        return [dict(zip(names, tuple(r))) for r in cur.fetchall()]

    def one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def insert(self, sql: str, params: tuple = ()) -> int:
        if self.is_pg:
            return self.one(sql + " RETURNING id", params)["id"]
        return self.execute(sql, params).lastrowid


class LoyaltyError(ValueError):
    """Error de negocio (saldo insuficiente, tarjeta bloqueada...)."""


class LoyaltyService(TenantReadyMixin):
    def __init__(self):
        self._db = None

    def _get_db(self):
        if self._db is None:
            from services.db_service import db_service
            self._db = db_service
        return self._db

    @contextmanager
    def _tx(self):
        self.init_tables()
        with self._raw_tx() as tx:
            yield tx

    @contextmanager
    def _raw_tx(self):
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
    # TABLAS
    # ------------------------------------------------------------------
    def init_tables(self, db_service=None) -> None:
        """Crea las tablas en la empresa en curso (una vez por empresa)."""
        if self._ready:
            return
        with _init_lock:
            if self._ready:
                return
            with self._raw_tx() as tx:
                pk = "SERIAL PRIMARY KEY" if tx.is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
                real = "NUMERIC(14, 2)" if tx.is_pg else "REAL"
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_programs (
                    id {pk},
                    name VARCHAR(120) NOT NULL,
                    kind VARCHAR(10) NOT NULL DEFAULT 'points',
                    points_per_currency {real} DEFAULT 1,
                    stamps_goal INTEGER DEFAULT 10,
                    reward_description VARCHAR(300) DEFAULT '',
                    expiry_days INTEGER DEFAULT 0,
                    terms TEXT DEFAULT '',
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at VARCHAR(40))""")
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_cards (
                    id {pk},
                    program_id INTEGER NOT NULL,
                    code VARCHAR(20) NOT NULL UNIQUE,
                    public_token VARCHAR(64) NOT NULL UNIQUE,
                    customer_name VARCHAR(160) NOT NULL,
                    phone VARCHAR(30) DEFAULT '',
                    email VARCHAR(160) DEFAULT '',
                    notes VARCHAR(500) DEFAULT '',
                    balance INTEGER NOT NULL DEFAULT 0,
                    lifetime_earned INTEGER NOT NULL DEFAULT 0,
                    lifetime_redeemed INTEGER NOT NULL DEFAULT 0,
                    status VARCHAR(10) NOT NULL DEFAULT 'active',
                    created_at VARCHAR(40),
                    last_activity_at VARCHAR(40))""")
                self._add_column(tx, "zenith_loyalty_cards", "last_stamp_at", "VARCHAR(40)")
                self._add_column(tx, "zenith_loyalty_programs", "stamp_cooldown_minutes",
                                 f"INTEGER DEFAULT {DEFAULT_STAMP_COOLDOWN_MIN}")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_cards_phone ON zenith_loyalty_cards(phone)")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_cards_program ON zenith_loyalty_cards(program_id)")
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_transactions (
                    id {pk},
                    card_id INTEGER NOT NULL,
                    kind VARCHAR(10) NOT NULL,
                    points INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    purchase_amount {real} DEFAULT 0,
                    reward_id INTEGER NULL,
                    reference VARCHAR(100) DEFAULT '',
                    notes VARCHAR(300) DEFAULT '',
                    created_by VARCHAR(160) DEFAULT '',
                    created_at VARCHAR(40))""")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_tx_card ON zenith_loyalty_transactions(card_id)")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_tx_ref ON zenith_loyalty_transactions(card_id, reference)")
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_codes (
                    id {pk},
                    program_id INTEGER NOT NULL,
                    contact VARCHAR(190) NOT NULL,
                    channel VARCHAR(12) NOT NULL,
                    code_hash VARCHAR(64) NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL,
                    expires_at VARCHAR(40) NOT NULL,
                    used_at VARCHAR(40) NULL)""")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_codes_contact ON zenith_loyalty_codes(program_id, contact)")
                self._add_column(tx, "zenith_loyalty_programs", "qr_token", "VARCHAR(64)")
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_requests (
                    id {pk},
                    token VARCHAR(64) NOT NULL UNIQUE,
                    short_code VARCHAR(8) NOT NULL,
                    program_id INTEGER NOT NULL,
                    card_id INTEGER NOT NULL,
                    status VARCHAR(10) NOT NULL DEFAULT 'pending',
                    message VARCHAR(300) DEFAULT '',
                    created_at VARCHAR(40) NOT NULL,
                    expires_at VARCHAR(40) NOT NULL,
                    decided_at VARCHAR(40) NULL,
                    decided_by VARCHAR(160) DEFAULT '')""")
                tx.execute("CREATE INDEX IF NOT EXISTS idx_loyalty_requests_status ON zenith_loyalty_requests(status)")
                tx.execute(f"""CREATE TABLE IF NOT EXISTS zenith_loyalty_rewards (
                    id {pk},
                    program_id INTEGER NOT NULL,
                    name VARCHAR(160) NOT NULL,
                    description VARCHAR(500) DEFAULT '',
                    cost INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at VARCHAR(40))""")
            self._ready = True

    @staticmethod
    def _add_column(tx: _Tx, table: str, column: str, ddl: str) -> None:
        """Migración suave para tablas creadas por versiones anteriores del módulo."""
        if tx.is_pg:
            tx.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")
            return
        cols = [r["name"] for r in tx.all(f"PRAGMA table_info({table})")]
        if cols and column not in cols:
            tx.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    # ------------------------------------------------------------------
    # PROGRAMAS
    # ------------------------------------------------------------------
    @staticmethod
    def _program_out(row: Dict[str, Any]) -> Dict[str, Any]:
        row = dict(row)
        row["active"] = bool(row["active"])
        row["points_per_currency"] = float(row.get("points_per_currency") or 0)
        cd = row.get("stamp_cooldown_minutes")
        row["stamp_cooldown_minutes"] = DEFAULT_STAMP_COOLDOWN_MIN if cd is None else int(cd)
        return row

    def list_programs(self, include_inactive: bool = True) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            sql = "SELECT * FROM zenith_loyalty_programs"
            if not include_inactive:
                sql += " WHERE active = 1"
            return [self._program_out(r) for r in tx.all(sql + " ORDER BY id")]

    def get_program(self, program_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.one("SELECT * FROM zenith_loyalty_programs WHERE id = ?", (program_id,))
        return self._program_out(row) if row else None

    def create_program(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._tx() as tx:
            pid = tx.insert(
                "INSERT INTO zenith_loyalty_programs (name, kind, points_per_currency, stamps_goal, "
                "reward_description, expiry_days, terms, stamp_cooldown_minutes, active, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
                (data["name"].strip(), data.get("kind", "points"), data.get("points_per_currency", 1.0),
                 data.get("stamps_goal", 10), data.get("reward_description", ""), data.get("expiry_days", 0),
                 data.get("terms", ""), int(data.get("stamp_cooldown_minutes", DEFAULT_STAMP_COOLDOWN_MIN)), _now()))
        return self.get_program(pid)

    def update_program(self, program_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        fields = {k: v for k, v in data.items() if v is not None}
        if "active" in fields:
            fields["active"] = 1 if fields["active"] else 0
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            with self._tx() as tx:
                tx.execute(f"UPDATE zenith_loyalty_programs SET {cols} WHERE id = ?", (*fields.values(), program_id))
        prog = self.get_program(program_id)
        if not prog:
            raise LookupError("Programa no encontrado.")
        return prog

    # ------------------------------------------------------------------
    # TARJETAS
    # ------------------------------------------------------------------
    @staticmethod
    def _card_out(row: Dict[str, Any]) -> Dict[str, Any]:
        return dict(row)

    def create_card(self, data: Dict[str, Any]) -> Dict[str, Any]:
        program = self.get_program(int(data["program_id"]))
        if not program or not program["active"]:
            raise LoyaltyError("El programa no existe o está inactivo.")
        phone = normalize_phone(data.get("phone"))
        with self._tx() as tx:
            if phone and tx.one("SELECT id FROM zenith_loyalty_cards WHERE phone = ? AND program_id = ?",
                                (phone, program["id"])):
                raise LoyaltyError("Ese teléfono ya tiene una tarjeta en este programa.")
            cid = self._insert_card(tx, program["id"], data["customer_name"].strip(), phone,
                                    (data.get("email") or "").strip().lower(), data.get("notes", ""))
        return self.get_card(cid)

    @staticmethod
    def _insert_card(tx: _Tx, program_id: int, name: str, phone: str, email: str, notes: str) -> int:
        for _ in range(10):  # colisiones de código son rarísimas, pero se reintenta
            code = _new_code()
            if not tx.one("SELECT id FROM zenith_loyalty_cards WHERE code = ?", (code,)):
                break
        now = _now()
        return tx.insert(
            "INSERT INTO zenith_loyalty_cards (program_id, code, public_token, customer_name, phone, email, "
            "notes, balance, lifetime_earned, lifetime_redeemed, status, created_at, last_activity_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'active', ?, ?)",
            (program_id, code, secrets.token_urlsafe(24), name, phone, email, notes, now, now))

    def get_card(self, card_id: int) -> Optional[Dict[str, Any]]:
        with self._tx() as tx:
            row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE id = ?", (card_id,))
        return self._card_out(row) if row else None

    def find_card(self, query: str) -> Optional[Dict[str, Any]]:
        """Busca por código exacto o por teléfono (en caja)."""
        q = (query or "").strip()
        if not q:
            return None
        # Un lector de QR escribe el enlace completo de la tarjeta: se toma el token de ?tarjeta=
        m = re.search(r"[?&]tarjeta=([A-Za-z0-9_-]{10,64})", q)
        token = m.group(1) if m else (q if len(q) >= 20 and re.fullmatch(r"[A-Za-z0-9_-]+", q) else "")
        with self._tx() as tx:
            row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE public_token = ?", (token,)) if token else None
            if not row:
                row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE code = ?", (q.upper(),))
            phone = normalize_phone(q)
            if not row and phone:
                row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE phone = ? ORDER BY id DESC", (phone,))
            if not row and len(phone) >= 7:
                # En caja suelen dictar el número sin código de país: se busca por terminación
                row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE phone LIKE ? ORDER BY id DESC",
                             (f"%{phone}",))
        return self._card_out(row) if row else None

    def get_card_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        if not token or len(token) > 64:
            return None
        with self._tx() as tx:
            row = tx.one("SELECT * FROM zenith_loyalty_cards WHERE public_token = ?", (token,))
        return self._card_out(row) if row else None

    def list_cards(self, program_id: Optional[int] = None, search: str = "", status: str = "",
                   limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        where, params = [], []
        if program_id:
            where.append("program_id = ?")
            params.append(program_id)
        if status:
            where.append("status = ?")
            params.append(status)
        if search:
            like = f"%{search.strip().lower()}%"
            where.append("(LOWER(customer_name) LIKE ? OR LOWER(email) LIKE ? OR code LIKE ? OR phone LIKE ?)")
            params += [like, like, f"%{search.strip().upper()}%", f"%{normalize_phone(search) or '~'}%"]
        sql = "SELECT * FROM zenith_loyalty_cards"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY last_activity_at DESC, id DESC LIMIT ? OFFSET ?"
        with self._tx() as tx:
            return [self._card_out(r) for r in tx.all(sql, (*params, limit, offset))]

    def update_card(self, card_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        fields = {k: v for k, v in data.items() if v is not None}
        if "phone" in fields:
            fields["phone"] = normalize_phone(fields["phone"])
        if "email" in fields:
            fields["email"] = fields["email"].strip().lower()
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            with self._tx() as tx:
                tx.execute(f"UPDATE zenith_loyalty_cards SET {cols} WHERE id = ?", (*fields.values(), card_id))
        card = self.get_card(card_id)
        if not card:
            raise LookupError("Tarjeta no encontrada.")
        return card

    def card_transactions(self, card_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            rows = tx.all("SELECT * FROM zenith_loyalty_transactions WHERE card_id = ? ORDER BY id DESC LIMIT ?",
                          (card_id, limit))
        for r in rows:
            r["purchase_amount"] = float(r.get("purchase_amount") or 0)
        return rows

    # ------------------------------------------------------------------
    # MOVIMIENTOS
    # ------------------------------------------------------------------
    def _load_for_movement(self, tx: _Tx, card_id: int):
        card = tx.one("SELECT * FROM zenith_loyalty_cards WHERE id = ?", (card_id,))
        if not card:
            raise LookupError("Tarjeta no encontrada.")
        if card["status"] != "active":
            raise LoyaltyError("La tarjeta está bloqueada.")
        program = tx.one("SELECT * FROM zenith_loyalty_programs WHERE id = ?", (card["program_id"],))
        if not program or not program["active"]:
            raise LoyaltyError("El programa de esta tarjeta está inactivo.")
        self._expire_if_due(tx, card, program)
        return card, program

    def _expire_if_due(self, tx: _Tx, card: Dict[str, Any], program: Dict[str, Any]) -> None:
        """Vencimiento por inactividad: si pasaron `expiry_days` sin movimientos, el saldo caduca."""
        days = int(program.get("expiry_days") or 0)
        if days <= 0 or int(card["balance"]) <= 0 or not card.get("last_activity_at"):
            return
        try:
            last = datetime.fromisoformat(str(card["last_activity_at"]))
        except ValueError:
            return
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - last < timedelta(days=days):
            return
        lost = int(card["balance"])
        tx.execute("UPDATE zenith_loyalty_cards SET balance = 0 WHERE id = ?", (card["id"],))
        tx.execute("INSERT INTO zenith_loyalty_transactions (card_id, kind, points, balance_after, reference, notes, "
                   "created_by, created_at) VALUES (?, 'expire', ?, 0, '', ?, 'sistema', ?)",
                   (card["id"], -lost, f"Vencimiento por {days} días sin movimientos", _now()))
        card["balance"] = 0

    def _record(self, tx: _Tx, card_id: int, kind: str, points: int, *, purchase_amount: float = 0.0,
                reward_id: Optional[int] = None, reference: str = "", notes: str = "", user: str = "") -> Dict[str, Any]:
        # Actualización atómica: el saldo nunca queda negativo aunque haya dos cajas a la vez
        cur = tx.execute(
            "UPDATE zenith_loyalty_cards SET balance = balance + ?, "
            "lifetime_earned = lifetime_earned + ?, lifetime_redeemed = lifetime_redeemed + ?, "
            "last_activity_at = ? WHERE id = ? AND balance + ? >= 0",
            (points, max(points, 0) if kind == "earn" else 0, -points if kind == "redeem" else 0,
             _now(), card_id, points))
        if cur.rowcount == 0:
            raise LoyaltyError("Saldo insuficiente.")
        balance = tx.one("SELECT balance FROM zenith_loyalty_cards WHERE id = ?", (card_id,))["balance"]
        tid = tx.insert(
            "INSERT INTO zenith_loyalty_transactions (card_id, kind, points, balance_after, purchase_amount, "
            "reward_id, reference, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (card_id, kind, points, balance, purchase_amount, reward_id, reference, notes, user, _now()))
        return {"transaction_id": tid, "kind": kind, "points": points, "balance": int(balance)}

    def earn(self, card_id: int, purchase_amount: float = 0.0, reference: str = "", notes: str = "",
             user: str = "") -> Dict[str, Any]:
        """Acumula por una compra. Con `reference` repetida devuelve el movimiento original (idempotente)."""
        with self._tx() as tx:
            return self._earn_in_tx(tx, card_id, purchase_amount, reference, notes, user)

    def _earn_in_tx(self, tx: _Tx, card_id: int, purchase_amount: float = 0.0, reference: str = "",
                    notes: str = "", user: str = "") -> Dict[str, Any]:
        reference = (reference or "").strip()
        card, program = self._load_for_movement(tx, card_id)
        if reference:
            dup = tx.one("SELECT * FROM zenith_loyalty_transactions WHERE card_id = ? AND reference = ? "
                         "AND kind = 'earn'", (card_id, reference))
            if dup:
                return {"transaction_id": dup["id"], "kind": "earn", "points": dup["points"],
                        "balance": int(card["balance"]), "duplicate": True}
        if program["kind"] == "stamps":
            # Siempre UN sello por movimiento, y la tarjeta debe esperar el tiempo mínimo entre sellos
            self._claim_stamp_slot(tx, card_id, program)
            points = 1
        else:
            rate = float(program.get("points_per_currency") or 0)
            points = int(math.floor(float(purchase_amount) * rate + 1e-9))
            if points <= 0:
                raise LoyaltyError("La compra no genera puntos (monto demasiado bajo).")
        result = self._record(tx, card_id, "earn", points, purchase_amount=float(purchase_amount or 0),
                              reference=reference, notes=notes, user=user)
        if program["kind"] == "stamps":
            result["goal"] = int(program["stamps_goal"])
            result["reward_ready"] = result["balance"] >= int(program["stamps_goal"])
        return result

    def _claim_stamp_slot(self, tx: _Tx, card_id: int, program: Dict[str, Any]) -> None:
        """Reserva el turno del sello de forma atómica: dos solicitudes simultáneas nunca suman dos sellos."""
        cd = program.get("stamp_cooldown_minutes")
        minutes = DEFAULT_STAMP_COOLDOWN_MIN if cd is None else int(cd)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        limit = (now - timedelta(minutes=minutes)).isoformat()
        cur = tx.execute("UPDATE zenith_loyalty_cards SET last_stamp_at = ? WHERE id = ? "
                         "AND (last_stamp_at IS NULL OR last_stamp_at <= ?)", (now.isoformat(), card_id, limit))
        if cur.rowcount == 0:
            last = tx.one("SELECT last_stamp_at FROM zenith_loyalty_cards WHERE id = ?", (card_id,)) or {}
            wait = minutes
            try:
                nxt = datetime.fromisoformat(str(last.get("last_stamp_at"))) + timedelta(minutes=minutes)
                wait = max(1, math.ceil((nxt - now).total_seconds() / 60))
            except (TypeError, ValueError):
                pass
            raise LoyaltyError(f"Esta tarjeta ya recibió un sello hace poco. Podrá recibir el siguiente en {wait} min.")

    # ------------------------------------------------------------------
    # QR IMPRESO (fijo por programa): el cliente lo escanea y suma su sello.
    # Siempre es el mismo QR; lo que se valida es al cliente (código por correo o WhatsApp la primera vez
    # en cada teléfono) y la espera mínima entre sellos de cada tarjeta.
    # ------------------------------------------------------------------
    def program_qr_token(self, program_id: int, regenerate: bool = False) -> str:
        program = self.get_program(program_id)
        if not program:
            raise LookupError("Programa no encontrado.")
        if program["kind"] != "stamps":
            raise LoyaltyError("El QR impreso solo aplica a programas por sellos.")
        if program.get("qr_token") and not regenerate:
            return program["qr_token"]
        token = secrets.token_urlsafe(18)
        with self._tx() as tx:
            tx.execute("UPDATE zenith_loyalty_programs SET qr_token = ? WHERE id = ?", (token, program_id))
        return token

    def program_by_qr(self, qr_token: str) -> Optional[Dict[str, Any]]:
        if not qr_token or len(qr_token) > 64:
            return None
        with self._tx() as tx:
            row = tx.one("SELECT * FROM zenith_loyalty_programs WHERE qr_token = ? AND kind = 'stamps' AND active = 1",
                         (qr_token,))
        return self._program_out(row) if row else None

    @staticmethod
    def normalize_contact(raw: str):
        """('email', 'ana@x.com') o ('phone', '50370001111'); lanza LoyaltyError si no sirve."""
        value = (raw or "").strip()
        if "@" in value:
            email = value.lower()
            if not EMAIL_RE.match(email):
                raise LoyaltyError("Ese correo no parece válido.")
            return "email", email
        phone = normalize_phone(value)
        if len(phone) < 8:
            raise LoyaltyError("Escribe tu correo o tu número de WhatsApp completo.")
        return "phone", phone

    @staticmethod
    def _code_hash(program_id: int, contact: str, code: str) -> str:
        import hashlib
        return hashlib.sha256(f"{program_id}:{contact}:{code}".encode("utf-8")).hexdigest()

    def create_code(self, program_id: int, contact: str) -> Dict[str, Any]:
        """Genera el código de 6 dígitos para `contact` (ya normalizado). Devuelve el código en claro para enviarlo."""
        now = datetime.now(timezone.utc).replace(microsecond=0)
        with self._tx() as tx:
            last = tx.one("SELECT created_at FROM zenith_loyalty_codes WHERE program_id = ? AND contact = ? "
                          "ORDER BY id DESC", (program_id, contact))
            if last and str(last["created_at"]) > (now - timedelta(seconds=CODE_RESEND_SECONDS)).isoformat():
                raise LoyaltyError("Ya te enviamos un código hace un momento. Espera un minuto para pedir otro.")
            recent = tx.one("SELECT COUNT(*) AS n FROM zenith_loyalty_codes WHERE program_id = ? AND contact = ? "
                            "AND created_at > ?", (program_id, contact, (now - timedelta(hours=1)).isoformat()))
            if int(recent["n"] or 0) >= CODE_MAX_PER_HOUR:
                raise LoyaltyError("Pediste demasiados códigos. Intenta de nuevo más tarde.")
            code = f"{secrets.randbelow(1_000_000):06d}"
            channel = "email" if "@" in contact else "whatsapp"
            tx.insert("INSERT INTO zenith_loyalty_codes (program_id, contact, channel, code_hash, attempts, created_at, "
                      "expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
                      (program_id, contact, channel, self._code_hash(program_id, contact, code), now.isoformat(),
                       (now + timedelta(minutes=CODE_TTL_MINUTES)).isoformat()))
        return {"code": code, "channel": channel}

    def _check_code(self, tx: _Tx, program_id: int, contact: str, code: str) -> Dict[str, Any]:
        row = tx.one("SELECT * FROM zenith_loyalty_codes WHERE program_id = ? AND contact = ? AND used_at IS NULL "
                     "ORDER BY id DESC", (program_id, contact))
        if not row or str(row["expires_at"]) <= _now():
            raise LoyaltyError("El código venció o no existe. Pide uno nuevo.")
        if int(row["attempts"]) >= CODE_MAX_ATTEMPTS:
            raise LoyaltyError("Demasiados intentos. Pide un código nuevo.")
        import hmac
        if not hmac.compare_digest(row["code_hash"], self._code_hash(program_id, contact, (code or "").strip())):
            # El intento fallido se guarda aunque la petición termine en error (transacción propia)
            with self._raw_tx() as tx2:
                tx2.execute("UPDATE zenith_loyalty_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
            raise LoyaltyError("Código incorrecto.")
        return row

    def code_required(self, kind: str, channels: Dict[str, bool]) -> bool:
        """Se pide código solo si hay cómo enviarlo; el cajero igual aprueba cada sello en persona."""
        return bool(channels.get("email" if kind == "email" else "whatsapp"))

    def identify(self, qr_token: str, contact_raw: str, code: str, customer_name: str,
                 channels: Dict[str, bool]) -> Dict[str, Any]:
        """Primera vez en un teléfono: valida el contacto (código si hay canal), encuentra o crea la tarjeta
        y deja una solicitud de sello pendiente para que la apruebe el cajero."""
        program = self.program_by_qr(qr_token)
        if not program:
            raise LookupError("Este código QR ya no es válido.")
        kind, contact = self.normalize_contact(contact_raw)
        need_code = self.code_required(kind, channels)
        with self._tx() as tx:
            code_row = self._check_code(tx, program["id"], contact, code) if need_code else None
            if kind == "email":
                card = tx.one("SELECT * FROM zenith_loyalty_cards WHERE program_id = ? AND email = ? ORDER BY id DESC",
                              (program["id"], contact))
            else:
                card = tx.one("SELECT * FROM zenith_loyalty_cards WHERE program_id = ? AND (phone = ? OR phone LIKE ?) "
                              "ORDER BY id DESC", (program["id"], contact, f"%{contact[-8:]}"))
            created = False
            if not card:
                name = (customer_name or "").strip()[:160]
                if not name:
                    return {"needs_name": True}  # el código sigue vigente para el siguiente paso
                cid = self._insert_card(tx, program["id"], name, contact if kind == "phone" else "",
                                        contact if kind == "email" else "", "Registro por QR impreso")
                card = tx.one("SELECT * FROM zenith_loyalty_cards WHERE id = ?", (cid,))
                created = True
            if code_row:
                tx.execute("UPDATE zenith_loyalty_codes SET used_at = ? WHERE id = ?", (_now(), code_row["id"]))
        req = self.request_stamp(int(card["id"]))
        return {**req, "card_created": created, "card_token": card["public_token"]}

    def request_from_saved_card(self, qr_token: str, card_tokens) -> Dict[str, Any]:
        """El teléfono ya tiene su tarjeta: se crea la solicitud sin pedir datos."""
        program = self.program_by_qr(qr_token)
        if not program:
            raise LookupError("Este código QR ya no es válido.")
        card = None
        with self._tx() as tx:
            for tok in [t for t in (card_tokens or []) if isinstance(t, str) and 0 < len(t) <= 64][:10]:
                card = tx.one("SELECT * FROM zenith_loyalty_cards WHERE public_token = ? AND program_id = ?",
                              (tok, program["id"]))
                if card:
                    break
        if not card:
            return {"needs_verification": True}
        req = self.request_stamp(int(card["id"]))
        return {**req, "card_created": False, "card_token": card["public_token"]}

    # ------------------------------------------------------------------
    # SOLICITUDES DE SELLO: el cliente las crea, el cajero las aprueba en persona
    # ------------------------------------------------------------------
    @staticmethod
    def _cooldown_wait(card: Dict[str, Any], program: Dict[str, Any]) -> int:
        """Minutos que faltan para que la tarjeta pueda recibir otro sello (0 = ya puede)."""
        cd = program.get("stamp_cooldown_minutes")
        minutes = DEFAULT_STAMP_COOLDOWN_MIN if cd is None else int(cd)
        if minutes <= 0 or not card.get("last_stamp_at"):
            return 0
        try:
            nxt = datetime.fromisoformat(str(card["last_stamp_at"])) + timedelta(minutes=minutes)
        except ValueError:
            return 0
        left = (nxt - datetime.now(timezone.utc)).total_seconds()
        return max(0, math.ceil(left / 60))

    def request_stamp(self, card_id: int) -> Dict[str, Any]:
        """Crea (o reutiliza) la solicitud pendiente de la tarjeta. Nada se suma hasta que el cajero la apruebe."""
        now = datetime.now(timezone.utc).replace(microsecond=0)
        with self._tx() as tx:
            card, program = self._load_for_movement(tx, card_id)
            wait = self._cooldown_wait(card, program)
            if wait:
                raise LoyaltyError(f"Ya recibiste un sello hace poco. Podrás pedir el siguiente en {wait} min.")
            row = tx.one("SELECT * FROM zenith_loyalty_requests WHERE card_id = ? AND status = 'pending' "
                         "AND expires_at > ? ORDER BY id DESC", (card_id, now.isoformat()))
            if not row:
                tx.execute("UPDATE zenith_loyalty_requests SET status = 'expired' WHERE card_id = ? AND status = 'pending'",
                           (card_id,))
                token = secrets.token_urlsafe(18)
                short = "".join(secrets.choice(REQUEST_CODE_ALPHABET) for _ in range(4))
                rid = tx.insert("INSERT INTO zenith_loyalty_requests (token, short_code, program_id, card_id, status, "
                                "created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
                                (token, short, program["id"], card_id, now.isoformat(),
                                 (now + timedelta(minutes=REQUEST_TTL_MINUTES)).isoformat()))
                row = tx.one("SELECT * FROM zenith_loyalty_requests WHERE id = ?", (rid,))
        return {"request_token": row["token"], "short_code": row["short_code"], "status": "pending",
                "expires_at": row["expires_at"]}

    def request_status(self, request_token: str) -> Optional[Dict[str, Any]]:
        if not request_token or len(request_token) > 64:
            return None
        with self._tx() as tx:
            row = tx.one("SELECT r.*, c.public_token FROM zenith_loyalty_requests r "
                         "JOIN zenith_loyalty_cards c ON c.id = r.card_id WHERE r.token = ?", (request_token,))
        if not row:
            return None
        status = row["status"]
        if status == "pending" and str(row["expires_at"]) <= _now():
            status = "expired"
        return {"status": status, "short_code": row["short_code"], "message": row.get("message") or "",
                "expires_at": row["expires_at"], "card_token": row["public_token"]}

    def pending_requests(self) -> List[Dict[str, Any]]:
        with self._tx() as tx:
            return tx.all("SELECT r.id, r.short_code, r.created_at, r.expires_at, r.card_id, c.customer_name, c.code, "
                          "c.balance, p.name AS program_name, p.stamps_goal FROM zenith_loyalty_requests r "
                          "JOIN zenith_loyalty_cards c ON c.id = r.card_id "
                          "JOIN zenith_loyalty_programs p ON p.id = r.program_id "
                          "WHERE r.status = 'pending' AND r.expires_at > ? ORDER BY r.id", (_now(),))

    def decide_request(self, request_id: int, approve: bool, user: str = "") -> Dict[str, Any]:
        """El cajero aprueba (suma el sello) o rechaza. Atómico: dos cajeros no pueden aprobar la misma."""
        now = _now()
        status = "approved" if approve else "rejected"
        try:
            with self._tx() as tx:
                row = tx.one("SELECT * FROM zenith_loyalty_requests WHERE id = ?", (request_id,))
                if not row:
                    raise LookupError("Solicitud no encontrada.")
                cur = tx.execute("UPDATE zenith_loyalty_requests SET status = ?, decided_at = ?, decided_by = ? "
                                 "WHERE id = ? AND status = 'pending' AND expires_at > ?",
                                 (status, now, user[:160], request_id, now))
                if cur.rowcount == 0:
                    raise LoyaltyError("La solicitud ya fue atendida o venció.")
                if not approve:
                    return {"status": "rejected", "card_id": int(row["card_id"])}
                result = self._earn_in_tx(tx, int(row["card_id"]), notes="Sello por QR impreso (aprobado en caja)",
                                          user=user)
                return {**result, "status": "approved", "card_id": int(row["card_id"])}
        except LoyaltyError as e:
            if approve and "ya fue atendida" not in str(e):
                # No se pudo sumar (p. ej. por la espera): se cierra la solicitud para que el cliente lo sepa
                with self._raw_tx() as tx:
                    tx.execute("UPDATE zenith_loyalty_requests SET status = 'rejected', message = ?, decided_at = ?, "
                               "decided_by = ? WHERE id = ? AND status = 'pending'", (str(e)[:300], now, user[:160],
                                                                                     request_id))
            raise

    def redeem(self, card_id: int, reward_id: Optional[int] = None, reference: str = "", notes: str = "",
               user: str = "") -> Dict[str, Any]:
        with self._tx() as tx:
            card, program = self._load_for_movement(tx, card_id)
            if program["kind"] == "stamps":
                cost = int(program["stamps_goal"])
                label = program.get("reward_description") or "Recompensa por sellos"
                reward_id = None
            else:
                if not reward_id:
                    raise LoyaltyError("Elige la recompensa a canjear.")
                reward = tx.one("SELECT * FROM zenith_loyalty_rewards WHERE id = ? AND program_id = ? AND active = 1",
                                (reward_id, program["id"]))
                if not reward:
                    raise LoyaltyError("Recompensa no disponible para este programa.")
                cost = int(reward["cost"])
                label = reward["name"]
            if int(card["balance"]) < cost:
                raise LoyaltyError(f"Saldo insuficiente: tiene {card['balance']} y se necesitan {cost}.")
            result = self._record(tx, card_id, "redeem", -cost, reward_id=reward_id, reference=reference,
                                  notes=notes or label, user=user)
            result["reward"] = label
            return result

    def adjust(self, card_id: int, delta: int, reason: str, user: str = "") -> Dict[str, Any]:
        if delta == 0:
            raise LoyaltyError("El ajuste no puede ser cero.")
        with self._tx() as tx:
            if not tx.one("SELECT id FROM zenith_loyalty_cards WHERE id = ?", (card_id,)):
                raise LookupError("Tarjeta no encontrada.")
            return self._record(tx, card_id, "adjust", int(delta), notes=reason, user=user)

    # ------------------------------------------------------------------
    # RECOMPENSAS
    # ------------------------------------------------------------------
    def list_rewards(self, program_id: Optional[int] = None, only_active: bool = False) -> List[Dict[str, Any]]:
        where, params = [], []
        if program_id:
            where.append("program_id = ?")
            params.append(program_id)
        if only_active:
            where.append("active = 1")
        sql = "SELECT * FROM zenith_loyalty_rewards" + (" WHERE " + " AND ".join(where) if where else "")
        with self._tx() as tx:
            rows = tx.all(sql + " ORDER BY cost, id", tuple(params))
        for r in rows:
            r["active"] = bool(r["active"])
        return rows

    def create_reward(self, data: Dict[str, Any]) -> Dict[str, Any]:
        program = self.get_program(int(data["program_id"]))
        if not program:
            raise LoyaltyError("Programa no encontrado.")
        if program["kind"] != "points":
            raise LoyaltyError("Los programas por sellos usan una sola recompensa (se define en el programa).")
        with self._tx() as tx:
            rid = tx.insert("INSERT INTO zenith_loyalty_rewards (program_id, name, description, cost, active, "
                            "created_at) VALUES (?, ?, ?, ?, 1, ?)",
                            (program["id"], data["name"].strip(), data.get("description", ""), int(data["cost"]),
                             _now()))
            row = tx.one("SELECT * FROM zenith_loyalty_rewards WHERE id = ?", (rid,))
        row["active"] = bool(row["active"])
        return row

    def update_reward(self, reward_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        fields = {k: v for k, v in data.items() if v is not None}
        if "active" in fields:
            fields["active"] = 1 if fields["active"] else 0
        with self._tx() as tx:
            if fields:
                cols = ", ".join(f"{k} = ?" for k in fields)
                tx.execute(f"UPDATE zenith_loyalty_rewards SET {cols} WHERE id = ?", (*fields.values(), reward_id))
            row = tx.one("SELECT * FROM zenith_loyalty_rewards WHERE id = ?", (reward_id,))
        if not row:
            raise LookupError("Recompensa no encontrada.")
        row["active"] = bool(row["active"])
        return row

    # ------------------------------------------------------------------
    # REPORTES Y VISTA PÚBLICA
    # ------------------------------------------------------------------
    def stats(self, program_id: Optional[int] = None) -> Dict[str, Any]:
        cond, params = ("WHERE c.program_id = ?", (program_id,)) if program_id else ("", ())
        with self._tx() as tx:
            cards = tx.one(f"SELECT COUNT(*) AS total, "
                           f"SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active, "
                           f"COALESCE(SUM(c.balance), 0) AS outstanding FROM zenith_loyalty_cards c {cond}", params)
            moves = tx.one(f"SELECT "
                           f"COALESCE(SUM(CASE WHEN t.kind = 'earn' THEN t.points ELSE 0 END), 0) AS earned, "
                           f"COALESCE(SUM(CASE WHEN t.kind = 'redeem' THEN -t.points ELSE 0 END), 0) AS redeemed, "
                           f"SUM(CASE WHEN t.kind = 'redeem' THEN 1 ELSE 0 END) AS redemptions, "
                           f"COALESCE(SUM(CASE WHEN t.kind = 'earn' THEN t.purchase_amount ELSE 0 END), 0) AS sales "
                           f"FROM zenith_loyalty_transactions t JOIN zenith_loyalty_cards c ON c.id = t.card_id {cond}",
                           params)
            top = tx.all(f"SELECT c.id, c.customer_name, c.code, c.balance, c.lifetime_earned "
                         f"FROM zenith_loyalty_cards c {cond} ORDER BY c.lifetime_earned DESC LIMIT 10", params)
        return {
            "cards_total": int(cards["total"] or 0),
            "cards_active": int(cards["active"] or 0),
            "points_outstanding": int(cards["outstanding"] or 0),
            "points_earned": int(moves["earned"] or 0),
            "points_redeemed": int(moves["redeemed"] or 0),
            "redemptions": int(moves["redemptions"] or 0),
            "sales_with_card": float(moves["sales"] or 0),
            "top_customers": top,
        }

    def public_view(self, token: str) -> Optional[Dict[str, Any]]:
        """Lo que ve el cliente final en el enlace de su tarjeta: sin teléfono, correo ni notas internas."""
        card = self.get_card_by_token(token)
        if not card:
            return None
        program = self.get_program(card["program_id"]) or {}
        rewards = self.list_rewards(card["program_id"], only_active=True) if program.get("kind") == "points" else []
        history = self.card_transactions(card["id"], limit=10)
        return {
            "customer_name": card["customer_name"],
            "code": card["code"],
            "status": card["status"],
            "balance": int(card["balance"]),
            "program": {
                "name": program.get("name", ""),
                "kind": program.get("kind", "points"),
                "points_per_currency": program.get("points_per_currency", 0),
                "stamps_goal": program.get("stamps_goal"),
                "reward_description": program.get("reward_description", ""),
                "expiry_days": program.get("expiry_days", 0),
                "terms": program.get("terms", ""),
                "stamp_cooldown_minutes": program.get("stamp_cooldown_minutes"),
            },
            "rewards": [{"name": r["name"], "cost": r["cost"], "description": r["description"],
                         "available": int(card["balance"]) >= int(r["cost"])} for r in rewards],
            "history": [{"kind": t["kind"], "points": t["points"], "created_at": t["created_at"]} for t in history],
        }


loyalty_service = LoyaltyService()
