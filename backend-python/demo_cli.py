"""
Script interactivo para probar el Asistente Operativo directamente en la consola.
Permite simular una conversación de WhatsApp sin necesidad de levantar el servidor.
"""
import sys
from services.ai_service import ai_service
from services.lead_service import lead_service
from config import settings

def main():
    print("=" * 60)
    print(f"  ASISTENTE OPERATIVO - {settings.COMPANY_NAME}")
    print(f"  Proveedor Activo: {ai_service.provider.upper()} ({ai_service.active_model})")
    print("  Simulador de Conversación en Consola")
    print("=" * 60)
    print("Escribe tus mensajes como si fueras un cliente en WhatsApp.")
    print("Comandos especiales:")
    print("  'salir'    - Terminar la sesión")
    print("  'reiniciar' - Limpiar la memoria de la conversación actual")
    print("=" * 60)

    session_id = "consola-demo-01"

    while True:
        try:
            user_input = input("\nCliente > ").strip()
            if not user_input:
                continue

            if user_input.lower() in ("salir", "exit", "quit"):
                print("\nFinalizando simulador. ¡Hasta pronto!")
                break

            if user_input.lower() in ("reiniciar", "reset"):
                lead_service.reset_session(session_id)
                print("\n[Sesión reiniciada con éxito]")
                continue

            # Generar respuesta con el proveedor activo (Gemini por defecto)
            reply = ai_service.generate_reply(session_id=session_id, user_message=user_input)
            is_transferred = lead_service.is_transferred(session_id)

            print(f"\nAsistente Operativo >\n{reply}")

            if is_transferred:
                print("\n[ALERTA: Se activó el protocolo de transferencia a asesor humano]")

        except (KeyboardInterrupt, EOFError):
            print("\nFinalizando...")
            break

if __name__ == "__main__":
    main()
