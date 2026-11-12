"""Tests del módulo Caja & Finanzas: seguridad, rutas, anulaciones, arqueo y reportes."""
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import modules.finance.service as fin
from modules.finance.router import router
from modules.finance.service import finance_service
from services.auth_service import require_auth


class FakeDB:
    is_postgres = False

    def __init__(self, path):
        self.path = path

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn


class FinanceTestCase(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        self.service = finance_service
        self._previous_db = self.service._db
        self.service._db = FakeDB(self.path)
        self.service.init_tables()
        # Sin módulo restaurante en estos tests: zona horaria por defecto (El Salvador, UTC-6)
        self._offset = patch.object(fin, "_utc_offset", return_value=-6)
        self._offset.start()

    def tearDown(self):
        self._offset.stop()
        self.service._db = self._previous_db
        os.remove(self.path)

    def expense(self, amount=5.0, **kw):
        return self.service.record_transaction(type="expense", category="supplies", amount=amount,
                                               description="Gas", **kw)

    def income(self, amount=10.0, **kw):
        return self.service.record_transaction(type="income", category="sale", amount=amount,
                                               description="Venta", **kw)


class TestApiSecurityAndRoutes(FinanceTestCase):
    def setUp(self):
        super().setUp()
        self.app = FastAPI()
        self.app.include_router(router)

    def test_requires_login(self):
        client = TestClient(self.app)
        for method, url in (("get", "/api/finance/summary"), ("get", "/api/finance/transactions"),
                            ("post", "/api/finance/shifts/open"), ("post", "/api/finance/transactions/1/void")):
            self.assertEqual(getattr(client, method)(url).status_code, 401, url)

    def test_current_shift_ticket_route(self):
        self.app.dependency_overrides[require_auth] = lambda: True
        client = TestClient(self.app)
        self.service.open_shift("Ana", 20)
        res = client.get("/api/finance/shifts/current/ticket")
        self.assertEqual(res.status_code, 200)
        self.assertIn("CORTE PARCIAL X", res.text)


class TestVoiding(FinanceTestCase):
    def test_void_keeps_record_and_excludes_from_totals(self):
        self.service.open_shift("Ana", 20)
        tx = self.expense(5)
        voided = self.service.void_transaction(tx["id"], "Registrado por error")
        self.assertIsNotNone(voided["voided_at"])
        self.assertEqual(voided["void_reason"], "Registrado por error")
        self.assertEqual(len(self.service.list_transactions()), 1)  # sigue en el libro
        self.assertEqual(self.service.get_current_shift()["expected_cash"], 20.0)

    def test_void_rules(self):
        self.service.open_shift("Ana", 0)
        tx = self.expense(5)
        with self.assertRaises(ValueError):
            self.service.void_transaction(tx["id"], "")  # motivo obligatorio
        self.service.void_transaction(tx["id"], "Error")
        with self.assertRaises(ValueError):
            self.service.void_transaction(tx["id"], "Otra vez")  # ya anulado
        linked = self.income(8, source_module="restaurant", source_reference_id="order_1")
        with self.assertRaises(ValueError):
            self.service.void_transaction(linked["id"], "No")  # viene de otro módulo

    def test_closed_cut_is_frozen(self):
        self.service.open_shift("Ana", 0)
        tx = self.expense(5)
        self.service.close_shift(counted_cash=0)
        with self.assertRaises(ValueError):
            self.service.void_transaction(tx["id"], "Tarde")

    def test_reverted_order_payment(self):
        # Turno abierto: el cobro se anula
        self.service.open_shift("Ana", 0)
        self.income(8, source_module="restaurant", source_reference_id="order_1")
        self.assertTrue(self.service.void_source_transaction("restaurant", "order_1"))
        self.assertEqual(self.service.get_current_shift()["total_income"], 0.0)
        # Se vuelve a cobrar: se reactiva el mismo movimiento
        self.income(8, source_module="restaurant", source_reference_id="order_1")
        self.assertEqual(self.service.get_current_shift()["total_income"], 8.0)
        # Corte cerrado: no se toca, se registra un reembolso en el turno siguiente
        first = self.service.close_shift(counted_cash=8)
        self.service.open_shift("Luis", 0)
        self.assertTrue(self.service.void_source_transaction("restaurant", "order_1"))
        self.assertEqual(self.service.get_shift(first["id"])["total_sales_cash"], 8.0)
        current = self.service.get_current_shift()
        self.assertEqual(current["total_expenses_cash"], 8.0)


class TestCashWithoutShift(FinanceTestCase):
    def test_sales_without_open_shift_enter_next_shift(self):
        self.income(12)  # cobrado con la caja cerrada
        self.assertIsNone(self.service.list_transactions()[0]["shift_id"])
        shift = self.service.open_shift("Ana", 10)
        current = self.service.get_current_shift()
        self.assertEqual(current["total_sales_cash"], 12.0)
        self.assertEqual(current["expected_cash"], 22.0)
        self.assertEqual(self.service.list_transactions()[0]["shift_id"], shift["id"])


class TestSummaryPeriod(FinanceTestCase):
    def test_summary_respects_days(self):
        self.income(10)
        old = self.income(100)
        with self.service._tx() as tx:
            tx.execute("UPDATE finance_transactions SET created_at = ? WHERE id = ?",
                       ((datetime.now(timezone.utc) - timedelta(days=40)).isoformat(), old["id"]))
        self.assertEqual(self.service.get_summary(days=30)["total_income"], 10.0)
        self.assertEqual(self.service.get_summary(days=60)["total_income"], 110.0)
        voided = self.income(7)
        self.service.void_transaction(voided["id"], "Prueba")
        self.assertEqual(self.service.get_summary(days=30)["total_income"], 10.0)


class TestLocalTime(FinanceTestCase):
    def test_ticket_uses_local_time(self):
        shift = self.service.open_shift("Ana", 0)
        with self.service._tx() as tx:
            tx.execute("UPDATE finance_shifts SET opened_at = ? WHERE id = ?",
                       ("2026-11-05T18:30:00+00:00", shift["id"]))
        ticket = self.service.get_shift_ticket(None)
        self.assertIn("Apertura:     2026-11-05 12:30:00", ticket)


class TestOneOpenShift(FinanceTestCase):
    def test_second_open_rejected(self):
        self.service.open_shift("Ana", 0)
        with self.assertRaises(ValueError):
            self.service.open_shift("Luis", 0)

    def test_database_blocks_concurrent_open(self):
        """Aunque dos aperturas pasen la validación a la vez, la BD rechaza la segunda."""
        self.service.open_shift("Ana", 0)
        # Simula la carrera: la segunda apertura no "ve" la primera al validar
        with patch.object(self.service, "get_current_shift", return_value=None):
            with self.assertRaises(ValueError):
                self.service.open_shift("Luis", 0)
        self.assertEqual(sum(1 for s in self.service.list_shifts() if s["status"] == "open"), 1)


class TestExactMoney(FinanceTestCase):
    def test_no_lost_cents(self):
        self.service.open_shift("Ana", 0)
        for _ in range(10):
            self.income(0.1)
        for _ in range(3):
            self.expense(0.1)
        shift = self.service.get_current_shift()
        self.assertEqual(shift["total_sales_cash"], 1.0)  # con float daría 0.9999999999999999
        self.assertEqual(shift["expected_cash"], 0.7)
        closed = self.service.close_shift(counted_cash=0.7)
        self.assertEqual(closed["difference"], 0.0)

    def test_amount_rounded_to_cents(self):
        self.assertEqual(self.income(10.005)["amount"], 10.01)


class TestAudit(FinanceTestCase):
    def test_actions_are_logged(self):
        shift = self.service.open_shift("Ana", 20, client_ip="10.0.0.5")
        tx = self.expense(5, created_by="Ana")
        self.service.void_transaction(tx["id"], "Duplicado", voided_by="Luis")
        self.service.close_shift(counted_cash=20, closed_by="Luis")
        log = self.service.list_audit()
        self.assertEqual([e["action"] for e in reversed(log)], ["shift_open", "tx_create", "tx_void", "shift_close"])
        self.assertEqual(log[-1]["actor"], "Ana")
        self.assertEqual(log[-1]["client_ip"], "10.0.0.5")
        self.assertEqual(log[1]["actor"], "Luis")
        self.assertIn("Duplicado", log[1]["detail"])
        self.assertEqual(len(self.service.list_audit(entity="shift", entity_id=shift["id"])), 2)


class TestRestaurantSync(FinanceTestCase):
    def test_sync_imports_only_missing_paid_orders(self):
        with self.service._tx() as tx:
            tx.execute("CREATE TABLE restaurant_orders (id INTEGER PRIMARY KEY, total REAL, payment_method TEXT, "
                       "customer_name TEXT, payment_status TEXT)")
            tx.execute("INSERT INTO restaurant_orders VALUES (1, 8.5, 'cash', 'Ana', 'paid'), "
                       "(2, 4.0, 'card', 'Luis', 'pending'), (3, 3.25, 'transfer', 'Eva', 'paid')")
        self.income(8.5, source_module="restaurant", source_reference_id="order_1")  # ya registrado
        self.assertEqual(self.service.sync_unrecorded_restaurant_sales(), 1)  # solo el #3
        self.assertEqual(self.service.sync_unrecorded_restaurant_sales(), 0)  # idempotente
        refs = sorted(t["source_reference_id"] for t in self.service.list_transactions())
        self.assertEqual(refs, ["order_1", "order_3"])

    def test_reads_do_not_trigger_sync(self):
        with patch.object(self.service, "sync_unrecorded_restaurant_sales") as sync:
            self.service.get_current_shift()
            self.service.list_transactions()
            self.service.get_summary()
            sync.assert_not_called()


class TestCashMovements(FinanceTestCase):
    def test_withdrawal_and_deposit_affect_cash_not_profit(self):
        self.service.open_shift("Ana", 50)
        self.income(30)
        self.service.record_transaction(type="withdrawal", category="x", amount=40, description="Depósito al banco")
        self.service.record_transaction(type="deposit", category="x", amount=10, description="Cambio de gerencia")
        shift = self.service.get_current_shift()
        self.assertEqual(shift["total_withdrawals"], 40.0)
        self.assertEqual(shift["total_deposits"], 10.0)
        self.assertEqual(shift["expected_cash"], 50.0)  # 50 + 30 + 10 - 40
        summary = self.service.get_summary()
        self.assertEqual((summary["total_income"], summary["total_expense"]), (30.0, 0.0))
        closed = self.service.close_shift(counted_cash=50)
        self.assertEqual(closed["total_withdrawals"], 40.0)
        self.assertIn("Retiros caja", self.service.get_shift_ticket(closed["id"]))


class TestDenominations(FinanceTestCase):
    def test_close_with_denomination_count(self):
        self.service.open_shift("Ana", 20)
        self.income(13.65)
        closed = self.service.close_shift(denominations={"20": 1, "10": 1, "1": 3, "0.25": 2, "0.10": 1, "0.05": 1})
        self.assertEqual(closed["counted_cash"], 33.65)
        self.assertEqual(closed["difference"], 0.0)
        ticket = self.service.get_shift_ticket(closed["id"])
        self.assertIn("CONTEO POR DENOMINACION", ticket)
        self.assertIn("0.25 x    2", ticket)

    def test_invalid_denominations(self):
        self.service.open_shift("Ana", 0)
        with self.assertRaises(ValueError):
            self.service.close_shift(denominations={"3": 1})
        with self.assertRaises(ValueError):
            self.service.close_shift(denominations={"20": -1})
        with self.assertRaises(ValueError):
            self.service.close_shift()  # sin conteo ni total


class TestCategories(FinanceTestCase):
    def test_defaults_and_validation(self):
        keys = {c["key"] for c in self.service.list_categories()}
        self.assertTrue({"sale", "supplies", "refund", "rent"} <= keys)
        with self.assertRaises(ValueError):
            self.service.record_transaction(type="expense", category="no_existe", amount=1, description="x")
        with self.assertRaises(ValueError):
            self.service.record_transaction(type="income", category="supplies", amount=1, description="x")

    def test_create_deactivate_and_protect_system(self):
        cat = self.service.create_category("Publicidad en redes", "expense")
        self.assertEqual(cat["key"], "publicidad_en_redes")
        with self.assertRaises(ValueError):
            self.service.create_category("publicidad en redes", "expense")  # duplicado
        self.service.update_category(cat["key"], active=False)
        with self.assertRaises(ValueError):
            self.service.record_transaction(type="expense", category=cat["key"], amount=1, description="x")
        with self.assertRaises(ValueError):
            self.service.update_category("sale", active=False)


class TestReports(FinanceTestCase):
    def _at(self, tx, iso):
        with self.service._tx() as t:
            t.execute("UPDATE finance_transactions SET created_at = ? WHERE id = ?", (iso, tx["id"]))

    def test_range_monthly_and_previous_period(self):
        self._at(self.income(100), "2026-10-10T18:00:00+00:00")
        self._at(self.expense(40), "2026-10-20T18:00:00+00:00")
        self._at(self.income(50), "2026-11-02T18:00:00+00:00")
        self._at(self.income(80), "2026-09-15T18:00:00+00:00")  # período anterior
        # 1 de octubre 03:00 UTC = 30 de septiembre 21:00 en El Salvador: cae en septiembre
        self._at(self.income(5), "2026-10-01T03:00:00+00:00")
        report = self.service.get_report("2026-10-01", "2026-11-30")
        self.assertEqual((report["income"], report["expense"], report["net"]), (150.0, 40.0, 110.0))
        self.assertEqual([m["month"] for m in report["monthly"]], ["2026-10", "2026-11"])
        self.assertEqual(report["previous"]["income"], 85.0)
        self.assertEqual(report["previous"]["income_change_pct"], 76.5)
        self.assertEqual(report["by_category"][0]["label"], "Insumos y comida")
        with self.assertRaises(ValueError):
            self.service.get_report("2026-11-30", "2026-10-01")

    def test_transactions_date_filter(self):
        self._at(self.income(1), "2026-11-05T05:00:00+00:00")  # 4 nov 23:00 local
        self._at(self.income(2), "2026-11-05T07:00:00+00:00")  # 5 nov 01:00 local
        rows = self.service.list_transactions(start="2026-11-05", end="2026-11-05")
        self.assertEqual([r["amount"] for r in rows], [2.0])


class TestReceipts(FinanceTestCase):
    def test_attach_and_read_receipt(self):
        tx = self.expense(5)
        data = "data:image/png;base64," + "A" * 100
        updated = self.service.set_receipt(tx["id"], data, "factura.png")
        self.assertEqual(updated["has_receipt"], 1)
        self.assertNotIn("receipt_data", self.service.list_transactions()[0])  # la lista no carga el archivo
        self.assertEqual(self.service.get_receipt(tx["id"])["data_url"], data)

    def test_receipt_validation(self):
        tx = self.expense(5)
        with self.assertRaises(ValueError):
            self.service.set_receipt(tx["id"], "data:text/html;base64,AAAA")
        with self.assertRaises(ValueError):
            self.service.set_receipt(tx["id"], "data:image/png;base64," + "A" * 2_000_001)
        self.assertIsNone(self.service.set_receipt(999, "data:image/png;base64,AAAA"))


if __name__ == "__main__":
    unittest.main()
