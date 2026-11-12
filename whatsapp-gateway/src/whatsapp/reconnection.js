const fs = require('fs');
const path = require('path');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('../config');

// Cuántas veces seguidas se tolera un código antes de tomar la medida drástica
const BAD_SESSION_TOLERANCE = 3;      // 500: recién a la 3.ª vez se borran las credenciales
const REPLACED_TOLERANCE = 3;         // 440: otra instancia usa la misma sesión; tras 3 se detiene

class ReconnectionManager {
  constructor() {
    this.attempt = 0;
    this.isReconnecting = false;
    this.reconnectTimer = null;
    this.badSessionCount = 0;
    this.replacedCount = 0;
  }

  /** Conexión abierta con éxito: se reinician todos los contadores. */
  reset() {
    this.attempt = 0;
    this.badSessionCount = 0;
    this.replacedCount = 0;
    this.cancel();
  }

  /** Cancela una reconexión programada (logout, apagado, reinicio manual). */
  cancel() {
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Decide qué hacer ante un cierre de conexión.
   * @param {any} lastDisconnect - Error del evento connection.update
   * @returns {{ shouldCleanAuth: boolean, delayMs: number, reason: string, stop: boolean, statusCode: number|undefined }}
   *   stop = true: no reconectar automáticamente (requiere acción humana).
   */
  evaluateDisconnect(lastDisconnect) {
    const error = lastDisconnect?.error;
    const statusCode = error instanceof Boom
      ? error.output?.statusCode
      : error?.output?.statusCode;

    let shouldCleanAuth = false;
    let stop = false;
    let delayMs = config.reconnect.initialDelayMs;
    let reason = `Status code: ${statusCode || 'Desconocido'}`;

    if (statusCode !== DisconnectReason.badSession) this.badSessionCount = 0;
    if (statusCode !== DisconnectReason.connectionReplaced) this.replacedCount = 0;

    switch (statusCode) {
      case DisconnectReason.loggedOut:
        reason = 'Sesión cerrada desde el teléfono (Logged out). Se requiere nuevo QR.';
        shouldCleanAuth = true;
        delayMs = 1000;
        break;

      case DisconnectReason.restartRequired:
        reason = 'WhatsApp solicitó reinicio de socket (Restart required). Reconectando de inmediato.';
        delayMs = 500;
        break;

      case DisconnectReason.timedOut: // 408: también es el código de «QR expirado»
        reason = 'Tiempo de espera agotado (sin internet, teléfono apagado o QR no escaneado).';
        delayMs = this._calculateBackoffDelay();
        break;

      case DisconnectReason.connectionClosed:
        reason = 'Conexión cerrada por el servidor.';
        delayMs = this._calculateBackoffDelay();
        break;

      case DisconnectReason.badSession:
        // Un 500 puede ser transitorio: borrar credenciales a la primera obliga a re-escanear sin necesidad.
        this.badSessionCount += 1;
        if (this.badSessionCount >= BAD_SESSION_TOLERANCE) {
          reason = `Sesión dañada (${this.badSessionCount} veces seguidas). Limpiando credenciales para nuevo QR.`;
          shouldCleanAuth = true;
          this.badSessionCount = 0;
          delayMs = 1000;
        } else {
          reason = `Error de sesión (500), intento ${this.badSessionCount}/${BAD_SESSION_TOLERANCE} antes de pedir nuevo QR.`;
          delayMs = this._calculateBackoffDelay();
        }
        break;

      case DisconnectReason.connectionReplaced:
        // Otra instancia (u otro despliegue) abrió la misma sesión: reconectar sin pausa provoca una pelea infinita.
        this.replacedCount += 1;
        if (this.replacedCount >= REPLACED_TOLERANCE) {
          reason = 'Conexión reemplazada repetidamente por otra instancia con la misma sesión. Reconexión automática detenida.';
          stop = true;
        } else {
          reason = `Conexión reemplazada por otra sesión (${this.replacedCount}/${REPLACED_TOLERANCE}). Reintentando en 60 s.`;
          delayMs = 60000;
        }
        break;

      case DisconnectReason.forbidden:
        reason = 'WhatsApp rechazó la cuenta (403: número bloqueado o restringido). Reconexión automática detenida.';
        stop = true;
        break;

      case DisconnectReason.multideviceMismatch:
        reason = 'Incompatibilidad multi-dispositivo (411). Se requiere vincular de nuevo.';
        shouldCleanAuth = true;
        delayMs = 1000;
        break;

      default:
        reason = `Desconexión inesperada (${statusCode || 's/c'}): ${error?.message || 'Sin detalle'}`;
        delayMs = this._calculateBackoffDelay();
        break;
    }

    return { shouldCleanAuth, delayMs, reason, stop, statusCode };
  }

  /**
   * Backoff exponencial con jitter: base * 1.5^intento + 0-1000 ms, con tope en maxDelayMs.
   */
  _calculateBackoffDelay() {
    this.attempt += 1;
    const base = config.reconnect.initialDelayMs;
    const max = config.reconnect.maxDelayMs;
    const exponential = Math.min(base * Math.pow(1.5, this.attempt), max);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, max);
  }

  /**
   * Elimina los archivos de credenciales dentro de la carpeta.
   * No borra el directorio raíz para evitar errores EBUSY en volúmenes Docker.
   */
  cleanAuthDirectory(authFolder) {
    try {
      if (fs.existsSync(authFolder)) {
        console.warn(`[ReconnectionManager] Limpiando archivos de credenciales en: ${authFolder}`);
        for (const file of fs.readdirSync(authFolder)) {
          // La carpeta raíz (empresa «default») contiene las carpetas de las demás empresas: nunca tocarlas.
          if (file === 'tenants') continue;
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
   * Programa una reconexión. Si ya hay una programada, se respeta la existente.
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
      this.reconnectTimer = null;
      this.isReconnecting = false;
      try {
        await reconnectCallback();
      } catch (err) {
        console.error('[ReconnectionManager] Error ejecutando callback de reconexión:', err.message);
        this.scheduleReconnect(this._calculateBackoffDelay(), reconnectCallback);
      }
    }, delayMs);
  }
}

const defaultManager = new ReconnectionManager();
defaultManager.ReconnectionManager = ReconnectionManager;
module.exports = defaultManager;
