import React, { useEffect, useState } from 'react';
import { ArrowRight, Bot, CalendarCheck, Check, Mail, MessageCircle, ShoppingBag, Users } from 'lucide-react';

// Datos de contacto comercial (configurables en el build: VITE_SALES_WHATSAPP=50370000000, VITE_SALES_EMAIL=ventas@...)
const SALES_WHATSAPP = (import.meta.env.VITE_SALES_WHATSAPP || '').replace(/\D/g, '');
const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || '';
const ACCENT = '#3ecf8e';

const waLink = (text) => `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(text)}`;
const contactHref = (text) => (SALES_WHATSAPP ? waLink(text) : SALES_EMAIL ? `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(text)}` : '#planes');

const FEATURES = [
  { icon: Bot, title: 'Asistente con IA 24/7', text: 'Responde en WhatsApp con la información de tu negocio, a cualquier hora.' },
  { icon: CalendarCheck, title: 'Citas y pedidos', text: 'Agenda, toma pedidos y cobra sin que tengas que estar pendiente del teléfono.' },
  { icon: Users, title: 'Clientes y bandeja', text: 'Cada conversación queda en una ficha; tu equipo entra al chat cuando hace falta.' },
  { icon: ShoppingBag, title: 'Todo en un panel', text: 'Inventario, caja, fidelidad y facturación electrónica en el mismo lugar.' },
];

const PLANS = [
  { name: 'Básico', price: '$39', for: 'Emprendedores', items: ['1 número de WhatsApp', 'Asistente con tu información', 'Preguntas frecuentes'] },
  { name: 'Profesional', price: '$99', for: 'PYMES', featured: true, items: ['Todo lo del Básico', 'Citas o pedidos', 'Clientes y bandeja del equipo'] },
  { name: 'Premium', price: '$249', for: 'Empresas', items: ['API oficial de WhatsApp', 'Facturación electrónica (DTE)', 'Integraciones y varios agentes'] },
];

export default function LandingScreen() {
  const [slug, setSlug] = useState(() => {
    try { return localStorage.getItem('zenith_login_tenant') || ''; } catch { return ''; }
  });

  useEffect(() => { document.title = 'Zenith · Asistente de WhatsApp con IA para tu negocio'; }, []);

  const goToCompany = (e) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean) window.location.assign(`/auth/${clean}`);
  };

  return (
    <div className="min-h-screen bg-[#121212] text-zinc-100 font-sans"
      style={{ backgroundImage: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(62,207,142,0.12), transparent 70%)' }}>
      <header className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">Zenith</span>
        <a href={contactHref('Hola, quiero información de Zenith')} className="text-sm text-zinc-300 hover:text-white">Contactar</a>
      </header>

      <main className="max-w-5xl mx-auto px-4">
        <section className="text-center pt-14 pb-16">
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-3xl mx-auto">
            Tu negocio atendiendo por WhatsApp, aunque estés ocupado
          </h1>
          <p className="mt-5 text-zinc-400 max-w-xl mx-auto">
            Un asistente con IA que responde, agenda y vende por ti, y un panel para que tu equipo lo tenga todo bajo control.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href={contactHref('Hola, quiero una demostración de Zenith')}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md font-medium text-[#0b1f16]"
              style={{ backgroundColor: ACCENT }}>
              {SALES_WHATSAPP ? <MessageCircle size={16} /> : <Mail size={16} />} Pedir una demostración
            </a>
            <a href="#planes" className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md border border-[#3e3e3e] hover:bg-[#1c1c1c]">
              Ver planes <ArrowRight size={16} />
            </a>
          </div>
        </section>

        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-16">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-5">
              <Icon size={20} style={{ color: ACCENT }} />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="mt-1.5 text-sm text-zinc-400">{text}</p>
            </div>
          ))}
        </section>

        <section id="planes" className="pb-16">
          <h2 className="text-2xl font-semibold text-center">Planes</h2>
          <p className="mt-2 text-center text-sm text-zinc-400">Precios mensuales en USD. La instalación y carga de tu información se cotiza aparte.</p>
          <div className="mt-8 grid md:grid-cols-3 gap-4">
            {PLANS.map(p => (
              <div key={p.name} className={`rounded-lg p-6 flex flex-col bg-[#171717] border ${p.featured ? 'border-[#3ecf8e]' : 'border-[#2e2e2e]'}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{p.name}</h3>
                  <span className="text-xs text-zinc-400">{p.for}</span>
                </div>
                <p className="mt-4"><span className="text-sm text-zinc-400">desde </span><span className="text-3xl font-semibold">{p.price}</span><span className="text-sm text-zinc-400">/mes</span></p>
                <ul className="mt-5 space-y-2 text-sm text-zinc-300 flex-1">
                  {p.items.map(i => <li key={i} className="flex gap-2"><Check size={16} className="shrink-0" style={{ color: ACCENT }} />{i}</li>)}
                </ul>
                <a href={contactHref(`Hola, me interesa el plan ${p.name} de Zenith`)}
                  className={`mt-6 h-10 inline-flex items-center justify-center rounded-md text-sm font-medium ${p.featured ? 'text-[#0b1f16]' : 'border border-[#3e3e3e] hover:bg-[#1c1c1c]'}`}
                  style={p.featured ? { backgroundColor: ACCENT } : undefined}>
                  Quiero este plan
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-20">
          <form onSubmit={goToCompany} className="max-w-md mx-auto bg-[#171717] border border-[#2e2e2e] rounded-lg p-5">
            <label htmlFor="landing-slug" className="block text-sm text-zinc-300">¿Ya eres cliente? Entra a tu empresa</label>
            <div className="mt-2 flex gap-2">
              <input id="landing-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="identificador-de-tu-empresa"
                autoCapitalize="none" spellCheck={false}
                className="flex-1 min-w-0 h-10 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none focus:border-zinc-500" />
              <button type="submit" className="h-10 px-4 rounded-md border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-sm">Entrar</button>
            </div>
          </form>
        </section>
      </main>

      <footer className="border-t border-[#222] py-6 text-center text-xs text-zinc-500">© {new Date().getFullYear()} Zenith</footer>
    </div>
  );
}
