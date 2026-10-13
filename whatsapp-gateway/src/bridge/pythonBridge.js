const config = require('../config');

/**
 * Reenvía un mensaje entrante de WhatsApp al backend de Python con el Asistente Operativo.
 * @param {string} senderNumber - Número de teléfono o identificador del usuario
 * @param {string} userMessage - Texto del mensaje enviado por el cliente
 * @returns {Promise<{reply: string, transferred_to_human: boolean} | null>}
 */
async function forwardToPythonBackend(senderNumber, userMessage) {
  const url = `${config.pythonBackendUrl}/chat`;

  const payload = {
    session_id: senderNumber,
    message: userMessage
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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
