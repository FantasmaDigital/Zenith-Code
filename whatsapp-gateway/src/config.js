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

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  pythonBackendUrl: (process.env.PYTHON_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, ''),
  authFolder: path.resolve(process.env.AUTH_FOLDER || './auth_info_baileys'),
  logLevel: process.env.LOG_LEVEL || 'info',
  // Clave compartida con el backend (header X-Internal-Key) y contraseña del panel para /qr
  internalApiKey: (process.env.INTERNAL_API_KEY || '').trim(),
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim(),
  reconnect: {
    initialDelayMs: parseInt(process.env.INITIAL_RECONNECT_DELAY_MS || '2000', 10),
    maxDelayMs: parseInt(process.env.MAX_RECONNECT_DELAY_MS || '30000', 10)
  }
};
