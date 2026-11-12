import unittest
from unittest.mock import MagicMock
from services.gemini_service import GeminiService


class TestGeminiPromptCache(unittest.TestCase):
    def setUp(self):
        self.svc = GeminiService()
        self.client = MagicMock()
        self.client.caches.create.return_value = MagicMock(name="cache")
        self.client.caches.create.return_value.name = "cachedContents/abc"

    def test_prompt_uploaded_once_and_reused(self):
        for _ in range(3):
            self.svc._generate(self.client, "PROMPT", [], {"temperature": 0.0})
        self.assertEqual(self.client.caches.create.call_count, 1)
        cfg = self.client.models.generate_content.call_args.kwargs["config"]
        self.assertEqual(cfg.cached_content, "cachedContents/abc")
        self.assertIsNone(cfg.system_instruction)

    def test_changed_prompt_creates_new_cache(self):
        self.svc._generate(self.client, "PROMPT A", [], {})
        self.svc._generate(self.client, "PROMPT B", [], {})
        self.assertEqual(self.client.caches.create.call_count, 2)

    def test_cache_unavailable_falls_back_without_retrying_every_message(self):
        self.client.caches.create.side_effect = Exception("too few tokens")
        for _ in range(3):
            self.svc._generate(self.client, "PROMPT", [], {})
        self.assertEqual(self.client.caches.create.call_count, 1)
        cfg = self.client.models.generate_content.call_args.kwargs["config"]
        self.assertEqual(cfg.system_instruction, "PROMPT")

    def test_expired_cache_retries_with_full_prompt(self):
        self.client.models.generate_content.side_effect = [Exception("cache not found"), "ok"]
        self.assertEqual(self.svc._generate(self.client, "PROMPT", [], {}), "ok")
        cfg = self.client.models.generate_content.call_args.kwargs["config"]
        self.assertEqual(cfg.system_instruction, "PROMPT")


if __name__ == "__main__":
    unittest.main()
