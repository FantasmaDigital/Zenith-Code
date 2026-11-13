import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Brain, MessageSquare, Pencil, Phone, Plus, RefreshCw, Search, ShoppingBag, Sparkles, Trash2, X } from 'lucide-react';

const STAGES = [
  ['new', 'Nuevo'], ['interested', 'Interesado'], ['customer', 'Cliente'], ['loyal', 'Frecuente'], ['lost', 'Perdido']
];
const STAGE_STYLE = {
  new: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  interested: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  customer: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  loyal: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  lost: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
};
const STAGE_LABEL = Object.fromEntries(STAGES);

const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(v) || 0);
const relative = (iso) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString();
};
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const phoneLabel = (p, channel) => (p && /^503\d{8}$/.test(p) ? `+503 ${p.slice(3, 7)}-${p.slice(7)}` : p ? `+${p}` : channel === 'whatsapp' ? 'WhatsApp' : 'Chat web');

const inputClass = 'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 transition-colors disabled:opacity-50';

function StageBadge({ stage }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-medium ${STAGE_STYLE[stage] || STAGE_STYLE.new}`}>
      {STAGE_LABEL[stage] || stage}
    </span>
  );
}

export function Avatar({ name, src, size = 'w-8 h-8 text-[13px]' }) {
  const [broken, setBroken] = React.useState(false);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src && !broken) {
    // Las URLs de WhatsApp caducan: si ya no carga, se vuelve a la inicial
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
      className={`${size} rounded-full object-cover border border-[#3a3a3a] shrink-0`} />;
  }
  return <div className={`${size} rounded-full bg-[#2a2a2a] border border-[#3a3a3a] flex items-center justify-center font-medium text-zinc-200 shrink-0`}>{initial}</div>;
}

const errorText = async (res, fallback) => {
  const d = await res.json().catch(() => ({}));
  return Array.isArray(d.detail) ? d.detail.map(x => x.msg).join(' · ') : d.detail || fallback;
};

// ==============================================================
// LISTA
// ==============================================================
function CustomerList({ apiFetch, apiBase, onOpen }) {
  const [data, setData] = useState({ customers: [], total: 0, by_stage: {} });
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const PAGE = 50;

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const q = new URLSearchParams({ search, stage, limit: PAGE, offset: page * PAGE });
      const res = await apiFetch(`${apiBase}/api/customers?${q}`);
      if (res.ok) setData(await res.json());
      setLoading(false);
    }, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, stage, page]);

  const totalAll = Object.values(data.by_stage).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[['', 'Todos', totalAll], ...STAGES.map(([id, label]) => [id, label, data.by_stage[id] || 0])].map(([id, label, n]) => (
          <button
            key={id || 'all'}
            onClick={() => { setStage(id); setPage(0); }}
            className={`px-3 py-1.5 rounded-md text-[13px] border transition-colors ${
              stage === id ? 'bg-[#2e2e2e] border-[#3e3e3e] text-zinc-100' : 'bg-[#171717] border-[#2e2e2e] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label} <span className="text-zinc-500 tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          className={`${inputClass} pl-9`}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Buscar por nombre, teléfono, notas o resumen…"
        />
      </div>

      <div className="bg-[#171717] border border-[#2e2e2e] rounded-md overflow-x-auto">
        <table className="w-full text-[13px] min-w-[720px]">
          <thead className="text-zinc-500 border-b border-[#2e2e2e]">
            <tr>
              <th className="text-left font-normal px-4 py-2.5">Cliente</th>
              <th className="text-left font-normal px-4 py-2.5">Etapa</th>
              <th className="text-left font-normal px-4 py-2.5">Lo que sabe la IA</th>
              <th className="text-right font-normal px-4 py-2.5">Mensajes</th>
              <th className="text-right font-normal px-4 py-2.5">Último contacto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#242424]">
            {data.customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                  {loading ? 'Cargando…' : search || stage ? 'Ningún cliente coincide con el filtro.' : 'Aún no hay clientes. Aparecerán aquí en cuanto alguien escriba por WhatsApp.'}
                </td>
              </tr>
            )}
            {data.customers.map(c => (
              <tr key={c.id} onClick={() => onOpen(c.id)} className="hover:bg-[#1c1c1c] cursor-pointer">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.name || c.phone} src={c.avatar_url} />
                    <div className="min-w-0">
                      <p className="text-zinc-100 truncate">{c.name || 'Sin nombre'}</p>
                      <p className="text-[12px] text-zinc-500 truncate">{phoneLabel(c.phone, c.channel) || 'Chat web'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5"><StageBadge stage={c.stage} /></td>
                <td className="px-4 py-2.5 text-zinc-400 max-w-[360px]">
                  <p className="truncate">{c.summary || <span className="text-zinc-600">Sin resumen todavía</span>}</p>
                  {c.tags?.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {c.tags.slice(0, 3).map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-[#232323] text-[11px] text-zinc-400">{t}</span>)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">{c.message_count}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400 whitespace-nowrap">{relative(c.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > PAGE && (
        <div className="flex items-center justify-between text-[13px] text-zinc-400">
          <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} de {data.total}</span>
          <div className="flex gap-2">
            <button className={btn} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button>
            <button className={btn} disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(p => p + 1)}>Siguiente</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==============================================================
// FICHA
// ==============================================================
function TagEditor({ tags, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-[#232323] border border-[#2e2e2e] text-[12px] text-zinc-300">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="text-zinc-500 hover:text-zinc-200" aria-label={`Quitar ${t}`}><X size={12} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder="+ etiqueta"
        className="w-24 bg-transparent text-[12px] text-zinc-300 outline-none placeholder-zinc-600"
      />
    </div>
  );
}

function CustomerDetail({ apiFetch, apiBase, customerId, onBack, toast, themeColor }) {
  const [c, setC] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [memDraft, setMemDraft] = useState(null); // { summary, facts } mientras se edita la memoria
  const [memSaving, setMemSaving] = useState(false);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const scrollRef = useRef(null);

  const load = async () => {
    const res = await apiFetch(`${apiBase}/api/customers/${customerId}`);
    if (res.status === 404) { setNotFound(true); return; }
    if (!res.ok) return;
    const data = (await res.json()).customer;
    setC(data);
    setForm({ name: data.name || '', notes: data.notes || '', tags: data.tags || [], stage: data.stage });
  };

  const loadMessages = async (beforeId) => {
    const q = new URLSearchParams({ limit: 50, ...(beforeId ? { before_id: beforeId } : {}) });
    const res = await apiFetch(`${apiBase}/api/customers/${customerId}/messages?${q}`);
    if (!res.ok) return;
    const batch = (await res.json()).messages || [];
    setHasMore(batch.length === 50);
    setMessages(prev => (beforeId ? [...batch, ...prev] : batch));
    if (!beforeId) setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0);
  };

  useEffect(() => {
    setC(null); setNotFound(false); setMessages([]);
    load();
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const dirty = useMemo(() => c && form && (
    form.name !== (c.name || '') || form.notes !== (c.notes || '') || form.stage !== c.stage
    || JSON.stringify(form.tags) !== JSON.stringify(c.tags || [])
  ), [c, form]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: form.name, notes: form.notes, tags: form.tags, ...(form.stage !== c.stage ? { stage: form.stage } : {}) };
      const res = await apiFetch(`${apiBase}/api/customers/${customerId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo guardar.'));
      const data = (await res.json()).customer;
      setC(data);
      setForm({ name: data.name || '', notes: data.notes || '', tags: data.tags || [], stage: data.stage });
      toast('Ficha guardada');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const patchMemory = async (body) => {
    setMemSaving(true);
    try {
      const res = await apiFetch(`${apiBase}/api/customers/${customerId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo guardar la memoria.'));
      setC((await res.json()).customer);
      setMemDraft(null);
      toast('Memoria guardada');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setMemSaving(false);
    }
  };
  const saveMemory = () => patchMemory({
    summary: memDraft.summary, facts: memDraft.facts.map(f => f.trim()).filter(Boolean)
  });
  const removeFact = (i) => patchMemory({ facts: (c.facts || []).filter((_, j) => j !== i) });

  const refreshSummary = async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch(`${apiBase}/api/customers/${customerId}/summary`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo actualizar la memoria.'));
      const data = (await res.json()).customer;
      setC(data);
      setForm(f => ({ ...f, tags: data.tags || [], stage: data.stage, name: f.name || data.name || '' }));
      toast('Memoria actualizada');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setRefreshing(false);
    }
  };

  if (notFound) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className={btn}><ArrowLeft size={14} /> Clientes</button>
        <p className="text-[13px] text-zinc-500">Este cliente no existe.</p>
      </div>
    );
  }
  if (!c || !form) return <p className="text-[13px] text-zinc-500">Cargando ficha…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-[#232323]" aria-label="Volver a clientes"><ArrowLeft size={16} /></button>
          <Avatar name={c.name || c.phone} src={c.avatar_url} size="w-10 h-10 text-base" />
          <div>
            <h1 className="text-xl font-medium tracking-tight text-zinc-100">{c.name || 'Sin nombre'}</h1>
            <p className="text-[13px] text-zinc-400 flex items-center gap-1.5">
              {c.phone ? <><Phone size={12} /> {phoneLabel(c.phone, c.channel)}</> : phoneLabel(null, c.channel)} · cliente desde {new Date(c.first_seen_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <button onClick={save} disabled={!dirty || saving} className="px-3 py-1.5 rounded-md text-[13px] font-medium text-black disabled:opacity-40" style={{ backgroundColor: themeColor }}>
          {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Sin cambios'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Columna izquierda: memoria y ficha */}
        <div className="lg:col-span-2 space-y-4">
          <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-100"><Brain size={14} style={{ color: themeColor }} /> Memoria del agente</h2>
              {!memDraft && (
                <div className="flex items-center gap-3">
                  <button onClick={() => setMemDraft({ summary: c.summary || '', facts: [...(c.facts || [])] })} className="inline-flex items-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-100">
                    <Pencil size={12} /> Editar
                  </button>
                  <button onClick={refreshSummary} disabled={refreshing || c.message_count === 0} className="inline-flex items-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-100 disabled:opacity-40">
                    <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Actualizar
                  </button>
                </div>
              )}
            </div>
            {memDraft ? (
              <div className="space-y-2">
                <textarea className={`${inputClass} min-h-[96px] resize-y`} value={memDraft.summary} maxLength={1200}
                  onChange={e => setMemDraft({ ...memDraft, summary: e.target.value })} placeholder="Resumen del cliente" />
                <ul className="space-y-1.5">
                  {memDraft.facts.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <input className={inputClass} value={f} maxLength={160}
                        onChange={e => setMemDraft({ ...memDraft, facts: memDraft.facts.map((x, j) => j === i ? e.target.value : x) })} />
                      <button onClick={() => setMemDraft({ ...memDraft, facts: memDraft.facts.filter((_, j) => j !== i) })}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-rose-300 hover:bg-[#232323]" aria-label="Quitar dato"><Trash2 size={13} /></button>
                    </li>
                  ))}
                </ul>
                {memDraft.facts.length < 12 && (
                  <button onClick={() => setMemDraft({ ...memDraft, facts: [...memDraft.facts, ''] })}
                    className="inline-flex items-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-100"><Plus size={12} /> Agregar dato</button>
                )}
                <p className="text-[11px] text-zinc-500">Lo que quites no lo volverá a agregar la IA al actualizar la memoria.</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMemDraft(null)} disabled={memSaving} className="px-3 py-1.5 rounded-md text-[12px] text-zinc-300 hover:bg-[#232323]">Cancelar</button>
                  <button onClick={saveMemory} disabled={memSaving} className="px-3 py-1.5 rounded-md text-[12px] font-medium text-black disabled:opacity-40" style={{ backgroundColor: themeColor }}>
                    {memSaving ? 'Guardando…' : 'Guardar memoria'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {c.summary ? (
                  <p className="text-[13px] text-zinc-300 leading-relaxed">{c.summary}</p>
                ) : (
                  <p className="text-[13px] text-zinc-500">La IA arma el resumen tras los primeros mensajes y lo actualiza sola cada pocos mensajes.</p>
                )}
                {c.facts?.length > 0 && (
                  <ul className="space-y-1">
                    {c.facts.map((f, i) => (
                      <li key={i} className="group flex gap-2 text-[13px] text-zinc-300">
                        <Sparkles size={12} className="mt-1 shrink-0 text-zinc-500" /><span className="flex-1">{f}</span>
                        <button onClick={() => removeFact(i)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 h-fit rounded text-zinc-500 hover:text-rose-300" aria-label={`Quitar «${f}»`}><X size={12} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="text-[11px] text-zinc-500">
              {c.summary_updated_at ? `Actualizada ${relative(c.summary_updated_at)}. ` : ''}El agente usa esta memoria para atender a este cliente de forma personalizada.
            </p>
          </section>

          <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
            <label className="block space-y-1">
              <span className="text-[12px] text-zinc-400">Nombre</span>
              <input className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre del cliente" />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] text-zinc-400">Etapa</span>
              <select className={inputClass} value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <span className="block text-[11px] text-zinc-500">
                {c.stage_locked ? 'Fijada a mano: la IA ya no la cambia.' : 'La IA la ajusta según la conversación; si la cambias tú, queda fija.'}
              </span>
            </label>
            <div className="space-y-1">
              <span className="text-[12px] text-zinc-400">Etiquetas</span>
              <TagEditor tags={form.tags} onChange={tags => setForm({ ...form, tags })} />
            </div>
            <label className="block space-y-1">
              <span className="text-[12px] text-zinc-400">Notas del equipo</span>
              <textarea rows={3} className={inputClass} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Lo que el equipo debe saber. El agente también lo lee." />
            </label>
          </section>

          {c.orders && (
            <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
              <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-100"><ShoppingBag size={14} /> Compras</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[12px] text-zinc-500">Pedidos</p><p className="text-lg font-medium text-zinc-100">{c.orders.count}</p></div>
                <div><p className="text-[12px] text-zinc-500">Total gastado</p><p className="text-lg font-medium text-zinc-100">{money(c.orders.total_spent)}</p></div>
              </div>
              {c.orders.recent.length > 0 && (
                <ul className="divide-y divide-[#242424] text-[12px]">
                  {c.orders.recent.map(o => (
                    <li key={o.id} className="py-1.5 flex justify-between gap-3">
                      <span className="text-zinc-400 truncate">#{o.id} · {o.items || '—'}</span>
                      <span className="text-zinc-300 font-mono shrink-0">{money(o.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Columna derecha: conversación */}
        <section className="lg:col-span-3 bg-[#171717] border border-[#2e2e2e] rounded-md flex flex-col min-h-[420px] max-h-[calc(100vh-180px)]">
          <div className="px-4 py-3 border-b border-[#2e2e2e] flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-100"><MessageSquare size={14} /> Conversación</h2>
            <span className="text-[12px] text-zinc-500">{c.message_count} mensajes</span>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {hasMore && (
              <button onClick={() => loadMessages(messages[0]?.id)} className="mx-auto block text-[12px] text-zinc-400 hover:text-zinc-100">Cargar mensajes anteriores</button>
            )}
            {messages.length === 0 && <p className="text-center text-[13px] text-zinc-500 py-10">Sin mensajes.</p>}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-[#232323] text-zinc-200 rounded-bl-sm' : 'text-zinc-100 rounded-br-sm'
                }`} style={m.role === 'user' ? undefined : { backgroundColor: 'rgba(var(--theme-primary-rgb), 0.16)' }}>
                  {m.content}
                  <span className="block mt-1 text-[10px] text-zinc-500 text-right">{dateTime(m.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function CustomersPanel({ apiFetch, apiBase, themeColor, showToast, customerId, onOpen }) {
  const toast = (msg, isErr = false) => showToast?.(msg, isErr);
  if (customerId) {
    return <CustomerDetail apiFetch={apiFetch} apiBase={apiBase} customerId={customerId} onBack={() => onOpen(null)} toast={toast} themeColor={themeColor} />;
  }
  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-zinc-100">Clientes</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">Cada persona que escribe tiene su ficha: conversación completa, compras y lo que el agente recuerda de ella.</p>
      </div>
      <CustomerList apiFetch={apiFetch} apiBase={apiBase} onOpen={onOpen} />
    </div>
  );
}
