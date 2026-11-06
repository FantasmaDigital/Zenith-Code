import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.restaurant import chat_orders
from modules.restaurant.models import MenuItemCreate, MenuItemUpdate, OrderCreate, OrderItemIn
from modules.restaurant.router import router
from modules.restaurant.service import OrderError, restaurant_service
from services.auth_service import require_auth


class FakeDB:
    """Base SQLite temporal con la interfaz mínima que usa el servicio."""
    is_postgres = False

    def __init__(self, path):
        self.path = path
        self.settings = {}

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_setting(self, key, default=""):
        return self.settings.get(key, default)

    def set_setting(self, key, value):
        self.settings[key] = value


def utc(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


class RestaurantTestCase(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        self.db = FakeDB(self.path)
        self.service = restaurant_service
        self._previous_db = self.service._db
        self.service.init_tables(self.db)
        self.service.save_config({
            "restaurant_name": "Pupusería Test", "accepting_orders": True,
            "hours": {d: {"closed": False, "open": "00:00", "close": "23:59"} for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")},
            "order_types": {"delivery": True, "pickup": True, "dine_in": False},
            "payment_methods": {"cash": True, "transfer": True, "card": False},
            "transfer_info": "Banco X cuenta 123", "prep_minutes": 20,
            "zones": [{"name": "Centro", "fee": 2.0, "min_order": 5.0, "minutes": 10}],
        })
        self.pupusa = self.service.add_menu_item(MenuItemCreate(name="Pupusa revuelta", price=1.5, category="Pupusas", stock=10))
        self.horchata = self.service.add_menu_item(MenuItemCreate(name="Horchata", price=1.0, category="Bebidas"))

    def tearDown(self):
        self.service._db = self._previous_db
        try:
            os.remove(self.path)
        except OSError:
            pass

    def order(self, **kwargs):
        defaults = dict(session_id="50370001234", customer_name="Ana", order_type="delivery",
                        delivery_address="Col. Escalón #5", delivery_zone="Centro", payment_method="cash",
                        items=[OrderItemIn(menu_item_id=self.pupusa["id"], quantity=4)])
        defaults.update(kwargs)
        return OrderCreate(**defaults)


class TestOrders(RestaurantTestCase):
    def test_total_is_computed_by_server_with_delivery_fee(self):
        order = self.service.create_order(self.order())
        self.assertEqual(order["subtotal"], 6.0)
        self.assertEqual(order["delivery_fee"], 2.0)
        self.assertEqual(order["total"], 8.0)
        self.assertEqual(order["estimated_minutes"], 30)
        self.assertEqual(order["customer_phone"], "50370001234")

    def test_stock_is_decremented_and_item_sells_out(self):
        self.service.create_order(self.order(items=[OrderItemIn(menu_item_id=self.pupusa["id"], quantity=10)]))
        item = self.service.get_menu_item(self.pupusa["id"])
        self.assertEqual(item["stock"], 0)
        self.assertFalse(item["available"])
        with self.assertRaises(OrderError):
            self.service.create_order(self.order())

    def test_not_enough_stock_is_rejected(self):
        with self.assertRaisesRegex(OrderError, "Solo quedan 10"):
            self.service.create_order(self.order(items=[OrderItemIn(menu_item_id=self.pupusa["id"], quantity=11)]))

    def test_cancel_restores_stock_and_blocks_further_changes(self):
        order = self.service.create_order(self.order())
        self.assertEqual(self.service.get_menu_item(self.pupusa["id"])["stock"], 6)
        with patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True):
            cancelled = self.service.update_order_status(order["id"], "cancelled", "Sin ingredientes")
        self.assertEqual(self.service.get_menu_item(self.pupusa["id"])["stock"], 10)
        self.assertEqual(cancelled["cancel_reason"], "Sin ingredientes")
        with self.assertRaises(OrderError):
            self.service.update_order_status(order["id"], "preparing")

    def test_delivery_rules(self):
        with self.assertRaisesRegex(OrderError, "dirección"):
            self.service.create_order(self.order(delivery_address=""))
        with self.assertRaisesRegex(OrderError, "zona"):
            self.service.create_order(self.order(delivery_zone="Marte"))
        with self.assertRaisesRegex(OrderError, r"mínimo.*\$5.00"):
            self.service.create_order(self.order(items=[OrderItemIn(menu_item_id=self.pupusa["id"], quantity=1)]))

    def test_pickup_has_no_fee_or_address(self):
        order = self.service.create_order(self.order(order_type="pickup", delivery_zone="", delivery_address="x"))
        self.assertEqual(order["delivery_fee"], 0)
        self.assertEqual(order["delivery_address"], "")
        self.assertEqual(order["total"], 6.0)

    def test_disabled_type_and_payment_rejected(self):
        with self.assertRaisesRegex(OrderError, "tipo de pedido"):
            self.service.create_order(self.order(order_type="dine_in"))
        with self.assertRaisesRegex(OrderError, "método de pago"):
            self.service.create_order(self.order(payment_method="card"))

    def test_status_change_notifies_customer(self):
        order = self.service.create_order(self.order())
        with patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True) as send:
            updated = self.service.update_order_status(order["id"], "confirmed")
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0], "50370001234")
        self.assertIn("confirmado", send.call_args.args[1])
        self.assertTrue(updated["notified"])
        with patch("services.whatsapp_service.whatsapp_service.send_text_message") as send:
            self.service.update_order_status(order["id"], "preparing", notify=False)
        send.assert_not_called()

    def test_search_filters_and_active_status(self):
        first = self.service.create_order(self.order(customer_name="Ana"))
        self.service.create_order(self.order(customer_name="Luis", session_id="50370009999"))
        self.assertEqual(len(self.service.list_orders(search="luis")), 1)
        self.assertEqual(len(self.service.list_orders(search=str(first["id"]))), 1)
        self.service.update_order_status(first["id"], "delivered", notify=False)
        self.assertEqual(len(self.service.list_orders("active")), 1)

    def test_ticket_contains_key_data(self):
        order = self.service.create_order(self.order(notes="Sin curtido"))
        ticket = self.service.build_ticket(order)
        for expected in ("Pupusería Test", "4 x Pupusa revuelta", "TOTAL: $8.00", "Col. Escalón #5", "Sin curtido"):
            self.assertIn(expected, ticket)


class TestSchedule(RestaurantTestCase):
    def test_open_closed_and_overnight(self):
        self.service.save_config({"hours": {
            "mon": {"closed": False, "open": "10:00", "close": "21:00"},
            "tue": {"closed": True, "open": "10:00", "close": "21:00"},
            "fri": {"closed": False, "open": "18:00", "close": "02:00"},
            "sat": {"closed": False, "open": "10:00", "close": "21:00"},
        }})
        config = self.service.get_config()
        # UTC-6: 2026-11-02 es lunes. 16:00 UTC = 10:00 local
        self.assertTrue(self.service.is_open(config, utc(2026, 11, 2, 16)))
        self.assertFalse(self.service.is_open(config, utc(2026, 11, 2, 15, 59)))
        self.assertFalse(self.service.is_open(config, utc(2026, 11, 3, 18)))  # martes cerrado
        self.assertTrue(self.service.is_open(config, utc(2026, 11, 7, 6)))    # viernes 00:00 local... sábado 00:00 UTC-6 = viernes noche
        self.assertTrue(self.service.is_open(config, utc(2026, 11, 7, 7, 30)))  # viernes 01:30 local sigue abierto

    def test_master_switch_closes_the_kitchen(self):
        self.service.save_config({"accepting_orders": False})
        self.assertFalse(self.service.is_open())

    def test_bot_orders_are_rejected_when_closed_but_manual_are_not(self):
        self.service.save_config({"accepting_orders": False, "closed_message": "Volvemos mañana"})
        with self.assertRaisesRegex(OrderError, "Volvemos mañana"):
            self.service.create_order(self.order(), source="bot", enforce_schedule=True)
        self.assertEqual(self.service.create_order(self.order(), source="manual")["status"], "pending")


class TestChatOrders(RestaurantTestCase):
    def tag(self, **overrides):
        payload = ('{"type":"delivery","zone":"Centro","address":"Col. Escalón #5","payment":"cash","name":"Ana",'
                   f'"notes":"","items":[{{"id":{self.pupusa["id"]},"qty":4,"notes":"sin curtido"}}]}}')
        return f"[[PEDIDO]]{payload}[[/PEDIDO]]"

    def test_confirmed_order_becomes_real_and_tag_is_replaced(self):
        reply = chat_orders.process_reply("50370001234", f"¡Perfecto Ana! Registrando tu pedido.\n{self.tag()}")
        self.assertNotIn("[[", reply)
        self.assertNotIn("{", reply)
        self.assertIn("Pedido #", reply)
        self.assertIn("$8.00", reply)
        orders = self.service.list_orders()
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0]["source"], "bot")
        self.assertEqual(orders[0]["items"][0]["notes"], "sin curtido")

    def test_ai_cannot_set_prices_and_duplicates_are_ignored(self):
        tag = self.tag().replace('"qty":4', '"qty":4,"price":0.01')
        chat_orders.process_reply("50370001234", tag)
        again = chat_orders.process_reply("50370001234", tag)
        self.assertEqual(len(self.service.list_orders()), 1)
        self.assertEqual(self.service.list_orders()[0]["total"], 8.0)
        self.assertIn("ya quedó anotado", again)

    def test_invalid_order_returns_customer_friendly_error(self):
        reply = chat_orders.process_reply("50370001234", self.tag().replace("Centro", "Marte"))
        self.assertIn("antes de anotarlo", reply)
        self.assertIn("Centro", reply)
        self.assertEqual(self.service.list_orders(), [])

    def test_broken_json_never_leaks_to_customer(self):
        reply = chat_orders.process_reply("5037", "Listo [[PEDIDO]]{no es json[[/PEDIDO]]")
        self.assertNotIn("[[", reply)
        self.assertNotIn("no es json", reply)
        self.assertIn("no me quedó claro", reply)
        self.assertEqual(chat_orders.process_reply("5037", "Hola [[PEDIDO]] sin cerrar"), "Hola  sin cerrar")

    def test_status_and_cancel_tags(self):
        chat_orders.process_reply("50370001234", self.tag())
        status = chat_orders.process_reply("50370001234", "[[ESTADO]]")
        self.assertIn("Pendiente", status)
        cancelled = chat_orders.process_reply("50370001234", "[[CANCELAR]]")
        self.assertIn("cancelé", cancelled)
        self.assertEqual(self.service.list_orders()[0]["status"], "cancelled")
        self.assertIn("No tienes un pedido activo", chat_orders.process_reply("50370001234", "[[CANCELAR]]"))

    def test_cannot_cancel_once_preparing(self):
        chat_orders.process_reply("50370001234", self.tag())
        with patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True):
            self.service.update_order_status(self.service.list_orders()[0]["id"], "preparing")
        self.assertIn("no puedo", chat_orders.process_reply("50370001234", "[[CANCELAR]]"))

    def test_prompt_extension_has_live_data(self):
        text = chat_orders.build_prompt_extension()
        for expected in ("Pupusería Test", "[id %d]" % self.pupusa["id"], "Centro $2.00", "Banco X cuenta 123",
                         "crear_pedido"):
            self.assertIn(expected, text)
        # Lo volátil (abierto/cerrado) va en el contexto en vivo, no en el prompt cacheado
        self.assertNotIn("ABIERTO", text)
        self.assertIn("ABIERTO", chat_orders.build_live_context())
        self.service.save_config({"accepting_orders": False})
        self.assertIn("CERRADO", chat_orders.build_live_context())
        self.assertEqual(text, chat_orders.build_prompt_extension())

    def test_full_chat_flow_creates_order_and_history_shows_final_text(self):
        from modules.registry import module_registry
        from modules.restaurant.module import RestaurantModule
        from services.ai_service import ai_service
        from services.lead_service import lead_service

        raw = f"Registrando tu pedido.\n{self.tag()}"

        def fake_engine(session_id, user_message="", **kwargs):
            lead_service.add_message(session_id, "user", user_message)
            lead_service.add_message(session_id, "assistant", raw)  # como hacen Gemini/OpenAI
            return raw

        session = "5037FLOW0001"
        with patch.dict(module_registry._loaded, {"restaurant": RestaurantModule()}, clear=False), \
             patch("services.gemini_service.gemini_service.execute_reply", side_effect=fake_engine), \
             patch("services.ai_service.settings.AI_PROVIDER", "gemini"):
            reply = ai_service.generate_reply(session, "Sí, confirmo")
        self.assertIn("Pedido #", reply)
        self.assertNotIn("[[", reply)
        self.assertEqual(len(self.service.list_orders()), 1)
        last = lead_service.get_or_create_session(session).messages[-1]
        self.assertEqual(last["content"], reply)  # la IA verá el total oficial, no la etiqueta
        lead_service._sessions.pop(session, None)

    def test_replies_without_tags_pass_through_untouched(self):
        self.assertEqual(chat_orders.process_reply("1", "Hola, ¿qué te sirvo?"), "Hola, ¿qué te sirvo?")


class TestStats(RestaurantTestCase):
    def test_stats_aggregate_sales_and_exclude_cancelled(self):
        a = self.service.create_order(self.order())
        b = self.service.create_order(self.order(order_type="pickup", session_id="50370009999"))
        self.service.update_order_status(b["id"], "cancelled", notify=False)
        stats = self.service.get_stats(7)
        self.assertEqual(stats["range"]["orders"], 1)
        self.assertEqual(stats["range"]["sales"], a["total"])
        self.assertEqual(stats["range"]["cancelled"], 1)
        self.assertEqual(stats["top_items"][0]["name"], "Pupusa revuelta")
        self.assertEqual(stats["top_items"][0]["quantity"], 4)
        self.assertEqual(len(stats["by_day"]), 7)
        self.assertEqual(sum(h["orders"] for h in stats["by_hour"]), 1)
        self.assertEqual(stats["today"]["active"], 1)


class TestMenuAndLegacyMigration(RestaurantTestCase):
    def test_stock_zero_disables_and_restock_reenables_and_null_removes_limit(self):
        item = self.service.update_menu_item(self.pupusa["id"], MenuItemUpdate(stock=0))
        self.assertFalse(item["available"])
        item = self.service.update_menu_item(self.pupusa["id"], MenuItemUpdate(stock=5))
        self.assertTrue(item["available"])
        item = self.service.update_menu_item(self.pupusa["id"], MenuItemUpdate.model_validate({"stock": None}))
        self.assertIsNone(item["stock"])

    def test_old_v1_database_is_migrated_in_place(self):
        fd, legacy_path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        conn = sqlite3.connect(legacy_path)
        conn.executescript("""
            CREATE TABLE restaurant_menu (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
                price REAL NOT NULL DEFAULT 0, category TEXT DEFAULT 'General', available INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE restaurant_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, customer_name TEXT DEFAULT 'Cliente',
                items_json TEXT NOT NULL DEFAULT '[]', status TEXT DEFAULT 'pending', total REAL DEFAULT 0, notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO restaurant_menu (name, price) VALUES ('Viejo plato', 3.5);
            INSERT INTO restaurant_orders (session_id, items_json, total) VALUES ('503', '[]', 7.0);
        """)
        conn.commit()
        conn.close()
        try:
            self.service.init_tables(FakeDB(legacy_path))
            self.assertEqual(self.service.list_menu()[0]["name"], "Viejo plato")
            order = self.service.list_orders()[0]
            self.assertEqual(order["total"], 7.0)
            self.assertEqual(order["order_type"], "delivery")
            self.assertEqual(order["payment_status"], "pending")
        finally:
            os.remove(legacy_path)


class TestApi(RestaurantTestCase):
    def setUp(self):
        super().setUp()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_auth] = lambda: "admin"
        self.client = TestClient(app)
        self.anon = TestClient(FastAPI())
        locked = FastAPI()
        locked.include_router(router)
        self.locked = TestClient(locked)

    def test_all_routes_require_auth(self):
        for method, path in [("get", "/api/restaurant/menu"), ("get", "/api/restaurant/orders"),
                             ("get", "/api/restaurant/config"), ("get", "/api/restaurant/stats"),
                             ("put", "/api/restaurant/config")]:
            self.assertEqual(getattr(self.locked, method)(path).status_code, 401, path)

    def test_config_roundtrip_and_validation(self):
        res = self.client.put("/api/restaurant/config", json={"prep_minutes": 35, "accepting_orders": False})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["config"]["prep_minutes"], 35)
        self.assertFalse(res.json()["open_now"])
        self.assertEqual(self.client.get("/api/restaurant/config").json()["config"]["restaurant_name"], "Pupusería Test")
        bad = self.client.put("/api/restaurant/config", json={"hours": {"mon": {"open": "25:99", "close": "10:00"}}})
        self.assertEqual(bad.status_code, 422)

    def test_order_lifecycle_through_api(self):
        res = self.client.post("/api/restaurant/orders", json={
            "session_id": "50370001234", "customer_name": "Ana", "order_type": "pickup", "payment_method": "transfer",
            "items": [{"menu_item_id": self.pupusa["id"], "quantity": 2}]})
        self.assertEqual(res.status_code, 200)
        order_id = res.json()["order"]["id"]
        with patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True):
            res = self.client.patch(f"/api/restaurant/orders/{order_id}/status", json={"status": "confirmed"})
        self.assertTrue(res.json()["customer_notified"])
        paid = self.client.patch(f"/api/restaurant/orders/{order_id}/payment", json={"payment_status": "paid"})
        self.assertEqual(paid.json()["order"]["payment_status"], "paid")
        self.assertIn("TOTAL: $3.00", self.client.get(f"/api/restaurant/orders/{order_id}/ticket").text)
        self.assertEqual(self.client.get("/api/restaurant/orders", params={"status": "active"}).json()["orders"][0]["id"], order_id)

    def test_business_rule_errors_are_400_and_terminal_state_is_409(self):
        res = self.client.post("/api/restaurant/orders", json={
            "session_id": "x", "order_type": "dine_in", "items": [{"menu_item_id": self.pupusa["id"], "quantity": 1}]})
        self.assertEqual(res.status_code, 400)
        ok = self.service.create_order(self.order())
        with patch("services.whatsapp_service.whatsapp_service.send_text_message", return_value=True):
            self.client.patch(f"/api/restaurant/orders/{ok['id']}/status", json={"status": "delivered"})
        again = self.client.patch(f"/api/restaurant/orders/{ok['id']}/status", json={"status": "preparing"})
        self.assertEqual(again.status_code, 409)

    def test_menu_bulk_and_stock_null_via_api(self):
        res = self.client.post("/api/restaurant/menu/bulk", json={"items": [
            {"name": "Yuca frita", "price": 2.5, "category": "Entradas"}, {"name": "Tamal", "price": 1.25, "stock": 8}]})
        self.assertEqual(res.json()["count"], 2)
        tamal = res.json()["items"][1]
        cleared = self.client.patch(f"/api/restaurant/menu/{tamal['id']}", json={"stock": None})
        self.assertIsNone(cleared.json()["item"]["stock"])
        self.assertEqual(self.client.patch("/api/restaurant/menu/9999", json={"price": 1}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
