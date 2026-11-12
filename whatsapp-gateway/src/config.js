const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const localEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../.env');

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

function intEnv(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  port: intEnv('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  pythonBackendUrl: (process.env.PYTHON_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, ''),
  authFolder: path.resolve(process.env.AUTH_FOLDER || './auth_info_baileys'),
  logLevel: process.env.LOG_LEVEL || 'info',
  // Clave compartida con el backend (header X-Internal-Key) y contraseña del panel para /qr
  internalApiKey: (process.env.INTERNAL_API_KEY || '').trim(),
  // Empresa principal de este gateway (las demás se crean a pedido del backend con X-Tenant-Id)
  tenantId: (process.env.TENANT_ID || 'default').trim().toLowerCase(),
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim(),
  // URL pública del panel (botón «Abrir panel» de /qr)
  panelUrl: (process.env.PANEL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  reconnect: {
    initialDelayMs: intEnv('INITIAL_RECONNECT_DELAY_MS', 2000),
    maxDelayMs: intEnv('MAX_RECONNECT_DELAY_MS', 30000)
  },
  // Tiempo máximo esperando la respuesta de la IA en el backend
  backendTimeoutMs: intEnv('BACKEND_TIMEOUT_MS', 120000),
  // Si nadie mira el QR durante este tiempo, se deja de regenerar hasta que alguien lo pida
  qrIdleTimeoutMs: intEnv('QR_IDLE_TIMEOUT_MS', 5 * 60 * 1000),
  // Mensajes más viejos que esto (p. ej. tras una caída larga) no se contestan
  maxMessageAgeMs: intEnv('MAX_MESSAGE_AGE_HOURS', 12) * 3600 * 1000,
  maxMediaBytes: intEnv('MAX_MEDIA_MB', 16) * 1024 * 1024,
  maxSessions: intEnv('MAX_SESSIONS', 50),
  // Por defecto el bot NO responde en grupos
  replyInGroups: (process.env.REPLY_IN_GROUPS || 'false').toLowerCase() === 'true'
};
