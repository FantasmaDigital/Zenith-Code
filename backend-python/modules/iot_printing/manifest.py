"""Manifest del módulo IoT de Impresión."""

MANIFEST = {
    "id": "iot_printing",
    "name": "Impresión IoT & Comandas",
    "description": "Control de impresoras térmicas POS conectadas por Red (Ethernet/WiFi TCP Socket) o USB para comandas automáticas de cocina y tickets de caja.",
    "version": "1.0.0",
    "icon": "Printer",
    "category": "Hardware & IoT",
    "author": "Zenith Official",
    "depends": [],
    "guide": {
        "summary": (
            "Módulo de hardware para conectar e imprimir directamente en impresoras térmicas ESC/POS a través de la red local "
            "(Ethernet / WiFi mediante Socket RAW TCP en el puerto 9100) o terminal USB. Permite separar roles automáticamente: "
            "comandas para Cocina con notas de preparación y tickets/facturas para Caja con corte de papel y apertura de gaveta."
        ),
        "quick_start": [
            "Conecta la impresora térmica al router de tu red local mediante cable Ethernet o WiFi.",
            "Obtén la dirección IP de la impresora (apágala, mantén presionado el botón FEED y enciéndela; imprimirá un ticket con su IP).",
            "Impresión IoT → «+ Agregar Impresora»: escribe un nombre (ej: «Cocina Principal»), la dirección IP y el puerto 9100.",
            "Elige el rol de la impresora: «Cocina (Comandas)», «Caja (Tickets / Facturas)» o «Todas las áreas».",
            "Presiona «Probar Impresión» para enviar un ticket de prueba y verificar que el socket responda en milisegundos."
        ],
        "sections": [
            {
                "id": "printers",
                "title": "Impresoras Registradas",
                "what": "Catálogo y administración de todas las impresoras térmicas del local.",
                "how": [
                    "«+ Agregar Impresora»: define el nombre, IP, puerto RAW (9100 por defecto), ancho de papel (80mm o 58mm) y rol.",
                    "Rol Cocina: recibe automáticamente comandas cuando una orden pasa a «En Cocina» o cuando se presiona «Cocina IoT».",
                    "Rol Caja: recibe automáticamente tickets de cobro y facturas fiscales cuando se emite un comprobante.",
                    "Opciones de hardware: activa «Corte automático» para que la guillotina corte el ticket al terminar, y «Abrir gaveta de dinero» para enviar el pulso RJ11 al cajón portamonedas.",
                    "«Probar Impresión»: envía una señal de diagnóstico en binario ESC/POS para comprobar la conectividad en vivo.",
                    "Edita o elimina impresoras en cualquier momento con los botones de acción en cada tarjeta."
                ],
                "tips": [
                    "Te recomendamos fijar la dirección IP de tu impresora en el router (DHCP estático) para que no cambie al reiniciar el módem."
                ]
            },
            {
                "id": "logs",
                "title": "Historial de Impresión",
                "what": "Registro de auditoría técnica de todos los trabajos enviados a las impresoras.",
                "how": [
                    "Revisa la fecha, hora, tipo de trabajo (comanda de cocina, ticket de factura, prueba de diagnóstico) y la impresora receptora.",
                    "El indicador verde «Exitoso» confirma que el socket TCP entregó los bytes a la impresora.",
                    "Si una impresora está apagada o sin cable de red, el log indicará «Error» detallando la causa (ej: Timeout de conexión) sin congelar el sistema."
                ],
                "tips": [
                    "El sistema usa un timeout de seguridad de 2.5 segundos: si una impresora se apaga o se queda sin papel, el software continúa operando sin demoras."
                ]
            }
        ],
        "faq": [
            {
                "q": "¿Qué marcas de impresoras son compatibles?",
                "a": "Cualquier impresora térmica estándar ESC/POS que cuente con puerto de red Ethernet/WiFi (Epson, Bixolon, Star Micronics, Xprinter, Rongta, POS-58/80, etc.)."
            },
            {
                "q": "¿Qué puerto debo usar?",
                "a": "El puerto estándar universal para impresión RAW en red es el 9100. Salvo configuraciones personalizadas del fabricante, deja siempre 9100."
            },
            {
                "q": "¿Puedo tener una impresora en Cocina y otra distinta en Caja?",
                "a": "Sí. Configura la primera con rol «Cocina» y la segunda con rol «Caja». El sistema enviará cada documento a la impresora adecuada de forma inteligente."
            }
        ]
    }
}
