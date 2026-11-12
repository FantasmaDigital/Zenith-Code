"""Manifest del módulo Caja & Finanzas."""

MANIFEST = {
    "id": "finance",
    "name": "Caja & Finanzas",
    "description": "Gestión de caja chica, turnos y cortes (X y Z), control de ingresos/egresos, gastos operativos y balance consolidado conectado a restaurantes y futuros módulos.",
    "version": "1.1.0",
    "icon": "Wallet",
    "category": "Finanzas & Contabilidad",
    "author": "Zenith",
    "depends": [],
    # Guía de uso que se muestra en el panel (sección «Guía de uso» del módulo).
    # Cada sección usa el mismo id que su pantalla, para poder abrirla desde la guía.
    "guide": {
        "summary": (
            "Controla el dinero del negocio: abre y cierra la caja por turnos, registra gastos, retiros y "
            "depósitos, cuadra el efectivo contando billetes y monedas, y revisa la utilidad por mes. Los cobros "
            "del restaurante entran solos. Nada se borra: los errores se anulan con motivo y todo queda en la bitácora."
        ),
        "quick_start": [
            "Categorías → revisa las categorías de gastos e ingresos y agrega las de tu negocio.",
            "Turno & Arqueo → «Abrir turno de caja» con el nombre del responsable y el fondo de cambio.",
            "Durante el día registra gastos, retiros y depósitos; los cobros del restaurante se suman solos.",
            "Al terminar, «Cerrar turno (Corte Z)» contando billetes y monedas.",
            "Revisa la utilidad del mes en «Reportes».",
        ],
        "sections": [
            {
                "id": "shift",
                "title": "Turno y arqueo",
                "what": "La caja del turno en curso: cuánto efectivo debería haber en el cajón y todo lo que entra y sale.",
                "how": [
                    "«Abrir turno de caja»: escribe el responsable y el fondo inicial (billetes y monedas con los que arranca el cajón). Solo puede haber una caja abierta a la vez.",
                    "Efectivo esperado = fondo + ventas en efectivo + depósitos − gastos en efectivo − retiros.",
                    "Gasto: compras e insumos pagados del cajón u otro medio. Ingreso extra: entradas que no son ventas del restaurante.",
                    "Retiro de caja: sacar efectivo (por ejemplo, para llevarlo al banco). Depósito a caja: meter efectivo (por ejemplo, más cambio). Ninguno de los dos cuenta como gasto o venta.",
                    "«Corte X» imprime un corte parcial sin cerrar la caja, útil a media jornada.",
                    "«Cerrar turno (Corte Z)»: cuenta cuántos billetes y monedas de cada valor hay; el sistema suma el total y muestra si hay faltante o sobrante. También puedes escribir solo el total.",
                    "Al confirmar el cierre se genera el ticket del Corte Z con el detalle del conteo.",
                ],
                "tips": [
                    "Si se cobra un pedido con la caja cerrada, ese cobro entra automáticamente al siguiente turno que abras.",
                    "Un corte cerrado ya no cambia: es el respaldo oficial de ese turno.",
                ],
            },
            {
                "id": "shifts_history",
                "title": "Historial de cortes",
                "what": "Todos los turnos con su fondo, ventas, gastos, efectivo esperado, efectivo contado y diferencia.",
                "how": [
                    "La columna «Diferencia» muestra si el turno cuadró exacto, con faltante (rojo) o con sobrante.",
                    "El ícono de impresora vuelve a generar el ticket de cualquier corte.",
                    "El turno abierto aparece como «En curso».",
                ],
                "tips": [],
            },
            {
                "id": "transactions",
                "title": "Movimientos",
                "what": "El libro de todos los ingresos, gastos, retiros y depósitos, manuales o automáticos.",
                "how": [
                    "Filtra por tipo, método de pago, origen (restaurante o caja) y rango de fechas, o busca por concepto, referencia o persona.",
                    "«CSV» descarga los movimientos filtrados para Excel o para tu contabilidad.",
                    "El clip permite adjuntar la foto de la factura o un PDF; si está en azul, el movimiento ya tiene comprobante y puedes abrirlo.",
                    "«Anular» pide un motivo. El movimiento queda en el libro tachado y deja de contar en los totales.",
                ],
                "tips": [
                    "Solo se pueden anular movimientos manuales del turno abierto (o registrados sin caja abierta).",
                    "Los cobros del restaurante se revierten desde el restaurante (desmarcando el pago); si su corte ya se cerró, se registra un reembolso en el turno actual.",
                ],
            },
            {
                "id": "reports",
                "title": "Reportes",
                "what": "El estado de resultados: ingresos, gastos y utilidad del período, comparados con el período anterior.",
                "how": [
                    "Elige Este mes, Mes anterior, Últimos 30 días, Este año o un rango de fechas propio.",
                    "Cada total muestra cuánto subió o bajó frente al período anterior de la misma duración.",
                    "La tabla «Por mes» muestra ingresos, gastos y utilidad de cada mes del rango.",
                    "Abajo están los ingresos y gastos por categoría y los ingresos por método de pago.",
                    "«Exportar CSV» descarga el reporte completo.",
                ],
                "tips": [
                    "Los retiros y depósitos de caja no cuentan en la utilidad; solo mueven efectivo.",
                    "Las fechas usan la hora del negocio (El Salvador), así una venta de las 9 p. m. del último día del mes cuenta en ese mes.",
                ],
            },
            {
                "id": "categories",
                "title": "Categorías",
                "what": "Las categorías de ingresos y gastos que aparecen al registrar un movimiento y que ordenan los reportes.",
                "how": [
                    "Escribe el nombre, elige si es de gasto o de ingreso y pulsa «Agregar».",
                    "«Renombrar» cambia el nombre; los movimientos anteriores muestran el nombre nuevo.",
                    "«Desactivar» la oculta para movimientos nuevos sin afectar los anteriores.",
                ],
                "tips": ["«Venta» y «Reembolso» son del sistema: las usa el restaurante y no se pueden desactivar."],
            },
            {
                "id": "audit",
                "title": "Bitácora",
                "what": "El registro de quién hizo qué y cuándo: aperturas, cierres, movimientos, anulaciones, comprobantes y cambios de categorías.",
                "how": [
                    "Busca por persona, acción o detalle.",
                    "Cada registro guarda la fecha, la persona, el detalle y la IP del equipo desde donde se hizo.",
                ],
                "tips": [
                    "La bitácora no se puede editar ni borrar.",
                    "La «persona» es el nombre escrito al abrir o cerrar caja; el panel usa una sola contraseña de administrador.",
                ],
            },
        ],
        "faq": [
            {"q": "¿Cuál es la diferencia entre un gasto y un retiro?",
             "a": "Un gasto es dinero que se va del negocio (compras, servicios) y baja la utilidad. Un retiro solo saca efectivo del cajón (por ejemplo, para depositarlo en el banco); el dinero sigue siendo del negocio."},
            {"q": "Me equivoqué en un gasto de un turno que ya cerré. ¿Cómo lo corrijo?",
             "a": "Los cortes cerrados no se modifican. Registra un movimiento de ajuste en el turno actual con un concepto que explique la corrección."},
            {"q": "Olvidé abrir la caja y ya cobré pedidos. ¿Se pierden?",
             "a": "No. Esos cobros quedan pendientes y entran automáticamente al turno que abras después."},
            {"q": "¿Por qué no puedo anular una venta del restaurante desde aquí?",
             "a": "Para que la caja y el pedido no queden distintos. Desmarca el pago en el pedido del restaurante y la caja se ajusta sola."},
        ],
    },
}
