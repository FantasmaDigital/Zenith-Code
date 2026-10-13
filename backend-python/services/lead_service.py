from typing import Dict, List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

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
        # Almacenamiento en memoria para sesiones activas (puede reemplazarse por Redis o Base de Datos)
        self._sessions: Dict[str, SessionState] = {}

    def get_or_create_session(self, session_id: str) -> SessionState:
        if session_id not in self._sessions:
            self._sessions[session_id] = SessionState(session_id=session_id)
        return self._sessions[session_id]

    def add_message(self, session_id: str, role: str, content: str):
        session = self.get_or_create_session(session_id)
        session.messages.append({"role": role, "content": content})
        session.updated_at = utc_now()

    def set_transferred(self, session_id: str, value: bool = True):
        session = self.get_or_create_session(session_id)
        session.transferred_to_human = value
        session.updated_at = utc_now()

    def is_transferred(self, session_id: str) -> bool:
        session = self.get_or_create_session(session_id)
        return session.transferred_to_human

    def get_all_sessions(self) -> Dict[str, SessionState]:
        return self._sessions

    def reset_session(self, session_id: str):
        if session_id in self._sessions:
            del self._sessions[session_id]

lead_service = LeadService()
