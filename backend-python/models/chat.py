from pydantic import BaseModel, Field
from typing import Optional

class ChatRequest(BaseModel):
    session_id: str = Field(default="demo-user", description="ID del usuario o número de teléfono")
    message: Optional[str] = Field(default="", description="Mensaje de texto enviado por el usuario")
    audio_base64: Optional[str] = Field(default=None, description="Audio de nota de voz en base64")
    audio_mime_type: Optional[str] = Field(default="audio/ogg; codecs=opus", description="Tipo MIME del audio")
    image_base64: Optional[str] = Field(default=None, description="Imagen o captura de comprobante bancario en base64")
    image_mime_type: Optional[str] = Field(default="image/jpeg", description="Tipo MIME de la imagen")
    contact_name: Optional[str] = Field(default=None, max_length=120, description="Nombre de perfil del cliente en WhatsApp")
    contact_avatar: Optional[str] = Field(default=None, max_length=1000, description="URL de la foto de perfil de WhatsApp")

    @property
    def has_content(self) -> bool:
        has_text = bool(self.message and self.message.strip())
        has_audio = bool(self.audio_base64 and self.audio_base64.strip())
        has_image = bool(self.image_base64 and self.image_base64.strip())
        return has_text or has_audio or has_image

class ChatResponse(BaseModel):
    session_id: str = Field(..., description="ID de sesión o número de WhatsApp")
    reply: str = Field(..., description="Respuesta generada por el asistente")
    transferred_to_human: bool = Field(default=False, description="Indica si la conversación fue transferida a asesor")
    human_handoff_active: bool = Field(default=False, description="Indica si la IA se encuentra silenciada por agente humano")

class SendMessageRequest(BaseModel):
    to: str = Field(..., description="Número de teléfono de destino (ej. 50371234567)")
    message: str = Field(..., description="Texto del mensaje a enviar")
