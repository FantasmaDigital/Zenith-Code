const config = require('../config');

/**
 * Reenvía un mensaje entrante de WhatsApp al backend de Python con el Asistente Operativo.
 * @param {string} senderNumber - Número de teléfono o identificador del usuario
 * @param {string} userMessage - Texto del mensaje enviado por el cliente
 * @returns {Promise<{reply: string, transferred_to_human: boolean} | null>}
 */
async function forwardToPythonBackend(senderNumber, userMessage, media = {}) {
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

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': config.internalApiKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[PythonBridge] Error HTTP ${response.status} desde ${url}: ${errText}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[PythonBridge] Error de conexión con Python backend (${url}):`, error.message);
    return null;
  }
}

module.exports = {
  forwardToPythonBackend
};
