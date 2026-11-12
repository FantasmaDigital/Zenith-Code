import React, { useState, useEffect } from 'react';
import { PlusCircle, RefreshCw, Save, Trash2 } from 'lucide-react';

const DAYS = [
  ['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'],
  ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']
];

const ORDER_TYPES = [
  ['delivery', '🛵 A domicilio'], ['pickup', '🛍️ Para recoger'], ['dine_in', '🍽️ Comer en el local']
];

const PAYMENTS = [
  ['cash', '💵 Efectivo'], ['transfer', '🏦 Transferencia'], ['card', '💳 Tarjeta']
];

const inputClass =
  'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500';

function Section({ title, hint, children }) {
  return (
    <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        {hint && <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded-md bg-[#121212] border-[#2e2e2e]"
      />
      <span>
        <span className="block text-xs font-semibold text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500 mt-0.5">{hint}</span>}
      </span>
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

const errorText = (detail) => {
  if (Array.isArray(detail)) {
    return detail.map(d => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join(' · ');
  }
  return typeof detail === 'string' ? detail : 'Revisa los datos ingresados.';
};

export default function RestaurantSettings({ apiFetch, apiBase, themeColor, showToast, onSaved }) {
  const [form, setForm] = useState(null);
  const [openNow, setOpenNow] = useState(false);
  const [localTime, setLocalTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/config`);
      if (!res.ok) throw new Error('No se pudo cargar la configuración.');
      const data = await res.json();
      setForm(data.config);
      setOpenNow(data.open_now);
      setLocalTime(data.local_time);
      setDirty(false);
    } catch (err) {
      showToast?.(err.message, true);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!form) {
    return (
      <div className="p-4 text-center text-zinc-500 text-sm">
        <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
        Cargando configuración...
      </div>
    );
  }

  const update = (patch) => {
    setForm(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const updateIn = (key, sub, value) => update({ [key]: { ...form[key], [sub]: value } });
  const ai = {
    take_orders: true, menu_style: 'categories', upsell: true, ask_name: true,
    menu_link: '', greeting: '', instructions: '', ...(form.ai || {})
  };
  const updateAi = (patch) => update({ ai: { ...ai, ...patch } });
  const updateDay = (day, patch) => updateIn('hours', day, { ...form.hours[day], ...patch });
  const updateZone = (index, patch) =>
    update({ zones: form.zones.map((z, i) => (i === index ? { ...z, ...patch } : z)) });

  const copyMondayToAll = () => {
    const monday = form.hours.mon;
    update({ hours: Object.fromEntries(DAYS.map(([d]) => [d, { ...monday }])) });
    showToast?.('Horario del lunes copiado a todos los días');
  };

  const handleSave = async () => {
    const names = form.zones.map(z => z.name.trim().toLowerCase());
    if (names.some(n => !n) || new Set(names).size !== names.length) {
      showToast?.('Cada zona necesita un nombre único.', true);
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          utc_offset_hours: Number(form.utc_offset_hours),
          prep_minutes: Number(form.prep_minutes) || 0,
          min_order: Number(form.min_order) || 0,
          flat_delivery_fee: Number(form.flat_delivery_fee) || 0,
          zones: form.zones.map(z => ({
            name: z.name.trim(),
            fee: Number(z.fee) || 0,
            min_order: Number(z.min_order) || 0,
            minutes: Number(z.minutes) || 0
          }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(data.detail));
      setForm(data.config);
      setOpenNow(data.open_now);
      setDirty(false);
      showToast?.('✅ Configuración del restaurante guardada');
      onSaved?.(data.config, data.open_now);
    } catch (err) {
      showToast?.(`No se guardó: ${err.message}`, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Barra de estado + guardar */}
      <div className="sticky top-16 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-[#171717]/95 backdrop-blur border border-[#2e2e2e] rounded-md">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
            openNow
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
          }`}>
            <span className={`w-2 h-2 rounded-full ${openNow ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {openNow ? 'Abierto ahora' : 'Cerrado ahora'}
          </span>
          <span className="text-xs text-zinc-500">Hora del restaurante: {localTime}</span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium text-black hover:brightness-110 transition-all disabled:opacity-40"
          style={{ backgroundColor: themeColor }}
        >
          {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
          {dirty ? 'Guardar cambios' : 'Sin cambios'}
        </button>
      </div>

      <Section
        title="🤖 Asistente IA del restaurante"
        hint="Define cómo el bot muestra el menú y toma pedidos por WhatsApp. Se aplica al instante tras guardar."
      >
        <Toggle
          checked={ai.take_orders}
          onChange={v => updateAi({ take_orders: v })}
          label="La IA toma pedidos completos"
          hint="Si lo apagas, el bot solo informa menú, precios y horarios, y pasa al cliente con un asesor para pedir."
        />
        {ai.take_orders && (
          <div className="flex flex-wrap gap-x-2 gap-y-2">
            <Toggle checked={ai.upsell} onChange={v => updateAi({ upsell: v })} label="Sugerir complementos" hint="Bebida, postre o acompañamiento, una sola vez." />
            <Toggle checked={ai.ask_name} onChange={v => updateAi({ ask_name: v })} label="Pedir nombre del cliente" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Cómo mostrar el menú">
            <select className={inputClass} value={ai.menu_style} onChange={e => updateAi({ menu_style: e.target.value })}>
              <option value="categories">Primero categorías, luego productos</option>
              <option value="full">Menú completo de una vez</option>
            </select>
          </Field>
          <Field label="Enlace al menú visual (opcional)" hint="Foto, PDF o página con la carta; el bot lo comparte si piden fotos.">
            <input className={inputClass} value={ai.menu_link} onChange={e => updateAi({ menu_link: e.target.value })} placeholder="https://..." />
          </Field>
        </div>
        <Field label="Saludo del restaurante (opcional)" hint="Si lo llenas, reemplaza al saludo del Perfil mientras el módulo esté activo. Vacío = se usa el saludo del Perfil.">
          <input className={inputClass} value={ai.greeting} onChange={e => updateAi({ greeting: e.target.value })} placeholder="¡Hola! Bienvenido a Pupusería La Esquina 🫓 ¿Te muestro el menú?" />
        </Field>
        <Field label="Indicaciones especiales para la IA" hint="Promociones, combos, alergias, políticas. El bot las sigue al pie de la letra.">
          <textarea rows={4} className={inputClass} value={ai.instructions} onChange={e => updateAi({ instructions: e.target.value })} placeholder={'Martes 2x1 en pupusas de queso.\nLas bebidas no se venden solas a domicilio.'} />
        </Field>
      </Section>

      <Section
        title="Datos y estado del local"
        hint="El bot usa estos datos para responder. Si apagas «Recibiendo pedidos», el bot deja de tomar pedidos aunque estés en horario."
      >
        <Toggle
          checked={form.accepting_orders}
          onChange={v => update({ accepting_orders: v })}
          label="Recibiendo pedidos"
          hint="Interruptor general: úsalo si la cocina se satura o hay un imprevisto."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nombre del restaurante">
            <input className={inputClass} value={form.restaurant_name} onChange={e => update({ restaurant_name: e.target.value })} placeholder="Ej: Pupusería Doña Marta" />
          </Field>
          <Field label="Dirección del local" hint="Se usa para pedidos «para recoger».">
            <input className={inputClass} value={form.address} onChange={e => update({ address: e.target.value })} placeholder="Ej: 5a Calle Poniente #123, San Salvador" />
          </Field>
          <Field label="Tiempo de preparación (minutos)">
            <input type="number" min="0" max="240" className={inputClass} value={form.prep_minutes} onChange={e => update({ prep_minutes: e.target.value })} />
          </Field>
          <Field label="Pedido mínimo general ($)" hint="Sin contar el envío. 0 = sin mínimo.">
            <input type="number" min="0" step="0.01" className={inputClass} value={form.min_order} onChange={e => update({ min_order: e.target.value })} />
          </Field>
          <Field label="Zona horaria (UTC)" hint="El Salvador = -6 (no cambia en el año).">
            <input type="number" min="-12" max="14" className={inputClass} value={form.utc_offset_hours} onChange={e => update({ utc_offset_hours: e.target.value })} />
          </Field>
          <Field label="Mensaje cuando estás cerrado" hint="Opcional. Si lo dejas vacío, el bot indica el horario.">
            <input className={inputClass} value={form.closed_message} onChange={e => update({ closed_message: e.target.value })} placeholder="Ej: Hoy no abrimos, ¡te esperamos mañana!" />
          </Field>
        </div>
        <Toggle
          checked={form.notify_customer}
          onChange={v => update({ notify_customer: v })}
          label="Avisar al cliente por WhatsApp en cada cambio de estado"
          hint="Confirmado, en preparación, listo/en camino, entregado o cancelado."
        />
      </Section>

      <Section title="Tipos de pedido">
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          {ORDER_TYPES.map(([id, label]) => (
            <Toggle key={id} checked={!!form.order_types[id]} onChange={v => updateIn('order_types', id, v)} label={label} />
          ))}
        </div>
      </Section>

      <Section title="Horario de atención" hint="El bot solo toma pedidos dentro de este horario. Si cierras pasada la medianoche, pon una hora de cierre menor que la de apertura (ej. 18:00 a 02:00).">
        <div className="space-y-2">
          {DAYS.map(([id, label]) => {
            const day = form.hours[id];
            return (
              <div key={id} className="grid grid-cols-[90px_1fr] sm:grid-cols-[110px_auto_1fr] items-center gap-3">
                <span className="text-xs font-semibold text-zinc-300">{label}</span>
                <Toggle checked={!day.closed} onChange={v => updateDay(id, { closed: !v })} label={day.closed ? 'Cerrado' : 'Abierto'} />
                {!day.closed && (
                  <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                    <input type="time" className={`${inputClass} max-w-[130px]`} value={day.open} onChange={e => updateDay(id, { open: e.target.value })} aria-label={`${label} apertura`} />
                    <span className="text-xs text-zinc-500">a</span>
                    <input type="time" className={`${inputClass} max-w-[130px]`} value={day.close} onChange={e => updateDay(id, { close: e.target.value })} aria-label={`${label} cierre`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={copyMondayToAll} className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 underline underline-offset-2">
          Copiar el horario del lunes a todos los días
        </button>
      </Section>

      <Section
        title="Zonas de entrega a domicilio"
        hint="Cada zona tiene su costo de envío, su pedido mínimo y minutos extra de viaje. El cliente debe elegir una zona de esta lista. Sin zonas, se cobra el envío fijo."
      >
        {form.zones.length === 0 ? (
          <Field label="Costo de envío fijo ($)">
            <input type="number" min="0" step="0.01" className={`${inputClass} max-w-[160px]`} value={form.flat_delivery_fee} onChange={e => update({ flat_delivery_fee: e.target.value })} />
          </Field>
        ) : (
          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-[1fr_90px_110px_90px_36px] gap-2 text-[10px] font-medium text-zinc-500 px-1">
              <span>Zona</span><span>Envío $</span><span>Mínimo $</span><span>+Min</span><span />
            </div>
            {form.zones.map((zone, index) => (
              <div key={index} className="grid grid-cols-2 sm:grid-cols-[1fr_90px_110px_90px_36px] gap-3 items-center">
                <input className={`${inputClass} col-span-2 sm:col-span-1`} value={zone.name} onChange={e => updateZone(index, { name: e.target.value })} placeholder="Ej: Centro, Escalón, Soyapango" aria-label="Nombre de la zona" />
                <input type="number" min="0" step="0.25" className={inputClass} value={zone.fee} onChange={e => updateZone(index, { fee: e.target.value })} aria-label="Costo de envío" />
                <input type="number" min="0" step="0.5" className={inputClass} value={zone.min_order} onChange={e => updateZone(index, { min_order: e.target.value })} aria-label="Pedido mínimo" />
                <input type="number" min="0" max="240" className={inputClass} value={zone.minutes} onChange={e => updateZone(index, { minutes: e.target.value })} aria-label="Minutos extra" />
                <button type="button" onClick={() => update({ zones: form.zones.filter((_, i) => i !== index) })} className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md justify-self-end" title="Quitar zona">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => update({ zones: [...form.zones, { name: '', fee: 2, min_order: 0, minutes: 10 }] })}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-md border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200"
        >
          <PlusCircle size={13} /> Agregar zona
        </button>
      </Section>

      <Section title="Métodos de pago">
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          {PAYMENTS.map(([id, label]) => (
            <Toggle key={id} checked={!!form.payment_methods[id]} onChange={v => updateIn('payment_methods', id, v)} label={label} />
          ))}
        </div>
        {form.payment_methods.transfer && (
          <Field label="Datos para transferencia" hint="El bot los envía al cliente y le pide la foto del comprobante.">
            <textarea rows={3} className={inputClass} value={form.transfer_info} onChange={e => update({ transfer_info: e.target.value })} placeholder="Banco Agrícola · Cuenta de ahorros 123456789 · A nombre de Marta López" />
          </Field>
        )}
      </Section>
    </div>
  );
}
