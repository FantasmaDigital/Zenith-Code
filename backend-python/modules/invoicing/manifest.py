"""Manifest del módulo Facturación & DTE El Salvador."""

MANIFEST = {
    "id": "invoicing",
    "name": "Facturación & DTE El Salvador",
    "description": "Facturación comercial e integrada para El Salvador (DTE: Factura 01, Crédito Fiscal 03) con modo offline interno o transmisión con Ministerio de Hacienda.",
    "version": "1.0.0",
    "icon": "Receipt",
    "category": "Finanzas & Fiscal",
    "author": "Zenith Official",
    "depends": [],
    "guide": {
        "summary": (
            "Sistema integral de facturación electrónica y comercial adaptado a la normativa del Ministerio de Hacienda "
            "de El Salvador (DTE) y con soporte para Tickets POS locales. Permite emitir Factura Consumidor Final (01), "
            "Comprobante de Crédito Fiscal (03) con desglose de IVA 13% y Retención 1%, así como operar en modo local sin fisco."
        ),
        "quick_start": [
            "Configuración Hacienda SV → Elige si deseas transmitir a Hacienda SV o trabajar en Modo Interno Offline.",
            "Si activas Hacienda SV: ingresa tu NIT, NRC, Razón Social, Nombre Comercial, Giro y Códigos de Establecimiento/Punto de Venta (ej: M001 / P001).",
            "Selecciona el ambiente: «00 - Pruebas / Sandbox» para emitir pruebas seguras, o «01 - Producción» para validez tributaria real.",
            "Emite facturas desde «Nueva Factura» o directamente cobrando pedidos desde el módulo Restaurante.",
            "Revisa tus comprobantes en «Comprobantes Emitidos»: consulta el UUID v4 oficial, correlativo DTE, vista previa 80mm y enlace público con QR."
        ],
        "sections": [
            {
                "id": "invoices",
                "title": "Comprobantes Emitidos",
                "what": "Historial y auditoría de todos los DTE y tickets generados por el negocio.",
                "how": [
                    "Buscador rápido: localiza facturas por Número de Control DTE, UUID de Generación o Nombre del Cliente.",
                    "Filtra por tipo de comprobante: Todos, Factura Consumidor Final (01), Crédito Fiscal (03) o Ticket POS (00).",
                    "Botón «Ver Comprobante» (ojo): abre la vista de impresión en formato ticket 80mm con QR y datos fiscales.",
                    "Botón «Imprimir Navegador»: permite imprimir en impresoras láser, PDF o cualquier impresora conectada a la PC.",
                    "Botón «Anular»: permite invalidar una factura emitida registrando el motivo en auditoría."
                ],
                "tips": [
                    "Los comprobantes emitidos enlazan automáticamente el ingreso a la caja del turno activo si tienes Caja & Finanzas instalado."
                ]
            },
            {
                "id": "new",
                "title": "Nueva Factura / Ticket",
                "what": "Emisión directa y detallada de comprobantes fiscales y tickets de venta.",
                "how": [
                    "Selecciona el tipo de documento: Factura (01) para público general, Crédito Fiscal (03) para empresas/contribuyentes, o Ticket POS (00).",
                    "Si seleccionas Crédito Fiscal (03), es obligatorio ingresar el NRC y el NIT o DUI del cliente.",
                    "Agrega los ítems vendidos indicando descripción, cantidad y precio unitario.",
                    "El sistema desglosa automáticamente el Subtotal Neto y el IVA 13% conforme a las reglas del Ministerio de Hacienda.",
                    "Selecciona la forma de pago (Efectivo, Tarjeta o Transferencia) y presiona «Emitir Comprobante»."
                ],
                "tips": [
                    "En Factura (01), los precios unitarios ya incluyen el IVA según la ley salvadoreña; en Crédito Fiscal (03) el IVA se calcula sobre la base gravada."
                ]
            },
            {
                "id": "config",
                "title": "Configuración Fiscal & Hacienda SV",
                "what": "Parámetros del emisor y conexión con el Ministerio de Hacienda de El Salvador.",
                "how": [
                    "«Activar Emisión DTE Hacienda SV»: activa o apaga la transmisión oficial al fisco. Si está apagado, emite tickets correlativos internos sin requerir tokens.",
                    "Ambiente: «00» para pruebas de integración con Hacienda, «01» para producción oficial en vivo.",
                    "Datos del emisor: NIT, NRC, Nombre Comercial, Razón Social, Actividad Económica y Dirección del establecimiento.",
                    "Códigos de emisión: Código de Establecimiento (M001 a M999) y Código de Punto de Venta (P001 a P999).",
                    "Clave privada / API Token: credencial provista por el Ministerio de Hacienda para firmar DTE."
                ],
                "tips": [
                    "Revisa que tu NRC y NIT coincidan con tu tarjeta tributaria oficial de El Salvador antes de pasar a ambiente 01 de producción."
                ]
            }
        ],
        "faq": [
            {
                "q": "¿Qué pasa si se corta el internet?",
                "a": "El sistema continúa funcionando sin interrupciones. Si la conexión a Hacienda no está disponible, puedes emitir en Modo Interno (Ticket 00) y luego regularizar o registrar la venta."
            },
            {
                "q": "¿Cuál es la diferencia entre Factura (01) y Crédito Fiscal (03)?",
                "a": "La Factura (01) se emite a consumidores finales que no deducen IVA. El Comprobante de Crédito Fiscal (03) se emite a contribuyentes registrados en IVA (empresas o profesionales) y requiere obligatoriamente su NRC."
            },
            {
                "q": "¿Puedo cobrar una orden de Restaurante y facturarla al mismo tiempo?",
                "a": "Sí. Al presionar «Cobrar» en cualquier orden de Restaurante se despliega el asistente para emitir la Factura o Crédito Fiscal correspondiente."
            }
        ]
    }
}
