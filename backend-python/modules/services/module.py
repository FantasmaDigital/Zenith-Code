"""Clase principal del módulo Servicios Profesionales."""
import json
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter

from modules.base import ZenithModule
from modules.services.manifest import MANIFEST
from modules.services.router import router as services_router
from modules.services.service import prof_services_service
from services.agent_tools import Tool, ToolContext

logger = logging.getLogger("asistente_operativo.modules.services")

RESPONSE_STYLE_INSTRUCTIONS = {
    "profesional": (
        "Mantén un tono profesional, claro, corporativo y orientado a resultados. "
        "Usa vocabulario formal pero accesible. Sé directo, transparente y enfocado en el valor de negocio."
    ),
    "cercano": (
        "Sé amigable, cercano y conversacional. Usa el tuteo con respeto y calidez. "
        "Genera empatía y confianza mostrando entusiasmo genuino por el proyecto del cliente."
    ),
    "consultivo": (
        "Actúa como un Consultor Estratégico Senior. Primero comprende el problema de negocio "
        "antes de hablar de soluciones técnicas. Haz preguntas inteligentes y sugiere la mejor arquitectura."
    ),
    "tecnico": (
        "Usa terminología técnica con precisión (arquitectura, APIs, stack, DevOps, base de datos). "
        "El cliente es un perfil técnico o una empresa que busca ingeniería de software rigurosa."
    ),
}


def _tool_guardar_lead(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """Guarda o actualiza un prospecto comercial con toda su conversación histórica."""
    try:
        from modules.services.service import prof_services_service
        lead = prof_services_service.capture_lead_from_chat(ctx.session_id, args)
        return {
            "ok": True,
            "lead_id": lead.get("id"),
            "nombre": lead.get("name"),
            "mensaje": f"Lead #{lead.get('id')} ({lead.get('name')}) registrado en el CRM con su conversación completa."
        }
    except Exception as e:
        logger.error(f"Error en herramienta guardar_lead: {e}")
        return {"ok": False, "error": str(e)}

def _tool_registrar_reunion(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """Registra en el CRM una reunión que el cliente confirmó."""
    try:
        lead = prof_services_service.register_meeting(ctx.session_id, args)
        try:
            from services.customer_service import customer_service
            customer_service.remember(ctx.session_id, tag="reunion")
        except Exception:
            pass
        return {"ok": True, "lead_id": lead.get("id"), "reunion": lead.get("meeting_at"),
                "mensaje": "Reunión registrada en el CRM. Confírmasela al cliente con la fecha/hora."}
    except Exception as e:
        logger.error(f"Error en herramienta registrar_reunion: {e}")
        return {"ok": False, "error": str(e)}


def _tool_consultar_servicios(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """Consulta en tiempo real el catálogo de servicios, precios y tiempos."""
    try:
        from modules.services.service import prof_services_service
        cat_filter = str(args.get("categoria") or "").strip().lower()
        items = prof_services_service.list_services(only_active=True)
        if cat_filter:
            items = [i for i in items if cat_filter in (i.get("category") or "").lower()]
        summary = []
        for s in items[:8]:
            p = f"${s['price_min']:,.0f} - ${s['price_max']:,.0f}" if s.get("price_min") and s.get("price_max") else "A medida"
            d = f" (~{s['duration_days']} días)" if s.get("duration_days") else ""
            summary.append(f"• {s['name']} ({s.get('category')}): {p}{d}")
        return {"ok": True, "total": len(items), "servicios": "\n".join(summary)}
    except Exception as e:
        logger.error(f"Error en herramienta consultar_servicios: {e}")
        return {"ok": False, "error": str(e)}


class ServicesModule(ZenithModule):
    """Módulo de Servicios Profesionales: CRM, catálogo, propuestas y AI ventas."""

    @property
    def manifest(self) -> Dict[str, Any]:
        return MANIFEST

    def get_router(self) -> APIRouter:
        return services_router

    def on_install(self, db_service) -> None:
        logger.info("🚀 Instalando módulo Servicios Profesionales...")
        prof_services_service.init_tables(db_service)
        logger.info("✅ Módulo Servicios Profesionales instalado correctamente.")

    def on_load(self, db_service) -> None:
        prof_services_service.init_tables(db_service)

    def on_uninstall(self, db_service) -> None:
        logger.info("🗑️ Módulo Servicios Profesionales desinstalado. Los datos se conservan.")

    # -----------------------------------------------------------------------
    # Integración con el sistema de IA
    # -----------------------------------------------------------------------

    def get_prompt_extension(self) -> str:
        """Extiende el prompt del sistema con el perfil de la empresa y catálogo de servicios."""
        try:
            cfg = prof_services_service.get_effective_config()
            services_text = prof_services_service.get_services_text()

            business_name = cfg.get("business_name", "")
            tagline = cfg.get("tagline", "")
            ai_pitch = cfg.get("ai_pitch", "")
            style = cfg.get("response_style", "profesional")
            show_prices = cfg.get("show_prices", True)
            contact_cta = cfg.get("contact_cta", "¿Te gustaría agendar una consulta sin costo para evaluar tu proyecto?")
            meeting_link = cfg.get("meeting_link", "")
            portfolio_url = cfg.get("portfolio_url", "")
            website = cfg.get("website", "")
            special_instructions = cfg.get("special_instructions", "")
            min_budget = cfg.get("min_project_budget")
            payment_terms = cfg.get("payment_terms", "")
            warranty_days = cfg.get("warranty_days")

            style_instruction = RESPONSE_STYLE_INSTRUCTIONS.get(style, RESPONSE_STYLE_INSTRUCTIONS["profesional"])

            lines = [
                "\n[EMPRESA - SERVICIOS PROFESIONALES & SOFTWARE]",
            ]
            if business_name:
                lines.append(f"Empresa: {business_name}")
            if tagline:
                lines.append(f"Propuesta de valor: {tagline}")
            if website:
                lines.append(f"Sitio web oficial: {website}")
            if portfolio_url:
                lines.append(f"Portafolio / Demos: {portfolio_url}")
            if ai_pitch:
                lines.append(f"\nDescripción y diferenciadores:\n{ai_pitch}")

            lines.append(f"\nEstilo de comunicación: {style_instruction}")

            lines.append(f"\n{services_text}")

            if not show_prices:
                lines.append(
                    "\nNOTA DE PRECIOS: No menciones precios específicos en el chat. "
                    "Explica con cortesía que cada solución se cotiza a medida según el alcance y requerimientos."
                )
            elif min_budget:
                lines.append(
                    f"\nPRESUPUESTO MÍNIMO: El rango base para proyectos nuevos inicia en ${min_budget:,.0f} USD. "
                    "Si el prospecto tiene un presupuesto menor, oriéntalo con amabilidad a soluciones escalables."
                )

            if payment_terms:
                lines.append(f"\nCondiciones de pago oficiales: {payment_terms}")
            if warranty_days:
                lines.append(f"Garantía y soporte post-entrega: {warranty_days} días de garantía incluidos.")

            if meeting_link:
                lines.append(
                    f"\n[AGENDAMIENTO DE REUNIONES O DEMOS]\n"
                    f"Si el cliente desea una videollamada, reunión técnica o demo en vivo, comparte el enlace oficial: {meeting_link}\n"
                    "Tú NO puedes reservar en ese enlace: nunca digas que la reunión «quedó agendada» solo por enviarlo. "
                    "Pide al cliente que te avise cuando reserve (o qué día y hora eligió) y entonces usa 'registrar_reunion'."
                )
            lines.append(
                "\n[REUNIONES]\nCuando el cliente confirme una reunión (fecha/hora acordada o reserva hecha), usa "
                "'registrar_reunion' antes de confirmárselo."
            )

            # Reglas de calificación y captura de leads
            qual_rules = []
            if cfg.get("ask_requirements", True):
                qual_rules.append("1) si ya cuentan con requerimientos definidos o diseño")
            if cfg.get("ask_timeline", True):
                qual_rules.append("2) la fecha estimada en la que desean lanzar o implementar")
            if cfg.get("ask_budget", True):
                qual_rules.append("3) el presupuesto aproximado disponible")

            qual_text = ", ".join(qual_rules) if qual_rules else "sus requerimientos principales"

            lines.append(
                f"\n[CAPTURA Y CALIFICACIÓN DE LEADS - ARM]\n"
                f"- Cuando el cliente exprese interés, indaga de forma consultiva y natural: {qual_text}.\n"
                f"- Usa la herramienta 'guardar_lead' para registrar su nombre, empresa, teléfono y área de interés.\n"
                f"- CTA oficial para cerrar la conversación con contacto: \"{contact_cta}\"\n"
                f"- NUNCA inventes servicios que no estén en el catálogo anterior."
            )

            if special_instructions:
                lines.append(f"\n[POLÍTICAS E INSTRUCCIONES ESPECIALES]\n{special_instructions}")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"get_prompt_extension error: {e}")
            return ""

    def get_welcome_override(self) -> str:
        """Si servicios tiene un saludo especializado, lo usa. Si está vacío, hereda del perfil."""
        try:
            cfg = prof_services_service.get_config()
            return (cfg.get("ai_greeting") or "").strip()
        except Exception as e:
            logger.warning(f"Error obteniendo saludo de servicios: {e}")
            return ""

    def get_live_context(self) -> str:
        """Contexto en tiempo real: leads nuevos y estado del pipeline."""
        try:
            stats = prof_services_service.get_stats()
            if not stats:
                return ""

            leads_nuevos = stats.get("leads_by_status", {}).get("nuevo", 0)
            pipeline_value = stats.get("pipeline_value", 0)
            clients_total = stats.get("clients_total", 0)

            lines = ["\n[CONTEXTO EN TIEMPO REAL - SERVICIOS]"]
            if leads_nuevos > 0:
                lines.append(f"⚠️ Leads nuevos sin contactar: {leads_nuevos}")
            lines.append(f"💼 Clientes activos: {clients_total}")
            if pipeline_value > 0:
                lines.append(f"📊 Pipeline de propuestas abiertas: ${pipeline_value:,.2f}")

            return "\n".join(lines)
        except Exception as e:
            logger.error(f"get_live_context error: {e}")
            return ""

    def get_tools(self) -> List[Tool]:
        """Herramientas que la IA puede invocar de forma nativa para capturar leads y consultar servicios."""
        return [
            Tool(
                name="guardar_lead",
                description=(
                    "Registra o actualiza en el CRM un prospecto (lead) interesado en los servicios de desarrollo o software. "
                    "ÚSALA DE FORMA AUTOMÁTICA en cuanto el cliente mencione su nombre, empresa, necesidad técnica, presupuesto, "
                    "plazos o datos de contacto. El sistema guardará el lead vinculado a la conversación completa."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "nombre": {"type": "string", "description": "Nombre de la persona o contacto"},
                        "empresa": {"type": "string", "description": "Empresa u organización (opcional)"},
                        "telefono": {"type": "string", "description": "Teléfono o WhatsApp (opcional)"},
                        "email": {"type": "string", "description": "Correo electrónico (opcional)"},
                        "servicio_interes": {"type": "string", "description": "Servicio de interés del catálogo (ej. Desarrollo Web, App Móvil, IA)"},
                        "presupuesto": {"type": "string", "description": "Presupuesto aproximado mencionado (opcional)"},
                        "plazo": {"type": "string", "description": "Plazo o fecha estimada de entrega (opcional)"},
                        "notas": {"type": "string", "description": "Resumen técnico de requerimientos, preguntas o alcance"},
                    },
                    "required": ["nombre"],
                },
                handler=_tool_guardar_lead,
            ),
            Tool(
                name="registrar_reunion",
                description=(
                    "Registra en el CRM una reunión, llamada o demo con el prospecto. Úsala cuando el cliente CONFIRME "
                    "una fecha/hora, o diga que ya reservó en el enlace de agenda. También guarda sus datos como lead."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "nombre": {"type": "string", "description": "Nombre del contacto"},
                        "fecha_hora": {"type": "string", "description": "Fecha y hora acordada tal como la dijo el cliente (vacío si reservó por enlace y no la dijo)"},
                        "servicio_interes": {"type": "string", "description": "Tema o servicio de la reunión"},
                        "empresa": {"type": "string", "description": "Empresa (opcional)"},
                        "notas": {"type": "string", "description": "Contexto útil para quien atenderá la reunión"},
                    },
                    "required": ["nombre"],
                },
                handler=_tool_registrar_reunion,
            ),
            Tool(
                name="consultar_servicios",
                description="Consulta los servicios disponibles del catálogo oficial, sus rangos de precios y tiempos de entrega.",
                parameters={
                    "type": "object",
                    "properties": {
                        "categoria": {"type": "string", "description": "Categoría a filtrar (opcional)"}
                    },
                },
                handler=_tool_consultar_servicios,
            ),
        ]

    def process_reply(
        self,
        session_id: str,
        user_message: str,
        ai_reply: str,
        tool_calls: Optional[List] = None,
    ) -> str:
        """Procesa llamadas a herramientas (guardar_lead, consultar_servicios)."""
        try:
            if not tool_calls:
                return ai_reply

            for call in tool_calls:
                fn_name = call.get("name", "")
                args = call.get("args", {}) or call.get("arguments", {})

                if fn_name == "guardar_lead":
                    lead_data = {
                        "name": args.get("nombre", "Prospecto"),
                        "company": args.get("empresa", ""),
                        "phone": args.get("telefono", ""),
                        "email": args.get("email", ""),
                        "service_interest": args.get("servicio_interes", ""),
                        "notes": args.get("notas", ""),
                        "source": "whatsapp",
                        "status": "nuevo",
                    }
                    lead = prof_services_service.add_lead(lead_data)
                    logger.info(f"✅ Lead guardado automáticamente: {lead.get('name')} (id={lead.get('id')})")

                elif fn_name == "consultar_servicios":
                    cat_filter = args.get("categoria", "")
                    services = prof_services_service.list_services(only_active=True)
                    if cat_filter:
                        services = [s for s in services if cat_filter.lower() in (s.get("category") or "").lower()]
                    logger.info(f"consultar_servicios ejecutado: {len(services)} servicios devueltos")

        except Exception as e:
            logger.error(f"process_reply error: {e}")

        return ai_reply
