const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const config = require('../config');
const reconnection = require('./reconnection');
const { forwardToPythonBackend } = require('../bridge/pythonBridge');

// Mismo formato que el backend (services/tenant_service.py: SLUG_RE) + la empresa principal «default».
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function normalizeTenant(raw) {
  const slug = (raw || 'default').toString().trim().toLowerCase();
  return slug || 'default';
}

function isValidTenant(slug) {
  return slug === 'default' || SLUG_RE.test(slug);
}

// La versión del protocolo se consulta a lo sumo cada 6 h (antes: en cada reconexión).
let cachedVersion = null;
let cachedVersionAt = 0;
async function getBaileysVersion() {
  if (cachedVersion && Date.now() - cachedVersionAt < 6 * 3600 * 1000) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
    cachedVersionAt = Date.now();
  } catch (e) {
    console.warn('[WhatsAppSession] No se pudo consultar la versión de WhatsApp Web:', e.message);
  }
  return cachedVersion || undefined; // undefined = versión incluida en Baileys
}

/**
 * Sesión aislada de WhatsApp Web (Baileys) para una empresa.
 * Cada empresa tiene su propia carpeta de credenciales, su propio QR y su propio número.
 *
 * Ciclo de vida (status):
 *   CONNECTING / RECONNECTING -> WAITING_QR -> CONNECTED
 *   QR_EXPIRED: nadie escaneó el QR; se genera otro cuando alguien lo pide (panel o /qr).
 *   STOPPED:    reconexión detenida (cuenta bloqueada o sesión usada en otro lado); se reanuda a mano.
 *   DISCONNECTED: transición tras desvincular.
 */
class WhatsAppSession {
  constructor(tenantId = 'default', customAuthFolder = null) {
    this.tenantId = normalizeTenant(tenantId);
    if (!isValidTenant(this.tenantId)) {
      throw new Error(`Identificador de empresa inválido: ${this.tenantId}`);
    }

    // 'default' usa la raíz para mantener sesiones previas; las demás, 'tenants/<slug>'
    if (customAuthFolder) {
      this.authFolder = customAuthFolder;
    } else if (this.tenantId === 'default') {
      this.authFolder = config.authFolder;
    } else {
      this.authFolder = path.join(config.authFolder, 'tenants', this.tenantId);
    }

    try {
      fs.mkdirSync(this.authFolder, { recursive: true });
    } catch (e) {
      console.warn(`[WhatsAppSession:${this.tenantId}] Aviso creando directorio auth:`, e.message);
    }

    this.sock = null;
    this.authState = null;
    this.status = 'INITIALIZING';
    this.stopReason = null;
    this.qrString = null;
    this.qrDataUrl = null;
    this.user = null;
    this.connectedAt = null;
    // Al crear la sesión se asume que alguien quiere vincular: el primer ciclo de QR dura qrIdleTimeoutMs
    this.lastQrRequestAt = Date.now();
    this.initializing = false;
    this.shuttingDown = false;
    this.logger = pino({ level: config.logLevel === 'silent' ? 'silent' : 'warn' });
    this.reconnection = new reconnection.ReconnectionManager();

    // Mensajes ya procesados (WhatsApp puede reenviarlos tras reconectar) y cola por chat
    this.seenMessageIds = new Map();
    this.chatQueues = new Map();
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'CONNECTED',
      user: this.user,
      connectedAt: this.connectedAt,
      hasQr: Boolean(this.qrString),
      reconnectAttempts: this.reconnection.attempt,
      stopReason: this.stopReason,
      tenant: this.tenantId
    };
  }

  /** Datos del QR. Pedirlos reactiva la sesión si el QR había expirado o la reconexión estaba detenida. */
  async getQrData() {
    this.lastQrRequestAt = Date.now();
    this.resume();
    return {
      status: this.status,
      qrString: this.qrString,
      qrDataUrl: this.qrDataUrl,
      tenant: this.tenantId
    };
  }

  /** Relanza la conexión si está detenida (QR expirado / reconexión detenida). */
  resume() {
    if (this.shuttingDown) return;
    if (this.status === 'QR_EXPIRED' || this.status === 'STOPPED') {
      console.log(`[WhatsAppSession:${this.tenantId}] Reanudando sesión (estado previo: ${this.status}).`);
      this.stopReason = null;
      this.reconnection.reset();
      this.initSession();
    }
  }

  hasStoredCredentials() {
    return fs.existsSync(path.join(this.authFolder, 'creds.json'));
  }

  /** Quita los listeners y cierra el socket actual sin cerrar la sesión en el teléfono. */
  _teardownSocket() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
      sock.ev.removeAllListeners('messages.upsert');
    } catch (e) { /* noop */ }
    try {
      sock.end(undefined);
    } catch (e) { /* el socket ya estaba cerrado */ }
  }

  /**
   * Inicializa o reinicia la conexión. Nunca deja dos sockets vivos para la misma empresa:
   * antes cada reconexión creaba un socket nuevo sin cerrar el anterior (respuestas duplicadas y fugas de memoria).
   */
  async initSession() {
    if (this.initializing || this.shuttingDown) return;
    this.initializing = true;
    this.reconnection.cancel();
    this._teardownSocket();

    this.status = this.reconnection.attempt > 0 ? 'RECONNECTING' : 'CONNECTING';
    console.log(`[WhatsAppSession:${this.tenantId}] Iniciando sesión Baileys (Estado: ${this.status})...`);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const version = await getBaileysVersion();
      if (this.shuttingDown) return;

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        logger: this.logger,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu(`Zenith-${this.tenantId}`),
        syncFullHistory: false,
        // false: el teléfono del negocio sigue recibiendo notificaciones (necesario para la atención humana)
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false
      });
      this.sock = sock;
      this.authState = state;

      // Cada handler ignora eventos de sockets viejos ya reemplazados
      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (e) {
          console.error(`[WhatsAppSession:${this.tenantId}] Error guardando credenciales:`, e.message);
        }
      });
      sock.ev.on('connection.update', (update) => {
        if (sock !== this.sock) return;
        this._handleConnectionUpdate(update).catch((e) =>
          console.error(`[WhatsAppSession:${this.tenantId}] Error en connection.update:`, e.message));
      });
      sock.ev.on('messages.upsert', (data) => {
        if (sock !== this.sock) return;
        this._handleMessagesUpsert(data);
      });
    } catch (error) {
      console.error(`[WhatsAppSession:${this.tenantId}] Error inicializando socket:`, error.message);
      this.status = 'RECONNECTING';
      this.reconnection.scheduleReconnect(this.reconnection._calculateBackoffDelay(), () => this.initSession());
    } finally {
      this.initializing = false;
    }
  }

  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.status = 'WAITING_QR';
      this.qrString = qr;
      try {
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
      } catch (err) {
        console.error(`[WhatsAppSession:${this.tenantId}] Error convirtiendo QR a DataURL:`, err.message);
      }
      console.log(`\n[WhatsAppSession:${this.tenantId}] 📲 Nuevo QR generado para empresa "${this.tenantId}"`);
      if (this.tenantId === 'default') {
        qrcodeTerminal.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      this.status = 'CONNECTED';
      this.stopReason = null;
      this.qrString = null;
      this.qrDataUrl = null;
      this.connectedAt = new Date().toISOString();
      this.user = this.sock?.user || null;
      this.reconnection.reset();

      const phoneNumber = this.user?.id ? this.user.id.split(':')[0] : 'Desconocido';
      console.log('\n=============================================================');
      console.log(`  ✅ WHATSAPP WEB CONECTADO PARA EMPRESA: [${this.tenantId}]`);
      console.log(`  📱 Teléfono Conectado: +${phoneNumber}`);
      console.log(`  🤖 Nombre: ${this.user?.name || 'Zenith Bot'}`);
      console.log('=============================================================\n');
    }

    if (connection === 'close') {
      if (this.shuttingDown) return;
      const evalResult = this.reconnection.evaluateDisconnect(lastDisconnect);
      const wasPaired = Boolean(this.authState?.creds?.me);
      const qrWasShown = this.status === 'WAITING_QR';
      this.connectedAt = null;
      console.log(`[WhatsAppSession:${this.tenantId}] ⚠️ Conexión cerrada. Razón: ${evalResult.reason}`);

      if (evalResult.stop) {
        this._teardownSocket();
        this.status = 'STOPPED';
        this.stopReason = evalResult.reason;
        this.qrString = null;
        this.qrDataUrl = null;
        return;
      }

      if (evalResult.shouldCleanAuth) {
        this._teardownSocket();
        this.user = null;
        this.qrString = null;
        this.qrDataUrl = null;
        this.reconnection.cleanAuthDirectory(this.authFolder);
      } else if (!wasPaired && evalResult.statusCode !== DisconnectReason.restartRequired) {
        // Nunca se vinculó y el QR caducó: solo se genera otro si alguien lo pidió hace poco.
        // Antes se regeneraban QR para siempre en cada empresa sin vincular.
        const someoneWatching = Date.now() - this.lastQrRequestAt < config.qrIdleTimeoutMs;
        if (!someoneWatching) {
          this._teardownSocket();
          this.status = 'QR_EXPIRED';
          this.qrString = null;
          this.qrDataUrl = null;
          console.log(`[WhatsAppSession:${this.tenantId}] ⏸️ QR sin escanear. Se generará otro cuando se abra el panel o /qr.`);
          return;
        }
        if (qrWasShown) {
          // QR caducado con alguien mirando: generar otro de inmediato
          this.reconnection.attempt = 0;
          evalResult.delayMs = 1000;
        }
        // Si ni siquiera llegó a mostrar QR (credenciales corruptas, sin red) se respeta el backoff
      }

      this.status = 'RECONNECTING';
      this.reconnection.scheduleReconnect(evalResult.delayMs, () => this.initSession());
    }
  }

  // ---------------- Mensajes entrantes ----------------

  _alreadySeen(id) {
    if (!id) return false;
    if (this.seenMessageIds.has(id)) return true;
    this.seenMessageIds.set(id, Date.now());
    if (this.seenMessageIds.size > 5000) {
      // Map conserva el orden de inserción: se descartan los más viejos
      const excess = this.seenMessageIds.size - 4000;
      let i = 0;
      for (const key of this.seenMessageIds.keys()) {
        if (i++ >= excess) break;
        this.seenMessageIds.delete(key);
      }
    }
    return false;
  }

  /** Encola por chat: los mensajes de un mismo cliente se procesan en orden; chats distintos, en paralelo. */
  _enqueue(chatId, task) {
    const prev = this.chatQueues.get(chatId) || Promise.resolve();
    const next = prev.then(task).catch((e) =>
      console.error(`[WhatsAppSession:${this.tenantId}] Error procesando mensaje de ${chatId}:`, e?.message || e));
    this.chatQueues.set(chatId, next);
    next.finally(() => {
      if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId);
    });
    return next;
  }

  _handleMessagesUpsert({ messages, type }) {
    if (type !== 'notify') return;

    for (const msg of messages || []) {
      try {
        if (!msg?.key || msg.key.fromMe || !msg.message) continue;
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) continue;
        if (remoteJid.endsWith('@g.us') && !config.replyInGroups) continue;
        if (this._alreadySeen(msg.key.id)) continue;

        // Tras una caída larga, WhatsApp entrega mensajes viejos: no contestar conversaciones ya frías
        const ts = Number(msg.messageTimestamp?.toNumber?.() ?? msg.messageTimestamp ?? 0) * 1000;
        if (ts && Date.now() - ts > config.maxMessageAgeMs) {
          console.log(`[WhatsAppSession:${this.tenantId}] Mensaje antiguo de ${remoteJid} ignorado.`);
          continue;
        }

        this._enqueue(remoteJid, () => this._processMessage(msg));
      } catch (e) {
        console.error(`[WhatsAppSession:${this.tenantId}] Error clasificando mensaje entrante:`, e.message);
      }
    }
  }

  /** Teléfono del remitente. Con direcciones LID (@lid) WhatsApp oculta el número; se usa el alternativo si viene. */
  _senderId(msg) {
    const key = msg.key;
    let jid = key.remoteJid;
    if (jid.endsWith('@lid')) {
      jid = key.senderPn || key.remoteJidAlt || jid;
    }
    if (jid.endsWith('@g.us')) {
      jid = key.participant || jid;
    }
    return jid.split('@')[0].split(':')[0];
  }

  /** URL de la foto de perfil (si la privacidad del contacto lo permite). Se cachea 12 h por chat. */
  async _profilePicture(jid) {
    this._avatarCache = this._avatarCache || new Map();
    const hit = this._avatarCache.get(jid);
    if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.url;
    let url = null;
    try {
      url = (await this.sock?.profilePictureUrl(jid, 'image')) || null;
    } catch (_) {
      url = null; // sin foto o foto privada
    }
    this._avatarCache.set(jid, { url, at: Date.now() });
    return url;
  }

  async _processMessage(msg) {
    const remoteJid = msg.key.remoteJid;
    const senderPhone = this._senderId(msg);
    const text = this._extractMessageText(msg) || '';

    const rawMessage = msg.message || {};
    const unwrapped =
      rawMessage.ephemeralMessage?.message ||
      rawMessage.viewOnceMessage?.message ||
      rawMessage.viewOnceMessageV2?.message ||
      rawMessage.documentWithCaptionMessage?.message ||
      rawMessage;

    const mediaPayload = {};
    await this._attachMedia(msg, unwrapped.audioMessage, 'audio', mediaPayload);
    await this._attachMedia(msg, unwrapped.imageMessage, 'image', mediaPayload);

    // Reacciones, stickers, mensajes de protocolo, etc.: nada que responder
    if (!text && !mediaPayload.audioBase64 && !mediaPayload.imageBase64) return;

    const aiResponse = await forwardToPythonBackend(
      senderPhone,
      text,
      { ...mediaPayload, contactName: msg.pushName || null, contactAvatar: await this._profilePicture(remoteJid) },
      this.tenantId
    );

    if (!aiResponse) return; // el bridge ya registró el error
    if (aiResponse.human_handoff_active || !aiResponse.reply || !aiResponse.reply.trim()) {
      console.log(`[WhatsAppSession:${this.tenantId}] ⏸️ [Silencio] Sin respuesta automática para +${senderPhone}.`);
      return;
    }

    try {
      console.log(`[WhatsAppSession:${this.tenantId}] 🤖 Respondiendo a +${senderPhone}...`);
      await this.sendMessage(remoteJid, aiResponse.reply);
      if (aiResponse.transferred_to_human) {
        console.log(`[WhatsAppSession:${this.tenantId}] 👨‍💼 Caso transferido a un humano para +${senderPhone}`);
      }
    } catch (e) {
      console.error(`[WhatsAppSession:${this.tenantId}] No se pudo enviar la respuesta a +${senderPhone}:`, e.message);
    }
  }

  async _attachMedia(msg, mediaMsg, kind, payload) {
    if (!mediaMsg) return;
    const size = Number(mediaMsg.fileLength?.toNumber?.() ?? mediaMsg.fileLength ?? 0);
    if (size && size > config.maxMediaBytes) {
      console.warn(`[WhatsAppSession:${this.tenantId}] ${kind} de ${size} bytes ignorado (máximo ${config.maxMediaBytes}).`);
      return;
    }
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: this.logger,
        reuploadRequest: this.sock?.updateMediaMessage
      });
      payload[`${kind}Base64`] = buffer.toString('base64');
      payload[`${kind}MimeType`] = mediaMsg.mimetype || (kind === 'audio' ? 'audio/ogg; codecs=opus' : 'image/jpeg');
    } catch (e) {
      console.error(`[WhatsAppSession:${this.tenantId}] Error descargando ${kind}:`, e.message);
    }
  }

  _extractMessageText(msg) {
    const m = msg.message;
    if (!m) return null;
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      m;
    const text =
      inner.conversation ||
      inner.extendedTextMessage?.text ||
      inner.imageMessage?.caption ||
      inner.videoMessage?.caption ||
      inner.documentMessage?.caption ||
      inner.buttonsResponseMessage?.selectedDisplayText ||
      inner.listResponseMessage?.title ||
      null;
    return text ? text.trim() : null;
  }

  // ---------------- Salida ----------------

  _toJid(to) {
    if (to.includes('@')) return to;
    return `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  async sendMessage(to, text) {
    if (!this.sock || this.status !== 'CONNECTED') {
      const err = new Error(`WhatsApp no está conectado para la empresa [${this.tenantId}] (Estado: ${this.status})`);
      err.status = 503;
      throw err;
    }
    return await this.sock.sendMessage(this._toJid(to), { text });
  }

  async addChatLabel(to, tagName, colorId = null) {
    if (!this.sock || this.status !== 'CONNECTED') return false;
    const jid = this._toJid(to);
    try {
      if (typeof this.sock.addChatLabel === 'function') {
        await this.sock.addChatLabel(jid, '110');
        return true;
      }
    } catch (err) {
      console.warn(`[WhatsAppSession:${this.tenantId}] Error asignando etiqueta a ${jid}:`, err.message);
    }
    return false;
  }

  /** Desvincula el teléfono, borra las credenciales y prepara un QR nuevo. */
  async logout() {
    const sock = this.sock;
    this.reconnection.cancel();
    // Sin listeners: el cierre provocado por logout no debe disparar otra reconexión en paralelo
    if (sock) {
      try {
        sock.ev.removeAllListeners('connection.update');
        await sock.logout();
      } catch (err) {
        console.error(`[WhatsAppSession:${this.tenantId}] Error durante logout:`, err.message);
      }
    }
    this._teardownSocket();
    this.reconnection.cleanAuthDirectory(this.authFolder);
    this.reconnection.reset();
    this.status = 'DISCONNECTED';
    this.stopReason = null;
    this.user = null;
    this.authState = null;
    this.connectedAt = null;
    this.qrString = null;
    this.qrDataUrl = null;
    console.log(`[WhatsAppSession:${this.tenantId}] Sesión cerrada y credenciales eliminadas.`);

    // Nuevo QR listo para vincular otro teléfono
    this.lastQrRequestAt = Date.now();
    this.reconnection.scheduleReconnect(1000, () => this.initSession());
  }

  /** Apagado del proceso: cierra el socket SIN desvincular el teléfono. */
  shutdown() {
    this.shuttingDown = true;
    this.reconnection.cancel();
    this._teardownSocket();
  }
}

/**
 * Gestor multi-empresa de sesiones de WhatsApp.
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  has(tenantId) {
    return this.sessions.has(normalizeTenant(tenantId));
  }

  /**
   * Devuelve la sesión de la empresa; la crea solo si create = true.
   * Lanza error si el identificador es inválido (evita rutas fuera de la carpeta de credenciales).
   */
  getSession(tenantId = 'default', { create = true } = {}) {
    const slug = normalizeTenant(tenantId);
    if (!isValidTenant(slug)) {
      const err = new Error('Identificador de empresa inválido.');
      err.status = 400;
      throw err;
    }
    let session = this.sessions.get(slug);
    if (!session) {
      if (!create) return null;
      if (this.sessions.size >= config.maxSessions) {
        const err = new Error('Se alcanzó el máximo de sesiones de WhatsApp en este gateway.');
        err.status = 503;
        throw err;
      }
      console.log(`[SessionManager] Creando sesión Baileys para empresa: [${slug}]`);
      session = new WhatsAppSession(slug);
      this.sessions.set(slug, session);
      session.initSession();
    }
    return session;
  }

  initDefault() {
    return this.getSession(config.tenantId || 'default');
  }

  /**
   * Al arrancar, reabre las sesiones de todas las empresas que ya estaban vinculadas.
   * Antes solo se abría la principal y las demás quedaban sin responder hasta que alguien abría su panel.
   */
  restoreAll() {
    this.initDefault();
    const tenantsDir = path.join(config.authFolder, 'tenants');
    let entries = [];
    try {
      entries = fs.readdirSync(tenantsDir, { withFileTypes: true });
    } catch (e) {
      return; // no hay empresas adicionales
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidTenant(entry.name)) continue;
      if (!fs.existsSync(path.join(tenantsDir, entry.name, 'creds.json'))) continue;
      try {
        this.getSession(entry.name);
      } catch (e) {
        console.error(`[SessionManager] No se pudo restaurar la sesión de [${entry.name}]:`, e.message);
      }
    }
  }

  shutdownAll() {
    for (const session of this.sessions.values()) {
      session.shutdown();
    }
  }

  // Métodos de compatibilidad directa
  getStatus(tenantId = 'default') {
    return this.getSession(tenantId).getStatus();
  }

  getQrData(tenantId = 'default') {
    return this.getSession(tenantId).getQrData();
  }

  sendMessage(to, text, tenantId = 'default') {
    return this.getSession(tenantId).sendMessage(to, text);
  }

  addChatLabel(to, tagName, colorId = null, tenantId = 'default') {
    return this.getSession(tenantId).addChatLabel(to, tagName, colorId);
  }

  logout(tenantId = 'default') {
    return this.getSession(tenantId).logout();
  }
}

const sessionManager = new SessionManager();
module.exports = sessionManager;
module.exports.WhatsAppSession = WhatsAppSession;
module.exports.SessionManager = SessionManager;
module.exports.normalizeTenant = normalizeTenant;
module.exports.isValidTenant = isValidTenant;
