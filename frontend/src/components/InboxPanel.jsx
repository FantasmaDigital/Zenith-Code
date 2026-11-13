import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Hand, Image as ImageIcon, Play, Search, Send, UserRound, Undo2, X } from 'lucide-react';
import { Avatar } from './CustomersPanel';

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
              <Avatar name={c.name} src={c.avatar_url} size="w-8 h-8 text-[12px]" />
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

/** Nota de voz del cliente: se descarga con la sesión del panel y se reproduce en un <audio>. */
function VoiceNote({ api, customerId, messageId }) {
  const [src, setSrc] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | error
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const load = async () => {
    setState('loading');
    try {
      const res = await api(`/api/customers/${customerId}/messages/${messageId}/media`);
      if (!res.ok) throw new Error();
      setSrc(URL.createObjectURL(await res.blob()));
      setState('idle');
    } catch {
      setState('error');
    }
  };
  if (src) return <audio controls autoPlay src={src} className="block w-full max-w-[260px] h-9 my-1" />;
  return (
    <button type="button" onClick={load} disabled={state === 'loading'}
      className="flex items-center gap-1.5 my-1 px-2.5 py-1.5 rounded-md bg-black/20 text-[12px] text-zinc-200 hover:bg-black/30 disabled:opacity-60">
      <Play size={12} /> {state === 'loading' ? 'Cargando audio…' : state === 'error' ? 'No se pudo cargar · reintentar' : 'Escuchar nota de voz'}
    </button>
  );
}

/** Imagen del chat: se descarga con la sesión del panel; clic para verla completa. */
function ChatImage({ api, customerId, messageId }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let url = null, alive = true;
    api(`/api/customers/${customerId}/messages/${messageId}/media`)
      .then(res => { if (!res.ok) throw new Error(); return res.blob(); })
      .then(b => { url = URL.createObjectURL(b); if (alive) setSrc(url); })
      .catch(() => alive && setError(true));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, messageId]);
  if (error) return <span className="flex items-center gap-1.5 my-1 text-[12px] text-zinc-400"><ImageIcon size={12} /> Imagen no disponible</span>;
  if (!src) return <div className="my-1 w-48 h-32 max-w-full rounded-md bg-black/20 animate-pulse" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block my-1">
      <img src={src} alt="Imagen del chat" className="block max-w-full sm:max-w-[260px] max-h-72 rounded-md object-contain bg-black/20" />
    </a>
  );
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Texto que el backend guarda cuando el mensaje es solo audio o imagen: con el archivo visible sobra
const MEDIA_PLACEHOLDERS = ['🎙️ [Nota de voz]', '🖼️ [Imagen]'];

function Conversation({ api, customerId, toast, themeColor, onOpenCustomer, onBack }) {
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [human, setHuman] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [image, setImage] = useState(null); // { file, preview } adjunta para enviar
  const fileRef = useRef(null);
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

  const pickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Solo imágenes JPG, PNG o WEBP.', true);
    if (file.size > MAX_IMAGE_BYTES) return toast('La imagen pesa más de 5 MB.', true);
    if (image) URL.revokeObjectURL(image.preview);
    setImage({ file, preview: URL.createObjectURL(file) });
  };
  const clearImage = () => { if (image) URL.revokeObjectURL(image.preview); setImage(null); };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !image) return;
    setSending(true);
    try {
      const res = image
        ? await api(`/api/customers/${customerId}/reply-image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: await fileToBase64(image.file), mime_type: image.file.type, caption: text.trim() })
        })
        : await api(`/api/customers/${customerId}/reply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() })
        });
      if (!res.ok) throw new Error(await errorText(res, 'No se pudo enviar.'));
      setHuman((await res.json()).human);
      setText('');
      clearImage();
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
    <div className="flex flex-col min-h-0 min-w-0">
      <div className="px-3 md:px-4 py-2.5 border-b border-[#2e2e2e] flex items-center justify-between gap-2 md:gap-3">
        <button onClick={onBack} className="md:hidden p-2 -ml-1 text-zinc-400 hover:text-white shrink-0" aria-label="Volver a la lista">
          <ArrowLeft size={18} />
        </button>
        <button onClick={() => onOpenCustomer(customerId)} className="text-left min-w-0 flex-1">
          <p className="text-[14px] font-medium text-zinc-100 truncate hover:underline">{customer?.name || phoneLabel(customer?.phone, customer?.channel)}</p>
          <p className="text-[12px] text-zinc-500 truncate">{customer?.stage_label}{customer?.summary ? ` · ${customer.summary}` : ''}</p>
        </button>
        <button onClick={toggleControl} className={`${btn} shrink-0`} title={human ? 'Devolver a la IA' : 'Tomar el control'}>
          {human
            ? <><Undo2 size={13} /> <span className="hidden sm:inline">Devolver a la IA</span><span className="sm:hidden">A la IA</span></>
            : <><Hand size={13} /> <span className="hidden sm:inline">Tomar el control</span><span className="sm:hidden">Tomar</span></>}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4 space-y-2">
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
              <div className={`max-w-[88%] sm:max-w-[78%] min-w-0 rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${mine ? 'rounded-br-sm text-zinc-100' : 'rounded-bl-sm bg-[#232323] text-zinc-200'}`}
                style={mine ? { backgroundColor: m.role === 'human' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(var(--theme-primary-rgb), 0.16)' } : undefined}>
                {mine && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400 mb-0.5">
                    {m.role === 'human' ? <><UserRound size={10} /> Asesor</> : <><Bot size={10} /> IA</>}
                  </span>
                )}
                {m.media === 'audio' && <VoiceNote api={api} customerId={customerId} messageId={m.id} />}
                {m.media === 'image' && <ChatImage api={api} customerId={customerId} messageId={m.id} />}
                {m.media && MEDIA_PLACEHOLDERS.includes((m.content || '').trim()) ? null : m.content}
                <span className="block mt-1 text-[10px] text-zinc-500 text-right">{shortTime(m.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="p-3 border-t border-[#2e2e2e] space-y-1.5">
        {!human && <p className="text-[11px] text-zinc-500">Al responder tomas el control: la IA deja de contestar en este chat hasta que la devuelvas.</p>}
        {image && (
          <div className="relative inline-block">
            <img src={image.preview} alt="Imagen a enviar" className="h-20 max-w-[160px] rounded-md object-cover border border-[#2e2e2e]" />
            <button type="button" onClick={clearImage} className="absolute -top-2 -right-2 p-1 rounded-full bg-[#2a2a2a] text-zinc-300 hover:text-white" aria-label="Quitar imagen"><X size={12} /></button>
          </div>
        )}
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickImage} />
          <button type="button" onClick={() => fileRef.current?.click()} className="px-2.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-[#232323] shrink-0" aria-label="Adjuntar imagen" title="Adjuntar imagen">
            <ImageIcon size={16} />
          </button>
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
            placeholder={image ? 'Texto de la imagen (opcional)…' : 'Escribe una respuesta… (Enter para enviar)'}
            className={`${inputClass} resize-none`}
          />
          <button type="submit" disabled={sending || (!text.trim() && !image)} className="px-3 rounded-md text-black disabled:opacity-40" style={{ backgroundColor: themeColor }} aria-label="Enviar">
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
      <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] h-[calc(100dvh-180px)] md:h-[calc(100vh-200px)] min-h-[420px] md:min-h-[480px] bg-[#171717] border border-[#2e2e2e] rounded-md overflow-hidden">
        {/* En el móvil se ve una cosa a la vez: la lista o el chat abierto (con botón para volver) */}
        <div className={`${conversationId ? 'hidden md:flex' : 'flex'} flex-col min-h-0 [&>div]:flex-1`}>
          <ConversationList api={api} selectedId={conversationId} onSelect={onSelect} />
        </div>
        {conversationId ? (
          <Conversation api={api} customerId={conversationId} toast={toast} themeColor={themeColor} onOpenCustomer={onOpenCustomer} onBack={() => onSelect(null)} />
        ) : (
          <div className="hidden md:flex items-center justify-center text-[13px] text-zinc-500">Elige una conversación.</div>
        )}
      </div>
    </div>
  );
}
