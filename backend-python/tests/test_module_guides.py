"""Cada módulo debe traer una guía de uso completa en su manifest (se muestra en el panel)."""
import unittest

from modules.registry import ModuleRegistry

# Pantallas reales de cada módulo: la guía debe documentarlas todas (el id abre esa pantalla desde la guía)
EXPECTED_SECTIONS = {
    "restaurant": {"kanban", "orders", "menu", "stats", "settings"},
    "finance": {"shift", "shifts_history", "transactions", "reports", "categories", "audit"},
}


class TestModuleGuides(unittest.TestCase):
    def setUp(self):
        registry = ModuleRegistry()
        registry.discover()
        self.manifests = {m["id"]: m for m in registry.get_available()}

    def test_every_module_has_a_complete_guide(self):
        self.assertTrue(self.manifests)
        for module_id, manifest in self.manifests.items():
            with self.subTest(module=module_id):
                guide = manifest.get("guide")
                self.assertIsInstance(guide, dict, "falta la guía de uso en el manifest")
                self.assertGreater(len(guide.get("summary", "")), 40)
                self.assertTrue(guide.get("quick_start"))
                self.assertTrue(guide.get("sections"))
                for section in guide["sections"]:
                    for field in ("id", "title", "what", "how"):
                        self.assertTrue(section.get(field), f"sección sin «{field}»: {section.get('id')}")
                    self.assertIsInstance(section.get("tips", []), list)
                for item in guide.get("faq", []):
                    self.assertTrue(item.get("q") and item.get("a"))

    def test_guides_cover_every_screen(self):
        for module_id, expected in EXPECTED_SECTIONS.items():
            with self.subTest(module=module_id):
                ids = [s["id"] for s in self.manifests[module_id]["guide"]["sections"]]
                self.assertEqual(set(ids), expected)
                self.assertEqual(len(ids), len(set(ids)), "secciones repetidas")


if __name__ == "__main__":
    unittest.main()
