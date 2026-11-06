from pydantic import BaseModel, Field
from typing import Literal, Optional

class UpdateSettingsRequest(BaseModel):
    company_name: Optional[str] = Field(None, description="Nombre de la empresa o marca")
    bot_name: Optional[str] = Field(None, description="Nombre del asistente")
    bot_tone: Optional[str] = Field(None, description="Tono y estilo de comunicación")
    brand_instructions: Optional[str] = Field(None, description="Directrices especiales de la marca")
    ai_provider: Optional[str] = Field(None, description="Proveedor de IA: gemini u openai")
    gemini_api_key: Optional[str] = Field(None, description="API Key de Google Gemini")
    gemini_model: Optional[str] = Field(None, description="Modelo de Gemini")
    openai_api_key: Optional[str] = Field(None, description="API Key de OpenAI")
    openai_model: Optional[str] = Field(None, description="Modelo de OpenAI")
    whatsapp_gateway_url: Optional[str] = Field(None, description="URL del WhatsApp Gateway")
    company_logo: Optional[str] = Field(None, description="Logo de la empresa en base64 o URL")
    bot_avatar: Optional[str] = Field(None, description="Avatar del asistente en base64 o URL")
    primary_color: Optional[str] = Field(None, description="Color de acento de marca (Hex)")
    welcome_message: Optional[str] = Field(None, description="Mensaje de bienvenida inicial")
    transfer_message: Optional[str] = Field(None, description="Mensaje de derivación a humano")
    support_phone: Optional[str] = Field(None, description="Teléfono oficial de soporte/ventas")
    website_url: Optional[str] = Field(None, description="Sitio web oficial de la marca")
    handoff_inactivity_hours: Optional[float] = Field(None, description="Horas de inactividad para reanudar IA tras transferir a humano", ge=0.1, le=168.0)
    whatsapp_channel: Optional[Literal["baileys", "meta"]] = Field(None, description="Canal de WhatsApp activo")
    meta_access_token: Optional[str] = Field(None, description="Token de acceso permanente de Meta (usuario del sistema)")
    meta_phone_number_id: Optional[str] = Field(None, description="Phone Number ID de WhatsApp Business")
    meta_waba_id: Optional[str] = Field(None, description="WhatsApp Business Account ID")
    meta_verify_token: Optional[str] = Field(None, description="Token de verificación del webhook de Meta")
    meta_app_secret: Optional[str] = Field(None, description="App Secret para validar la firma del webhook")
    meta_api_version: Optional[str] = Field(None, description="Versión de Graph API (ej. v21.0)", pattern=r"^(v\d+\.\d+)?$")
    public_base_url: Optional[str] = Field(None, description="URL pública HTTPS del backend")

class PauseHandoffRequest(BaseModel):
    session_id: str = Field(..., description="ID de sesión o número de WhatsApp")
    reason: Optional[str] = Field(default="Pausado manualmente desde el portal", description="Motivo de la pausa")
    tag: Optional[str] = Field(default="ATENCIÓN HUMANA", description="Etiqueta de categorización directa")
    notes: Optional[str] = Field(default="", description="Nota ejecutiva para el asesor")

class UpdateHandoffMetaRequest(BaseModel):
    tag: Optional[str] = Field(None, description="Nueva etiqueta del chat")
    notes: Optional[str] = Field(None, description="Nueva nota para el asesor")
