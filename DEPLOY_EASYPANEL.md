# Desplegar Zenith en EasyPanel

EasyPanel ya trae proxy con HTTPS automático (Traefik), así que **no se usan** `Caddyfile` ni
`docker-compose.prod.yml` (esos quedan para un VPS sin panel). GitHub Actions compila las imágenes y las
publica en GHCR; EasyPanel solo las descarga y las ejecuta.

```
GitHub (push a main) ──► Actions: pruebas ► imágenes en ghcr.io ► webhooks de EasyPanel
EasyPanel, proyecto «zenith»:
  panel.tudominio.com ──► frontend  (puerto 80)
  api.tudominio.com   ──► backend   (puerto 8000) ──► db (Postgres)
                                    ▲  │
                                    │  ▼
                                    gateway (puerto 3000, SIN dominio público)
```

## 0. Antes de empezar

1. DNS: crea dos registros **A** que apunten a la IP del servidor: `panel.tudominio.com` y `api.tudominio.com`.
2. Haz merge a `main` una vez para que Actions publique las imágenes (el deploy fallará la primera vez porque
   aún no hay webhooks; es normal). Quedarán en:
   - `ghcr.io/fantasmadigital/zenith-code/backend:latest`
   - `ghcr.io/fantasmadigital/zenith-code/whatsapp-gateway:latest`
   - `ghcr.io/fantasmadigital/zenith-code/frontend:latest`
3. En GitHub → **Settings → Environments → New environment** → `production` → agrega la variable
   **API_DOMAIN** = `api.tudominio.com` (sin `https://`). El panel la lleva incrustada al compilarse.
4. Crea un token para que EasyPanel descargue imágenes privadas: GitHub → Settings → Developer settings →
   **Personal access tokens (classic)** → solo el permiso `read:packages`.
5. Genera las claves (una distinta para cada una):
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

## 1. Proyecto y base de datos

1. EasyPanel → **Create project** → nombre `zenith`.
2. **+ Service → Postgres** → nombre `db`. Al crearse, copia la **Internal Connection URL**
   (algo como `postgres://postgres:CLAVE@zenith_db:5432/zenith`).

> Los servicios se ven entre sí como `<proyecto>_<servicio>`: `zenith_db`, `zenith_backend`, `zenith_gateway`.

## 2. Backend

**+ Service → App** → nombre `backend`.

- **Source → Docker Image**: `ghcr.io/fantasmadigital/zenith-code/backend:latest`
  - Username: tu usuario de GitHub. Password: el token `read:packages`.
- **Environment**:
  ```env
  DATABASE_URL=postgres://postgres:CLAVE@zenith_db:5432/zenith
  DEBUG=False
  WEB_CONCURRENCY=1
  RATE_LIMIT_ENABLED=true
  ADMIN_PASSWORD=...
  INTERNAL_API_KEY=...
  AUTH_SECRET=...
  ALLOWED_ORIGINS=https://panel.tudominio.com
  PANEL_URL=https://panel.tudominio.com
  PUBLIC_BASE_URL=https://api.tudominio.com
  WHATSAPP_GATEWAY_URL=http://zenith_gateway:3000
  COMPANY_NAME=Mi Empresa
  AI_PROVIDER=gemini
  GEMINI_API_KEY=...
  GEMINI_MODEL=gemini-2.5-flash
  OPENAI_API_KEY=
  OPENAI_MODEL=gpt-4o-mini
  # Opcional, para invitaciones por correo:
  # SMTP_HOST= SMTP_PORT=587 SMTP_USER= SMTP_PASSWORD= SMTP_FROM= SMTP_SECURITY=starttls
  ```
- **Mounts → Add Volume**: nombre `backend_data`, mount path `/app/data`.
- **Domains**: `api.tudominio.com`, HTTPS activado, **puerto 8000**.
- **Deploy**. Comprueba: `https://api.tudominio.com/health` → `{"status":"online"}`.

> Mantén `WEB_CONCURRENCY=1` y **1 réplica**: el bloqueo de login y el límite por IP viven en memoria.

## 3. WhatsApp gateway

**+ Service → App** → nombre `gateway`.

- **Source → Docker Image**: `ghcr.io/fantasmadigital/zenith-code/whatsapp-gateway:latest` (mismas credenciales).
- **Environment**:
  ```env
  PORT=3000
  HOST=0.0.0.0
  PYTHON_BACKEND_URL=http://zenith_backend:8000
  AUTH_FOLDER=/app/auth_info_baileys
  LOG_LEVEL=info
  ADMIN_PASSWORD=...          # la misma del backend
  INTERNAL_API_KEY=...        # la misma del backend
  TENANT_ID=default
  PANEL_URL=https://panel.tudominio.com
  ```
- **Mounts → Add Volume**: nombre `baileys_auth`, mount path `/app/auth_info_baileys`.
  **Importante**: aquí vive la sesión de WhatsApp; si se borra hay que volver a escanear el QR.
- **Domains**: ninguno. El QR se escanea desde el panel (sección WhatsApp), que lo pide al backend.
- **Deploy**.

## 4. Panel (frontend)

**+ Service → App** → nombre `frontend`.

- **Source → Docker Image**: `ghcr.io/fantasmadigital/zenith-code/frontend:latest`.
- **Environment**: nada (la URL de la API ya va dentro de la imagen, desde `API_DOMAIN`).
- **Domains**: `panel.tudominio.com`, HTTPS, **puerto 80**.
- **Deploy**. Entra a `https://panel.tudominio.com` con `ADMIN_PASSWORD`.

## 5. Despliegue automático

En cada App → **Deployments** copia la **Deploy Webhook URL** y guárdala en GitHub → Environments →
`production` → **Secrets**:

| Secret                       | Webhook de |
|------------------------------|------------|
| `EASYPANEL_WEBHOOK_BACKEND`  | backend    |
| `EASYPANEL_WEBHOOK_GATEWAY`  | gateway    |
| `EASYPANEL_WEBHOOK_FRONTEND` | frontend   |

Desde ahí, cada merge a `main`: pruebas → imágenes nuevas → redeploy en orden backend → gateway → panel →
comprobación de `https://API_DOMAIN/health`. Las ramas `feature/**` y los PR solo corren las pruebas y
compilan las imágenes (no publican ni despliegan).

**No** actives «Auto Deploy» desde GitHub en EasyPanel: compilaría en el servidor y se saltaría las pruebas.

## Problemas comunes

- **El panel dice que no puede conectar con la API**: `API_DOMAIN` en GitHub no coincide con el dominio del
  backend, o `ALLOWED_ORIGINS` no es exactamente `https://panel.tudominio.com`. Si cambias `API_DOMAIN`,
  vuelve a correr el workflow para recompilar el panel.
- **El gateway no conecta con el backend (401)**: `INTERNAL_API_KEY` distinta entre los dos servicios.
- **`unable to open database file`**: falta el volumen `/app/data` del backend.
- **Cambiar `ADMIN_PASSWORD` o `AUTH_SECRET`** cierra todas las sesiones del panel (es lo esperado).
- **Respaldos**: activa los backups del servicio `db` en EasyPanel; el volumen `baileys_auth` también conviene
  respaldarlo.
