const fs = require('fs');
const path = require('path');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('../config');

class ReconnectionManager {
  constructor() {
    this.attempt = 0;
    this.isReconnecting = false;
    this.reconnectTimer = null;
  }

  reset() {
    this.attempt = 0;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Determina si la desconexión requiere regenerar credenciales (loggedOut)
   * o una reconexión automática (red caída, timeout, restart requerido).
   * @param {any} lastDisconnect - Error del evento connection.update
   * @returns {{ shouldCleanAuth: boolean, delayMs: number, reason: string }}
   */
  evaluateDisconnect(lastDisconnect) {
    const error = lastDisconnect?.error;
    const statusCode = error instanceof Boom 
      ? error.output?.statusCode 
      : error?.output?.statusCode;

    let shouldCleanAuth = false;
    let delayMs = config.reconnect.initialDelayMs;
    let reason = `Status code: ${statusCode || 'Desconocido'}`;

    switch (statusCode) {
      case DisconnectReason.loggedOut:
        reason = 'Sesión cerrada explícitamente en el teléfono (Logged out). Se requiere nuevo QR.';
        shouldCleanAuth = true;
        delayMs = 1000;
        break;

      case DisconnectReason.restartRequired:
        reason = 'WhatsApp solicitó reinicio de socket (Restart required). Reconectando de inmediato.';
        delayMs = 500;
        break;

      case DisconnectReason.timedOut:
        reason = 'Tiempo de espera agotado (Timed out - posible pérdida de internet o batería en teléfono).';
        delayMs = this._calculateBackoffDelay();
        break;

      case DisconnectReason.connectionLost:
        reason = 'Conexión perdida con los servidores de WhatsApp.';
        delayMs = this._calculateBackoffDelay();
        break;

      case DisconnectReason.connectionClosed:
        reason = 'Conexión cerrada por el servidor.';
        delayMs = this._calculateBackoffDelay();
        break;

      case DisconnectReason.badSession:
        reason = 'Archivo de sesión corrupto o dañado. Limpiando credenciales para nuevo QR.';
        shouldCleanAuth = true;
        delayMs = 1000;
        break;

      case DisconnectReason.connectionReplaced:
        reason = 'Conexión reemplazada por otra sesión activa de WhatsApp Web.';
        delayMs = 5000;
        break;

      default:
        reason = `Desconexión inesperada: ${error?.message || 'Sin detalle'}`;
        delayMs = this._calculateBackoffDelay();
        break;
    }

    return { shouldCleanAuth, delayMs, reason };
  }

  /**
   * Calcula el tiempo de espera con backoff exponencial y jitter aleatorio
   */
  _calculateBackoffDelay() {
    this.attempt += 1;
    const base = config.reconnect.initialDelayMs;
    const max = config.reconnect.maxDelayMs;
    // Backoff exponencial: base * 1.5^(attempt) + jitter aleatorio (0-1000ms)
    const exponential = Math.min(base * Math.pow(1.5, this.attempt), max);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, max);
  }

  /**
   * Elimina de forma segura los archivos de credenciales corruptos dentro de la carpeta.
   * No borra el directorio raíz para evitar errores EBUSY en volúmenes Docker.
   */
  cleanAuthDirectory(authFolder) {
    try {
      if (fs.existsSync(authFolder)) {
        console.warn(`[ReconnectionManager] Limpiando archivos de credenciales en: ${authFolder}`);
        const files = fs.readdirSync(authFolder);
        for (const file of files) {
          const filePath = path.join(authFolder, file);
          try {
            fs.rmSync(filePath, { recursive: true, force: true });
          } catch (e) {
            console.error(`[ReconnectionManager] Error eliminando ${filePath}:`, e.message);
          }
        }
        console.log('[ReconnectionManager] Carpeta de credenciales reseteada con éxito.');
      }
    } catch (err) {
      console.error(`[ReconnectionManager] Error limpiando credenciales en ${authFolder}:`, err.message);
    }
  }

  /**
   * Programa la reconexión automática infinita
   */
  scheduleReconnect(delayMs, reconnectCallback) {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    console.log(`[ReconnectionManager] 🔄 Programando reconexión en ${(delayMs / 1000).toFixed(1)}s (Intento #${this.attempt})...`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      this.isReconnecting = false;
      try {
        await reconnectCallback();
      } catch (err) {
        console.error('[ReconnectionManager] Error ejecutando callback de reconexión:', err.message);
        // Continuar el ciclo infinito ante cualquier fallo
        this.scheduleReconnect(this._calculateBackoffDelay(), reconnectCallback);
      }
    }, delayMs);
  }
}

module.exports = new ReconnectionManager();
