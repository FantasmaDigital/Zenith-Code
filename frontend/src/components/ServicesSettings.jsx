import React, { useState, useEffect } from 'react';
import {
  Save,
  RefreshCw,
  Building2,
  Bot,
  Target,
  DollarSign,
  Clock,
  Sparkles,
  Download,
  Calendar,
  Globe,
  CheckCircle2,
  Link,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

const BUSINESS_TYPES = [
  { value: 'software',      label: '💻 Empresa de Software / Desarrollo Web y Móvil' },
  { value: 'agencia',       label: '🚀 Agencia Digital / Marketing & Creatividad' },
  { value: 'consultoria',   label: '📊 Consultoría Estratégica / Transformación Digital' },
  { value: 'legal',         label: '⚖️ Despacho Legal / Firma Jurídica' },
  { value: 'diseno',        label: '🎨 Estudio de Diseño UI/UX y Producto' },
  { value: 'contabilidad',  label: '📈 Firma Contable y Finanzas' },
  { value: 'otro',          label: '💼 Empresa de Servicios Profesionales' }
];

const RESPONSE_STYLES = [
  {
    value: 'profesional',
    title: 'Profesional & Ejecutivo',
    desc: 'Tono formal, claro y directo. Enfatiza valor de negocio, retorno de inversión y seriedad técnica.'
  },
  {
    value: 'consultivo',
    title: 'Consultivo & Estratégico',
    desc: 'Actúa como consultor senior. Primero indaga la problemática del negocio antes de proponer tecnologías.'
  },
  {
    value: 'cercano',
    title: 'Cercano & Conversacional',
    desc: 'Tuteo respetuoso y empático. Crea una relación cálida, fluida y dinámica con el prospecto.'
  },
  {
    value: 'tecnico',
    title: 'Técnico & Especializado',
    desc: 'Habla de arquitectura, APIs, microservicios, bases de datos y metodologías de ingeniería de software.'
  }
];

const inputClass =
  'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors';

function Section({ title, hint, icon: Icon, children }) {
  return (
    <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
      <div className="flex items-start gap-2.5 pb-2 border-b border-[#242424]">
        {Icon && <Icon size={16} className="text-zinc-400 mt-0.5 shrink-0" />}
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          {hint && <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{hint}</p>}
        </div>
      </div>
      <div className="space-y-3 pt-1">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded bg-[#121212] border-[#2e2e2e] text-emerald-500 focus:ring-0"
      />
      <div>
        <span className="block text-xs font-semibold text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500 mt-0.5">{hint}</span>}
      </div>
    </label>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export default function ServicesSettings({
  apiFetch,
  apiBase,
  themeColor = '#3ecf8e',
  showToast = () => {}
}) {
  const [form, setForm] = useState(null);
  const fallbacks = form?._profile_fallbacks || {};
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/config`);
      if (!res.ok) throw new Error('No se pudo cargar la configuración.');
      const data = await res.json();
      setForm(data);
      setDirty(false);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (patch) => {
    setForm(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!res.ok) throw new Error('Error al guardar la configuración.');
      const saved = await res.json();
      setForm(saved);
      setDirty(false);
      showToast?.('✅ Configuración comercial guardada', 'success');
    } catch (err) {
      showToast?.(err.message || 'Error guardando', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExportFullBackup = async () => {
    try {
      const [cfg, srv, ld, prop, st] = await Promise.all([
        apiFetch(`${apiBase}/api/services/config`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/services`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/leads`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/proposals`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/stats`).then(r => r.json())
      ]);
      const blob = new Blob([JSON.stringify({
        exported_at: new Date().toISOString(),
        module: 'services',
        version: '1.0.0',
        config: cfg,
        services: srv,
        leads: ld,
        proposals: prop,
        stats: st
      }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `zenith_servicios_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast?.('📦 Respaldo JSON descargado');
    } catch {
      showToast?.('Error generando respaldo', 'error');
    }
  };

  if (loading || !form) {
    return (
      <div className="p-8 text-center text-zinc-500 text-sm">
        <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
        Cargando configuración comercial...
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Barra de estado fija superior (Idéntica a RestaurantSettings) */}
      <div className="sticky top-16 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 bg-[#171717]/95 backdrop-blur border border-[#2e2e2e] rounded-md shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Módulo Activo · {form.business_name || 'Mi Empresa de Software'}
          </span>
          <span className="text-xs text-zinc-500 hidden md:inline">Moneda: {form.currency || 'USD ($)'}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportFullBackup}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all"
            title="Descargar respaldo completo en formato JSON"
          >
            <Download size={13} />
            <span>Respaldo JSON</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 transition-all disabled:opacity-40 shadow-sm"
            style={{ backgroundColor: themeColor }}
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            <span>{saving ? 'Guardando...' : dirty ? 'Guardar Cambios' : 'Sin Cambios'}</span>
          </button>
        </div>
      </div>

            {/* 1. IDENTIDAD COMERCIAL & PRESENCIA */}
      <Section
        title="🏢 Identidad Comercial y Presencia"
        hint="Datos oficiales que la IA usa para presentarte con autoridad y legitimidad."
        icon={Building2}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tipo de Negocio">
            <select
              value={form.business_type || 'software'}
              onChange={e => update({ business_type: e.target.value })}
              className={inputClass}
            >
              {BUSINESS_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Nombre Comercial de Servicios">
            <input
              type="text"
              value={form.business_name || ''}
              onChange={e => update({ business_name: e.target.value })}
              placeholder={fallbacks.company_name || 'Ej. Zenith Software Studios'}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Tagline / Propuesta de Valor Principal" hint="La frase principal con la que resumes tu ventaja competitiva ante clientes.">
          <input
            type="text"
            value={form.tagline || ''}
            onChange={e => update({ tagline: e.target.value })}
            placeholder="Ej. Desarrollamos software a medida y plataformas web escalables para acelerar tu crecimiento."
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Sitio Web Oficial">
            <input
              type="url"
              value={form.website || ''}
              onChange={e => update({ website: e.target.value })}
              placeholder={fallbacks.website_url || 'https://tuempresa.com'}
              className={inputClass}
            />
          </Field>

          <Field label="Enlace de Portafolio / Demos" hint="GitHub, Figma, Demos en vivo o Behance.">
            <input
              type="url"
              value={form.portfolio_url || ''}
              onChange={e => update({ portfolio_url: e.target.value })}
              placeholder="https://portfolio.zenithcode.io"
              className={inputClass}
            />
          </Field>

          <Field label="Modalidad de Trabajo">
            <select
              value={form.work_mode || 'remote'}
              onChange={e => update({ work_mode: e.target.value })}
              className={inputClass}
            >
              <option value="remote">100% Remoto (Nacional e Internacional)</option>
              <option value="hybrid">Híbrido (Remoto y Presencial)</option>
              <option value="onsite">Presencial en Oficinas</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* 2. AGENTE COMERCIAL IA (ARM - AI RELATIONSHIP MANAGEMENT) */}
      <Section
        title="🤖 Agente Comercial IA (ARM - AI Relationship Management)"
        hint="Personaliza la estrategia de venta y el estilo con el que la IA interactúa por WhatsApp o Chat Web."
        icon={Bot}
      >
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-zinc-300">Estilo de Comunicación Oficial</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RESPONSE_STYLES.map(style => {
              const active = (form.response_style || 'profesional') === style.value;
              return (
                <div
                  key={style.value}
                  onClick={() => update({ response_style: style.value })}
                  className={`p-3 rounded-md border cursor-pointer transition-all ${
                    active
                      ? 'bg-[#1e1c18] border-amber-500/50 text-zinc-100 shadow-sm'
                      : 'bg-[#121212] border-[#262626] text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-100">{style.title}</span>
                    {active && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{style.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        <Field
          label="Pitch Oficial de Ventas (Propuesta Única de Valor)"
          hint="Instrucción de cabecera: explica a quién ayudas, qué problemas resuelves y por qué tu empresa es la mejor opción técnica."
        >
          <textarea
            rows={4}
            value={form.ai_pitch || ''}
            onChange={e => update({ ai_pitch: e.target.value })}
            placeholder="Somos una empresa especializada en desarrollo de software, arquitectura cloud y plataformas modernas. Ayudamos a empresas a digitalizarse y automatizar procesos con código limpio y soporte continuo..."
            className={inputClass}
          />
        </Field>

        <Field
          label="Saludo del Asistente Comercial (Opcional)"
          hint="Si lo dejas vacío, el asistente utiliza el saludo general configurado en tu perfil."
        >
          <input
            type="text"
            value={form.ai_greeting || ''}
            onChange={e => update({ ai_greeting: e.target.value })}
            placeholder={fallbacks.welcome_message || 'Ej. ¡Hola! ¿En qué proyecto o solución de software podemos apoyarte?'}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Enlace de Agendamiento de Reuniones / Demos"
            hint="Calendly, Google Meet o TidyCal. La IA lo comparte cuando el cliente pide una reunión técnica o demo."
          >
            <input
              type="url"
              value={form.meeting_link || ''}
              onChange={e => update({ meeting_link: e.target.value })}
              placeholder="https://calendly.com/miempresa/reunion-15min"
              className={inputClass}
            />
          </Field>

          <Field
            label="Llamado a la Acción (CTA de Captura de Datos)"
            hint="Frase final con la que la IA solicita los datos de contacto para armar una propuesta formal."
          >
            <input
              type="text"
              value={form.contact_cta || ''}
              onChange={e => update({ contact_cta: e.target.value })}
              placeholder="¿Te gustaría agendar una llamada de 15 min sin costo para evaluar tu proyecto?"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="pt-2 border-t border-[#262626] space-y-2">
          <label className="block text-xs font-semibold text-zinc-300">Reglas de Presentación Comercial en el Chat</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Toggle
              checked={Boolean(form.show_prices)}
              onChange={v => update({ show_prices: v })}
              label="Mostrar rangos de precio"
              hint="Si lo apagas, la IA indica que cada solución se cotiza a medida."
            />
            <Toggle
              checked={Boolean(form.show_duration)}
              onChange={v => update({ show_duration: v })}
              label="Mencionar plazos estimados"
              hint="Indica tiempos de entrega aproximados (ej. 30 a 45 días)."
            />
            <Toggle
              checked={Boolean(form.mention_stack)}
              onChange={v => update({ mention_stack: v })}
              label="Destacar stack técnico"
              hint="Menciona tecnologías y metodología ágil (Scrum, QA)."
            />
          </div>
        </div>

        <Field
          label="Instrucciones & Políticas Especiales de la Empresa"
          hint="Reglas que el bot seguirá estrictamente: tecnologías que NO utilizan, acuerdos de confidencialidad (NDA), etc."
        >
          <textarea
            rows={3}
            value={form.special_instructions || ''}
            onChange={e => update({ special_instructions: e.target.value })}
            placeholder="No realizamos trabajos en plataformas obsoletas. Todos los proyectos incluyen firma de NDA previa. Ofrecemos 3 meses de garantía por bugs."
            className={inputClass}
          />
        </Field>
      </Section>

      {/* 3. CALIFICACIÓN DE PROSPECTOS (LEAD SCORING / BANT) */}
      <Section
        title="🎯 Calificación Automática de Prospectos (Lead Qualification)"
        hint="Criterios para que la IA filtre e identifique prospectos calificados antes de transferirlos a tu equipo."
        icon={Target}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Presupuesto Mínimo Aceptado para Proyectos ($)"
            hint="Proyectos por debajo de este monto serán orientados amablemente a soluciones base."
          >
            <input
              type="number"
              value={form.min_project_budget ?? ''}
              onChange={e => update({ min_project_budget: Number(e.target.value) || 0 })}
              placeholder="500"
              className={inputClass}
            />
          </Field>

          <div className="space-y-2 pt-1">
            <span className="block text-xs font-semibold text-zinc-300">Preguntas de Calificación que la IA indagará:</span>
            <Toggle
              checked={Boolean(form.ask_budget)}
              onChange={v => update({ ask_budget: v })}
              label="Indagar presupuesto estimado"
              hint="Pregunta al prospecto si cuenta con un rango de inversión previsto."
            />
            <Toggle
              checked={Boolean(form.ask_timeline)}
              onChange={v => update({ ask_timeline: v })}
              label="Indagar fecha deseada de lanzamiento"
              hint="Pregunta para qué fecha necesitan tener la solución en producción."
            />
            <Toggle
              checked={Boolean(form.ask_requirements)}
              onChange={v => update({ ask_requirements: v })}
              label="Indagar diseño o requerimientos previos"
              hint="Verifica si ya cuentan con wireframes o alcance detallado."
            />
          </div>
        </div>
      </Section>

      {/* 4. MODELO COMERCIAL & CONDICIONES DE PAGO */}
      <Section
        title="💳 Modelo Comercial y Condiciones de Pago"
        hint="Términos comerciales estándar que la IA comunica a los clientes al momento de cotizar."
        icon={DollarSign}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Condiciones Estándar de Pago" hint="Cómo se estructuran los pagos del proyecto.">
            <input
              type="text"
              value={form.payment_terms || ''}
              onChange={e => update({ payment_terms: e.target.value })}
              placeholder="Ej. 50% anticipo al iniciar y 50% contra entrega a satisfacción."
              className={inputClass}
            />
          </Field>

          <Field label="Garantía y Soporte Post-Entrega (Días)" hint="Período de corrección de incidencias o soporte incluido.">
            <input
              type="number"
              value={form.warranty_days ?? ''}
              onChange={e => update({ warranty_days: Number(e.target.value) || 0 })}
              placeholder="30"
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      {/* 5. HORARIO COMERCIAL & FUERA DE SERVICIO */}
      <Section
        title="⏰ Horario de Atención Comercial"
        hint="Define cuándo opera tu equipo de ventas y qué debe responder la IA fuera del horario laboral."
        icon={Clock}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Días Laborables">
            <input
              type="text"
              value={form.work_days || 'Lunes a Viernes'}
              onChange={e => update({ work_days: e.target.value })}
              placeholder="Lunes a Viernes"
              className={inputClass}
            />
          </Field>

          <Field label="Horas de Atención">
            <input
              type="text"
              value={form.work_hours || '08:00 - 18:00'}
              onChange={e => update({ work_hours: e.target.value })}
              placeholder="08:00 - 18:00"
              className={inputClass}
            />
          </Field>

          <Field label="Zona Horaria">
            <input
              type="text"
              value={form.timezone || 'America/El_Salvador'}
              onChange={e => update({ timezone: e.target.value })}
              placeholder="America/El_Salvador"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Respuesta Oficial Fuera de Horario"
          hint="Mensaje con el que la IA atiende cuando el prospecto escribe fuera de horas laborales."
        >
          <textarea
            rows={2}
            value={form.out_of_hours_msg || ''}
            onChange={e => update({ out_of_hours_msg: e.target.value })}
            placeholder="Nuestro equipo comercial está fuera de horario, pero con gusto tomo tus requerimientos y mañana a primera hora te contactamos con una propuesta formal."
            className={inputClass}
          />
        </Field>
      </Section>
    </div>
  );
}

