"""Manifest del módulo Restaurante & Pedidos."""

MANIFEST = {
    "id": "restaurant",
    "name": "Restaurante & Pedidos",
    "description": "Menú con stock, horarios, zonas de entrega, pagos y estadísticas. El bot toma pedidos reales por WhatsApp y avisa al cliente cada cambio de estado.",
    "version": "2.0.0",
    "icon": "UtensilsCrossed",
    "category": "Operaciones",
    "author": "Zenith",
    "depends": [],
    # Guía de uso que se muestra en el panel (sección «Guía de uso» del módulo).
    # Cada sección usa el mismo id que su pantalla, para poder abrirla desde la guía.
    "guide": {
        "summary": (
            "Convierte el WhatsApp del negocio en un punto de venta: el asistente muestra el menú, toma el pedido "
            "completo (productos, entrega y pago), lo registra en el panel y avisa al cliente cada vez que cambia "
            "de estado. Tú lo atiendes desde el tablero y ves cómo va el negocio en Estadísticas."
        ),
        "quick_start": [
            "Configuración → completa horario, tipos de pedido (domicilio, recoger, en el local), zonas de entrega y métodos de pago.",
            "Configuración → «Asistente IA del restaurante»: decide si la IA toma pedidos completos y cómo muestra el menú.",
            "Menú → agrega tus platillos uno por uno o pega varios a la vez con «Carga rápida».",
            "Prueba un pedido completo en «Simulador de chat» antes de conectar WhatsApp.",
            "Atiende los pedidos en «Tablero Kanban», arrastrándolos de columna en columna.",
        ],
        "sections": [
            {
                "id": "kanban",
                "title": "Tablero Kanban",
                "what": "La pantalla de trabajo del día: cada pedido es una tarjeta y cada columna es un estado.",
                "how": [
                    "Las columnas siguen el flujo Pendientes → Confirmadas → En cocina → Listas / En camino → Entregadas.",
                    "Arrastra una tarjeta a otra columna para cambiar su estado. Si «Avisar al cliente» está activo en Configuración, el cliente recibe un WhatsApp con el nuevo estado.",
                    "Haz clic en el estado de pago de la tarjeta para marcar el pedido como cobrado (o deshacerlo). Si tienes instalado Caja & Finanzas, el cobro entra solo a la caja.",
                    "Usa «Cancelar comanda» para anular un pedido: se pide el motivo, el stock de sus platillos se devuelve al menú y el cliente es notificado.",
                    "El ícono de impresora genera la comanda / ticket para cocina o para el repartidor.",
                    "El selector de período elige qué pedidos se ven en el tablero (por ejemplo, solo los de hoy).",
                    "«Nueva orden» registra pedidos que llegan por teléfono o en mostrador; el total lo calcula el sistema.",
                ],
                "tips": [
                    "Los pedidos que toma el bot aparecen marcados como «BOT».",
                    "Las tarjetas entregadas o canceladas ya no se pueden mover.",
                ],
            },
            {
                "id": "orders",
                "title": "Historial de pedidos",
                "what": "Consulta y revisión de todos los pedidos, con filtros, búsqueda y exportación.",
                "how": [
                    "Elige el período: Hoy, Ayer, Últimos 7 días, Este mes, Todos o un rango personalizado.",
                    "Filtra por estado (pendiente, en cocina, entregado, cancelado…) y por modalidad (domicilio, recoger, en el local).",
                    "Busca por nombre del cliente, teléfono, número de pedido, platillo o mesa.",
                    "Abre o imprime el ticket de cualquier pedido.",
                    "«CSV» descarga los pedidos filtrados para Excel o tu contabilidad.",
                ],
                "tips": ["Para revisar un día completo usa «Personalizado» con la misma fecha de inicio y fin."],
            },
            {
                "id": "menu",
                "title": "Menú y platillos",
                "what": "El catálogo que la IA ofrece por WhatsApp. Lo que cambies aquí lo usa el asistente al instante.",
                "how": [
                    "«Nuevo platillo»: nombre, precio, categoría, descripción y stock.",
                    "Stock vacío significa «sin límite». Con un número, se descuenta con cada pedido y el platillo se agota solo al llegar a 0.",
                    "Desactiva «Disponible» para ocultar un platillo temporalmente sin borrarlo.",
                    "«Carga rápida» agrega muchos platillos a la vez, uno por línea: Nombre | Precio | Categoría | Descripción.",
                    "Usa el buscador y el filtro de categoría para encontrar platillos en menús grandes.",
                ],
                "tips": [
                    "La IA solo ofrece platillos disponibles y con sus precios exactos; nunca inventa productos.",
                    "Cuando quedan 5 o menos unidades, el asistente lo sabe y puede avisarle al cliente.",
                ],
            },
            {
                "id": "stats",
                "title": "Estadísticas",
                "what": "Cómo va el negocio: ventas, pedidos, horas pico y platillos más vendidos.",
                "how": [
                    "Elige el rango: Hoy, 7 días o 30 días.",
                    "Ventas, pedidos y ticket promedio del rango; «Tomados por el bot» indica qué porcentaje de pedidos atendió la IA.",
                    "«Cancelados», «Pagados» y «Hora pico» ayudan a detectar problemas y a planificar personal.",
                    "Los gráficos muestran ventas por día, pedidos por hora del día y los platillos más vendidos.",
                    "«Stock bajo» lista los platillos a punto de agotarse.",
                ],
                "tips": [],
            },
            {
                "id": "settings",
                "title": "Configuración",
                "what": "Reglas del negocio que el asistente respeta al atender: horario, entregas, pagos y comportamiento de la IA.",
                "how": [
                    "Asistente IA: si toma pedidos completos o solo informa el menú, si sugiere complementos, si pide el nombre, cómo muestra el menú, un enlace a la carta con fotos e indicaciones especiales (promociones, combos, alergias).",
                    "Saludo del restaurante: si lo llenas, reemplaza al saludo del Perfil mientras el módulo esté activo; vacío usa el del Perfil.",
                    "«Recibiendo pedidos» es el interruptor general: apágalo si la cocina se satura y el bot dejará de tomar pedidos aunque estés en horario.",
                    "Horario: un horario por día. Si cierras pasada la medianoche pon la hora de cierre menor que la de apertura (ej. 18:00 a 02:00). «Copiar lunes» lo aplica a toda la semana.",
                    "Zonas de entrega: cada zona tiene costo de envío, pedido mínimo y minutos extra. Sin zonas, se usa un costo de envío fijo.",
                    "Métodos de pago: efectivo, transferencia y tarjeta. Con transferencia, escribe los datos de la cuenta; el bot los envía y pide la foto del comprobante.",
                    "Pulsa «Guardar cambios» en la barra superior; el bot usa la configuración nueva de inmediato.",
                ],
                "tips": ["La zona horaria de El Salvador es UTC −6 y no cambia durante el año."],
            },
        ],
        "faq": [
            {"q": "¿Cómo sabe la IA qué hay en el menú y cuánto cuesta?",
             "a": "Lee el menú y la configuración en vivo cada vez que responde. Los totales los calcula siempre el sistema, nunca la IA."},
            {"q": "¿Por qué el bot no tomó un pedido?",
             "a": "Revisa que esté dentro del horario, que «Recibiendo pedidos» esté encendido, que el tipo de pedido y el método de pago estén habilitados y que el cliente esté en una zona con cobertura."},
            {"q": "¿El cliente puede preguntar por su pedido o cancelarlo?",
             "a": "Sí. Si pregunta cómo va, la IA responde con el estado real. Puede cancelar solo mientras el pedido siga pendiente; después debe hablar con el negocio."},
            {"q": "¿Qué pasa si se equivocan al marcar un pedido como pagado?",
             "a": "Vuelve a hacer clic en el estado de pago. Si Caja & Finanzas está instalado, el cobro se anula (o se registra un reembolso si ese corte de caja ya se cerró)."},
        ],
    },
}
