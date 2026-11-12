"""Manifest del módulo de Tarjetas de Fidelidad."""

MANIFEST = {
    "id": "loyalty",
    "name": "Tarjetas de Fidelidad",
    "description": (
        "Programas de lealtad por puntos o por sellos: tarjetas digitales con QR para tus clientes, "
        "acumulación por compra, canje de recompensas e historial. Funciona solo o junto al Agente IA."
    ),
    "version": "1.0.0",
    "icon": "CreditCard",
    "category": "FIDELIZACIÓN",
    "author": "Zenith",
    "depends": [],
    # Producto del plan: una empresa puede tener SOLO este producto, sin el ARM
    "feature": "loyalty",
    "guide": {
        "summary": (
            "Premia a tus clientes frecuentes. Crea un programa por puntos (ej. $1 = 1 punto) o por sellos "
            "(ej. 10 visitas = 1 café gratis), emite tarjetas digitales con código QR y registra cada compra. "
            "El cliente consulta su saldo desde el enlace de su tarjeta, sin instalar nada."
        ),
        "quick_start": [
            "Programas → Crea tu programa: por puntos o por sellos, con su regla de acumulación.",
            "Recompensas → Define qué puede canjear el cliente y cuántos puntos cuesta.",
            "Tarjetas → Emite una tarjeta con el nombre y teléfono del cliente y compártele su enlace.",
            "Caja → Busca la tarjeta (código, QR o teléfono) y registra la compra o el canje.",
            "Reportes → Revisa tarjetas activas, puntos emitidos y canjes."
        ],
        "sections": [
            {
                "id": "programs",
                "title": "Programas",
                "what": "Las reglas de tu plan de lealtad.",
                "how": [
                    "Puntos: define cuántos puntos da cada unidad de moneda gastada (ej. 1 punto por $1).",
                    "Sellos: cada compra suma un sello; al llegar a la meta el cliente gana su recompensa.",
                    "Vencimiento opcional: los puntos sin movimiento por N días pueden caducar."
                ],
                "tips": ["Empieza con un solo programa sencillo; es más fácil de explicar en mostrador."]
            },
            {
                "id": "cards",
                "title": "Tarjetas",
                "what": "Cada cliente tiene una tarjeta con código único y enlace público con QR.",
                "how": [
                    "«Nueva tarjeta»: nombre, teléfono y/o correo del cliente.",
                    "Comparte el enlace de la tarjeta: el cliente ve su saldo y sus recompensas disponibles.",
                    "Puedes bloquear una tarjeta extraviada sin perder su historial."
                ],
                "tips": ["El teléfono sirve para encontrar la tarjeta rápido en caja."]
            },
            {
                "id": "pos",
                "title": "Caja (acumular y canjear)",
                "what": "Registro de compras y canjes en el punto de venta.",
                "how": [
                    "Busca la tarjeta por código o teléfono.",
                    "Acumular: escribe el monto de la compra (puntos) o suma el sello.",
                    "Canjear: elige la recompensa; el saldo se descuenta al instante."
                ],
                "tips": ["Usa la referencia (n.º de ticket) para evitar registrar dos veces la misma compra."]
            },
            {
                "id": "rewards",
                "title": "Recompensas",
                "what": "Catálogo de premios que el cliente puede canjear con sus puntos.",
                "how": ["Define nombre y costo en puntos; desactívalas cuando ya no apliquen."],
                "tips": []
            },
            {
                "id": "stats",
                "title": "Reportes",
                "what": "Tarjetas activas, puntos emitidos y canjeados, y mejores clientes.",
                "how": ["Filtra por programa para comparar resultados."],
                "tips": []
            }
        ]
    }
}
