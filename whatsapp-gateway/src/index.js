const express = require('express');
const config = require('./config');
const session = require('./whatsapp/session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================================================
// RUTAS DE LA API Y MONITOREO
// ==============================================================

app.get('/', (req, res) => {
  res.json({
    service: 'Zenith WhatsApp Gateway (In-House Baileys)',
    version: '1.0.0',
    ...session.getStatus(),
    endpoints: {
      qr_page: '/qr (HTML)',
      qr_api: '/api/qr (JSON)',
      status: '/api/status (JSON)',
      send_message: '/api/send (POST)'
    }
  });
});

app.get('/api/status', (req, res) => {
  res.json(session.getStatus());
});

app.get('/api/qr', async (req, res) => {
  const qrData = await session.getQrData();
  res.json(qrData);
});

// ==============================================================
// INTERFAZ WEB AMIGABLE PARA ESCANEAR EL CÓDIGO QR
// ==============================================================
app.get('/qr', async (req, res) => {
  const { status, qrDataUrl } = await session.getQrData();
  const user = session.user;
  const phoneNumber = user?.id ? user.id.split(':')[0] : null;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Gateway - Conexión QR</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --accent: #22c55e;
      --amber: #f59e0b;
      --border: #334155;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    h1 {
      font-size: 1.5rem;
      margin-top: 0;
      margin-bottom: 8px;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 24px;
    }
    .badge-CONNECTED { background: #065f46; color: #34d399; }
    .badge-WAITING_QR { background: #78350f; color: #fbbf24; }
    .badge-CONNECTING, .badge-RECONNECTING { background: #1e3a8a; color: #60a5fa; }
    .badge-DISCONNECTED { background: #451a03; color: #f87171; }
    .qr-container {
      background: #ffffff;
      padding: 16px;
      border-radius: 12px;
      display: inline-block;
      margin-bottom: 20px;
    }
    .qr-container img {
      width: 250px;
      height: 250px;
      display: block;
    }
    .instructions {
      font-size: 0.9rem;
      color: #94a3b8;
      line-height: 1.5;
      text-align: left;
      background: rgba(0,0,0,0.2);
      padding: 14px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    ol { margin: 0; padding-left: 20px; }
    li { margin-bottom: 4px; }
    .btn {
      background: #2563eb;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
      margin: 4px;
    }
    .btn-danger { background: #dc2626; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Zenith WhatsApp Gateway</h1>
    <div class="badge badge-${status}">ESTADO: ${status}</div>

    ${status === 'CONNECTED' ? `
      <div style="margin: 20px 0;">
        <div style="font-size: 3rem;">✅</div>
        <h2 style="color: #34d399; margin: 10px 0;">Dispositivo Vinculado</h2>
        <p style="color: #94a3b8;">Número conectado: <strong>+${phoneNumber || 'Conectado'}</strong></p>
        <p style="font-size: 0.85rem; color: #64748b;">El bot está respondiendo mensajes de forma autónoma.</p>
        <form action="/api/logout" method="POST" onsubmit="return confirm('¿Seguro que deseas desvincular el dispositivo?');">
          <button type="submit" class="btn btn-danger">Desvincular Dispositivo</button>
        </form>
      </div>
    ` : qrDataUrl ? `
      <div class="qr-container">
        <img src="${qrDataUrl}" alt="Código QR de WhatsApp" />
      </div>
      <div class="instructions">
        <strong>Para conectar:</strong>
        <ol>
          <li>Abre WhatsApp en tu teléfono.</li>
          <li>Toca <b>Ajustes</b> o <b>Menú</b> &gt; <b>Dispositivos vinculados</b>.</li>
          <li>Toca <b>Vincular un dispositivo</b> y apunta a este código QR.</li>
        </ol>
      </div>
    ` : `
      <div style="padding: 40px 0;">
        <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
        <p>Generando código QR o reconectando socket...</p>
      </div>
    `}

    <div>
      <a href="/qr" class="btn">Recargar Página</a>
    </div>
  </div>

  <script>
    // Auto-recarga cada 5 segundos si está esperando QR o reconectando
    const status = "${status}";
    if (status !== 'CONNECTED') {
      setTimeout(() => {
        window.location.reload();
      }, 5000);
    }
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
    const result = await session.sendMessage(to, text);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Desvincular sesión manualmente
app.post('/api/logout', async (req, res) => {
  try {
    await session.logout();
    res.redirect('/qr');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================
// MANEJO ROBUSTO DE EXCEPCIONES Y CICLO DE VIDA DEL PROCESO
// ==============================================================
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Excepción no capturada:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Promesa rechazada no manejada:', reason);
});

// Iniciar servidor HTTP e inicializar socket de Baileys
app.listen(config.port, config.host, () => {
  console.log(`[WhatsAppGateway] 🚀 Servidor HTTP escuchando en http://${config.host}:${config.port}`);
  console.log(`[WhatsAppGateway] 📲 Abre http://localhost:${config.port}/qr para escanear el código QR`);
  session.initSession();
});
