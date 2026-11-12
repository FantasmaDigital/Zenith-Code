"""Envío de correo por SMTP (invitaciones y avisos de la plataforma)."""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Optional

from config import settings

logger = logging.getLogger("asistente_operativo.email")


class EmailService:
    def is_configured(self) -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_FROM)

    def send(self, to: str, subject: str, text: str, html: Optional[str] = None) -> None:
        """Envía el correo o lanza una excepción con un mensaje entendible."""
        if not self.is_configured():
            raise RuntimeError("El correo no está configurado en el servidor (SMTP_HOST / SMTP_FROM).")
        msg = EmailMessage()
        name, addr = parseaddr(settings.SMTP_FROM)
        msg["From"] = formataddr((name or "Zenith", addr))
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(text)
        if html:
            msg.add_alternative(html, subtype="html")

        security = (settings.SMTP_SECURITY or "starttls").lower()
        port = int(settings.SMTP_PORT or (465 if security == "ssl" else 587))
        try:
            if security == "ssl":
                server = smtplib.SMTP_SSL(settings.SMTP_HOST, port, timeout=20, context=ssl.create_default_context())
            else:
                server = smtplib.SMTP(settings.SMTP_HOST, port, timeout=20)
            with server:
                if security == "starttls":
                    server.starttls(context=ssl.create_default_context())
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        except smtplib.SMTPAuthenticationError:
            raise RuntimeError("El servidor de correo rechazó el usuario o la contraseña SMTP.")
        except (smtplib.SMTPException, OSError) as e:
            raise RuntimeError(f"No se pudo enviar el correo: {e}")
        logger.info(f"✉️ Correo enviado: «{subject}».")


email_service = EmailService()
