const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const session = require('./whatsapp/session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!config.internalApiKey) {
  console.error('[WhatsAppGateway] ❌ INTERNAL_API_KEY no está configurada: el backend no podrá usar el gateway.');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  return bufA.length > 0 && bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Autenticación: el backend usa X-Internal-Key; una persona en el navegador (/qr) usa
// HTTP Basic con la contraseña del panel (ADMIN_PASSWORD). Sin CORS: nadie debe llamarlo desde otro sitio.
// La página del QR y su estado son de solo lectura y se abren sin credenciales; el puerto solo escucha en 127.0.0.1.
const PUBLIC_READ_PATHS = new Set(['/', '/qr', '/api/qr', '/api/status', '/health']);
app.use((req, res, next) => {
  // req.trusted: la petición trae credenciales válidas (puede crear sesiones de otras empresas)
  req.trusted = Boolean(config.internalApiKey && safeEqual(req.get('X-Internal-Key'), config.internalApiKey));
  if (req.trusted) {
    return next();
  }
  if (req.method === 'GET' && PUBLIC_READ_PATHS.has(req.path)) {
    return next();
  }
  const basic = (req.get('Authorization') || '').match(/^Basic\s+(.+)$/i);
  if (basic && config.adminPassword) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(password, config.adminPassword)) {
      // El navegador reenvía Basic auth en cualquier petición, incluso desde otro sitio (CSRF):
      // con Basic solo se permiten lecturas y el botón de desvincular de la propia página /qr.
      req.trusted = true;
      if (req.method === 'GET') {
        return next();
      }
      const sameOrigin = req.get('Origin') === `${req.protocol}://${req.get('host')}`;
      if (req.method === 'POST' && req.path === '/api/logout' && sameOrigin) {
        return next();
      }
      return res.status(403).json({ error: 'Operación no permitida desde el navegador.' });
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Zenith WhatsApp Gateway", charset="UTF-8"');
  return res.status(401).json({ error: 'No autorizado.' });
});

// ==============================================================
// Helper Multi-Tenant: resuelve la sesión Baileys para la empresa de la petición
// Sin credenciales solo se consultan sesiones existentes: antes cualquiera podía crear sesiones ilimitadas
// (carpetas y sockets) con ?tenant=xxx desde las rutas públicas.
function getSessionForReq(req) {
  const tenantId = session.normalizeTenant(
    req.headers['x-tenant-id'] ||
    req.query.tenant ||
    req.query.empresa ||
    config.tenantId ||
    'default'
  );
  const create = req.trusted || tenantId === config.tenantId;
  const s = session.getSession(tenantId, { create });
  if (!s) {
    const err = new Error('No hay una sesión de WhatsApp para esa empresa.');
    err.status = 404;
    throw err;
  }
  return s;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: session.sessions.size });
});

// RUTAS DE LA API Y MONITOREO
// ==============================================================

app.get('/', (req, res, next) => {
  let s;
  try { s = getSessionForReq(req); } catch (err) { return next(err); }
  res.json({
    service: 'Zenith WhatsApp Gateway (In-House Baileys Multi-Tenant)',
    version: '2.0.0',
    tenant: s.tenantId,
    ...s.getStatus(),
    endpoints: {
      qr_page: '/qr (HTML)',
      qr_api: '/api/qr (JSON)',
      status: '/api/status (JSON)',
      send_message: '/api/send (POST)'
    }
  });
});

app.get('/api/status', (req, res, next) => {
  // ?peek=1: solo consultar (resumen del superadmin); no crea una sesión ni genera QR para empresas sin WhatsApp
  if (req.query.peek === '1') {
    try {
      const tenantId = session.normalizeTenant(req.headers['x-tenant-id'] || req.query.tenant || config.tenantId);
      const existing = session.getSession(tenantId, { create: false });
      if (!existing) {
        return res.json({ status: 'NOT_STARTED', connected: false, user: null, tenant: tenantId });
      }
      return res.json({ ...existing.getStatus(), tenant: existing.tenantId });
    } catch (err) {
      return next(err);
    }
  }
  let s;
  try { s = getSessionForReq(req); } catch (err) { return next(err); }
  res.json({ ...s.getStatus(), tenant: s.tenantId });
});

app.get('/api/qr', async (req, res, next) => {
  let s;
  try { s = getSessionForReq(req); } catch (err) { return next(err); }
  const qrData = await s.getQrData();
  const user = s.user;
  const phoneNumber = user?.id ? user.id.split(':')[0] : null;
  res.json({
    ...qrData,
    phone_number: phoneNumber ? `+${phoneNumber}` : null,
    user: user || null
  });
});

// ==============================================================
// INTERFAZ WEB PREMIUM PARA ESCANEAR EL CÓDIGO QR (ESTILO ZENITH STUDIO)
// ==============================================================
app.get('/qr', async (req, res, next) => {
  let s;
  try {
    s = getSessionForReq(req);
  } catch (err) {
    return next(err);
  }
  const { status, qrDataUrl } = await s.getQrData();
  const user = s.user;
  const phoneNumber = user?.id ? user.id.split(':')[0] : null;

  const html = `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenith Studio - Conexión WhatsApp Web</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0c0d12;
      --card-bg: #111218;
      --card-sub: #161922;
      --border: #1f2330;
      --border-focus: #3ecf8e;
      --theme-primary: #3ecf8e;
      --theme-primary-rgb: 62, 207, 142;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 24px 16px;
      background-image: 
        radial-gradient(circle at 50% 0%, rgba(var(--theme-primary-rgb), 0.12) 0%, transparent 60%),
        radial-gradient(circle at 100% 100%, rgba(59, 130, 246, 0.05) 0%, transparent 50%);
      background-attachment: fixed;
      -webkit-font-smoothing: antialiased;
    }
    .main-container {
      max-width: 480px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.03);
      overflow: hidden;
      backdrop-filter: blur(12px);
      transition: all 0.3s ease;
    }
    .header {
      padding: 28px 28px 20px 28px;
      border-bottom: 1px solid var(--border);
      text-align: center;
      position: relative;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: rgba(var(--theme-primary-rgb), 0.14);
      border: 1px solid rgba(var(--theme-primary-rgb), 0.3);
      color: var(--theme-primary);
      margin-bottom: 14px;
      box-shadow: 0 0 20px rgba(var(--theme-primary-rgb), 0.2);
    }
    .logo-badge svg {
      width: 24px;
      height: 24px;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 14px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 13px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
    }
    .pill-dot {
      width: 7px;
      height: 7px;
      border-radius: 9999px;
      animation: pulse 2s infinite ease-in-out;
    }
    .status-CONNECTED {
      background: rgba(var(--theme-primary-rgb), 0.14);
      color: var(--theme-primary);
      border: 1px solid rgba(var(--theme-primary-rgb), 0.35);
    }
    .status-CONNECTED .pill-dot { background: var(--theme-primary); }

    .status-WAITING_QR {
      background: rgba(245, 158, 11, 0.14);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .status-WAITING_QR .pill-dot { background: #fbbf24; }

    .status-CONNECTING, .status-RECONNECTING {
      background: rgba(59, 130, 246, 0.14);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.35);
    }
    .status-CONNECTING .pill-dot, .status-RECONNECTING .pill-dot { background: #60a5fa; }

    .status-QR_EXPIRED, .status-STOPPED,
    .status-DISCONNECTED {
      background: rgba(244, 63, 94, 0.14);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.35);
    }
    .status-DISCONNECTED .pill-dot, .status-QR_EXPIRED .pill-dot, .status-STOPPED .pill-dot { background: #fb7185; }

    .body-content {
      padding: 24px 28px;
    }
    .connected-box {
      text-align: center;
      padding: 10px 0;
    }
    .check-circle {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(var(--theme-primary-rgb), 0.15);
      border: 2px solid var(--theme-primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--theme-primary);
      margin-bottom: 16px;
      box-shadow: 0 0 30px rgba(var(--theme-primary-rgb), 0.25);
    }
    .check-circle svg {
      width: 34px;
      height: 34px;
    }
    .device-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .phone-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--card-sub);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      font-weight: 600;
      color: #ffffff;
      margin: 10px 0 16px 0;
    }
    .meta-list {
      background: var(--card-sub);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      text-align: left;
      margin-bottom: 20px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .meta-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .meta-row:first-child {
      padding-top: 0;
    }
    .meta-label {
      color: var(--text-muted);
    }
    .meta-value {
      font-weight: 600;
      color: #ffffff;
    }
    .qr-frame {
      background: #ffffff;
      padding: 16px;
      border-radius: 16px;
      display: inline-block;
      margin: 0 auto 20px auto;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
      position: relative;
    }
    .qr-frame img {
      width: 240px;
      height: 240px;
      display: block;
    }
    .steps-card {
      background: var(--card-sub);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 20px;
    }
    .steps-card h3 {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 0.84rem;
      color: #d1d5db;
      line-height: 1.45;
      margin-bottom: 10px;
    }
    .step-item:last-child {
      margin-bottom: 0;
    }
    .step-num {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(var(--theme-primary-rgb), 0.15);
      color: var(--theme-primary);
      font-size: 0.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .btn {
      width: 100%;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
      text-decoration: none;
      border: none;
    }
    .btn-primary {
      background: var(--theme-primary);
      color: #0c0d12;
      box-shadow: 0 4px 14px rgba(var(--theme-primary-rgb), 0.3);
    }
    .btn-primary:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: var(--card-sub);
      color: #e5e7eb;
      border: 1px solid var(--border);
      margin-top: 10px;
    }
    .btn-secondary:hover {
      background: #1f2330;
      color: #ffffff;
    }
    .btn-danger {
      background: rgba(244, 63, 94, 0.12);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.3);
      margin-top: 10px;
    }
    .btn-danger:hover {
      background: rgba(244, 63, 94, 0.22);
      color: #ffffff;
      border-color: rgba(244, 63, 94, 0.5);
    }
    .footer-note {
      text-align: center;
      padding: 14px 28px 20px 28px;
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .live-indicator {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--theme-primary);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.92); }
    }
  </style>
</head>
<body>
  <div class="main-container">
    <div class="header">
      <div class="logo-badge">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.34 5L2 22l5.16-1.32C8.61 21.52 10.26 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.05 16.5c-1.57 0-3.08-.43-4.4-1.24l-.31-.19-3.26.83.87-3.17-.2-.33A7.994 7.994 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-7.95 8.5z"/>
        </svg>
      </div>
      <h1>Zenith WhatsApp Gateway</h1>
      <p class="subtitle">Microservicio In-House Baileys Multi-Device</p>
      <div id="statusPill" class="status-pill status-${status}">
        <span class="pill-dot"></span>
        <span id="statusText">ESTADO: ${status}</span>
      </div>
    </div>

    <div class="body-content" id="dynamicContent">
      ${status === 'CONNECTED' ? `
        <div class="connected-box">
          <div class="check-circle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <div class="device-title">Dispositivo Vinculado</div>
          <div class="phone-tag">
            <span>📱</span>
            <span>+${phoneNumber || 'Conectado'}</span>
          </div>

          <div class="meta-list">
            <div class="meta-row">
              <span class="meta-label">Motor de IA:</span>
              <span class="meta-value">Gemini / OpenAI Failover</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Respuestas Autónomas:</span>
              <span class="meta-value" style="color: var(--theme-primary);">● En Vivo</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Reconexión Automática:</span>
              <span class="meta-value">Backoff Exponencial</span>
            </div>
          </div>

          <a href="${config.panelUrl}/whatsapp-gateway" class="btn btn-primary">
            <span>Abrir en Zenith Studio Dashboard</span>
            <span>→</span>
          </a>

          <form action="/api/logout?tenant=${encodeURIComponent(s.tenantId)}" method="POST" onsubmit="return confirm('¿Seguro que deseas desvincular el dispositivo de WhatsApp?');">
            <button type="submit" class="btn btn-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Desvincular Dispositivo</span>
            </button>
          </form>
        </div>
      ` : qrDataUrl ? `
        <div style="text-align: center;">
          <div class="qr-frame">
            <img id="qrImage" src="${qrDataUrl}" alt="Código QR WhatsApp" />
          </div>

          <div class="steps-card">
            <h3>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              Instrucciones de Vinculación
            </h3>
            <div class="step-item">
              <span class="step-num">1</span>
              <span>Abre <strong>WhatsApp</strong> en tu teléfono móvil.</span>
            </div>
            <div class="step-item">
              <span class="step-num">2</span>
              <span>Toca <strong>Ajustes</strong> o <strong>Menú ⋮</strong> &gt; <strong>Dispositivos vinculados</strong>.</span>
            </div>
            <div class="step-item">
              <span class="step-num">3</span>
              <span>Toca <strong>Vincular un dispositivo</strong> y escanea este código QR.</span>
            </div>
          </div>

          <a href="${config.panelUrl}/whatsapp-gateway" class="btn btn-secondary">
            <span>Ir al Panel Zenith Studio</span>
          </a>
        </div>
      ` : `
        <div style="padding: 48px 16px; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 12px; animation: pulse 1.5s infinite;">⏳</div>
          <h2 style="font-size: 1rem; color: #fff; margin-bottom: 6px;">Inicializando Baileys Socket...</h2>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Generando código QR seguro y conectando con WhatsApp Web.</p>
        </div>
      `}
    </div>

    <div class="footer-note">
      <span class="live-indicator"></span>
      <span>Sincronización en tiempo real vía Baileys Socket</span>
    </div>
  </div>

  <script>
    // Polling inteligente silencioso cada 2.5 segundos para detectar el escaneo sin recargar toda la ventana
    let currentStatus = "${status}";
    setInterval(async () => {
      try {
        const res = await fetch('/api/qr?tenant=${encodeURIComponent(s.tenantId)}');
        if (!res.ok) return;
        const data = await res.json();
        
        // Si el estado cambió (por ejemplo de WAITING_QR a CONNECTED), recargamos para actualizar el render
        if (data.status !== currentStatus) {
          window.location.reload();
        } else if (data.status === 'WAITING_QR' && data.qrDataUrl) {
          const qrImg = document.getElementById('qrImage');
          if (qrImg && qrImg.src !== data.qrDataUrl) {
            qrImg.src = data.qrDataUrl;
          }
        }
      } catch (err) {
        console.warn('Sondeo silencioso de QR:', err.message);
      }
    }, 2500);
  </script>
</body>
</html>`;

  res.send(html);
});

// ==============================================================
// ENDPOINT PARA ENVÍO DE MENSAJES (POST)
// ==============================================================
app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;

  if (!to || !text) {
    return res.status(400).json({ error: "Los campos 'to' y 'text' son requeridos." });
  }

  try {
    const s = getSessionForReq(req);
    const result = await s.sendMessage(to, text);
    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ==============================================================
// ENDPOINT PARA ETIQUETAR CHAT EN WHATSAPP BUSINESS
// ==============================================================
app.post('/api/chat/label', async (req, res) => {
  const { to, tag, color } = req.body;

  if (!to || !tag) {
    return res.status(400).json({ error: "Los campos 'to' y 'tag' son requeridos." });
  }

  try {
    const s = getSessionForReq(req);
    const success = await s.addChatLabel(to, tag, color);
    res.json({ success, to, tag });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// Desvincular sesión manualmente
app.post('/api/logout', async (req, res) => {
  try {
    const s = getSessionForReq(req);
    // Auditoría: desvincular borra las credenciales; dejar rastro de quién lo pidió
    const origin = req.get('X-Internal-Key') ? 'backend (panel)' : 'página /qr (navegador)';
    console.warn(`[WhatsAppGateway] 🔌 Desvinculación solicitada para [${s.tenantId}] desde ${origin} ` +
      `(IP ${req.ip}, UA ${req.get('User-Agent') || 's/d'}).`);
    await s.logout();
    if (req.headers.accept?.includes('application/json') || req.is('json') || req.xhr) {
      return res.json({ success: true, status: 'DISCONNECTED' });
    }
    res.redirect(`/qr?tenant=${encodeURIComponent(s.tenantId)}`);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ==============================================================
// MANEJO ROBUSTO DE EXCEPCIONES Y CICLO DE VIDA DEL PROCESO
// ==============================================================
// Errores de las rutas (JSON inválido, empresa inválida...) como JSON, sin trazas internas
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[WhatsAppGateway] Error en', req.method, req.path, '-', err.message);
  }
  res.status(status).json({ error: status >= 500 ? 'Error interno del gateway.' : err.message });
});

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Excepción no capturada:', err?.message, err?.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Promesa rechazada no manejada:', reason);
});

// Iniciar servidor HTTP y reabrir las sesiones de WhatsApp ya vinculadas (todas las empresas)
const server = app.listen(config.port, config.host, () => {
  console.log(`[WhatsAppGateway] 🚀 Servidor HTTP escuchando en http://${config.host}:${config.port}`);
  console.log(`[WhatsAppGateway] 📲 Abre http://localhost:${config.port}/qr para escanear el código QR`);
  session.restoreAll().catch((e) => console.error('[WhatsAppGateway] Error restaurando sesiones:', e.message));
});

// Apagado ordenado (docker stop / redeploy): cerrar sockets sin desvincular los teléfonos
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WhatsAppGateway] ${signal} recibido: cerrando sesiones...`);
  // Espera el último respaldo de la sesión en la BD antes de salir (máx. 8 s)
  setTimeout(() => process.exit(0), 8000).unref();
  session.shutdownAll().finally(() => server.close(() => process.exit(0)));
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
