import React, { useEffect, useRef, useState } from 'react';
import { Bot, Hand, Search, Send, UserRound, Undo2 } from 'lucide-react';

const POLL_MS = 5000;
const inputClass = 'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 transition-colors disabled:opacity-50';

const shortTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};
const phoneLabel = (p, channel) => (p && /^503\d{8}$/.test(p) ? `+503 ${p.slice(3, 7)}-${p.slice(7)}` : p ? `+${p}` : channel === 'whatsapp' ? 'WhatsApp' : 'Chat web');
const errorText = async (res, fallback) => {
  const d = await res.json().catch(() => ({}));
  return Array.isArray(d.detail) ? d.detail.map(x => x.msg).join(' · ') : d.detail || fallback;
};

function ConversationList({ api, selectedId, onSelect }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await api(`/api/inbox?${new URLSearchParams({ search, only })}`);
      if (res.ok && alive) setItems((await res.json()).conversations || []);
    };
    const t = setTimeout(load, search ? 250 : 0);
    const iv = setInterval(load, POLL_MS);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, only]);

  return (
    <div className="flex flex-col min-h-0 border-r border-[#2e2e2e]">
      <div className="p-3 space-y-2 border-b border-[#2e2e2e]">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input className={`${inputClass} pl-8 py-1.5`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar chat…" />
        </div>
        <div className="flex p-0.5 bg-[#121212] border border-[#2e2e2e] rounded-md text-[12px]">
          {[['', 'Todos'], ['human', 'Con asesor']].map(([id, label]) => (
            <button key={id || 'all'} onClick={() => setOnly(id)}
              className={`flex-1 py-1 rounded ${only === id ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-[#222]">
        {items.length === 0 && <li className="p-6 text-center text-[13px] text-zinc-500">Sin conversaciones.</li>}
        {items.map(c => (
          <li key={c.id}>
            <button onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-[#1c1c1c] ${String(selectedId) === String(c.id) ? 'bg-[#232323]' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] flex items-center justify-center text-[12px] text-zinc-200 shrink-0">
                {(c.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-zinc-100 truncate">{c.name || phoneLabel(c.phone, c.channel)}</span>
                  <span className="text-[11px] text-zinc-500 shrink-0">{shortTime(c.last_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.human
                    ? <Hand size={11} className="text-amber-400 shrink-0" aria-label="Con asesor" />
                    : <Bot size={11} className="text-zinc-500 shrink-0" aria-label="Atiende la IA" />}
                  <span className={`text-[12px] truncate ${c.last_role === 'user' ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    {c.last_role !== 'user' && (c.last_role === 'human' ? 'Asesor: ' : 'IA: ')}{c.last_message}
                  </span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Conversation({ api, customerId, toast, themeColor, onOpenCustomer }) {
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [human, setHuman] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const lastIdRef = useRef(null);

  const load = async (initial = false) => {
    const [c, m, inbox] = await Promise.all([
      initial ? api(`/api/customers/${customerId}`) : null,
      api(`/api/customers/${customerId}/messages?limit=100`),
      api(`/api/inbox?limit=200`)
    ]);
    if (c?.ok) setCustomer((await c.json()).customer);
    if (m.ok) {
      const list = (await m.json()).messages || [];
      setMessages(list);
      const last = list[list.length - 1]?.id;
      if (last !== lastIdRef.current) {
        lastIdRef.current = last;
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: initial ? 'auto' : 'smooth' }), 0);
      }
    }
    if (inbox.ok) {
      const row = ((await inbox.json()).conversations || []).find(x => String(x.id) === String(customerId));
      if (row) setHuman(row.human);
    }
  };

  useEffect(() => {
    setCustomer(null); setMessages([]); lastIdRef.current = null;
    load(true);
    const iv = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await api(`/api/customers/${customerId}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() })
      });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo enviar.'));
      setHuman((await res.json()).human);
      setText('');
      load(false);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSending(false);
    }
  };

  const toggleControl = async () => {
    const res = await api(`/api/customers/${customerId}/takeover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !human })
    });
    if (!res.ok) return toast('No se pudo cambiar quién atiende', true);
    const now = (await res.json()).human;
    setHuman(now);
    toast(now ? 'Tomaste el control: la IA no responderá en este chat' : 'La IA vuelve a atender este chat');
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-[#2e2e2e] flex items-center justify-between gap-3">
        <button onClick={() => onOpenCustomer(customerId)} className="text-left min-w-0">
          <p className="text-[14px] font-medium text-zinc-100 truncate hover:underline">{customer?.name || phoneLabel(customer?.phone, customer?.channel)}</p>
          <p className="text-[12px] text-zinc-500 truncate">{customer?.stage_label}{customer?.summary ? ` · ${customer.summary}` : ''}</p>
        </button>
        <button onClick={toggleControl} className={btn} title={human ? 'Devolver a la IA' : 'Tomar el control'}>
          {human ? <><Undo2 size={13} /> Devolver a la IA</> : <><Hand size={13} /> Tomar el control</>}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map(m => {
          if (m.role === 'action') {
            return (
              <div key={m.id} className="flex justify-center">
                <span className="px-2.5 py-1 rounded-full bg-[#1f1f1f] border border-[#2e2e2e] text-[11px] text-zinc-400">{m.content}</span>
              </div>
            );
          }
          const mine = m.role !== 'user';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${mine ? 'rounded-br-sm text-zinc-100' : 'rounded-bl-sm bg-[#232323] text-zinc-200'}`}
                style={mine ? { backgroundColor: m.role === 'human' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(var(--theme-primary-rgb), 0.16)' } : undefined}>
                {mine && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400 mb-0.5">
                    {m.role === 'human' ? <><UserRound size={10} /> Asesor</> : <><Bot size={10} /> IA</>}
                  </span>
                )}
                {m.content}
                <span className="block mt-1 text-[10px] text-zinc-500 text-right">{shortTime(m.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="p-3 border-t border-[#2e2e2e] space-y-1.5">
        {!human && <p className="text-[11px] text-zinc-500">Al responder tomas el control: la IA deja de contestar en este chat hasta que la devuelvas.</p>}
        <div className="flex gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
            placeholder="Escribe una respuesta… (Enter para enviar)"
            className={`${inputClass} resize-none`}
          />
          <button type="submit" disabled={sending || !text.trim()} className="px-3 rounded-md text-black disabled:opacity-40" style={{ backgroundColor: themeColor }} aria-label="Enviar">
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}

export default function InboxPanel({ apiFetch, apiBase, themeColor, showToast, conversationId, onSelect, onOpenCustomer }) {
  const api = (path, opts) => apiFetch(`${apiBase}${path}`, opts);
  const toast = (msg, isErr = false) => showToast?.(msg, isErr);
  return (
    <div className="space-y-4 animate-fadeIn">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-zinc-100">Bandeja</h1>
        <p className="text-sm text-zinc-400 mt-1">Todas las conversaciones en vivo, con lo que hizo el agente. Toma el control cuando quieras.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] h-[calc(100vh-200px)] min-h-[480px] bg-[#171717] border border-[#2e2e2e] rounded-md overflow-hidden">
        <ConversationList api={api} selectedId={conversationId} onSelect={onSelect} />
        {conversationId ? (
          <Conversation api={api} customerId={conversationId} toast={toast} themeColor={themeColor} onOpenCustomer={onOpenCustomer} />
        ) : (
          <div className="hidden md:flex items-center justify-center text-[13px] text-zinc-500">Elige una conversación.</div>
        )}
      </div>
    </div>
  );
}
