# Plan para hacer Zenith Code rentable en El Salvador

Oct 28, 2026 · @pamela

## 1. Riesgo crítico: Baileys

Baileys no es una API oficial: usa WhatsApp Web de forma no autorizada, lo que va contra los términos de WhatsApp. Si un negocio depende de su número y lo banean, se le paran las ventas y el culpable serás tú. Hay que resolverlo antes de vender.

- **Clientes serios:** ofrece la API oficial de Meta (Cloud API) como plan premium. Las conversaciones iniciadas por el cliente son gratuitas dentro de la ventana de 24 h; solo se paga por plantillas que envía el negocio. Es vendible y estable.
- **Clientes pequeños:** deja Baileys como opción económica, con aviso claro del riesgo, un número dedicado (no el personal del dueño) y límites de envío que simulen comportamiento humano.
- **Cambia el mensaje de venta:** "100% gratis" no es cierto, porque Gemini/OpenAI cobran por uso y el servidor cuesta. Vende "sin comisión por mensaje y con precio fijo mensual", que es más honesto y sigue siendo atractivo.

## 2. Producto y modelo de negocio

**No vendas "un chatbot", vende resultados.** Al dueño de un negocio salvadoreño le importan más las citas agendadas, los pedidos cerrados y los cobros recibidos que la tecnología.

Elige 2 o 3 verticales y empaquétalas. Las que más se mueven por WhatsApp en El Salvador:

| Vertical | Qué resuelve el bot |
| --- | --- |
| Restaurantes y delivery | Menú, pedidos, zona de entrega, estado del pedido |
| Clínicas, dentistas y estéticas | Agendar, recordar y confirmar citas (reduce ausencias) |
| Inmobiliarias y concesionarias | Calificar leads, enviar fichas y agendar visitas |
| Tiendas de ropa, belleza y tecnología (vendedores de Instagram/Facebook) | Catálogo, precios, existencias, envío |
| Gimnasios, academias y colegios | Inscripciones, cobros, recordatorios |

## 3. Funciones que hoy no tienes y que cambian el valor

- **Agendamiento** con Google Calendar o Cal.com, más recordatorios automáticos.
- **Pedidos y carrito conversacional**, con resumen para el negocio.
- **Cobros:** enlaces de pago con Wompi (Banco Agrícola), tarjeta, transferencia con envío de comprobante y, como diferenciador local, Bitcoin/Lightning para quien lo quiera.
- **Notas de voz:** transcribirlas (Whisper o Gemini). En El Salvador se usan muchísimo y es una ventaja grande.
- **Imágenes:** que lea comprobantes de transferencia y fotos de productos.
- **Seguimiento automático:** reactivar leads fríos, pedir reseñas y fomentar la recompra.
- **Tono local:** configurar el bot para hablar en "vos" y con expresiones salvadoreñas naturales, sin exagerar.
- **Facturación electrónica (DTE):** conectar con el sistema del Ministerio de Hacienda o con facturadores existentes es una necesidad real y un buen gancho, aunque requiere cuidado técnico y normativo. Verifícalo con un contador.
- **CRM ligero:** pipeline de leads, etiquetas, métricas y un reporte semanal por WhatsApp al dueño ("esta semana atendimos 120 chats, 18 citas, 9 ventas").

## 4. Mejoras técnicas para poder escalar

Sin multi-tenant no hay negocio recurrente: hoy el sistema parece diseñado para una sola empresa.

- **Multi-tenant:** varios clientes en una misma instalación, cada uno con su número, conocimiento y marca.
- **Autenticación y roles**, y facturación de tus propios clientes.
- **Tabla de uso por cliente** para controlar costos de IA y cobrar por plan.
- **Tests** de las conversaciones críticas y **monitoreo** (Sentry, uptime): un bot caído a las 8 pm un sábado es un cliente perdido.
- **Backups automáticos** de Postgres y de la sesión de WhatsApp.
- **Guardrails:** no inventar precios, no prometer lo que no está en la base de conocimiento y escalar a humano ante dudas.

## 5. Precios (referencia, ajustar con pruebas)

El Salvador está dolarizado, así que se cobra en USD. Estimación orientativa:

| Plan | Para quién | Precio sugerido (USD) |
| --- | --- | --- |
| Básico | Emprendedor, 1 número, conocimiento y FAQ | $39-59/mes |
| Profesional | PYME con agenda o pedidos y CRM | $99-149/mes |
| Premium | API oficial, DTE, integraciones, varios agentes | $249+/mes |
| Instalación | Configuración y carga de contenido | $100-300 único |

El costo de IA por cliente con Gemini Flash suele ser de unos pocos dólares al mes con tráfico moderado, así que el margen es alto si controlas el uso. Con 30 clientes a un promedio de $90/mes, serían unos $2,700/mes recurrentes. Son números ilustrativos: mide tu costo real por conversación antes de fijar precios.

## 6. Salida al mercado

1. **Piloto gratis o muy barato** con 3-5 negocios de una sola vertical (por ejemplo, clínicas dentales). Mide citas agendadas y horas ahorradas, y conviértelo en casos de éxito.
2. **Demo en vivo por WhatsApp:** que el prospecto escriba a tu propio bot y lo pruebe en 2 minutos. Vende mucho más que una presentación.
3. **Canales:** Instagram y TikTok con casos reales, grupos de emprendedores, cámaras de comercio y alianzas con agencias de marketing, contadores y diseñadores web que revendan tu servicio.
4. **Cobro:** mensualidad con tarjeta (Wompi) o transferencia, con contrato simple.
5. **Retención:** el reporte semanal de resultados hace que el cliente vea el valor y no cancele.

## 7. Orden de prioridades

1. Multi-tenant + autenticación + panel de uso y facturación.
2. Primera vertical empaquetada (agenda o pedidos, según la que elijas).
3. Notas de voz + cobros con Wompi.
4. Opción de API oficial de Meta para clientes premium.
5. Reportes semanales, CRM y DTE.
6. Alianzas y reventa.

**Pregunta abierta:** ¿a qué vertical apuntar primero? De esa decisión depende la arquitectura multi-tenant concreta y el plan de implementación por fases.
