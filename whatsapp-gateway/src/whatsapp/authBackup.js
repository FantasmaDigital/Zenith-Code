/**
 * Respaldo de la sesión de WhatsApp (archivos de Baileys) en la base de datos, vía el backend.
 *
 * - Al arrancar sin creds.json en disco (contenedor recreado sin volumen), se restauran desde la BD:
 *   el número sigue vinculado y NO hace falta escanear el QR otra vez.
 * - Mientras la sesión vive, los archivos que cambian se suben (cifrados en el backend).
 * - Al desvincular, se borra el respaldo.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const SYNC_INTERVAL_MS = 15000;
const MAX_FILE_BYTES = 512 * 1024;
const FILE_RE = /^[A-Za-z0-9._@:+=-]{1,200}$/;

function headers() {
  return { 'Content-Type': 'application/json', 'X-Internal-Key': config.internalApiKey };
}

function url(tenant = '') {
  return `${config.pythonBackendUrl}/api/internal/wa-auth${tenant ? `/${encodeURIComponent(tenant)}` : ''}`;
}

async function request(method, tenant, body) {
  const res = await fetch(url(tenant), {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

/** Empresas con sesión respaldada en la BD. */
async function listTenants() {
  try {
    return (await request('GET', '')).tenants || [];
  } catch (e) {
    console.warn('[AuthBackup] No se pudo listar las sesiones respaldadas:', e.message);
    return [];
  }
}

function readFolder(folder) {
  const out = {};
  let entries = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    // Solo archivos de esta sesión (la carpeta raíz contiene «tenants/» de las demás empresas)
    if (!e.isFile() || !FILE_RE.test(e.name) || !e.name.endsWith('.json')) continue;
    try {
      const p = path.join(folder, e.name);
      if (fs.statSync(p).size > MAX_FILE_BYTES) continue;
      out[e.name] = fs.readFileSync(p, 'utf8');
    } catch (_) { /* archivo borrado entre medio */ }
  }
  return out;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

class AuthBackup {
  constructor(tenant, folder) {
    this.tenant = tenant;
    this.folder = folder;
    this.known = new Map(); // archivo -> hash ya subido
    this.timer = null;
    this.flushing = null;
    this.debounce = null;
    this.disabled = !config.internalApiKey;
  }

  /** Si no hay credenciales en disco, las trae de la BD. Devuelve true si restauró una sesión. */
  async restoreIfMissing() {
    if (this.disabled || fs.existsSync(path.join(this.folder, 'creds.json'))) return false;
    try {
      const { files = {} } = await request('GET', this.tenant);
      if (!files['creds.json']) return false;
      fs.mkdirSync(this.folder, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        if (!FILE_RE.test(name) || typeof content !== 'string') continue;
        fs.writeFileSync(path.join(this.folder, name), content);
        this.known.set(name, hash(content));
      }
      console.log(`[AuthBackup:${this.tenant}] ♻️ Sesión restaurada desde la base de datos (${Object.keys(files).length} archivos). No hace falta QR.`);
      return true;
    } catch (e) {
      console.error(`[AuthBackup:${this.tenant}] No se pudo restaurar la sesión desde la BD:`, e.message);
      return false;
    }
  }

  start() {
    if (this.disabled || this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  /** Programa un respaldo pronto (tras creds.update). */
  soon() {
    if (this.disabled) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = null; this.flush().catch(() => {}); }, 1500);
  }

  /** Sube los archivos nuevos o modificados y marca los borrados. */
  async flush() {
    if (this.disabled) return;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const current = readFolder(this.folder);
      if (!current['creds.json']) return; // sin sesión todavía: nada que respaldar
      const changes = {};
      for (const [name, content] of Object.entries(current)) {
        const h = hash(content);
        if (this.known.get(name) !== h) changes[name] = content;
      }
      for (const name of this.known.keys()) {
        if (!(name in current)) changes[name] = null;
      }
      const names = Object.keys(changes);
      if (!names.length) return;
      // En lotes para no mandar cuerpos enormes la primera vez
      for (let i = 0; i < names.length; i += 200) {
        const batch = Object.fromEntries(names.slice(i, i + 200).map((n) => [n, changes[n]]));
        await request('PUT', this.tenant, { files: batch });
      }
      for (const n of names) {
        if (changes[n] === null) this.known.delete(n);
        else this.known.set(n, hash(changes[n]));
      }
    })().catch((e) => {
      console.warn(`[AuthBackup:${this.tenant}] No se pudo respaldar la sesión en la BD:`, e.message);
    }).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Desvinculación real: borra el respaldo. */
  async clear() {
    this.known.clear();
    if (this.disabled) return;
    try {
      await request('DELETE', this.tenant);
      console.log(`[AuthBackup:${this.tenant}] Respaldo de sesión eliminado de la BD.`);
    } catch (e) {
      console.error(`[AuthBackup:${this.tenant}] No se pudo borrar el respaldo de la BD:`, e.message);
    }
  }
}

module.exports = { AuthBackup, listTenants };
