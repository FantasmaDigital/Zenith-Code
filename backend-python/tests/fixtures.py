import base64
from fastapi.testclient import TestClient
from config import settings
from main import app

# Las pruebas se autentican como el gateway (clave interna); se fija una si el .env no la trae
if not settings.INTERNAL_API_KEY:
    settings.INTERNAL_API_KEY = "test-internal-key"

# 1x1 GIF transparente válido para pruebas de visión/imagen en base64
SAMPLE_IMAGE_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

# Payload OGG Opus simulado para pruebas de audio en base64
SAMPLE_AUDIO_BASE64 = base64.b64encode(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00ZenithAudioSample").decode("utf-8")

def get_test_client() -> TestClient:
    """Retorna una instancia configurada de TestClient para la API FastAPI."""
    return TestClient(app, headers={"X-Internal-Key": settings.INTERNAL_API_KEY})

def get_anonymous_client() -> TestClient:
    """TestClient sin credenciales, para verificar que la API rechaza accesos no autenticados."""
    return TestClient(app)
