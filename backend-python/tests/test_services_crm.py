"""CRM de Servicios: el agente guarda leads y registra reuniones (antes fallaba por columnas faltantes)."""
import os
import sqlite3
import tempfile
import unittest

from modules.services.module import _tool_guardar_lead, _tool_registrar_reunion
from modules.services.service import prof_services_service
from services import agents
from services.agent_tools import ToolContext
from tests.test_restaurant import FakeDB


class TestServicesCrm(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        # Tabla con el esquema antiguo (sin session_id ni transcripción), como en instalaciones existentes
        conn = sqlite3.connect(self.path)
        conn.execute("""CREATE TABLE prof_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                        company TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
                        service_interest TEXT DEFAULT '', status TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'manual',
                        notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT)""")
        conn.commit()
        conn.close()
        self._prev = (prof_services_service._db, prof_services_service._initialized)
        prof_services_service._initialized = False
        prof_services_service.init_tables(FakeDB(self.path))
        self.ctx = ToolContext(session_id="50371970983")

    def tearDown(self):
        prof_services_service._db, prof_services_service._initialized = self._prev
        try:
            os.remove(self.path)
        except OSError:
            pass

    def test_lead_saved_on_old_schema(self):
        res = _tool_guardar_lead(self.ctx, {"nombre": "Daniel", "servicio_interes": "Zenith ARM"})
        self.assertTrue(res["ok"], res)
        leads = prof_services_service.list_leads()
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["phone"], "+50371970983")

    def test_meeting_updates_same_lead(self):
        _tool_guardar_lead(self.ctx, {"nombre": "Daniel"})
        res = _tool_registrar_reunion(self.ctx, {"nombre": "Daniel", "fecha_hora": "viernes 3 pm"})
        self.assertTrue(res["ok"], res)
        leads = prof_services_service.list_leads()
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["status"], "reunion")
        self.assertEqual(leads[0]["meeting_at"], "viernes 3 pm")

    def test_sales_areas_can_use_crm_tools(self):
        for area in ("recepcion", "ventas"):
            names = agents.tool_names(area) or []
            if names:
                self.assertIn("guardar_lead", names)
                self.assertIn("registrar_reunion", names)


if __name__ == "__main__":
    unittest.main()
