const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const config = require('../config');
const reconnection = require('./reconnection');
const { forwardToPythonBackend } = require('../bridge/pythonBridge');

class WhatsAppSession {
  constructor() {
    this.sock = null;
    this.status = 'INITIALIZING';
    this.qrString = null;
    this.qrDataUrl = null;
    this.user = null;
    this.connectedAt = null;
    this.logger = pino({ level: config.logLevel === 'silent' ? 'silent' : 'warn' });
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'CONNECTED',
      user: this.user,
      connectedAt: this.connectedAt,
      hasQr: Boolean(this.qrString),
      reconnectAttempts: reconnection.attempt
    };
  }

  async getQrData() {
    return {
      status: this.status,
      qrString: this.qrString,
      qrDataUrl: this.qrDataUrl
    };
  }

  /**
   * Inicializa o reinicia la conexión del socket de WhatsApp Web.
   */
  async initSession() {
    this.status = reconnection.attempt > 0 ? 'RECONNECTING' : 'CONNECTING';
    console.log(`[WhatsAppSession] Iniciando sesión Baileys (Estado: ${this.status})...`);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.authFolder);
      const { version, isLatest } = await fetchLatestBaileysVersion();

      console.log(`[WhatsAppSession] Usando versión WA Web v${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false, // Lo manejamos nosotros con qrcode-terminal y web
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false
      });

      // Guardar cambios en las credenciales
      this.sock.ev.on('creds.update', saveCreds);

      // Manejar cambios de estado y QR
      this.sock.ev.on('connection.update', (update) => this._handleConnectionUpdate(update));

      // Manejar mensajes entrantes
      this.sock.ev.on('messages.upsert', (data) => this._handleMessagesUpsert(data));

    } catch (error) {
      console.error('[WhatsAppSession] Error fatal inicializando socket:', error.message);
      this.status = 'DISCONNECTED';
      const delay = reconnection._calculateBackoffDelay();
      reconnection.scheduleReconnect(delay, () => this.initSession());
    }
  }

  /**
   * Procesa el ciclo de vida de la conexión: QR, apertura y desconexión.
   */
  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // 1. Si hay un código QR para escanear
    if (qr) {
      this.status = 'WAITING_QR';
      this.qrString = qr;

      try {
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
      } catch (err) {
        console.error('[WhatsAppSession] Error convirtiendo QR a DataURL:', err.message);
      }

      console.log('\n=============================================================');
      console.log('  📲 ESCANEA ESTE CÓDIGO QR DESDE TU WHATSAPP (Dispositivos vinculados)');
      console.log('  También disponible en la web: http://localhost:' + config.port + '/qr');
      console.log('=============================================================\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    // 2. Conexión establecida con éxito
    if (connection === 'open') {
      this.status = 'CONNECTED';
      this.qrString = null;
      this.qrDataUrl = null;
      this.connectedAt = new Date().toISOString();
      this.user = this.sock.user;
      reconnection.reset();

      const phoneNumber = this.user?.id ? this.user.id.split(':')[0] : 'Desconocido';
      console.log('\n=============================================================');
      console.log(`  ✅ WHATSAPP WEB CONECTADO CON ÉXITO`);
      console.log(`  📱 Teléfono Conectado: +${phoneNumber}`);
      console.log(`  🤖 Nombre: ${this.user?.name || 'Zenith Bot'}`);
      console.log('=============================================================\n');
    }

    // 3. Conexión cerrada (caída de internet, batería, logout, etc.)
    if (connection === 'close') {
      this.status = 'DISCONNECTED';
      this.qrString = null;
      this.qrDataUrl = null;

      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
        } catch (_) {}
        this.sock = null;
      }

      const evalResult = reconnection.evaluateDisconnect(lastDisconnect);
      console.warn(`\n[WhatsAppSession] ⚠️ Conexión cerrada. Motivo: ${evalResult.reason}`);

      if (evalResult.shouldCleanAuth) {
        reconnection.cleanAuthDirectory(config.authFolder);
      }

      // Reconexión infinita con backoff
      reconnection.scheduleReconnect(evalResult.delayMs, () => this.initSession());
    }
  }

  /**
   * Procesa mensajes entrantes y los enruta al backend de Python
   */
  async _handleMessagesUpsert({ messages, type }) {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes enviados por el propio bot
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      // Ignorar broadcasts y estados de WhatsApp
      if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('newsletter')) continue;

      // Extraer el texto del mensaje
      const text = this._extractMessageText(msg);
      if (!text) continue;

      // Obtener número limpio (ej. 50371234567)
      const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
      console.log(`[WhatsAppSession] 💬 Mensaje de +${senderPhone}: "${text}"`);

      // Enviar al Asistente Operativo en Python
      const aiResponse = await forwardToPythonBackend(senderPhone, text);

      if (aiResponse && aiResponse.reply) {
        console.log(`[WhatsAppSession] 🤖 Respondiendo a +${senderPhone}...`);
        await this.sendMessage(remoteJid, aiResponse.reply);

        if (aiResponse.transferred_to_human) {
          console.log(`[WhatsAppSession] 👨‍💼 Caso transferido a un humano para +${senderPhone}`);
        }
      }
    }
  }

  /**
   * Extrae el texto legible del mensaje soportando varios tipos de payload de Baileys
   */
  _extractMessageText(msg) {
    const message = msg.message;
    if (!message) return null;

    if (message.conversation) {
      return message.conversation.trim();
    }
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text.trim();
    }
    if (message.imageMessage?.caption) {
      return message.imageMessage.caption.trim();
    }
    if (message.videoMessage?.caption) {
      return message.videoMessage.caption.trim();
    }
    return null;
  }

  /**
   * Envía un mensaje de texto a un destinatario
   * @param {string} to - Número de teléfono (con o sin @s.whatsapp.net)
   * @param {string} text - Contenido del mensaje
   */
  async sendMessage(to, text) {
    if (!this.sock || this.status !== 'CONNECTED') {
      throw new Error(`No se puede enviar mensaje: WhatsApp no está conectado (Estado actual: ${this.status})`);
    }

    // Normalizar JID
    let jid = to;
    if (!jid.includes('@')) {
      const cleanDigits = jid.replace(/\D/g, '');
      jid = `${cleanDigits}@s.whatsapp.net`;
    }

    const result = await this.sock.sendMessage(jid, { text });
    return result;
  }

  /**
   * Cierre voluntario de sesión y limpieza
   */
  async logout() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (err) {
        console.error('[WhatsAppSession] Error durante logout:', err.message);
      }
    }
    reconnection.cleanAuthDirectory(config.authFolder);
    this.status = 'DISCONNECTED';
    this.user = null;
    this.qrString = null;
    this.qrDataUrl = null;
    console.log('[WhatsAppSession] Sesión cerrada y credenciales eliminadas.');
  }
}

module.exports = new WhatsAppSession();
