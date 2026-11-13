"""
Cobro automático de suscripciones con PayPal (Subscriptions API v1).

Flujo:
1. La página de ventas pide /api/public/billing/config: planes, precios y el plan_id de PayPal de cada uno.
2. El cliente llena empresa + correo y aprueba la suscripción con el botón de PayPal (14 días de prueba).
3. /api/public/billing/activate verifica la suscripción contra la API de PayPal (nunca se confía en el navegador),
   crea la empresa con el plan y envía al correo el enlace para crear su contraseña.
4. El webhook de PayPal (firma verificada) mantiene el estado: pago recibido, pago fallido, suspendida, cancelada.
   Una suscripción suspendida, o cancelada/vencida pasado su periodo pagado, desactiva la empresa; al reactivarse
   se reactiva.

Credenciales solo por variables de entorno: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE (sandbox|live),
PAYPAL_WEBHOOK_ID. Los plan_id de PayPal se crean con setup_plans() y se guardan en la base (no en el código).
"""
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

from services.tenant_service import (DEFAULT_TENANT, FEATURE_ARM, FEATURE_LOYALTY, normalize_slug, public_slug,
                                     tenant_registry, validate_slug)

logger = logging.getLogger("asistente_operativo.billing")

TRIAL_DAYS = 14
GRACE_DAYS = 5

# Catálogo comercial (precios en USD, sin IVA). Los límites se muestran al cliente; su control fino es aparte.
PLANS: Dict[str, Dict[str, Any]] = {
    "emprendedor": {
        "name": "Emprendedor", "monthly": 19, "yearly": 190, "features": [FEATURE_ARM],
        "ai_replies": 1000, "users": 2,
        "items": ["1 número de WhatsApp", "Asistente IA con tu información", "Bandeja y clientes",
                  "1,000 respuestas IA al mes", "2 usuarios"],
    },
    "negocio": {
        "name": "Negocio", "monthly": 39, "yearly": 390, "features": [FEATURE_ARM, FEATURE_LOYALTY],
        "ai_replies": 3000, "users": 5, "featured": True,
        "items": ["Todo lo del Emprendedor", "1 módulo: pedidos, citas/CRM o fidelidad", "Memoria de clientes y automatizaciones",
                  "3,000 respuestas IA al mes", "5 usuarios"],
    },
    "pro": {
        "name": "Pro", "monthly": 79, "yearly": 790, "features": [FEATURE_ARM, FEATURE_LOYALTY],
        "ai_replies": 8000, "users": 15,
        "items": ["Todos los módulos: inventario, caja, DTE y fidelidad", "API oficial de WhatsApp (opcional)",
                  "8,000 respuestas IA al mes", "15 usuarios", "Soporte prioritario"],
    },
}
CYCLES = ("monthly", "yearly")
PLAN_IDS_SETTING = "PAYPAL_PLAN_IDS"  # JSON {"negocio:monthly": "P-...", ...} en la empresa principal

# Estados de PayPal que mantienen la empresa activa
ACTIVE_STATES = {"APPROVAL_PENDING", "APPROVED", "ACTIVE"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


class PayPalError(RuntimeError):
    pass


class BillingService:
    def __init__(self):
        self._token: Optional[str] = None
        self._token_exp = 0.0
        self._ready = False
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------ configuración
    @property
    def mode(self) -> str:
        return "live" if os.getenv("PAYPAL_MODE", "sandbox").strip().lower() == "live" else "sandbox"

    @property
    def api_base(self) -> str:
        return "https://api-m.paypal.com" if self.mode == "live" else "https://api-m.sandbox.paypal.com"

    @property
    def client_id(self) -> str:
        return os.getenv("PAYPAL_CLIENT_ID", "").strip()

    def is_configured(self) -> bool:
        return bool(self.client_id and os.getenv("PAYPAL_SECRET", "").strip())

    def _plan_ids(self) -> Dict[str, str]:
        from services.db_service import db_service
        from services.tenant_service import tenant_context
        with tenant_context(DEFAULT_TENANT):
            raw = db_service.get_setting(PLAN_IDS_SETTING, "") or ""
        try:
            data = json.loads(raw) if raw else {}
            return {k: str(v) for k, v in data.items()} if isinstance(data, dict) else {}
        except ValueError:
            return {}

    def _save_plan_ids(self, ids: Dict[str, str]) -> None:
        from services.db_service import db_service
        from services.tenant_service import tenant_context
        with tenant_context(DEFAULT_TENANT):
            db_service.set_setting(PLAN_IDS_SETTING, json.dumps(ids))

    def public_config(self) -> Dict[str, Any]:
        ids = self._plan_ids()
        plans = []
        for key, p in PLANS.items():
            plans.append({
                "key": key, "name": p["name"], "monthly": p["monthly"], "yearly": p["yearly"],
                "items": p["items"], "featured": bool(p.get("featured")),
                "paypal_plan_monthly": ids.get(f"{key}:monthly", ""),
                "paypal_plan_yearly": ids.get(f"{key}:yearly", ""),
            })
        enabled = self.is_configured() and all(p["paypal_plan_monthly"] for p in plans)
        return {"enabled": enabled, "client_id": self.client_id if enabled else "", "mode": self.mode,
                "trial_days": TRIAL_DAYS, "plans": plans}

    # ------------------------------------------------------------------ API de PayPal
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        if not self.is_configured():
            raise PayPalError("PayPal no está configurado (PAYPAL_CLIENT_ID / PAYPAL_SECRET).")
        res = requests.post(f"{self.api_base}/v1/oauth2/token", data={"grant_type": "client_credentials"},
                            auth=(self.client_id, os.getenv("PAYPAL_SECRET", "").strip()), timeout=20)
        if res.status_code != 200:
            raise PayPalError(f"PayPal rechazó las credenciales ({res.status_code}).")
        data = res.json()
        self._token, self._token_exp = data["access_token"], time.time() + int(data.get("expires_in", 3000))
        return self._token

    def _api(self, method: str, path: str, body: Optional[dict] = None) -> Dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._access_token()}", "Content-Type": "application/json",
                   "Prefer": "return=representation"}
        res = requests.request(method, f"{self.api_base}{path}", headers=headers,
                               data=json.dumps(body) if body is not None else None, timeout=25)
        if res.status_code >= 400:
            detail = ""
            try:
                detail = res.json().get("message") or res.json().get("name") or ""
            except ValueError:
                pass
            raise PayPalError(f"PayPal respondió {res.status_code} en {path}: {detail}")
        return res.json() if res.content else {}

    def setup_plans(self) -> Dict[str, str]:
        """Crea en PayPal el producto y los 6 planes (3 niveles × mensual/anual) que falten. Idempotente."""
        ids = self._plan_ids()
        product_id = ids.get("_product")
        if not product_id:
            product = self._api("POST", "/v1/catalogs/products", {
                "name": "Zenith", "description": "Asistente de WhatsApp con IA para negocios",
                "type": "SERVICE", "category": "SOFTWARE"})
            product_id = ids["_product"] = product["id"]
        for key, p in PLANS.items():
            for cycle in CYCLES:
                slot = f"{key}:{cycle}"
                if ids.get(slot):
                    continue
                price = p["monthly"] if cycle == "monthly" else p["yearly"]
                unit = "MONTH" if cycle == "monthly" else "YEAR"
                plan = self._api("POST", "/v1/billing/plans", {
                    "product_id": product_id,
                    "name": f"Zenith {p['name']} ({'mensual' if cycle == 'monthly' else 'anual'})",
                    "status": "ACTIVE",
                    "billing_cycles": [
                        {"frequency": {"interval_unit": "DAY", "interval_count": TRIAL_DAYS},
                         "tenure_type": "TRIAL", "sequence": 1, "total_cycles": 1},
                        {"frequency": {"interval_unit": unit, "interval_count": 1}, "tenure_type": "REGULAR",
                         "sequence": 2, "total_cycles": 0,
                         "pricing_scheme": {"fixed_price": {"value": f"{price:.2f}", "currency_code": "USD"}}},
                    ],
                    "payment_preferences": {"auto_bill_outstanding": True, "setup_fee_failure_action": "CONTINUE",
                                            "payment_failure_threshold": 2},
                })
                ids[slot] = plan["id"]
                self._save_plan_ids(ids)
        self._save_plan_ids(ids)
        logger.info("💳 Planes de PayPal listos.")
        return ids

    def get_subscription(self, subscription_id: str) -> Dict[str, Any]:
        if not re.fullmatch(r"I-[A-Z0-9]{6,40}", subscription_id or ""):
            raise PayPalError("Identificador de suscripción inválido.")
        return self._api("GET", f"/v1/billing/subscriptions/{subscription_id}")

    def verify_webhook(self, headers: Dict[str, str], event: Dict[str, Any]) -> bool:
        webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
        if not webhook_id:
            logger.warning("PAYPAL_WEBHOOK_ID no configurado: se rechaza el webhook de PayPal.")
            return False
        body = {
            "auth_algo": headers.get("paypal-auth-algo", ""), "cert_url": headers.get("paypal-cert-url", ""),
            "transmission_id": headers.get("paypal-transmission-id", ""),
            "transmission_sig": headers.get("paypal-transmission-sig", ""),
            "transmission_time": headers.get("paypal-transmission-time", ""),
            "webhook_id": webhook_id, "webhook_event": event,
        }
        try:
            return self._api("POST", "/v1/notifications/verify-webhook-signature", body).get(
                "verification_status") == "SUCCESS"
        except PayPalError as e:
            logger.warning(f"No se pudo verificar el webhook de PayPal: {e}")
            return False

    # ------------------------------------------------------------------ base de datos
    def _run(self, sql: str, params: tuple = (), fetch: bool = False):
        return tenant_registry._run(sql, params, fetch=fetch)

    def ensure(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            tenant_registry.ensure()
            self._run("""CREATE TABLE IF NOT EXISTS zenith_subscriptions (
                subscription_id VARCHAR(60) PRIMARY KEY, tenant VARCHAR(40) NOT NULL, plan_key VARCHAR(20) NOT NULL,
                cycle VARCHAR(10) NOT NULL, status VARCHAR(30) NOT NULL, email VARCHAR(160) DEFAULT '',
                next_billing_at VARCHAR(40) DEFAULT '', paid_until VARCHAR(40) DEFAULT '',
                created_at VARCHAR(40), updated_at VARCHAR(40))""")
            self._ready = True

    def _plan_for_paypal_id(self, plan_id: str) -> Optional[tuple]:
        for slot, pid in self._plan_ids().items():
            if pid == plan_id and ":" in slot:
                key, cycle = slot.split(":", 1)
                return key, cycle
        return None

    def subscription_for_tenant(self, tenant: str) -> Optional[Dict[str, Any]]:
        self.ensure()
        rows = self._run("SELECT * FROM zenith_subscriptions WHERE tenant = ? ORDER BY created_at DESC",
                         (normalize_slug(tenant),), fetch=True)
        if not rows:
            return None
        row = dict(rows[0])
        plan = PLANS.get(row["plan_key"], {})
        row["plan_name"] = plan.get("name", row["plan_key"])
        row["price"] = plan.get("monthly" if row["cycle"] == "monthly" else "yearly")
        return row

    # ------------------------------------------------------------------ alta desde la página de ventas
    def activate(self, subscription_id: str, company: str, slug: str, email: str) -> Dict[str, Any]:
        """Verifica la suscripción en PayPal y crea la empresa. Idempotente por subscription_id."""
        self.ensure()
        email = (email or "").strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Correo inválido.")
        existing = self._run("SELECT tenant FROM zenith_subscriptions WHERE subscription_id = ?",
                             (subscription_id,), fetch=True)
        if existing:
            return {"tenant": existing[0]["tenant"], "tenant_slug": public_slug(existing[0]["tenant"]),
                    "already": True}
        sub = self.get_subscription(subscription_id)
        status = sub.get("status", "")
        if status not in ACTIVE_STATES:
            raise ValueError("La suscripción no está activa en PayPal.")
        plan = self._plan_for_paypal_id(sub.get("plan_id", ""))
        if not plan:
            raise ValueError("La suscripción no corresponde a un plan de Zenith.")
        plan_key, cycle = plan
        slug = validate_slug(slug)
        tenant_registry.create(slug, company, features=PLANS[plan_key]["features"])
        tenant_registry.set_owner_credentials(slug, email)
        now = _iso(_now())
        nb = (sub.get("billing_info") or {}).get("next_billing_time") or ""
        self._run("""INSERT INTO zenith_subscriptions (subscription_id, tenant, plan_key, cycle, status, email,
                     next_billing_at, paid_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                  (subscription_id, slug, plan_key, cycle, status, email, nb, nb, now, now))
        # Enlace para que el dueño cree su contraseña (mismo mecanismo que «olvidé mi contraseña»)
        from services.password_reset_service import password_reset_service
        password_reset_service.request(email, slug, welcome=True)
        logger.info(f"💳 Nueva suscripción {plan_key}/{cycle} para «{slug}».")
        return {"tenant": slug, "tenant_slug": public_slug(slug), "already": False}

    # ------------------------------------------------------------------ eventos (webhook)
    def handle_event(self, event: Dict[str, Any]) -> None:
        self.ensure()
        etype = event.get("event_type", "")
        res = event.get("resource") or {}
        sub_id = res.get("billing_agreement_id") if etype.startswith("PAYMENT.SALE") else res.get("id")
        if not sub_id:
            return
        rows = self._run("SELECT * FROM zenith_subscriptions WHERE subscription_id = ?", (sub_id,), fetch=True)
        if not rows:
            logger.info(f"Evento {etype} de una suscripción desconocida; se ignora.")
            return
        row = rows[0]
        now = _iso(_now())
        if etype.startswith("PAYMENT.SALE") or etype.startswith("BILLING.SUBSCRIPTION"):
            # El estado real siempre se vuelve a leer en PayPal
            try:
                sub = self.get_subscription(sub_id)
            except PayPalError as e:
                logger.warning(f"No se pudo leer la suscripción {sub_id}: {e}")
                return
            status = sub.get("status", row["status"])
            nb = (sub.get("billing_info") or {}).get("next_billing_time") or row["next_billing_at"]
            paid_until = row["paid_until"]
            if etype == "PAYMENT.SALE.COMPLETED" and nb:
                paid_until = nb
            plan = self._plan_for_paypal_id(sub.get("plan_id", "")) or (row["plan_key"], row["cycle"])
            self._run("""UPDATE zenith_subscriptions SET status = ?, next_billing_at = ?, paid_until = ?, plan_key = ?,
                         cycle = ?, updated_at = ? WHERE subscription_id = ?""",
                      (status, nb, paid_until, plan[0], plan[1], now, sub_id))
            if plan[0] != row["plan_key"]:
                tenant_registry.update(row["tenant"], features=PLANS[plan[0]]["features"])
            logger.info(f"💳 {etype}: «{row['tenant']}» queda {status}.")
        self.enforce(row["tenant"])

    def enforce(self, tenant: str) -> None:
        """Activa o desactiva la empresa según su suscripción."""
        sub = self.subscription_for_tenant(tenant)
        if not sub or normalize_slug(tenant) == DEFAULT_TENANT:
            return
        should_be_active = sub["status"] in ACTIVE_STATES
        if sub["status"] in ("CANCELLED", "EXPIRED"):
            # Cancelada: conserva el acceso hasta el fin del periodo pagado (+ días de gracia)
            limit = sub.get("paid_until") or ""
            try:
                until = datetime.fromisoformat(limit.replace("Z", "+00:00")) + timedelta(days=GRACE_DAYS)
                should_be_active = _now() < until
            except ValueError:
                should_be_active = False
        rec = tenant_registry.get(tenant) or {}
        if bool(rec.get("active")) != should_be_active:
            tenant_registry.update(tenant, active=should_be_active)
            logger.info(f"💳 Empresa «{tenant}» {'reactivada' if should_be_active else 'pausada'} por su suscripción.")

    def cancel(self, tenant: str, reason: str = "Cancelada por el cliente") -> Dict[str, Any]:
        sub = self.subscription_for_tenant(tenant)
        if not sub or sub["status"] not in ACTIVE_STATES:
            raise ValueError("No hay una suscripción activa.")
        self._api("POST", f"/v1/billing/subscriptions/{sub['subscription_id']}/cancel", {"reason": reason[:120]})
        self._run("UPDATE zenith_subscriptions SET status = 'CANCELLED', updated_at = ? WHERE subscription_id = ?",
                  (_iso(_now()), sub["subscription_id"]))
        self.enforce(tenant)
        return self.subscription_for_tenant(tenant)

    # ------------------------------------------------------------------ revisión periódica
    def start(self) -> None:
        """Una vez por hora revisa las suscripciones canceladas cuyo periodo ya venció."""
        if self._thread or not self.is_configured():
            return

        def loop():
            while True:
                time.sleep(3600)
                try:
                    self.ensure()
                    for r in self._run("SELECT DISTINCT tenant FROM zenith_subscriptions", fetch=True):
                        self.enforce(r["tenant"])
                except Exception as e:
                    logger.warning(f"Revisión de suscripciones falló: {e}")

        self._thread = threading.Thread(target=loop, daemon=True, name="billing-enforcer")
        self._thread.start()


billing_service = BillingService()
