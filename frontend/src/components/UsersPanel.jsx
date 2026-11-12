import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  Users,
  Mail,
  MessageCircle,
  Link2,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  AlertCircle,
  X,
  Power,
  Clock
} from 'lucide-react';

const ROLE_TONES = {
  owner: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
  admin: 'text-violet-300 bg-violet-500/10 border-violet-500/25',
  supervisor: 'text-sky-300 bg-sky-500/10 border-sky-500/25',
  agent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  viewer: 'text-zinc-300 bg-zinc-800 border-zinc-700'
};

const CHANNEL_LABELS = { whatsapp: 'WhatsApp', email: 'Correo', link: 'Enlace' };

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
};

function RoleBadge({ role, label }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-medium border rounded-full px-2 py-0.5 ${ROLE_TONES[role] || ROLE_TONES.viewer}`}>
      {label || role}
    </span>
  );
}

function CopyButton({ text, label = 'Copiar enlace' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-white border border-[#2e2e2e] rounded-md px-2 py-1"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      {copied ? 'Copiado' : label}
    </button>
  );
}

/**
 * Usuarios de la empresa: invitar por WhatsApp, correo o enlace, asignar roles, desactivar y eliminar.
 * Solo lo ven el propietario (contraseña de la empresa) y los administradores.
 */
export default function UsersPanel({ apiFetch, apiBase, themeColor = '#3ecf8e', showToast, currentUserId }) {
  const [data, setData] = useState({ users: [], invitations: [], roles: [], channels: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'agent', channel: 'auto' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // resultado del último envío (enlace + canal)

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${apiBase}/api/users`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'No se pudo cargar la lista de usuarios.');
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, apiBase]);

  useEffect(() => { load(); }, [load]);

  const channels = data.channels || {};
  const roles = data.roles || [];

  const call = async (url, options, okMessage) => {
    const res = await apiFetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast?.(body.detail || 'No se pudo completar la acción.', true);
      return null;
    }
    if (okMessage) showToast?.(okMessage);
    return body;
  };

  const handleResult = (body) => {
    setResult(body);
    if (body.sent_via === 'whatsapp') showToast?.('Invitación enviada por WhatsApp.');
    else if (body.sent_via === 'email') showToast?.('Invitación enviada por correo.');
    else if (body.sent_via === 'link') showToast?.('Invitación creada. Comparte el enlace.');
    else showToast?.('No se pudo enviar automáticamente; comparte el enlace.', true);
  };

  const submitInvite = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const body = await call(`${apiBase}/api/users/invitations`, { method: 'POST', body: JSON.stringify(form) });
      if (body) {
        handleResult(body);
        setForm({ name: '', email: '', phone: '', role: form.role, channel: 'auto' });
        setShowInvite(false);
        load();
      }
    } finally {
      setSending(false);
    }
  };

  const resend = async (inv, channel = 'auto') => {
    const body = await call(`${apiBase}/api/users/invitations/${inv.id}/resend`, {
      method: 'POST', body: JSON.stringify({ channel })
    });
    if (body) { handleResult(body); load(); }
  };

  const revoke = async (inv) => {
    if (!window.confirm(`¿Cancelar la invitación de ${inv.name || inv.email || inv.phone}? El enlace dejará de funcionar.`)) return;
    if (await call(`${apiBase}/api/users/invitations/${inv.id}`, { method: 'DELETE' }, 'Invitación cancelada.')) load();
  };

  const updateUser = async (user, patch, msg) => {
    if (await call(`${apiBase}/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) }, msg)) load();
  };

  const removeUser = async (user) => {
    if (!window.confirm(`¿Eliminar a ${user.name || user.email}? Perderá el acceso de inmediato. Esta acción no se puede deshacer.`)) return;
    if (await call(`${apiBase}/api/users/${user.id}`, { method: 'DELETE' }, 'Usuario eliminado.')) load();
  };

  const hasContact = form.email.trim() || form.phone.trim();
  const channelWarning = (() => {
    if (form.channel === 'whatsapp' && !channels.whatsapp) return channels.whatsapp_detail || 'WhatsApp no está conectado.';
    if (form.channel === 'email' && !channels.email) return channels.email_detail || 'El correo no está configurado.';
    if (form.channel === 'whatsapp' && !form.phone.trim()) return 'Escribe el número de WhatsApp.';
    if (form.channel === 'email' && !form.email.trim()) return 'Escribe el correo.';
    return '';
  })();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium text-zinc-100 flex items-center gap-2"><Users size={20} /> Usuarios</h2>
          <p className="text-[13px] text-zinc-400 mt-1">
            Invita a tu equipo y define qué puede hacer cada persona. La invitación llega por WhatsApp, correo o un enlace que compartes tú.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-md border border-[#2e2e2e] text-zinc-400 hover:text-white" title="Actualizar" aria-label="Actualizar">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setShowInvite(true); setResult(null); }}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md text-sm font-medium text-black hover:brightness-110"
            style={{ backgroundColor: themeColor }}
          >
            <UserPlus size={15} /> Invitar usuario
          </button>
        </div>
      </div>

      {/* Canales disponibles */}
      {data.channels && (
        <div className="flex flex-wrap gap-2 text-[12px]">
          <span className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 ${channels.whatsapp ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10' : 'text-zinc-400 border-zinc-700 bg-zinc-900'}`}
            title={channels.whatsapp_detail || ''}>
            <MessageCircle size={12} /> WhatsApp {channels.whatsapp ? 'listo' : 'no disponible'}
          </span>
          <span className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 ${channels.email ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10' : 'text-zinc-400 border-zinc-700 bg-zinc-900'}`}
            title={channels.email_detail || ''}>
            <Mail size={12} /> Correo {channels.email ? 'listo' : 'no configurado'}
          </span>
          <span className="inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-zinc-300 border-zinc-700 bg-zinc-900">
            <Link2 size={12} /> Enlace siempre disponible
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Resultado del último envío */}
      {result && (
        <div className={`rounded-lg border px-4 py-3 text-[13px] space-y-2 ${result.sent_via ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/25 bg-amber-500/5'}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-zinc-200">
              {result.sent_via === 'whatsapp' && <>Invitación enviada por <b>WhatsApp</b> a {result.invitation.phone}.</>}
              {result.sent_via === 'email' && <>Invitación enviada por <b>correo</b> a {result.invitation.email}.</>}
              {result.sent_via === 'link' && <>Invitación creada. Comparte este enlace con la persona:</>}
              {!result.sent_via && <>No se pudo enviar automáticamente. Comparte este enlace con la persona:</>}
            </p>
            <button onClick={() => setResult(null)} className="text-zinc-500 hover:text-white" aria-label="Cerrar"><X size={14} /></button>
          </div>
          {result.error && <p className="text-amber-300 text-[12px]">{result.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-[12px] text-zinc-400 bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 break-all">{result.link}</code>
            <CopyButton text={result.link} />
          </div>
        </div>
      )}

      {/* Usuarios */}
      <section className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden">
        <header className="px-4 py-3 border-b border-[#2e2e2e] text-[13px] font-medium text-zinc-300">
          Miembros ({data.users.length})
        </header>
        {data.users.length === 0 && !loading ? (
          <p className="px-4 py-6 text-[13px] text-zinc-500">
            Aún no hay usuarios. Por ahora solo se entra con la contraseña de la empresa.
          </p>
        ) : (
          <ul className="divide-y divide-[#2e2e2e]">
            {data.users.map(u => {
              const isSelf = currentUserId && u.id === currentUserId;
              return (
                <li key={u.id} className={`px-4 py-3 flex flex-wrap items-center gap-3 ${u.active ? '' : 'opacity-60'}`}>
                  <div className="h-9 w-9 rounded-full bg-[#262626] flex items-center justify-center text-sm font-medium text-zinc-200 shrink-0">
                    {(u.name || u.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-100 truncate">
                      {u.name || '—'} {isSelf && <span className="text-[11px] text-zinc-500">(tú)</span>}
                      {!u.active && <span className="ml-2 text-[11px] text-rose-300">Desactivado</span>}
                    </p>
                    <p className="text-[12px] text-zinc-500 truncate">
                      {[u.email, u.phone && `+${u.phone}`].filter(Boolean).join(' · ')}
                      {' · '}Último acceso: {fmtDate(u.last_login_at)}
                    </p>
                  </div>
                  <select
                    value={u.role}
                    disabled={isSelf}
                    onChange={e => updateUser(u, { role: e.target.value }, 'Rol actualizado.')}
                    className="h-8 bg-[#121212] border border-[#2e2e2e] rounded-md px-2 text-[13px] text-zinc-200 disabled:opacity-50"
                    aria-label={`Rol de ${u.name || u.email}`}
                  >
                    {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <button
                    disabled={isSelf}
                    onClick={() => updateUser(u, { active: !u.active }, u.active ? 'Usuario desactivado.' : 'Usuario activado.')}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                    title={u.active ? 'Desactivar' : 'Activar'}
                    aria-label={u.active ? 'Desactivar' : 'Activar'}
                  >
                    <Power size={15} />
                  </button>
                  <button
                    disabled={isSelf}
                    onClick={() => removeUser(u)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-rose-300 disabled:opacity-30"
                    title="Eliminar"
                    aria-label="Eliminar"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Invitaciones pendientes */}
      <section className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden">
        <header className="px-4 py-3 border-b border-[#2e2e2e] text-[13px] font-medium text-zinc-300">
          Invitaciones pendientes ({data.invitations.length})
        </header>
        {data.invitations.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-zinc-500">No hay invitaciones pendientes.</p>
        ) : (
          <ul className="divide-y divide-[#2e2e2e]">
            {data.invitations.map(inv => (
              <li key={inv.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100 truncate flex items-center gap-2">
                    {inv.name || inv.email || `+${inv.phone}`} <RoleBadge role={inv.role} label={inv.role_label} />
                  </p>
                  <p className="text-[12px] text-zinc-500 truncate flex items-center gap-1">
                    {[inv.email, inv.phone && `+${inv.phone}`].filter(Boolean).join(' · ')}
                    {' · '}
                    {inv.status === 'expired'
                      ? <span className="text-amber-300">Vencida</span>
                      : <><Clock size={11} /> vence {fmtDate(inv.expires_at)}</>}
                    {inv.channel && <> · vía {CHANNEL_LABELS[inv.channel] || inv.channel}</>}
                  </p>
                  {inv.delivery_error && <p className="text-[12px] text-amber-300 mt-0.5">{inv.delivery_error}</p>}
                </div>
                {inv.phone && (
                  <button onClick={() => resend(inv, 'whatsapp')} disabled={!channels.whatsapp}
                    className="inline-flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-white border border-[#2e2e2e] rounded-md px-2 py-1 disabled:opacity-40"
                    title={channels.whatsapp ? 'Reenviar por WhatsApp' : channels.whatsapp_detail}>
                    <MessageCircle size={13} /> WhatsApp
                  </button>
                )}
                {inv.email && (
                  <button onClick={() => resend(inv, 'email')} disabled={!channels.email}
                    className="inline-flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-white border border-[#2e2e2e] rounded-md px-2 py-1 disabled:opacity-40"
                    title={channels.email ? 'Reenviar por correo' : channels.email_detail}>
                    <Mail size={13} /> Correo
                  </button>
                )}
                <button onClick={() => resend(inv, 'link')}
                  className="inline-flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-white border border-[#2e2e2e] rounded-md px-2 py-1"
                  title="Genera un enlace nuevo (el anterior deja de funcionar)">
                  <Link2 size={13} /> Nuevo enlace
                </button>
                <button onClick={() => revoke(inv)} className="p-1.5 rounded-md text-zinc-400 hover:text-rose-300" title="Cancelar invitación" aria-label="Cancelar invitación">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Roles */}
      {roles.length > 0 && (
        <section className="grid sm:grid-cols-2 gap-3">
          {roles.map(r => (
            <div key={r.id} className="bg-[#171717] border border-[#2e2e2e] rounded-lg px-4 py-3">
              <RoleBadge role={r.id} label={r.label} />
              <p className="text-[12px] text-zinc-400 mt-2">{r.description}</p>
            </div>
          ))}
        </section>
      )}

      {/* Modal invitar */}
      {showInvite && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowInvite(false)}>
          <form
            onSubmit={submitInvite}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md bg-[#171717] border border-[#2e2e2e] rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium text-zinc-100 flex items-center gap-2"><UserPlus size={17} /> Invitar usuario</h3>
              <button type="button" onClick={() => setShowInvite(false)} className="text-zinc-500 hover:text-white" aria-label="Cerrar"><X size={16} /></button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[13px] text-zinc-300">Nombre <span className="text-zinc-500">(opcional)</span></span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120}
                className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none" placeholder="Ana López" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-[13px] text-zinc-300">WhatsApp</span>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel"
                  className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none" placeholder="+503 7000 0000" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] text-zinc-300">Correo</span>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none" placeholder="ana@empresa.com" />
              </label>
            </div>
            <p className="text-[12px] text-zinc-500 -mt-2">Con uno basta. El WhatsApp debe llevar código de país.</p>

            <label className="block space-y-1.5">
              <span className="text-[13px] text-zinc-300">Rol</span>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-2 text-sm text-zinc-200">
                {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <span className="block text-[12px] text-zinc-500">{roles.find(r => r.id === form.role)?.description}</span>
            </label>

            <fieldset className="space-y-1.5">
              <legend className="text-[13px] text-zinc-300 mb-1.5">Enviar por</legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'auto', label: 'Automático', icon: RefreshCw },
                  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
                  { id: 'email', label: 'Correo', icon: Mail },
                  { id: 'link', label: 'Solo enlace', icon: Link2 }
                ].map(opt => {
                  const Icon = opt.icon;
                  const selected = form.channel === opt.id;
                  return (
                    <button type="button" key={opt.id} onClick={() => setForm({ ...form, channel: opt.id })}
                      className={`h-9 rounded-md border text-[12px] inline-flex items-center justify-center gap-1.5 ${selected ? 'text-white' : 'text-zinc-400 border-[#2e2e2e] hover:text-white'}`}
                      style={selected ? { borderColor: themeColor, backgroundColor: `${themeColor}1a` } : undefined}
                      aria-pressed={selected}>
                      <Icon size={13} /> {opt.label}
                    </button>
                  );
                })}
              </div>
              <span className="block text-[12px] text-zinc-500">
                {form.channel === 'auto' && 'WhatsApp si hay número y está conectado; si no, correo; si tampoco, te damos el enlace.'}
                {form.channel === 'link' && 'No se envía nada: copias el enlace y lo compartes tú.'}
              </span>
              {channelWarning && <span className="block text-[12px] text-amber-300">{channelWarning}</span>}
            </fieldset>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowInvite(false)} className="h-9 px-3 rounded-md text-sm text-zinc-300 hover:text-white">Cancelar</button>
              <button type="submit" disabled={sending || !hasContact}
                className="h-9 px-4 rounded-md text-sm font-medium text-black disabled:opacity-50 inline-flex items-center gap-2"
                style={{ backgroundColor: themeColor }}>
                {sending && <RefreshCw size={13} className="animate-spin" />} Enviar invitación
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
