"""Manifest del módulo de Inventario & Insumos."""

MANIFEST = {
    "id": "inventory",
    "name": "Inventario & Insumos",
    "description": (
        "Control universal de existencias, insumos para recetas (escandallo), compras a proveedores, "
        "mermas y Kardex valorizado. Enlazado automáticamente con Restaurante y Finanzas."
    ),
    "version": "1.0.0",
    "icon": "Boxes",
    "category": "GESTIÓN DE OPERACIONES",
    "author": "Zenith",
    "depends": ["restaurant"],
    "parent_module": "restaurant",
    "is_child": True,
    "guide": {
        "summary": (
            "Controla las existencias físicas de tu negocio en tiempo real. Para restaurantes: gestiona materias primas "
            "(carne, pan, quesos) y crea recetas para que al cobrar un pedido se descuenten automáticamente los ingredientes. "
            "Para comercio y retail: controla productos terminados con ventas 1 a 1. Además, registra compras con opción de "
            "generar el gasto en Finanzas y audita cada entrada o salida en el Kardex."
        ),
        "quick_start": [
            "Stock → Registra tus productos terminados o insumos iniciales con su stock y costo.",
            "Recetas (BOM) → Si vendes platos o combos, define los insumos y gramos que lleva cada uno.",
            "Entradas / Compras → Ingresa compras de proveedores y cárgalas automáticamente a Caja en Finanzas.",
            "Ventas → Al cobrar un pedido en Restaurante, los ingredientes se descuentan solos.",
            "Mermas → Registra desperdicios o caducidades para controlar costos perdidos.",
            "Kardex → Audita el historial completo de movimientos."
        ],
        "sections": [
            {
                "id": "stock",
                "title": "Existencias y Catálogo",
                "what": "Lista de todos los artículos, materias primas y productos de reventa con su stock actual y alertas.",
                "how": [
                    "«Nuevo Artículo»: define nombre, tipo (Producto terminado, Insumo crudo, Compuesto), unidad (kg, g, l, ml, pza) y stock mínimo.",
                    "El semáforo visual alerta en rojo cuando un artículo está por debajo de su stock mínimo o en cero.",
                    "«Ajuste Rápido»: corrige el stock físico tras un conteo de inventario indicando el motivo."
                ],
                "tips": [
                    "Si marcas 'Controlar stock = No', el artículo se mostrará pero no bloqueará ventas si se agota."
                ]
            },
            {
                "id": "recipes",
                "title": "Fichas Técnicas / Recetas (BOM)",
                "what": "Composición de cada plato o combo: qué insumos lleva y qué cantidad exacta se consume por venta.",
                "how": [
                    "Selecciona un plato del menú o producto compuesto.",
                    "Agrega los insumos requeridos (ej. 0.25 kg de carne molida, 1 pieza de pan brioche, 30 ml de salsa).",
                    "El sistema calcula el costo teórico del plato sumando el costo de cada ingrediente."
                ],
                "tips": [
                    "Las ventas en Restaurante consultan esta receta para descontar automáticamente los insumos."
                ]
            },
            {
                "id": "purchases",
                "title": "Entradas y Compras",
                "what": "Recepción de mercancía de proveedores que incrementa el stock y actualiza el costo.",
                "how": [
                    "Selecciona el ítem, ingresa la cantidad recibida y el costo unitario de compra.",
                    "Activa 'Registrar egreso en Finanzas' para que se cree el gasto en la caja chica automáticamente.",
                    "El sistema recalcula el costo promedio ponderado del inventario."
                ],
                "tips": [
                    "Puedes incluir el número de factura o nombre del proveedor en las notas."
                ]
            },
            {
                "id": "waste",
                "title": "Mermas y Desperdicios",
                "what": "Registro de pérdidas por caducidad, descomposición, errores de cocina o roturas.",
                "how": [
                    "Selecciona el insumo y la cantidad desechada.",
                    "Elige el motivo (Caducidad, Error de preparación, Dañado, Merma natural).",
                    "El sistema descuenta el stock y calcula el costo total de la pérdida para tus reportes."
                ],
                "tips": [
                    "Revisar las mermas semanalmente te ayuda a detectar fugas y mejorar porciones."
                ]
            },
            {
                "id": "kardex",
                "title": "Historial de Movimientos (Kardex)",
                "what": "Libro mayor de auditoría: cada unidad que entra o sale con fecha, usuario y módulo de origen.",
                "how": [
                    "Filtra por tipo de movimiento (Venta, Compra, Merma, Ajuste), rango de fechas o busca por producto.",
                    "Revisa el stock anterior y el stock resultante tras cada transacción."
                ],
                "tips": [
                    "Los movimientos automáticos del restaurante llevan la referencia 'order_ID' para fácil rastreo."
                ]
            }
        ]
    }
}

