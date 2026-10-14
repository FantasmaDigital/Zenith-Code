import logging
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field

logger = logging.getLogger("asistente_operativo.lead_service")

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class SessionState(BaseModel):
    session_id: str
    messages: List[Dict[str, str]] = Field(default_factory=list)
    project_type: Optional[str] = None
    urgency_or_date: Optional[str] = None
    contact_email: Optional[str] = None
    contact_name: Optional[str] = None
    transferred_to_human: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

class LeadService:
    def __init__(self):
        # Almacenamiento en memoria para sesiones activas (sincronizado con BD)
        self._sessions: Dict[str, SessionState] = {}

    def get_or_create_session(self, session_id: str) -> SessionState:
        if session_id not in self._sessions:
            self._sessions[session_id] = SessionState(session_id=session_id)
        return self._sessions[session_id]

    def add_message(self, session_id: str, role: str, content: str):
        session = self.get_or_create_session(session_id)
        session.messages.append({"role": role, "content": content})
        session.updated_at = utc_now()

    def set_transferred(
        self,
        session_id: str,
        value: bool = True,
        reason: str = "Derivado a agente humano",
        tag: Optional[str] = None,
        notes: Optional[str] = None
    ):
        """
        Marca la conversación como transferida a un agente humano (o liberada)
        y persiste el estado en la base de datos PostgreSQL / SQLite con tag y nota para el asesor.
        """
        session = self.get_or_create_session(session_id)
        session.transferred_to_human = value
        session.updated_at = utc_now()

        # Si se activa el handoff y no se proveyó tag o nota, analizar intención automáticamente
        final_tag = tag
        final_notes = notes
        if value and (not final_tag or not final_notes):
            try:
                from services.handoff_analyzer import analyze_handoff_intent
                auto_tag, auto_note = analyze_handoff_intent(session.messages, reason=reason)
                if not final_tag:
                    final_tag = auto_tag
                if not final_notes:
                    final_notes = auto_note
            except Exception as e:
                logger.warning(f"Error analizando intención para handoff en sesión {session_id}: {e}")
                if not final_tag:
                    final_tag = "ATENCIÓN HUMANA"
                if not final_notes:
                    final_notes = "Derivado a asesor para atención personalizada."

        try:
            from services.db_service import db_service
            from config import settings
            inactivity = float(getattr(settings, "HANDOFF_INACTIVITY_HOURS", 6.0))
            db_service.set_handoff(
                session_id=session_id,
                transferred=value,
                reason=reason,
                inactivity_hours=inactivity,
                tag=final_tag,
                notes=final_notes
            )
            logger.info(
                f"🔄 [Handoff] Sesión {session_id} -> transferred={value} "
                f"(Tag: {final_tag}, Inactividad: {inactivity}h, motivo: {reason})"
            )

            # Sincronizar etiqueta nativa en WhatsApp Business a través de Baileys Gateway
            if value and final_tag:
                try:
                    from services.whatsapp_service import whatsapp_service
                    whatsapp_service.add_chat_label(to_phone=session_id, tag=final_tag, note=final_notes)
                except Exception as gw_err:
                    logger.debug(f"Aviso sincronizando etiqueta con WhatsApp Business: {gw_err}")
        except Exception as e:
            logger.warning(f"Error persistiendo handoff en BD para {session_id}: {e}")

    def is_in_human_handoff(self, session_id: str, touch_activity: bool = False) -> Tuple[bool, float]:
        """
        Determina si una conversación está actualmente en manos de un agente humano.
        Regla: La IA NO debe responder hasta que pasen las horas de inactividad configuradas.
        Si transcurre el tiempo de inactividad sin nuevos mensajes, la transferencia se libera automáticamente.

        Retorna:
            (is_active: bool, remaining_hours: float)
        """
        from config import settings
        from services.db_service import db_service

        inactivity_limit_hours = float(getattr(settings, "HANDOFF_INACTIVITY_HOURS", 6.0))
        handoff_data = None
        try:
            handoff_data = db_service.get_handoff(session_id)
        except Exception:
            pass

        # Si no hay registro en BD, revisar sesión en memoria
        if not handoff_data:
            session = self._sessions.get(session_id)
            if not session or not session.transferred_to_human:
                return False, 0.0
            last_activity = session.updated_at
        else:
            if not handoff_data.get("transferred_to_human"):
                return False, 0.0
            last_activity = handoff_data.get("last_activity_at")
            if isinstance(last_activity, str):
                try:
                    last_activity = datetime.fromisoformat(last_activity.replace("Z", "+00:00"))
                except Exception:
                    last_activity = utc_now()

        # Calcular tiempo transcurrido desde la última actividad
        now = utc_now()
        if last_activity is None:
            last_activity = now
        elif last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)

        elapsed_seconds = max(0.0, (now - last_activity).total_seconds())
        elapsed_hours = elapsed_seconds / 3600.0
        remaining_hours = max(0.0, inactivity_limit_hours - elapsed_hours)

        # Si el tiempo transcurrido supera el límite de inactividad, liberar automáticamente
        if elapsed_hours >= inactivity_limit_hours:
            logger.info(
                f"⏰ [Handoff Expirado] Sesión {session_id} cumplió {elapsed_hours:.1f}h de inactividad "
                f"(Límite: {inactivity_limit_hours}h). Reanudando IA de forma autónoma."
            )
            self.set_transferred(session_id, False, reason="Inactividad expirada")
            return False, 0.0

        # Si sigue activa y se solicita touch_activity, refrescamos el timestamp para prolongar la ventana
        if touch_activity:
            try:
                db_service.touch_handoff(session_id)
                session = self.get_or_create_session(session_id)
                session.updated_at = now
            except Exception:
                pass

        return True, remaining_hours

    def release_handoff(self, session_id: str):
        """Libera de forma inmediata la derivación a humano para que la IA responda al instante."""
        self.set_transferred(session_id, False, reason="Liberado manualmente por operador")

    def pause_handoff(
        self,
        session_id: str,
        reason: str = "Pausado manualmente desde el portal",
        tag: Optional[str] = None,
        notes: Optional[str] = None
    ):
        """Pausa de forma manual la IA para una sesión específica, asignando opcionalmente tag y nota."""
        self.set_transferred(session_id, True, reason=reason, tag=tag, notes=notes)

    def update_handoff_meta(self, session_id: str, tag: Optional[str] = None, notes: Optional[str] = None) -> bool:
        """Actualiza la etiqueta o la nota ejecutiva del asesor sin alterar el estado de transferencia."""
        try:
            from services.db_service import db_service
            success = db_service.update_handoff_meta(session_id, tag=tag, notes=notes)
            if success and tag:
                try:
                    from services.whatsapp_service import whatsapp_service
                    whatsapp_service.add_chat_label(to_phone=session_id, tag=tag, note=notes)
                except Exception as gw_err:
                    logger.debug(f"Aviso actualizando etiqueta con WhatsApp Business: {gw_err}")
            return success
        except Exception as e:
            logger.warning(f"Error actualizando meta de handoff en lead_service para {session_id}: {e}")
            return False

    def release_all_handoffs(self) -> int:
        """Libera todas las derivaciones activas a humano en lote."""
        active = self.list_active_handoffs()
        count = 0
        for item in active:
            sid = item.get("session_id")
            if sid:
                self.release_handoff(sid)
                count += 1
        return count

    def is_transferred(self, session_id: str) -> bool:
        active, _ = self.is_in_human_handoff(session_id, touch_activity=False)
        return active

    def list_active_handoffs(self) -> List[Dict[str, Any]]:
        """Lista todas las conversaciones activas que están en manos de agentes humanos."""
        try:
            from services.db_service import db_service
            db_active = db_service.list_active_handoffs()
            enriched = []
            for item in db_active:
                sid = item.get("session_id")
                active, rem = self.is_in_human_handoff(sid, touch_activity=False)
                if active:
                    item["remaining_inactivity_hours"] = round(rem, 2)
                    enriched.append(item)
            return enriched
        except Exception as e:
            logger.warning(f"Error listando active handoffs: {e}")
            return []

    def get_all_sessions(self) -> Dict[str, SessionState]:
        return self._sessions

    def reset_session(self, session_id: str):
        if session_id in self._sessions:
            del self._sessions[session_id]
        try:
            from services.db_service import db_service
            db_service.set_handoff(session_id, False, reason="Sesión reiniciada")
        except Exception:
            pass

lead_service = LeadService()
