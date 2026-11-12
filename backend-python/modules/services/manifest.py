"""Manifest del módulo Servicios Profesionales."""

MANIFEST = {
    "id": "services",
    "name": "Servicios Profesionales",
    "description": (
        "CRM y gestión comercial para empresas de servicios: software, consultoría, agencias, diseño, legal y más. "
        "Administra tu catálogo de servicios, pipeline de prospectos, propuestas y proyectos activos, "
        "con integración de IA como agente de ventas y relaciones."
    ),
    "version": "1.0.0",
    "icon": "Briefcase",
    "category": "Gestión Comercial",
    "author": "Zenith Official",
    "depends": [],
    "guide": {
        "summary": (
            "Módulo 100% independiente para empresas de servicios profesionales. Centraliza tu portafolio de servicios, "
            "gestiona prospectos con un pipeline de ventas visual, emite propuestas y da seguimiento a proyectos activos. "
            "La IA actúa como agente de relaciones y ventas: presenta servicios, captura leads y agenda seguimientos "
            "directamente desde WhatsApp o el chat web. Funciona para software, agencias, consultorías, despachos legales, "
            "estudios de diseño y cualquier negocio orientado a servicios."
        ),
        "quick_start": [
            "Ve a 'Servicios' y agrega tu catálogo: nombre, descripción, categoría, rango de precio y tiempo estimado.",
            "Configura en 'Configuración' el tipo de negocio, tagline y el tono que usará la IA para presentarte.",
            "Cuando un prospecto contacte por WhatsApp, la IA presenta tus servicios y lo registra automáticamente en 'Leads'.",
            "Convierte leads en propuestas formales desde la pestaña 'Propuestas' y da seguimiento visual.",
            "Revisa métricas de conversión, ingresos proyectados y actividad reciente en 'Estadísticas'."
        ],
        "sections": [
            {
                "id": "services",
                "title": "Catálogo de Servicios",
                "what": "Define y administra todos los servicios que ofrece tu empresa con precios, categorías y estado.",
                "how": [
                    "Haz clic en 'Nuevo Servicio' para agregar un servicio con nombre, descripción corta, categoría y rango de precio.",
                    "Puedes indicar un tiempo estimado de entrega en días para que la IA lo comunique con precisión.",
                    "Activa o desactiva servicios con el toggle — los desactivados no se muestran en el chat.",
                    "Edita cualquier servicio haciendo clic sobre su tarjeta.",
                    "Las categorías que definas (ej. 'Desarrollo Web', 'Consultoría', 'Diseño') organizan el catálogo en la IA."
                ],
                "tips": [
                    "Define rangos de precio reales: 'Desde $500' hasta '$5,000'. La IA los comunica con honestidad y sin inventar.",
                    "El campo descripción es clave: la IA lo usa para explicarle al prospecto qué incluye el servicio."
                ]
            },
            {
                "id": "leads",
                "title": "Leads / CRM de Prospectos",
                "what": "Pipeline visual de todos los prospectos e interesados en tus servicios.",
                "how": [
                    "Los leads se crean automáticamente cuando la IA detecta interés en el chat, o manualmente desde este panel.",
                    "Cada lead tiene estado: Nuevo → Contactado → Propuesta Enviada → Negociación → Cliente → Perdido.",
                    "Registra notas, fuente del contacto (WhatsApp, web, referido) y el servicio de interés.",
                    "Filtra por estado o busca por nombre/empresa para localizar prospectos rápido.",
                    "Haz clic en un lead para ver su historial completo y actualizar su estado."
                ],
                "tips": [
                    "Mueve los leads por el pipeline regularmente — la IA te da contexto de seguimientos pendientes en tiempo real.",
                    "El campo 'Notas' es privado: úsalo para recordatorios, contexto de llamadas o acuerdos informales."
                ]
            },
            {
                "id": "proposals",
                "title": "Propuestas Comerciales",
                "what": "Genera y da seguimiento a propuestas formales vinculadas a tus leads.",
                "how": [
                    "Desde un lead activo, haz clic en 'Nueva Propuesta' para crear una propuesta asociada.",
                    "Selecciona los servicios a incluir, ajusta precios, vigencia en días y agrega notas.",
                    "Estado de propuesta: Borrador → Enviada → Aceptada → Rechazada.",
                    "Cuando una propuesta es Aceptada, el lead pasa automáticamente a estado 'Cliente'.",
                    "Visualiza el valor total de propuestas abiertas vs. cerradas en Estadísticas."
                ],
                "tips": [
                    "Establece vigencia corta (7-14 días) para generar urgencia y acelerar decisiones.",
                    "Puedes tener múltiples propuestas por lead si el cliente evalúa diferentes alcances."
                ]
            },
            {
                "id": "stats",
                "title": "Estadísticas & Métricas",
                "what": "Dashboard de desempeño comercial: leads, conversiones e ingresos proyectados.",
                "how": [
                    "Revisa el embudo de conversión completo: total leads → propuestas → clientes cerrados.",
                    "Consulta ingresos proyectados por propuestas abiertas y confirmadas.",
                    "Identifica los servicios más solicitados para enfocar tu oferta comercial.",
                    "Las métricas se actualizan en tiempo real conforme la IA registra nuevos leads."
                ],
                "tips": [
                    "Un ratio de conversión lead→cliente por encima del 25% es excelente en servicios profesionales."
                ]
            },
            {
                "id": "config",
                "title": "Configuración del Módulo",
                "what": "Personaliza cómo la IA te representa ante clientes potenciales.",
                "how": [
                    "Selecciona tu tipo de negocio (Software, Agencia, Consultoría, etc.) para afinar el tono de la IA.",
                    "Define tu tagline o propuesta de valor — la IA la usa al presentar la empresa.",
                    "Escribe un 'Pitch de IA': instrucción específica de cómo quieres que la IA venda tus servicios.",
                    "Elige el estilo de respuesta: Profesional, Cercano o Técnico.",
                    "Los cambios se aplican en tiempo real sin reiniciar el sistema."
                ],
                "tips": [
                    "Un buen pitch de IA incluye: qué problema resuelves, para quién, y qué te diferencia de la competencia.",
                    "El estilo 'Cercano' funciona mejor para startups y agencias creativas; 'Profesional' para consultoría y legal."
                ]
            }
        ],
        "faq": [
            {
                "q": "¿Funciona sin instalar otros módulos?",
                "a": "Sí, 100% independiente. No requiere Restaurante, Inventario, Facturación ni ningún otro módulo."
            },
            {
                "q": "¿La IA puede agendar reuniones o demos automáticamente?",
                "a": "La IA captura el interés y los datos del prospecto en 'Leads'. La integración de agenda requiere configurar un enlace de Calendly u otra herramienta en tu configuración de conocimiento."
            },
            {
                "q": "¿Puedo usarlo para mi agencia, despacho o consultora? ¿No solo para software?",
                "a": "Absolutamente. El módulo es generalizado para cualquier empresa orientada a servicios: software, marketing, diseño, legal, contabilidad, etc."
            },
            {
                "q": "¿Qué pasa con los leads cuando desinstalo el módulo?",
                "a": "Los datos permanecen en la base de datos y se restauran al reinstalar. La desinstalación solo desactiva la interfaz."
            }
        ]
    }
}

