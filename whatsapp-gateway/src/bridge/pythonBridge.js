const config = require('../config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Errores de red en los que el backend NUNCA recibió la petición: es seguro reintentar.
// (Un timeout o un 5xx no se reintentan: la IA pudo haber registrado un pedido y se duplicaría.)
const RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'UND_ERR_SOCKET']);

function isRetryable(error) {
  const code = error?.cause?.code || error?.code;
  return RETRYABLE_CODES.has(code);
}

/**
 * Reenvía un mensaje entrante de WhatsApp al backend de Python.
 * Multi-empresa: incluye X-Tenant-Id para que el backend responda con la IA y Base de Conocimiento de esa empresa.
 * @returns {Promise<{reply: string, transferred_to_human: boolean, human_handoff_active?: boolean} | null>}
 */
async function forwardToPythonBackend(senderNumber, userMessage, media = {}, tenantId = 'default') {
  const url = `${config.pythonBackendUrl}/chat`;

  const payload = {
    session_id: senderNumber,
    message: userMessage || '',
    audio_base64: media.audioBase64 || null,
    audio_mime_type: media.audioMimeType || 'audio/ogg; codecs=opus',
    image_base64: media.imageBase64 || null,
    image_mime_type: media.imageMimeType || 'image/jpeg',
    contact_name: media.contactName || null
  };

  const resolvedTenant = (tenantId || config.tenantId || 'default').trim().toLowerCase();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': config.internalApiKey,
          'X-Tenant-Id': resolvedTenant
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.backendTimeoutMs)
      });

      if (!response.ok) {
        const errText = (await response.text().catch(() => '')).slice(0, 500);
        console.error(`[PythonBridge] HTTP ${response.status} desde ${url} para empresa [${resolvedTenant}]: ${errText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        console.error(`[PythonBridge] El backend no respondió en ${config.backendTimeoutMs / 1000}s para empresa [${resolvedTenant}].`);
        return null;
      }
      if (isRetryable(error) && attempt < maxAttempts) {
        console.warn(`[PythonBridge] Backend no disponible (${error?.cause?.code || error.message}); reintento ${attempt}/${maxAttempts - 1}...`);
        await sleep(2000 * attempt);
        continue;
      }
      console.error(`[PythonBridge] Error de conexión con Python backend (${url}) para empresa [${resolvedTenant}]:`, error?.cause?.code || error.message);
      return null;
    }
  }
  return null;
}

module.exports = {
  forwardToPythonBackend
};
