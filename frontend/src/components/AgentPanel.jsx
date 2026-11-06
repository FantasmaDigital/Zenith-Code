import React, { useEffect, useState } from 'react';
import { Bot, Clock, MoonStar, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';

const STATUS = {
  pending_approval: ['Por aprobar', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
  approved: ['Programado', 'bg-sky-500/15 text-sky-300 border-sky-500/30'],
  sent: ['Enviado', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'],
  rejected: ['Descartado', 'bg-zinc-800 text-zinc-400 border-zinc-700'],
  skipped: ['Omitido', 'bg-zinc-800 text-zinc-400 border-zinc-700'],
  failed: ['Falló', 'bg-rose-500/15 text-rose-300 border-rose-500/30']
};
const PARAM_LABELS = {
  inactive_days: ['Días sin escribir', 'días'],
  hours_after: ['Horas después de entregar', 'horas'],
  days_without_reply: ['Días sin responder', 'días']
};

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 transition-colors disabled:opacity-50';
const inputClass = 'bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500';
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const errorText = async (res, fallback) => {
  const d = await res.json().catch(() => ({}));
  return Array.isArray(d.detail) ? d.detail.map(x => x.msg).join(' · ') : d.detail || fallback;
};

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, STATUS.skipped[1]];
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}>{label}</span>;
}

function Header({ title, description, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-zinc-100">{title}</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{description}</p>
      </div>
      {children && <div className="flex gap-2 shrink-0">{children}</div>}
    </div>
  );
}

// ==============================================================
// BANDEJA DE APROBACIÓN
// ==============================================================
function Approvals({ api, toast, themeColor, onOpenCustomer, onChanged }) {
  const [tasks, setTasks] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [quietNow, setQuietNow] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    const [t, p] = await Promise.all([api('/api/agent/tasks?status=pending_approval&limit=200'), api('/api/agent/playbooks')]);
    if (t.ok) setTasks((await t.json()).tasks || []);
    if (p.ok) setQuietNow((await p.json()).quiet_now);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const decide = async (task, action) => {
    setBusy(task.id);
    try {
      const res = await api(`/api/agent/tasks/${task.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { message: drafts[task.id] ?? task.message } : {})
      });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo completar.'));
      const updated = (await res.json()).task;
      if (action === 'reject') toast('Mensaje descartado');
      else if (updated.status === 'sent') toast(`Mensaje enviado a ${updated.customer_name || 'el cliente'}`);
      else if (updated.status === 'approved') toast('Aprobado: se enviará al terminar el horario de silencio');
      else toast(updated.error || 'No se pudo enviar', true);
      setTasks(ts => ts.filter(t => t.id !== task.id));
      onChanged();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(null);
    }
  };

  const scan = async () => {
    setScanning(true);
    const res = await api('/api/agent/scan', { method: 'POST' });
    setScanning(false);
    if (!res.ok) return toast('No se pudo revisar', true);
    const r = (await res.json()).result;
    toast(r.created ? `${r.created} oportunidad(es) nueva(s)` : 'Sin oportunidades nuevas por ahora');
    load();
    onChanged();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <Header title="Aprobaciones" description="Mensajes que el agente quiere enviar por iniciativa propia y acciones que pidió hacer en un chat. Revísalos y apruébalos o descártalos.">
        <button onClick={scan} disabled={scanning} className={btn}><RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> Buscar oportunidades</button>
      </Header>
      {quietNow && (
        <p className="flex items-center gap-2 text-[13px] text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-md px-3 py-2">
          <MoonStar size={14} /> Horario de silencio: lo que apruebes ahora se enviará al iniciar el horario permitido.
        </p>
      )}
      {tasks.length === 0 ? (
        <div className="p-10 text-center bg-[#171717] border border-[#2e2e2e] rounded-md">
          <Bot size={22} className="mx-auto text-zinc-500" />
          <p className="mt-2 text-[13px] text-zinc-300">No hay mensajes por aprobar.</p>
          <p className="text-[12px] text-zinc-500">Activa automatizaciones para que el agente busque oportunidades cada 5 minutos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(t => (
            <div key={t.id} className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <button onClick={() => t.customer_id && onOpenCustomer(t.customer_id)} className="text-[14px] font-medium text-zinc-100 hover:underline">
                    {t.customer_name || `+${t.session_id}`}
                  </button>
                  <p className="text-[12px] text-zinc-500">{t.playbook_name} · {t.reason}</p>
                </div>
                <span className="text-[12px] text-zinc-500">{when(t.created_at)}</span>
              </div>
              {t.kind === 'action' ? (
                <p className="text-[13px] text-zinc-200 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2">{t.message}</p>
              ) : (
              <textarea
                rows={3}
                value={drafts[t.id] ?? t.message ?? ''}
                onChange={e => setDrafts({ ...drafts, [t.id]: e.target.value })}
                className={`${inputClass} w-full leading-relaxed`}
                aria-label="Mensaje a enviar"
              />
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => decide(t, 'reject')} disabled={busy === t.id} className={btn}><X size={13} /> Descartar</button>
                <button
                  onClick={() => decide(t, 'approve')}
                  disabled={busy === t.id || !(drafts[t.id] ?? t.message ?? '').trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-black disabled:opacity-50"
                  style={{ backgroundColor: themeColor }}
                >
                  <Send size={13} /> {t.kind === 'action' ? 'Aprobar y ejecutar' : 'Aprobar y enviar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==============================================================
// AUTOMATIZACIONES Y LÍMITES
// ==============================================================
function Specialists({ api, toast, themeColor }) {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  useEffect(() => {
    (async () => {
      const res = await api('/api/agent/specialists');
      if (res.ok) setData(await res.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return null;

  const setGlobal = async (enabled) => {
    const res = await api('/api/agent/specialists', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (!res.ok) return toast('No se pudo guardar', true);
    setData(await res.json());
    toast(enabled ? 'Áreas especializadas activadas' : 'Un solo agente para todo');
  };
  const save = async (key, body, msg) => {
    const res = await api(`/api/agent/specialists/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    const agent = (await res.json()).agent;
    setData(d => ({ ...d, agents: d.agents.map(a => (a.key === key ? agent : a)) }));
    toast(msg);
  };

  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-medium text-zinc-100">Áreas especializadas</h2>
          <p className="text-[13px] text-zinc-400 mt-0.5 max-w-2xl">Cada mensaje lo atiende el área que corresponde: Recepción, Ventas y pedidos o Soporte y reclamos. Cada área tiene su rol y solo las acciones que necesita, y pueden pasarse el chat entre ellas.</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0" title={data.enabled ? 'Desactivar' : 'Activar'}>
          <input type="checkbox" className="sr-only" checked={data.enabled} onChange={e => setGlobal(e.target.checked)} />
          <span className="w-9 h-5 rounded-full bg-[#3a3a3a] transition-colors" style={data.enabled ? { backgroundColor: themeColor } : undefined} />
          <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${data.enabled ? 'translate-x-4' : ''}`} />
        </label>
      </div>
      {data.enabled && (
        <ul className="divide-y divide-[#242424]">
          {data.agents.map(a => (
            <li key={a.key} className="py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] text-zinc-100">{a.name}</p>
                  <p className="text-[12px] text-zinc-500">{a.description}</p>
                </div>
                {a.locked ? (
                  <span className="text-[12px] text-zinc-500 shrink-0">Siempre activa</span>
                ) : (
                  <button onClick={() => save(a.key, { enabled: !a.enabled }, a.enabled ? 'Área desactivada' : 'Área activada')} className={`${btn} shrink-0`}>
                    {a.enabled ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </div>
              {a.enabled && (
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={drafts[a.key] ?? a.instructions}
                    onChange={e => setDrafts({ ...drafts, [a.key]: e.target.value })}
                    placeholder={`Indicaciones para ${a.name.toLowerCase()} (opcional). Ej: ${a.key === 'soporte' ? 'si el pedido llegó frío, ofrece reponerlo con aprobación' : a.key === 'ventas' ? 'ofrece siempre el combo del día' : 'responde en máximo dos líneas'}`}
                    className={`${inputClass} flex-1 leading-relaxed`}
                  />
                  {(drafts[a.key] ?? a.instructions) !== a.instructions && (
                    <button onClick={() => save(a.key, { instructions: drafts[a.key] }, 'Indicaciones guardadas')} className={`${btn} self-start`}>Guardar</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolPolicies({ api, toast }) {
  const [tools, setTools] = useState([]);
  useEffect(() => {
    (async () => {
      const res = await api('/api/agent/tool-policies');
      if (res.ok) setTools((await res.json()).tools || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = async (name, policy) => {
    const res = await api(`/api/agent/tool-policies/${name}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy })
    });
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    setTools((await res.json()).tools || []);
    toast('Regla actualizada');
  };
  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
      <div>
        <h2 className="text-[14px] font-medium text-zinc-100">Acciones del agente en el chat</h2>
        <p className="text-[13px] text-zinc-400 mt-0.5">Decide qué puede hacer solo y qué necesita tu aprobación. Lo que pida aprobación llega a «Aprobaciones» y el agente le dice al cliente que en breve se lo confirman.</p>
      </div>
      <ul className="divide-y divide-[#242424]">
        {tools.map(t => (
          <li key={t.name} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] text-zinc-100">{t.label}</p>
              <p className="text-[12px] text-zinc-500 truncate max-w-xl" title={t.description}>{t.description}</p>
            </div>
            {t.locked ? (
              <span className="text-[12px] text-zinc-500 shrink-0">Siempre activa</span>
            ) : (
              <div className="flex p-0.5 bg-[#121212] border border-[#2e2e2e] rounded-md text-[12px] shrink-0">
                {[['auto', 'Automática'], ['approve', 'Con aprobación'], ['off', 'Apagada']].map(([p, label]) => (
                  <button key={p} onClick={() => p !== t.policy && change(t.name, p)}
                    className={`px-2.5 py-1 rounded ${t.policy === p ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Automations({ api, toast, themeColor }) {
  const [playbooks, setPlaybooks] = useState([]);
  const [guard, setGuard] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await api('/api/agent/playbooks');
    if (!res.ok) return;
    const d = await res.json();
    setPlaybooks(d.playbooks);
    setGuard(d.guardrails);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const update = async (key, body, okMsg) => {
    const res = await api(`/api/agent/playbooks/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    const pb = (await res.json()).playbook;
    setPlaybooks(list => list.map(p => (p.key === key ? pb : p)));
    if (okMsg) toast(okMsg);
  };

  const saveGuard = async (e) => {
    e.preventDefault();
    setSaving(true);
    const res = await api('/api/agent/guardrails', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...guard, min_days_between: Number(guard.min_days_between) })
    });
    setSaving(false);
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    setGuard((await res.json()).guardrails);
    toast('Límites guardados');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <Header title="Automatizaciones" description="Elige en qué situaciones el agente escribe por iniciativa propia y si necesita tu aprobación antes de enviar." />

      <div className="space-y-3">
        {playbooks.map(p => (
          <div key={p.key} className={`p-4 bg-[#171717] border border-[#2e2e2e] rounded-md ${p.available ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[14px] font-medium text-zinc-100">{p.name}</h2>
                <p className="text-[13px] text-zinc-400 mt-0.5 max-w-2xl">{p.description}</p>
                {!p.available && <p className="text-[12px] text-amber-300 mt-1">Necesita el módulo «{p.requires}» instalado.</p>}
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0" title={p.enabled ? 'Desactivar' : 'Activar'}>
                <input type="checkbox" className="sr-only peer" checked={p.enabled} disabled={!p.available}
                  onChange={e => update(p.key, { enabled: e.target.checked }, e.target.checked ? 'Automatización activada' : 'Automatización desactivada')} />
                <span className="w-9 h-5 rounded-full bg-[#3a3a3a] transition-colors" style={p.enabled ? { backgroundColor: themeColor } : undefined} />
                <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${p.enabled ? 'translate-x-4' : ''}`} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <span className="block text-[12px] text-zinc-400">Envío</span>
                <div className="flex p-0.5 bg-[#121212] border border-[#2e2e2e] rounded-md text-[12px]">
                  {[['approve', 'Pedir mi aprobación'], ['auto', 'Automático']].map(([mode, label]) => (
                    <button key={mode} onClick={() => update(p.key, { mode }, 'Modo actualizado')}
                      className={`px-2.5 py-1 rounded ${p.mode === mode ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {Object.entries(p.params).map(([k, v]) => (
                <label key={k} className="space-y-1">
                  <span className="block text-[12px] text-zinc-400">{PARAM_LABELS[k]?.[0] || k}</span>
                  <span className="flex items-center gap-1.5">
                    <input type="number" min="1" max="365" defaultValue={v} className={`${inputClass} w-20 py-1`}
                      onBlur={e => Number(e.target.value) !== v && update(p.key, { params: { [k]: Number(e.target.value) } }, 'Guardado')} />
                    <span className="text-[12px] text-zinc-500">{PARAM_LABELS[k]?.[1]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Specialists api={api} toast={toast} themeColor={themeColor} />

      <ToolPolicies api={api} toast={toast} />

      {guard && (
        <form onSubmit={saveGuard} className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium text-zinc-100"><ShieldCheck size={15} /> Límites de seguridad</h2>
          <div className="flex flex-wrap gap-4">
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">No escribir desde</span>
              <input type="time" className={inputClass} value={guard.quiet_start} onChange={e => setGuard({ ...guard, quiet_start: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">hasta</span>
              <input type="time" className={inputClass} value={guard.quiet_end} onChange={e => setGuard({ ...guard, quiet_end: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">Máximo un mensaje por cliente cada</span>
              <span className="flex items-center gap-1.5">
                <input type="number" min="1" max="90" className={`${inputClass} w-20`} value={guard.min_days_between} onChange={e => setGuard({ ...guard, min_days_between: e.target.value })} />
                <span className="text-[12px] text-zinc-500">días</span>
              </span>
            </label>
            <button type="submit" disabled={saving} className={`${btn} self-end`}>Guardar límites</button>
          </div>
          <ul className="text-[12px] text-zinc-500 space-y-0.5">
            <li>• Nunca se escribe a clientes que pidieron no recibir mensajes (etiqueta «no-contactar», se pone sola si lo piden en el chat).</li>
            <li>• Nunca se escribe a un chat que está atendiendo un asesor, ni por canales que no sean WhatsApp.</li>
            <li>• Con Meta Cloud API, fuera de las 24 h desde el último mensaje del cliente el envío falla y queda registrado.</li>
          </ul>
        </form>
      )}
    </div>
  );
}

// ==============================================================
// HISTORIAL
// ==============================================================
function History({ api, onOpenCustomer }) {
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({});
  const [filter, setFilter] = useState('');
  useEffect(() => {
    (async () => {
      const res = await api(`/api/agent/tasks?limit=300${filter ? `&status=${filter}` : ''}`);
      if (!res.ok) return;
      const d = await res.json();
      setTasks(d.tasks || []);
      setCounts(d.counts || {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <Header title="Historial del agente" description="Todo lo que el agente intentó hacer por iniciativa propia, con su resultado." />
      <div className="flex flex-wrap gap-2">
        {[['', 'Todos'], ...Object.entries(STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => (
          <button key={k || 'all'} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-md text-[13px] border ${filter === k ? 'bg-[#2e2e2e] border-[#3e3e3e] text-zinc-100' : 'bg-[#171717] border-[#2e2e2e] text-zinc-400 hover:text-zinc-200'}`}>
            {l} {k && <span className="text-zinc-500 tabular-nums">{counts[k] || 0}</span>}
          </button>
        ))}
      </div>
      <div className="bg-[#171717] border border-[#2e2e2e] rounded-md overflow-x-auto">
        <table className="w-full text-[13px] min-w-[760px]">
          <thead className="text-zinc-500 border-b border-[#2e2e2e]">
            <tr>
              <th className="text-left font-normal px-4 py-2.5">Cliente</th>
              <th className="text-left font-normal px-4 py-2.5">Automatización</th>
              <th className="text-left font-normal px-4 py-2.5">Mensaje</th>
              <th className="text-left font-normal px-4 py-2.5">Estado</th>
              <th className="text-right font-normal px-4 py-2.5">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#242424]">
            {tasks.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">Sin actividad todavía.</td></tr>}
            {tasks.map(t => (
              <tr key={t.id}>
                <td className="px-4 py-2.5">
                  <button onClick={() => t.customer_id && onOpenCustomer(t.customer_id)} className="text-zinc-100 hover:underline text-left">
                    {t.customer_name || `+${t.session_id}`}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{t.playbook_name}</td>
                <td className="px-4 py-2.5 text-zinc-300 max-w-[340px]">
                  <p className="truncate" title={t.message}>{t.message || '—'}</p>
                  {t.error && <p className="text-[12px] text-rose-300 truncate" title={t.error}>{t.error}</p>}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={t.status} />
                  {t.decided_by && <span className="block text-[11px] text-zinc-500 mt-0.5">por {t.decided_by}</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> {when(t.sent_at || t.decided_at || t.created_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==============================================================
// MÉTRICAS
// ==============================================================
const AREA_NAMES = { recepcion: 'Recepción', ventas: 'Ventas y pedidos', soporte: 'Soporte y reclamos', general: 'Agente único' };
const TOOL_NAMES = {
  crear_pedido: 'Crear pedido', consultar_pedido: 'Consultar pedido', cancelar_pedido: 'Cancelar pedido',
  guardar_dato_cliente: 'Guardar dato del cliente', transferir_a_asesor: 'Transferir a asesor', derivar_a_area: 'Derivar a otra área'
};
const usd = (v, d = 2) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(d)}`);
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(0)}%`);

function Kpi({ label, value, hint, change }) {
  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
      <p className="text-[12px] text-zinc-400">{label}</p>
      <p className="text-2xl font-medium text-zinc-100 mt-1 tabular-nums">{value}</p>
      {change !== undefined && change !== null && (
        <p className={`text-[12px] mt-0.5 ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{change > 0 ? '+' : ''}{change}% vs. período anterior</p>
      )}
      {hint && <p className="text-[12px] text-zinc-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function Metrics({ api, toast, themeColor }) {
  const [days, setDays] = useState(7);
  const [m, setM] = useState(null);
  const [prices, setPrices] = useState(null);
  const [report, setReport] = useState(null);
  const [priceForm, setPriceForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api(`/api/agent/metrics?days=${days}`);
      if (res.ok) setM(await res.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([api('/api/agent/prices'), api('/api/agent/weekly-report')]);
      if (p.ok) {
        const d = await p.json();
        setPrices(d);
        const cur = d.prices[d.active_model] || { input: 0, output: 0, cached: 0 };
        setPriceForm({ model: d.active_model, ...cur });
      }
      if (r.ok) setReport(await r.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePrice = async (e) => {
    e.preventDefault();
    const res = await api('/api/agent/prices', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...priceForm, input: Number(priceForm.input), output: Number(priceForm.output), cached: Number(priceForm.cached) })
    });
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    setPrices(p => ({ ...p, ...(res.ok ? {} : {}) }));
    toast('Precio guardado');
    const again = await api(`/api/agent/metrics?days=${days}`);
    if (again.ok) setM(await again.json());
  };

  const saveReport = async (patch) => {
    const res = await api('/api/agent/weekly-report', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) return toast(await errorText(res, 'No se pudo guardar.'), true);
    setReport(await res.json());
  };

  const sendNow = async () => {
    setBusy(true);
    const res = await api('/api/agent/weekly-report/send', { method: 'POST' });
    setBusy(false);
    if (!res.ok) return toast(await errorText(res, 'No se pudo enviar.'), true);
    toast('Reporte enviado a tu WhatsApp');
  };

  const maxDay = m ? Math.max(1, ...m.daily.map(d => d.conversations)) : 1;

  return (
    <div className="space-y-6 animate-fadeIn">
      <Header title="Métricas del agente" description="Qué logró el agente, cuánto tardó y cuánto costó.">
        <div className="flex p-0.5 bg-[#171717] border border-[#2e2e2e] rounded-md text-[13px]">
          {[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([d, label]) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1 rounded ${days === d ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>{label}</button>
          ))}
        </div>
      </Header>

      {!m ? <p className="text-[13px] text-zinc-500">Cargando…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Conversaciones" value={m.conversations} change={m.conversations_change_pct} hint={`${m.new_customers} clientes nuevos`} />
            <Kpi label="Respondido por la IA" value={pct(m.automation_rate)} hint={`${m.ai_replies} de ${m.ai_replies + m.human_replies} respuestas`} />
            <Kpi label="Pasó a un asesor" value={pct(m.handoff_rate)} hint={`${m.handoffs} conversaciones`} />
            <Kpi label="Tiempo de respuesta" value={m.latency_ms.p50 !== null ? `${(m.latency_ms.p50 / 1000).toFixed(1)} s` : '—'} hint={m.latency_ms.p90 !== null ? `9 de cada 10 en menos de ${(m.latency_ms.p90 / 1000).toFixed(1)} s` : 'Sin datos aún'} />
            {m.orders && <Kpi label="Ventas cerradas por el agente" value={usd(m.orders.revenue)} change={m.orders_change_pct} hint={`${m.orders.by_agent} pedidos · ${pct(m.orders.share)} del total`} />}
            {m.proactive && <Kpi label="Mensajes proactivos" value={m.proactive.sent} hint={m.proactive.sent ? `${m.proactive.replied} respondieron (${pct(m.proactive.reply_rate)})` : 'Ninguno enviado'} />}
            <Kpi label="Costo estimado de IA" value={usd(m.cost, m.cost < 1 ? 4 : 2)} hint={m.cost_per_conversation !== null ? `${usd(m.cost_per_conversation, 4)} por conversación` : undefined} />
            <Kpi label="Ahorro por caché" value={pct(m.tokens.cache_rate)} hint={`${m.tokens.cached.toLocaleString()} de ${m.tokens.input.toLocaleString()} tokens de entrada`} />
          </div>

          {m.unpriced_models.length > 0 && (
            <p className="text-[13px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              Sin precio configurado para: {m.unpriced_models.join(', ')}. El costo de esas respuestas no se está sumando.
            </p>
          )}
          {(m.errors > 0 || m.fallbacks > 0) && (
            <p className="text-[13px] text-zinc-400">
              {m.errors > 0 && <span className="text-rose-300">{m.errors} llamadas fallidas al proveedor de IA. </span>}
              {m.fallbacks > 0 && <span>{m.fallbacks} respuestas se generaron con el proveedor de respaldo.</span>}
            </p>
          )}

          <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
            <h2 className="text-[13px] font-medium text-zinc-100 mb-3">Conversaciones por día</h2>
            <div className="flex items-end gap-1 h-32" role="img" aria-label="Conversaciones por día">
              {m.daily.map(d => (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.day}: ${d.conversations} conversaciones · ${usd(d.cost, 4)}`}>
                  <div className="w-full rounded-t" style={{ height: `${(d.conversations / maxDay) * 100}%`, minHeight: d.conversations ? 4 : 1, backgroundColor: d.conversations ? themeColor : '#2e2e2e' }} />
                  {m.daily.length <= 14 && <span className="text-[10px] text-zinc-500">{d.day.slice(8)}</span>}
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <h2 className="text-[13px] font-medium text-zinc-100 mb-2">Por área</h2>
              {m.by_agent.length === 0 ? <p className="text-[13px] text-zinc-500">Sin respuestas registradas en el período.</p> : (
                <table className="w-full text-[13px]">
                  <thead className="text-zinc-500"><tr><th className="text-left font-normal py-1">Área</th><th className="text-right font-normal">Respuestas</th><th className="text-right font-normal">Acciones</th><th className="text-right font-normal">Costo</th></tr></thead>
                  <tbody className="divide-y divide-[#242424]">
                    {m.by_agent.map(a => (
                      <tr key={a.agent}><td className="py-1.5 text-zinc-200">{AREA_NAMES[a.agent] || a.agent}</td><td className="text-right tabular-nums text-zinc-300">{a.replies}</td><td className="text-right tabular-nums text-zinc-300">{a.tools}</td><td className="text-right tabular-nums text-zinc-300">{usd(a.cost, 4)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <h2 className="text-[13px] font-medium text-zinc-100 mb-2">Acciones que más usó</h2>
              {m.tools.length === 0 ? <p className="text-[13px] text-zinc-500">Sin acciones en el período.</p> : (
                <ul className="space-y-1.5">
                  {m.tools.map(t => (
                    <li key={t.tool} className="flex justify-between text-[13px]"><span className="text-zinc-300">{TOOL_NAMES[t.tool] || t.tool}</span><span className="tabular-nums text-zinc-400">{t.count}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {report && (
        <section className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[14px] font-medium text-zinc-100">Reporte semanal por WhatsApp</h2>
              <p className="text-[13px] text-zinc-400 mt-0.5">Cada semana te llega un resumen de lo que hizo el agente, para que veas el resultado sin entrar al panel.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input type="checkbox" className="sr-only" checked={report.config.enabled} onChange={e => saveReport({ enabled: e.target.checked })} />
              <span className="w-9 h-5 rounded-full bg-[#3a3a3a]" style={report.config.enabled ? { backgroundColor: themeColor } : undefined} />
              <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${report.config.enabled ? 'translate-x-4' : ''}`} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">Enviar al WhatsApp</span>
              <input className={`${inputClass} w-44`} defaultValue={report.config.phone} placeholder="50370000000" onBlur={e => e.target.value !== report.config.phone && saveReport({ phone: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">Día</span>
              <select className={inputClass} value={report.config.weekday} onChange={e => saveReport({ weekday: Number(e.target.value) })}>
                {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">Hora</span>
              <select className={inputClass} value={report.config.hour} onChange={e => saveReport({ hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <button onClick={sendNow} disabled={busy || !report.config.phone} className={btn}><Send size={13} /> Enviarme uno ahora</button>
          </div>
          <pre className="text-[12px] text-zinc-300 bg-[#121212] border border-[#2e2e2e] rounded-md p-3 whitespace-pre-wrap font-sans">{report.preview}</pre>
        </section>
      )}

      {priceForm && (
        <form onSubmit={savePrice} className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
          <div>
            <h2 className="text-[14px] font-medium text-zinc-100">Precios para el costo estimado</h2>
            <p className="text-[13px] text-zinc-400 mt-0.5">USD por millón de tokens. Los valores de fábrica son de referencia: verifica los precios vigentes de tu proveedor.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[12px] text-zinc-400">Modelo</span>
              <select className={inputClass} value={priceForm.model} onChange={e => setPriceForm({ model: e.target.value, ...(prices.prices[e.target.value] || { input: 0, output: 0, cached: 0 }) })}>
                {[...new Set([prices.active_model, ...Object.keys(prices.prices)])].map(k => <option key={k} value={k}>{k}{k === prices.active_model ? ' (en uso)' : ''}</option>)}
              </select>
            </label>
            {[['input', 'Entrada'], ['cached', 'Entrada en caché'], ['output', 'Salida']].map(([k, label]) => (
              <label key={k} className="space-y-1">
                <span className="block text-[12px] text-zinc-400">{label}</span>
                <input type="number" step="0.001" min="0" className={`${inputClass} w-28`} value={priceForm[k]} onChange={e => setPriceForm({ ...priceForm, [k]: e.target.value })} />
              </label>
            ))}
            <button type="submit" className={btn}>Guardar precio</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function AgentPanel({ apiFetch, apiBase, themeColor, showToast, subTab, onOpenCustomer, onChanged }) {
  const api = (path, opts) => apiFetch(`${apiBase}${path}`, opts);
  const toast = (msg, isErr = false) => showToast?.(msg, isErr);
  if (subTab === 'automations') return <Automations api={api} toast={toast} themeColor={themeColor} />;
  if (subTab === 'history') return <History api={api} onOpenCustomer={onOpenCustomer} />;
  if (subTab === 'metrics') return <Metrics api={api} toast={toast} themeColor={themeColor} />;
  return <Approvals api={api} toast={toast} themeColor={themeColor} onOpenCustomer={onOpenCustomer} onChanged={onChanged} />;
}

