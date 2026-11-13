import React, { useEffect, useState } from 'react';
import { ArrowLeft, Cookie, ShieldCheck, X } from 'lucide-react';

// Datos del responsable, configurables en el build (nada personal fijo en el código)
const LEGAL = {
  company: import.meta.env.VITE_LEGAL_NAME || 'Fantasma Digital',
  product: 'Zenith',
  email: import.meta.env.VITE_PRIVACY_EMAIL || import.meta.env.VITE_SALES_EMAIL || '',
  country: 'El Salvador',
  updated: '12 de noviembre de 2026',
};

export const LEGAL_ROUTES = { privacidad: 'privacy', cookies: 'cookies' };
export const getLegalPage = () => {
  const first = (window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  return LEGAL_ROUTES[first] || null;
};

const contact = LEGAL.email
  ? <a className="text-zinc-100 underline" href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
  : 'los canales de contacto publicados en nuestro sitio';

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      <div className="space-y-2 text-[14px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

function List({ items }) {
  return <ul className="list-disc pl-5 space-y-1">{items.map(i => <li key={i}>{i}</li>)}</ul>;
}

function PrivacyContent() {
  return (
    <>
      <Section title="1. Quién es el responsable">
        <p>{LEGAL.company} opera {LEGAL.product}, una plataforma que permite a negocios atender a sus clientes por WhatsApp con un asistente de inteligencia artificial y administrar su operación desde un panel. Para cualquier consulta sobre privacidad escríbenos a {contact}.</p>
        <p>Cuando un negocio usa {LEGAL.product} para atender a sus propios clientes, ese negocio decide qué datos trata y para qué; {LEGAL.company} los trata por cuenta del negocio y siguiendo sus instrucciones.</p>
      </Section>
      <Section title="2. Qué datos tratamos">
        <p><b className="text-zinc-100">Usuarios del panel</b> (dueños y equipo de cada negocio):</p>
        <List items={[
          'Nombre, correo electrónico y/o número de WhatsApp, rol y empresa a la que pertenecen.',
          'Contraseña, que se guarda únicamente cifrada con un algoritmo de un solo sentido (nunca en texto legible).',
          'Registros técnicos de acceso: fecha del último inicio de sesión, dirección IP e intentos fallidos, para proteger la cuenta.',
        ]} />
        <p><b className="text-zinc-100">Clientes de los negocios</b> que escriben por WhatsApp o por el chat web:</p>
        <List items={[
          'Número de teléfono, nombre y foto de perfil de WhatsApp (si su configuración de privacidad lo permite).',
          'Mensajes, notas de voz e imágenes que envían, y las respuestas del asistente o del equipo.',
          'Datos que el propio cliente comparte en la conversación (pedidos, direcciones, citas, preferencias) y una ficha con un resumen generado a partir de la conversación.',
        ]} />
        <p><b className="text-zinc-100">Visitantes de este sitio</b>: no usamos herramientas de analítica ni publicidad. Solo se guarda en tu navegador lo indispensable para que el sitio funcione (ver la Política de cookies).</p>
      </Section>
      <Section title="3. Para qué los usamos">
        <List items={[
          'Prestar el servicio: responder a los clientes, registrar pedidos, citas, prospectos y la ficha de cada cliente.',
          'Permitir el acceso seguro al panel y que cada empresa vea solo su propia información.',
          'Mantener la seguridad: detectar accesos indebidos, bloquear intentos repetidos y resolver incidentes.',
          'Atender solicitudes de soporte y cumplir obligaciones legales.',
        ]} />
        <p>No vendemos datos personales ni los usamos para publicidad. Tampoco usamos las conversaciones de un negocio para atender a otro.</p>
      </Section>
      <Section title="4. Base para tratarlos">
        <p>Tratamos los datos para cumplir el contrato con cada negocio, con el consentimiento de las personas cuando corresponde, por interés legítimo en mantener la seguridad del servicio, y cuando la ley nos lo exige.</p>
      </Section>
      <Section title="5. Con quién se comparten">
        <p>Solo con proveedores necesarios para prestar el servicio, que tratan los datos por nuestra cuenta:</p>
        <List items={[
          'Proveedores de inteligencia artificial (Google Gemini y, si el negocio lo configura, OpenAI) para generar respuestas, transcribir notas de voz y resumir conversaciones.',
          'WhatsApp (Meta) como canal de mensajería.',
          'Proveedores de alojamiento y base de datos donde corre la plataforma.',
          'Hacienda u otros organismos, cuando el negocio emite facturación electrónica o la ley lo exige.',
        ]} />
        <p>Algunos de estos proveedores procesan datos fuera de {LEGAL.country}. Elegimos proveedores con medidas de seguridad reconocidas.</p>
      </Section>
      <Section title="6. Cuánto tiempo los guardamos">
        <p>Mientras el negocio mantenga activa su cuenta. Si una empresa se da de baja, sus datos se apartan y se eliminan en un plazo razonable, salvo lo que la ley obligue a conservar (por ejemplo, documentos tributarios). Cada negocio puede pedir antes la eliminación de conversaciones o fichas concretas.</p>
      </Section>
      <Section title="7. Cómo los protegemos">
        <List items={[
          'Conexiones cifradas (HTTPS) y cabeceras de seguridad que impiden incrustar el panel en otros sitios.',
          'Contraseñas cifradas, sesiones que vencen a las 12 horas y bloqueo temporal tras varios intentos fallidos.',
          'Separación de datos por empresa y permisos por rol dentro de cada equipo.',
          'Claves de servicios externos guardadas en el servidor y nunca mostradas completas en el panel.',
        ]} />
      </Section>
      <Section title="8. Tus derechos">
        <p>Puedes pedir acceso a tus datos, su corrección, su eliminación, oponerte a su uso o solicitar una copia, conforme a la legislación de {LEGAL.country}. Si eres cliente de un negocio que usa {LEGAL.product}, puedes dirigirte a ese negocio o escribirnos a {contact} y lo canalizaremos. En WhatsApp puedes escribir «no quiero recibir mensajes» para que el asistente no te contacte por iniciativa propia.</p>
      </Section>
      <Section title="9. Menores de edad">
        <p>El panel está dirigido a negocios y no a menores de edad. Si crees que un menor nos dio datos sin autorización, escríbenos para eliminarlos.</p>
      </Section>
      <Section title="10. Cambios">
        <p>Si cambiamos esta política publicaremos la nueva versión en esta página con su fecha de actualización.</p>
      </Section>
    </>
  );
}

function CookiesContent() {
  return (
    <>
      <Section title="Resumen">
        <p>{LEGAL.product} <b className="text-zinc-100">no usa cookies de publicidad ni de analítica</b>, y no te rastrea entre sitios. Solo guarda en tu navegador lo indispensable para que el sitio funcione.</p>
      </Section>
      <Section title="Qué guardamos en tu navegador">
        <p>En lugar de cookies usamos el almacenamiento local del navegador (localStorage), con estos fines estrictamente necesarios:</p>
        <List items={[
          'Sesión: el token que te mantiene dentro del panel; vence a las 12 horas o al cerrar sesión.',
          'Empresa y usuario usados por última vez, para no escribirlos cada vez.',
          'Apariencia: logo, nombre y color de la empresa, para mostrar la pantalla de acceso al instante.',
          'Preferencias de la interfaz y el aviso de cookies que ya cerraste.',
        ]} />
        <p>Nada de esto se comparte con terceros ni se usa para perfilarte. Puedes borrarlo en cualquier momento desde la configuración de tu navegador; si lo haces, tendrás que volver a iniciar sesión.</p>
      </Section>
      <Section title="Servicios de terceros">
        <p>Para mostrar la tipografía, el navegador descarga fuentes desde Google Fonts, lo que permite a Google ver tu dirección IP. Google Fonts no instala cookies. Los enlaces a WhatsApp o al correo solo se abren si tú los pulsas.</p>
      </Section>
      <Section title="Contacto">
        <p>Si tienes preguntas escríbenos a {contact}.</p>
      </Section>
    </>
  );
}

export function LegalPage({ page }) {
  const isPrivacy = page === 'privacy';
  const title = isPrivacy ? 'Política de privacidad' : 'Política de cookies';
  useEffect(() => { document.title = `${title} · ${LEGAL.product}`; window.scrollTo(0, 0); }, [title]);
  const back = () => (window.history.length > 1 ? window.history.back() : window.location.assign('/'));

  return (
    <div className="min-h-screen bg-[#121212] text-zinc-100 font-sans">
      <header className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
          <ArrowLeft size={16} /> Volver
        </button>
        <a href="/" className="text-sm font-semibold">{LEGAL.product}</a>
      </header>
      <main className="max-w-3xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          {isPrivacy ? <ShieldCheck size={16} /> : <Cookie size={16} />} {LEGAL.company}
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">Última actualización: {LEGAL.updated}</p>
        <div className="mt-8 space-y-8">{isPrivacy ? <PrivacyContent /> : <CookiesContent />}</div>
        <nav className="mt-12 pt-6 border-t border-[#222] flex flex-wrap gap-4 text-sm text-zinc-400">
          <a href="/privacidad" className="hover:text-white">Política de privacidad</a>
          <a href="/cookies" className="hover:text-white">Política de cookies</a>
        </nav>
      </main>
    </div>
  );
}

export function LegalLinks({ className = '' }) {
  return (
    <nav className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-zinc-500 ${className}`}>
      <a href="/privacidad" className="hover:text-zinc-300">Privacidad</a>
      <a href="/cookies" className="hover:text-zinc-300">Cookies</a>
    </nav>
  );
}

const NOTICE_KEY = 'zenith_cookie_notice_v1';

// Aviso informativo: solo hay almacenamiento estrictamente necesario, así que no se pide aceptar nada
export function CookieNotice() {
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(NOTICE_KEY); } catch { return false; }
  });
  if (!open) return null;
  const close = () => {
    try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* sin almacenamiento */ }
    setOpen(false);
  };
  return (
    <div role="region" aria-label="Aviso de cookies"
      className="fixed inset-x-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm z-[100] bg-[#1c1c1c] border border-[#2e2e2e] rounded-lg shadow-2xl p-4 text-[13px] text-zinc-300">
      <div className="flex items-start gap-3">
        <Cookie size={18} className="shrink-0 mt-0.5 text-zinc-400" />
        <p className="flex-1">
          Solo usamos el almacenamiento del navegador imprescindible para que el sitio funcione. Sin publicidad ni rastreo.{' '}
          <a href="/cookies" className="text-zinc-100 underline">Más información</a>
        </p>
        <button onClick={close} aria-label="Cerrar aviso" className="text-zinc-500 hover:text-white"><X size={16} /></button>
      </div>
      <button onClick={close} className="mt-3 w-full h-9 rounded-md bg-[#2e2e2e] hover:bg-[#3a3a3a] text-zinc-100 font-medium">Entendido</button>
    </div>
  );
}
