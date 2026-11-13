"""
Capas de seguridad HTTP del backend (middlewares ASGI puros, sin dependencias externas):

- SecurityHeadersMiddleware: cabeceras defensivas en todas las respuestas y `no-store` en la API.
- RateLimitMiddleware: límite de peticiones por IP en las rutas públicas (login, invitaciones, tarjetas de
  fidelidad, webhook). Ventana deslizante en memoria: vale porque el backend corre con un solo worker
  (igual que el bloqueo de login). Detrás de Caddy la IP real llega por X-Forwarded-For (--proxy-headers).
"""
import os
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Tuple

# (prefijo de ruta, peticiones permitidas, ventana en segundos). Gana el primer prefijo que coincida.
DEFAULT_RULES: List[Tuple[str, int, int]] = [
    ("/api/auth/login", 20, 60),
    # Endpoints que verifican la contraseña actual: sin esto se podrían probar contraseñas con un token robado
    ("/api/auth/owner", 10, 60),
    ("/api/auth/password", 10, 60),
    # Recuperación de contraseña: pocos correos por IP para no usarla como cañón de spam
    ("/api/public/password-reset/request", 5, 600),
    ("/api/public/", 120, 60),
    ("/webhook/meta", 600, 60),
]

_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
                            b"accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()"),
    # La API solo devuelve JSON/archivos: nada de scripts, ni ser incrustada en otra página
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    (b"x-permitted-cross-domain-policies", b"none"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
]


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        is_api = scope.get("path", "").startswith("/api/")

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"server"]
                present = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in _SECURITY_HEADERS if k not in present]
                if is_api and b"cache-control" not in present:
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RateLimiter:
    """Ventana deslizante por (regla, IP). Thread-safe: los endpoints síncronos corren en hilos."""

    def __init__(self, rules: List[Tuple[str, int, int]]):
        self.rules = rules
        self._hits: Dict[Tuple[str, str], Deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def rule_for(self, path: str):
        for rule in self.rules:
            if path.startswith(rule[0]):
                return rule
        return None

    def hit(self, path: str, ip: str) -> int:
        """Registra la petición. Devuelve 0 si se permite o los segundos a esperar si se excedió el límite."""
        rule = self.rule_for(path)
        if not rule:
            return 0
        prefix, limit, window = rule
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            bucket = self._hits.setdefault((prefix, ip), deque())
            while bucket and bucket[0] <= now - window:
                bucket.popleft()
            if len(bucket) >= limit:
                return max(1, int(bucket[0] + window - now) + 1)
            bucket.append(now)
            return 0

    def _sweep(self, now: float) -> None:
        """Libera IPs inactivas para que la memoria no crezca sin límite."""
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        longest = max((r[2] for r in self.rules), default=60)
        for key in [k for k, b in self._hits.items() if not b or b[-1] <= now - longest]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def rate_limit_enabled() -> bool:
    return os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() in ("true", "1", "yes")


class RateLimitMiddleware:
    def __init__(self, app, limiter: RateLimiter):
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") == "OPTIONS" or not rate_limit_enabled():
            return await self.app(scope, receive, send)
        client = scope.get("client")
        ip = client[0] if client else "unknown"
        retry_after = self.limiter.hit(scope.get("path", ""), ip)
        if not retry_after:
            return await self.app(scope, receive, send)
        body = b'{"detail":"Demasiadas solicitudes. Intenta de nuevo en un momento."}'
        await send({"type": "http.response.start", "status": 429, "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"retry-after", str(retry_after).encode()),
        ]})
        await send({"type": "http.response.body", "body": body})


rate_limiter = RateLimiter(DEFAULT_RULES)
