# Package tests
#
# La memoria de clientes guarda cada mensaje en la base de datos. Durante los tests se usa una base
# SQLite temporal para no escribir conversaciones de prueba en la base real.
import atexit
import os
import sqlite3
import tempfile


class _TempCustomerDB:
    is_postgres = False

    def __init__(self):
        fd, self.path = tempfile.mkstemp(suffix="_customers_test.sqlite")
        os.close(fd)
        self.settings = {}

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_setting(self, key, default=""):
        return self.settings.get(key, default)

    def set_setting(self, key, value):
        self.settings[key] = value


def _isolate_customer_memory():
    from services.automation_service import automation_service
    from services.customer_service import customer_service
    from services.metrics_service import metrics_service
    db = _TempCustomerDB()
    metrics_service._db = db
    metrics_service._ready = False
    customer_service._db = db
    customer_service._ready = False
    automation_service._db = db
    automation_service._ready = False
    atexit.register(lambda: os.path.exists(db.path) and os.remove(db.path))


_isolate_customer_memory()
