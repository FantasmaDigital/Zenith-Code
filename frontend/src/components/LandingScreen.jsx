import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, CalendarCheck, Check, Loader2, Mail, MessageCircle, ShoppingBag, Users, X } from 'lucide-react';
import { LegalLinks } from './LegalPages';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Datos de contacto comercial (configurables en el build: VITE_SALES_WHATSAPP=50370000000, VITE_SALES_EMAIL=ventas@...)
const SALES_WHATSAPP = (import.meta.env.VITE_SALES_WHATSAPP || '').replace(/\D/g, '');
const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || '';

// Marca: Zenith es una app de Fantasma Digital (fondo casi negro, ámbar, Space Grotesk)
const ACCENT = '#FAB61E';
const ON_ACCENT = '#040406';
const BG = '#040406';
const HEADING = { fontFamily: "'Space Grotesk', Inter, system-ui, sans-serif" };

const waLink = (text) => `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(text)}`;
const contactHref = (text) => (SALES_WHATSAPP ? waLink(text) : SALES_EMAIL ? `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(text)}` : '#planes');

export function ZenithLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Zenith">
      <path d="M60 8a52 52 0 1 1-26.5 96.8L12 112l7.4-20.5A52 52 0 0 1 60 8z" fill="#FAB61E" />
      <path d="M38 36h46v10L54 74h31v10H36V74l30-28H38z" fill="#040406" />
    </svg>
  );
}

const FEATURES = [
  { icon: Bot, title: 'Asistente con IA 24/7', text: 'Responde en WhatsApp con la información de tu negocio, a cualquier hora.' },
  { icon: CalendarCheck, title: 'Citas y pedidos', text: 'Agenda, toma pedidos y registra prospectos sin que estés pendiente del teléfono.' },
  { icon: Users, title: 'Clientes y bandeja', text: 'Cada conversación queda en una ficha; tu equipo entra al chat cuando hace falta.' },
  { icon: ShoppingBag, title: 'Todo en un panel', text: 'Inventario, caja, fidelidad y facturación electrónica en el mismo lugar.' },
];

// Respaldo si la API no responde: los mismos planes del backend (sin botón de PayPal)
const FALLBACK = {
  enabled: false, client_id: '', trial_days: 14,
  plans: [
    { key: 'emprendedor', name: 'Emprendedor', monthly: 19, yearly: 190, items: ['1 número de WhatsApp', 'Asistente IA con tu información', 'Bandeja y clientes', '1,000 respuestas IA al mes', '2 usuarios'] },
    { key: 'negocio', name: 'Negocio', monthly: 39, yearly: 390, featured: true, items: ['Todo lo del Emprendedor', '1 módulo: pedidos, citas/CRM o fidelidad', 'Memoria de clientes y automatizaciones', '3,000 respuestas IA al mes', '5 usuarios'] },
    { key: 'pro', name: 'Pro', monthly: 79, yearly: 790, items: ['Todos los módulos: inventario, caja, DTE y fidelidad', 'API oficial de WhatsApp (opcional)', '8,000 respuestas IA al mes', '15 usuarios', 'Soporte prioritario'] },
  ],
};

const slugify = (text) => (text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

// Carga el SDK de PayPal una sola vez por client_id
let sdkPromise = null;
function loadPayPal(clientId) {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=USD`;
      s.onload = () => resolve(window.paypal);
      s.onerror = () => { sdkPromise = null; reject(new Error('No se pudo cargar PayPal.')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

const input = 'w-full h-10 bg-[#0e0e12] border border-[#2a2a30] rounded-md px-3 text-sm text-zinc-100 outline-none focus:border-[#FAB61E]';

function Checkout({ plan, cycle, config, onClose }) {
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [slugState, setSlugState] = useState({ checking: false, available: null, detail: '' });
  const [step, setStep] = useState('form'); // form | pay | activating | done | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const buttonsRef = useRef(null);
  const dataRef = useRef({});
  const price = cycle === 'yearly' ? plan.yearly : plan.monthly;
  const paypalPlanId = cycle === 'yearly' ? plan.paypal_plan_yearly : plan.paypal_plan_monthly;

  useEffect(() => { if (!slugTouched) setSlug(slugify(company)); }, [company, slugTouched]);

  // Comprobación del identificador antes de pagar
  useEffect(() => {
    if (!slug || slug.length < 2) { setSlugState({ checking: false, available: null, detail: '' }); return undefined; }
    setSlugState(s => ({ ...s, checking: true }));
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/public/billing/slug?slug=${encodeURIComponent(slug)}`)
        .then(r => r.json())
        .then(d => setSlugState({ checking: false, available: Boolean(d.available), detail: d.detail || '' }))
        .catch(() => setSlugState({ checking: false, available: null, detail: 'No se pudo comprobar.' }));
    }, 350);
    return () => clearTimeout(t);
  }, [slug]);

  const canPay = company.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && slugState.available === true;

  const toPay = (e) => {
    e.preventDefault();
    if (!canPay) return;
    dataRef.current = { company: company.trim(), slug, email: email.trim() };
    setStep('pay');
  };

  useEffect(() => {
    if (step !== 'pay' || !buttonsRef.current) return undefined;
    let cancelled = false;
    buttonsRef.current.innerHTML = '';
    loadPayPal(config.client_id).then(paypal => {
      if (cancelled || !paypal) return;
      paypal.Buttons({
        style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'subscribe' },
        createSubscription: (data, actions) => actions.subscription.create({ plan_id: paypalPlanId }),
        onApprove: async (data) => {
          setStep('activating');
          try {
            const res = await fetch(`${API_BASE}/api/public/billing/activate`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription_id: data.subscriptionID, ...dataRef.current })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudo activar tu cuenta.');
            setResult(body);
            setStep('done');
          } catch (err) {
            setError(`${err.message} Tu suscripción quedó registrada en PayPal; escríbenos y la activamos de inmediato.`);
            setStep('error');
          }
        },
        onError: () => { setError('PayPal no pudo completar la suscripción. Intenta de nuevo.'); setStep('error'); },
      }).render(buttonsRef.current);
    }).catch(err => { setError(err.message); setStep('error'); });
    return () => { cancelled = true; };
  }, [step, config.client_id, paypalPlanId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Suscripción al plan ${plan.name}`}>
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-[#0b0b0f] border border-[#2a2a30] rounded-t-xl sm:rounded-xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold" style={HEADING}>Plan {plan.name}</h3>
            <p className="text-sm text-zinc-400">${price} {cycle === 'yearly' ? 'al año' : 'al mes'} · {config.trial_days} días gratis</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-zinc-400 hover:text-white"><X size={18} /></button>
        </div>

        {step === 'form' && (
          <form onSubmit={toPay} className="mt-5 space-y-3" noValidate>
            <label className="block text-[13px] text-zinc-300">Nombre de tu negocio
              <input className={`${input} mt-1`} value={company} onChange={e => setCompany(e.target.value)} autoFocus maxLength={160} placeholder="Pupusería Ana" />
            </label>
            <label className="block text-[13px] text-zinc-300">Identificador (tu enlace de acceso)
              <input className={`${input} mt-1 font-mono`} value={slug} maxLength={40} autoCapitalize="none" spellCheck={false}
                onChange={e => { setSlugTouched(true); setSlug(slugify(e.target.value) || e.target.value.toLowerCase()); }} placeholder="pupuseria-ana" />
              <span className={`block mt-1 text-[12px] ${slugState.available === false ? 'text-rose-400' : 'text-zinc-500'}`}>
                {slugState.checking ? 'Comprobando…'
                  : slugState.available === true ? `Entrarás en ${window.location.host}/auth/${slug}`
                    : slugState.detail || 'Solo minúsculas, números y guiones.'}
              </span>
            </label>
            <label className="block text-[13px] text-zinc-300">Tu correo (para entrar y recibir avisos)
              <input type="email" className={`${input} mt-1`} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={160} placeholder="tu@correo.com" />
            </label>
            <button type="submit" disabled={!canPay} className="w-full h-11 rounded-md font-semibold disabled:opacity-40" style={{ backgroundColor: ACCENT, color: ON_ACCENT }}>
              Continuar al pago
            </button>
            <p className="text-[12px] text-zinc-500">No se cobra nada durante {config.trial_days} días. Cancelas cuando quieras desde el panel o desde PayPal.</p>
          </form>
        )}

        {step === 'pay' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-zinc-300">Suscríbete con PayPal o con tarjeta. El primer cobro será dentro de {config.trial_days} días.</p>
            <div ref={buttonsRef} className="min-h-[120px] bg-white rounded-md p-3" />
            <button onClick={() => setStep('form')} className="text-[13px] text-zinc-400 hover:text-white">Volver</button>
          </div>
        )}

        {step === 'activating' && (
          <p className="mt-6 flex items-center gap-2 text-sm text-zinc-300"><Loader2 size={16} className="animate-spin" /> Creando tu panel…</p>
        )}

        {step === 'done' && result && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-zinc-200">¡Listo! Tu panel está creado. Revisa tu correo ({dataRef.current.email}) para crear tu contraseña; puede tardar unos minutos y a veces llega a spam.</p>
            <a href={`/auth/${result.tenant_slug}`} className="w-full h-11 inline-flex items-center justify-center rounded-md font-semibold" style={{ backgroundColor: ACCENT, color: ON_ACCENT }}>
              Ir a mi acceso
            </a>
          </div>
        )}

        {step === 'error' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-rose-300">{error}</p>
            <a href={contactHref(`Hola, tuve un problema al suscribirme al plan ${plan.name} de Zenith`)} className="text-sm underline text-zinc-200">Escríbenos</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LandingScreen() {
  const [slug, setSlug] = useState(() => {
    try { return localStorage.getItem('zenith_login_tenant') || ''; } catch { return ''; }
  });
  const [config, setConfig] = useState(FALLBACK);
  const [cycle, setCycle] = useState('monthly');
  const [checkout, setCheckout] = useState(null);

  useEffect(() => { document.title = 'Zenith · Asistente de WhatsApp con IA para tu negocio'; }, []);
  useEffect(() => {
    fetch(`${API_BASE}/api/public/billing/config`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.plans) && d.plans.length) setConfig(d); })
      .catch(() => {});
  }, []);

  const goToCompany = (e) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean) window.location.assign(`/auth/${clean}`);
  };

  return (
    <div className="min-h-screen text-zinc-100 font-sans"
      style={{ backgroundColor: BG, backgroundImage: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(250,182,30,0.10), transparent 70%)' }}>
      <header className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5">
          <ZenithLogo size={30} />
          <span className="text-lg font-bold tracking-tight" style={HEADING}>zenith</span>
        </a>
        <a href={contactHref('Hola, quiero información de Zenith')} className="text-sm text-zinc-300 hover:text-white">Contactar</a>
      </header>

      <main className="max-w-5xl mx-auto px-4">
        <section className="text-center pt-14 pb-16">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: ACCENT }}>Una app de Fantasma Digital</p>
          <h1 className="mt-4 text-3xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto" style={HEADING}>
            Tu negocio contestando WhatsApp en segundos, de día y de noche
          </h1>
          <p className="mt-5 text-zinc-400 max-w-xl mx-auto">
            Un asistente con IA que responde, agenda y vende por ti, y un panel para que tu equipo lo tenga todo bajo control.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#planes" className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md font-semibold"
              style={{ backgroundColor: ACCENT, color: ON_ACCENT }}>
              Probar {config.trial_days} días gratis <ArrowRight size={16} />
            </a>
            <a href={contactHref('Hola, quiero una demostración de Zenith')}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md border border-[#33333a] hover:bg-[#131318]">
              {SALES_WHATSAPP ? <MessageCircle size={16} /> : <Mail size={16} />} Pedir una demostración
            </a>
          </div>
        </section>

        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-16">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-[#0e0e12] border border-[#222228] rounded-lg p-5">
              <Icon size={20} style={{ color: ACCENT }} />
              <h2 className="mt-3 font-semibold" style={HEADING}>{title}</h2>
              <p className="mt-1.5 text-sm text-zinc-400">{text}</p>
            </div>
          ))}
        </section>

        <section id="planes" className="pb-16 scroll-mt-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-center" style={HEADING}>Planes</h2>
          <p className="mt-2 text-center text-sm text-zinc-400">Precios en USD, sin IVA. {config.trial_days} días gratis y sin contrato de permanencia.</p>
          <div className="mt-6 flex justify-center">
            <div className="inline-flex p-1 rounded-full bg-[#0e0e12] border border-[#222228] text-sm" role="tablist" aria-label="Ciclo de pago">
              {[['monthly', 'Mensual'], ['yearly', 'Anual · 2 meses gratis']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={cycle === id} onClick={() => setCycle(id)}
                  className={`px-4 h-9 rounded-full font-medium ${cycle === id ? '' : 'text-zinc-400 hover:text-white'}`}
                  style={cycle === id ? { backgroundColor: ACCENT, color: ON_ACCENT } : undefined}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-8 grid md:grid-cols-3 gap-4">
            {config.plans.map(p => {
              const price = cycle === 'yearly' ? p.yearly : p.monthly;
              const payable = config.enabled && (cycle === 'yearly' ? p.paypal_plan_yearly : p.paypal_plan_monthly);
              return (
                <div key={p.key} className={`rounded-lg p-6 flex flex-col bg-[#0e0e12] border ${p.featured ? 'border-[#FAB61E]' : 'border-[#222228]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold" style={HEADING}>{p.name}</h3>
                    {p.featured && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: ACCENT, color: ON_ACCENT }}>Recomendado</span>}
                  </div>
                  <p className="mt-4">
                    <span className="text-4xl font-bold" style={HEADING}>${price}</span>
                    <span className="text-sm text-zinc-400">{cycle === 'yearly' ? '/año' : '/mes'}</span>
                  </p>
                  {cycle === 'yearly' && <p className="text-xs text-zinc-500 mt-1">Equivale a ${(p.yearly / 12).toFixed(2)} al mes</p>}
                  <ul className="mt-5 space-y-2 text-sm text-zinc-300 flex-1">
                    {(p.items || []).map(i => <li key={i} className="flex gap-2"><Check size={16} className="shrink-0 mt-0.5" style={{ color: ACCENT }} />{i}</li>)}
                  </ul>
                  {payable ? (
                    <button onClick={() => setCheckout(p)}
                      className={`mt-6 h-11 rounded-md text-sm font-semibold ${p.featured ? '' : 'border border-[#33333a] hover:bg-[#131318]'}`}
                      style={p.featured ? { backgroundColor: ACCENT, color: ON_ACCENT } : undefined}>
                      Probar {config.trial_days} días gratis
                    </button>
                  ) : (
                    <a href={contactHref(`Hola, me interesa el plan ${p.name} de Zenith`)}
                      className={`mt-6 h-11 inline-flex items-center justify-center rounded-md text-sm font-semibold ${p.featured ? '' : 'border border-[#33333a] hover:bg-[#131318]'}`}
                      style={p.featured ? { backgroundColor: ACCENT, color: ON_ACCENT } : undefined}>
                      Quiero este plan
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-center text-xs text-zinc-500">Extras: +2,000 respuestas IA por $10 · instalación asistida $49 (gratis con plan anual).</p>
        </section>

        <section className="pb-20">
          <form onSubmit={goToCompany} className="max-w-md mx-auto bg-[#0e0e12] border border-[#222228] rounded-lg p-5">
            <label htmlFor="landing-slug" className="block text-sm text-zinc-300">¿Ya eres cliente? Entra a tu empresa</label>
            <div className="mt-2 flex gap-2">
              <input id="landing-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="identificador-de-tu-empresa"
                autoCapitalize="none" spellCheck={false}
                className="flex-1 min-w-0 h-10 bg-[#040406] border border-[#2a2a30] rounded-md px-3 text-sm outline-none focus:border-[#FAB61E]" />
              <button type="submit" className="h-10 px-4 rounded-md border border-[#33333a] bg-[#131318] hover:bg-[#1c1c22] text-sm">Entrar</button>
            </div>
          </form>
        </section>
      </main>

      <footer className="border-t border-[#1a1a20] py-6 text-center text-xs text-zinc-500 space-y-2">
        <LegalLinks />
        <p>© {new Date().getFullYear()} Zenith · una app de <a href="https://fantasmadigital.dev" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">Fantasma Digital</a></p>
      </footer>

      {checkout && <Checkout plan={checkout} cycle={cycle} config={config} onClose={() => setCheckout(null)} />}
    </div>
  );
}
