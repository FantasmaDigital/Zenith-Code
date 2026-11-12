import React, { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import {
  CreditCard, Search, Plus, RefreshCw, Gift, Stamp, Coins, Ban, CheckCircle2, Copy, X, Award, TrendingUp, Users,
  QrCode, LayoutGrid, List, Clock
} from 'lucide-react';

// ==============================================================
// Utilidades
// ==============================================================
const box = 'bg-[#171717] border border-[#2e2e2e] rounded-lg';
const input = 'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500';
const label = 'block text-[11px] uppercase tracking-wider text-zinc-500 mb-1';
const KIND_LABEL = { earn: 'Acumulación', redeem: 'Canje', adjust: 'Ajuste', expire: 'Vencimiento' };

const origin = () => window.location.origin;
export const publicCardLink = (card, tenantSlug) =>
  `${origin()}/?tarjeta=${encodeURIComponent(card.public_token)}&empresa=${encodeURIComponent(tenantSlug || 'default')}`;
const printedQrLink = (token, tenantSlug) =>
  `${origin()}/?qr=${encodeURIComponent(token)}&empresa=${encodeURIComponent(tenantSlug || 'default')}`;
// Animación del sello nuevo (se inyecta con <style> en las páginas públicas)
const STAMP_CSS = `
@keyframes zl-pop { 0% { transform: scale(2.6) rotate(-25deg); opacity: 0 } 55% { transform: scale(.85) rotate(6deg); opacity: 1 } 75% { transform: scale(1.12) } 100% { transform: scale(1) } }
@keyframes zl-ring { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.75) } 100% { box-shadow: 0 0 0 18px rgba(255,255,255,0) } }
@keyframes zl-burst { 0% { transform: scale(0) } 60% { transform: scale(1.2) } 100% { transform: scale(1) } }
@keyframes zl-rise { 0% { transform: translateY(12px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes zl-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
.zl-pop { animation: zl-pop .7s cubic-bezier(.2,.9,.3,1.3) .35s both, zl-ring 1s ease-out 1s 2; }
.zl-burst { animation: zl-burst .5s ease-out both; }
.zl-rise { animation: zl-rise .5s ease-out both; }
.zl-pulse { animation: zl-pulse 1.6s ease-in-out infinite; }
`;


const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

// Tarjetas guardadas en el teléfono del cliente (para que al escanear el QR del mostrador no tenga que escribir nada)
const savedKey = (tenant) => `zenith_loyalty_cards_${tenant || 'default'}`;
const getSavedCards = (tenant) => {
  try { const v = JSON.parse(localStorage.getItem(savedKey(tenant)) || '[]'); return Array.isArray(v) ? v.slice(0, 10) : []; }
  catch { return []; }
};
const saveCard = (tenant, token) => {
  if (!token) return;
  try {
    const list = [token, ...getSavedCards(tenant).filter(t => t !== token)].slice(0, 10);
    localStorage.setItem(savedKey(tenant), JSON.stringify(list));
  } catch { /* almacenamiento bloqueado: el cliente podrá identificarse con su número */ }
};

// ==============================================================
// Componentes visuales
// ==============================================================
export function QrImage({ value, size = 180, className = '' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!value) { setSrc(''); return undefined; }
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then(url => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className={`bg-white/5 rounded-md ${className}`} />;
  return <img src={src} width={size} height={size} alt="Código QR" className={`rounded-md bg-white ${className}`} />;
}

/** La tarjeta dibujada: la misma en el panel, en la caja y en el teléfono del cliente. */
export function LoyaltyCardVisual({ card, program, companyName, color = '#3ecf8e', compact = false, onClick, popIndex = -1 }) {
  const stamps = program?.kind === 'stamps';
  const goal = Number(program?.stamps_goal) || 10;
  const balance = Number(card?.balance) || 0;
  const filled = Math.min(balance, goal);
  const blocked = card?.status && card.status !== 'active';
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl text-zinc-950 shadow-lg select-none ${onClick ? 'cursor-pointer hover:brightness-110 transition' : ''} ${compact ? 'p-4' : 'p-5'}`}
      style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 55%, ${color}88 100%)`, aspectRatio: '1.586' }}
    >
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/15" />
      <div className="absolute -right-4 bottom-[-60px] w-48 h-48 rounded-full bg-black/10" />
      <div className="relative h-full flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-70 truncate">{companyName || 'Tarjeta de fidelidad'}</div>
            <div className={`${compact ? 'text-sm' : 'text-base'} font-bold truncate`}>{program?.name || '—'}</div>
          </div>
          {stamps ? <Stamp size={compact ? 16 : 20} className="opacity-70 shrink-0" /> : <Coins size={compact ? 16 : 20} className="opacity-70 shrink-0" />}
        </div>

        <div className="flex-1 flex items-center">
          {stamps ? (
            <div className="flex flex-wrap gap-1.5 w-full">
              {Array.from({ length: goal }).map((_, i) => (
                <div key={i} className={`rounded-full border-2 border-zinc-950/40 flex items-center justify-center shrink-0 ${i === popIndex ? 'zl-pop' : ''}`}
                  style={{
                    width: compact ? (goal > 10 ? 20 : 26) : (goal > 10 ? 26 : 34),
                    height: compact ? (goal > 10 ? 20 : 26) : (goal > 10 ? 26 : 34),
                    backgroundColor: i < filled ? 'rgba(9,9,11,0.85)' : 'rgba(255,255,255,0.25)'
                  }}>
                  {i < filled && <CheckCircle2 size={compact ? 10 : 14} style={{ color }} />}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <span className={`${compact ? 'text-3xl' : 'text-4xl'} font-extrabold`}>{balance}</span>
              <span className="text-sm opacity-70"> puntos</span>
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className={`${compact ? 'text-xs' : 'text-sm'} font-semibold truncate`}>{card?.customer_name}</div>
            {stamps && <div className="text-[11px] opacity-75">{filled}/{goal} sellos{balance >= goal ? ' · ¡premio listo!' : ''}</div>}
          </div>
          <div className="font-mono text-[11px] tracking-widest opacity-80">{card?.code}</div>
        </div>
      </div>
      {blocked && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-red-300 text-sm font-semibold">Bloqueada</div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${box} w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-5 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, title, value, color }) {
  return (
    <div className={`${box} p-4`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500"><Icon size={14} style={{ color }} />{title}</div>
      <div className="mt-1.5 text-xl font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

// ==============================================================
// PANEL PRINCIPAL
// ==============================================================
export default function LoyaltyPanel({ apiFetch, apiBase, themeColor, showToast, subTab = 'pos', setSubTab, tenantSlug = 'default', companyName = '' }) {
  const [programs, setPrograms] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [cards, setCards] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('grid');
  const [modal, setModal] = useState(null); // 'program' | 'reward' | 'card'
  const [detailId, setDetailId] = useState(null);

  const notifyRef = useRef(showToast);
  notifyRef.current = showToast;
  const notify = useCallback((msg, type = 'success') => notifyRef.current && notifyRef.current(msg, type === 'error'), []);

  const call = useCallback(async (path, options = {}) => {
    const res = await apiFetch(`${apiBase}/api/loyalty${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo completar la operación.');
    return data;
  }, [apiFetch, apiBase]);

  const loadPrograms = useCallback(async () => {
    try { setPrograms((await call('/programs')).programs || []); } catch (e) { notify(e.message, 'error'); }
  }, [call, notify]);
  const loadRewards = useCallback(async () => {
    try { setRewards((await call('/rewards')).rewards || []); } catch (e) { notify(e.message, 'error'); }
  }, [call, notify]);
  const loadCards = useCallback(async (q) => {
    setLoading(true);
    try { setCards((await call(`/cards?search=${encodeURIComponent(q || '')}`)).cards || []); } catch (e) { notify(e.message, 'error'); }
    setLoading(false);
  }, [call, notify]);
  const loadStats = useCallback(async () => {
    try { setStats(await call('/stats')); } catch (e) { notify(e.message, 'error'); }
  }, [call, notify]);

  useEffect(() => { loadPrograms(); loadRewards(); }, [loadPrograms, loadRewards]);
  useEffect(() => {
    if (subTab === 'cards') loadCards('');
    if (subTab === 'stats') loadStats();
  }, [subTab, loadCards, loadStats]);

  const programOf = (id) => programs.find(p => p.id === id);
  const noPrograms = programs.length === 0;

  const copyLink = async (card) => {
    try { await navigator.clipboard.writeText(publicCardLink(card, tenantSlug)); notify('Enlace de la tarjeta copiado.'); }
    catch { notify('No se pudo copiar el enlace.', 'error'); }
  };

  return (
    <div className="space-y-4">
      {noPrograms && subTab !== 'programs' && (
        <div className={`${box} p-4 text-sm text-zinc-300 flex items-center justify-between gap-3`}>
          <span>Primero crea un programa de fidelidad (puntos o sellos).</span>
          <button onClick={() => setSubTab('programs')} className="text-xs font-semibold px-3 py-1.5 rounded-md text-zinc-950" style={{ backgroundColor: themeColor }}>Crear programa</button>
        </div>
      )}

      {subTab === 'pos' && <StampRequests call={call} notify={notify} themeColor={themeColor} />}

      {subTab === 'pos' && <PosView call={call} notify={notify} rewards={rewards} programs={programs} themeColor={themeColor} copyLink={copyLink} companyName={companyName} />}

      {subTab === 'kiosk' && <PrintQrView call={call} notify={notify} programs={programs} themeColor={themeColor} tenantSlug={tenantSlug} companyName={companyName} />}

      {subTab === 'cards' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
              <input className={`${input} pl-8`} placeholder="Buscar por nombre, código, teléfono o correo"
                value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadCards(search)} />
            </div>
            <div className="flex border border-[#2e2e2e] rounded-md overflow-hidden">
              <button title="Ver tarjetas" onClick={() => setView('grid')} className={`px-2.5 ${view === 'grid' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}><LayoutGrid size={14} /></button>
              <button title="Ver lista" onClick={() => setView('list')} className={`px-2.5 ${view === 'list' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}><List size={14} /></button>
            </div>
            <button onClick={() => loadCards(search)} className="px-3 py-1.5 text-xs border border-[#2e2e2e] rounded-md text-zinc-300"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            <button disabled={noPrograms} onClick={() => setModal('card')} className="px-3 py-1.5 text-xs font-semibold rounded-md text-zinc-950 disabled:opacity-40 flex items-center gap-1" style={{ backgroundColor: themeColor }}><Plus size={14} />Nueva tarjeta</button>
          </div>

          {cards.length === 0 && <div className={`${box} p-6 text-center text-sm text-zinc-500`}>Sin tarjetas todavía.</div>}

          {view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(c => (
                <LoyaltyCardVisual key={c.id} card={c} program={programOf(c.program_id)} companyName={companyName}
                  color={themeColor} compact onClick={() => setDetailId(c.id)} />
              ))}
            </div>
          ) : cards.length > 0 && (
            <div className={`${box} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                  <tr><th className="text-left p-3">Cliente</th><th className="text-left p-3">Código</th><th className="text-left p-3">Programa</th><th className="text-right p-3">Saldo</th><th className="text-left p-3">Estado</th></tr>
                </thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.id} onClick={() => setDetailId(c.id)} className="border-b border-[#222] text-zinc-300 cursor-pointer hover:bg-[#1c1c1c]">
                      <td className="p-3"><div className="text-zinc-100">{c.customer_name}</div><div className="text-[11px] text-zinc-500">{c.phone || c.email}</div></td>
                      <td className="p-3 font-mono">{c.code}</td>
                      <td className="p-3">{programOf(c.program_id)?.name || '—'}</td>
                      <td className="p-3 text-right font-semibold">{c.balance}</td>
                      <td className="p-3">{c.status === 'active' ? <span className="text-emerald-400 text-xs">Activa</span> : <span className="text-red-400 text-xs">Bloqueada</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'programs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setModal('program')} className="px-3 py-1.5 text-xs font-semibold rounded-md text-zinc-950 flex items-center gap-1" style={{ backgroundColor: themeColor }}><Plus size={14} />Nuevo programa</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {programs.map(p => (
              <div key={p.id} className={`${box} p-4 space-y-3`}>
                <LoyaltyCardVisual card={{ customer_name: 'Vista previa', code: 'XXXXXXXX', balance: p.kind === 'stamps' ? Math.ceil(p.stamps_goal / 2) : 120 }}
                  program={p} companyName={companyName} color={themeColor} compact />
                <div className="flex items-center justify-between">
                  <div className="text-sm text-zinc-100 font-semibold">{p.name}</div>
                  <button className={`text-xs ${p.active ? 'text-emerald-400' : 'text-zinc-500'}`}
                    onClick={async () => { try { await call(`/programs/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); loadPrograms(); } catch (e) { notify(e.message, 'error'); } }}>
                    {p.active ? 'Activo' : 'Inactivo'}
                  </button>
                </div>
                <div className="text-xs text-zinc-400 space-y-0.5">
                  {p.kind === 'stamps'
                    ? <>
                        <div>1 sello por visita · {p.stamps_goal} sellos = {p.reward_description || 'recompensa'}</div>
                        <div>Espera entre sellos: {p.stamp_cooldown_minutes > 0 ? `${p.stamp_cooldown_minutes} min` : 'sin espera'}</div>
                      </>
                    : <div>{p.points_per_currency} punto(s) por cada $1</div>}
                  {p.expiry_days > 0 && <div>Vence tras {p.expiry_days} días sin movimientos</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'rewards' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button disabled={!programs.some(p => p.kind === 'points')} onClick={() => setModal('reward')} className="px-3 py-1.5 text-xs font-semibold rounded-md text-zinc-950 disabled:opacity-40 flex items-center gap-1" style={{ backgroundColor: themeColor }}><Plus size={14} />Nueva recompensa</button>
          </div>
          <p className="text-xs text-zinc-500">Las recompensas aplican a programas por puntos. Los programas por sellos tienen un único premio, definido en el programa.</p>
          <div className={`${box} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                <tr><th className="text-left p-3">Recompensa</th><th className="text-left p-3">Programa</th><th className="text-right p-3">Costo</th><th className="text-left p-3">Estado</th></tr>
              </thead>
              <tbody>
                {rewards.map(r => (
                  <tr key={r.id} className="border-b border-[#222] text-zinc-300">
                    <td className="p-3"><div className="text-zinc-100">{r.name}</div><div className="text-[11px] text-zinc-500">{r.description}</div></td>
                    <td className="p-3">{programOf(r.program_id)?.name || '—'}</td>
                    <td className="p-3 text-right">{r.cost} pts</td>
                    <td className="p-3"><button className={`text-xs ${r.active ? 'text-emerald-400' : 'text-zinc-500'}`}
                      onClick={async () => { try { await call(`/rewards/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); loadRewards(); } catch (e) { notify(e.message, 'error'); } }}>
                      {r.active ? 'Activa' : 'Inactiva'}</button></td>
                  </tr>
                ))}
                {rewards.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-zinc-500">Sin recompensas.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'stats' && stats && (
        <div className="space-y-3">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat icon={CreditCard} title="Tarjetas activas" value={`${stats.cards_active} / ${stats.cards_total}`} color={themeColor} />
            <Stat icon={TrendingUp} title="Puntos / sellos emitidos" value={stats.points_earned} color={themeColor} />
            <Stat icon={Gift} title="Canjes" value={`${stats.redemptions} (${stats.points_redeemed})`} color={themeColor} />
            <Stat icon={Coins} title="Ventas con tarjeta" value={`$${Number(stats.sales_with_card || 0).toFixed(2)}`} color={themeColor} />
          </div>
          <div className={`${box} p-4`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100 mb-3"><Users size={15} />Mejores clientes</div>
            {stats.top_customers.length === 0 && <div className="text-sm text-zinc-500">Sin datos todavía.</div>}
            {stats.top_customers.map((c, i) => (
              <div key={c.id} className="flex justify-between text-sm text-zinc-300 py-1.5 border-b border-[#222] last:border-0">
                <span>{i + 1}. {c.customer_name} <span className="text-zinc-500 font-mono text-xs">{c.code}</span></span>
                <span>{c.lifetime_earned} acumulados · saldo {c.balance}</span>
              </div>
            ))}
            <div className="text-xs text-zinc-500 mt-3">Saldo pendiente de canje en circulación: {stats.points_outstanding}</div>
          </div>
        </div>
      )}

      {modal === 'program' && <ProgramModal call={call} notify={notify} themeColor={themeColor} onClose={() => setModal(null)} onSaved={loadPrograms} />}
      {modal === 'reward' && <RewardModal call={call} notify={notify} programs={programs.filter(p => p.kind === 'points')} themeColor={themeColor} onClose={() => setModal(null)} onSaved={loadRewards} />}
      {modal === 'card' && <CardModal call={call} notify={notify} programs={programs.filter(p => p.active)} themeColor={themeColor} onClose={() => setModal(null)}
        onSaved={(card) => { loadCards(''); setDetailId(card.id); }} />}
      {detailId && <CardDetailModal call={call} notify={notify} cardId={detailId} programOf={programOf} themeColor={themeColor}
        companyName={companyName} tenantSlug={tenantSlug} copyLink={copyLink} onClose={() => setDetailId(null)} onChanged={() => loadCards(search)} />}
    </div>
  );
}

// ==============================================================
// DETALLE DE TARJETA: dibujo, QR para entregar al cliente e historial
// ==============================================================
function CardDetailModal({ call, notify, cardId, programOf, themeColor, companyName, tenantSlug, copyLink, onClose, onChanged }) {
  const [card, setCard] = useState(null);
  const load = useCallback(async () => {
    try { setCard(await call(`/cards/${cardId}`)); } catch (e) { notify(e.message, 'error'); onClose(); }
  }, [call, cardId, notify, onClose]);
  useEffect(() => { load(); }, [load]);
  if (!card) return null;
  const link = publicCardLink(card, tenantSlug);
  return (
    <Modal title={`Tarjeta de ${card.customer_name}`} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <LoyaltyCardVisual card={card} program={programOf(card.program_id)} companyName={companyName} color={themeColor} />
          <div className="text-xs text-zinc-400 space-y-0.5">
            {card.phone && <div>Teléfono: {card.phone}</div>}
            {card.email && <div>Correo: {card.email}</div>}
            <div>Creada: {fmtDate(card.created_at)}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <QrImage value={link} size={170} />
          <div className="text-[11px] text-zinc-500 text-center max-w-[170px]">El cliente escanea este QR para guardar su tarjeta en el teléfono.</div>
          <button onClick={() => copyLink(card)} className="text-xs flex items-center gap-1 text-zinc-300 hover:text-zinc-100"><Copy size={13} />Copiar enlace</button>
          <button className={`text-xs flex items-center gap-1 ${card.status === 'active' ? 'text-red-400' : 'text-emerald-400'}`}
            onClick={async () => {
              try { await call(`/cards/${card.id}`, { method: 'PATCH', body: { status: card.status === 'active' ? 'blocked' : 'active' } }); await load(); onChanged(); }
              catch (e) { notify(e.message, 'error'); }
            }}>
            {card.status === 'active' ? <><Ban size={13} />Bloquear</> : <><CheckCircle2 size={13} />Reactivar</>}
          </button>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Historial</div>
        {(card.transactions || []).length === 0 && <div className="text-sm text-zinc-500">Sin movimientos.</div>}
        {(card.transactions || []).map(t => (
          <div key={t.id} className="flex justify-between text-sm py-1.5 border-b border-[#222] last:border-0">
            <div>
              <div className="text-zinc-200">{KIND_LABEL[t.kind] || t.kind}{t.reference ? ` · ${t.reference}` : ''}</div>
              <div className="text-[11px] text-zinc-500">{fmtDate(t.created_at)}{t.created_by ? ` · ${t.created_by}` : ''}{t.notes ? ` · ${t.notes}` : ''}</div>
            </div>
            <div className={t.points >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.points > 0 ? '+' : ''}{t.points}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ==============================================================
// CAJA: buscar tarjeta, acumular y canjear
// ==============================================================
function PosView({ call, notify, rewards, programs, themeColor, copyLink, companyName }) {
  const [query, setQuery] = useState('');
  const [card, setCard] = useState(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const program = card ? programs.find(p => p.id === card.program_id) : null;
  const cardRewards = card ? rewards.filter(r => r.program_id === card.program_id && r.active) : [];

  const refresh = async (id) => setCard(await call(`/cards/${id}`));

  const lookup = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try { const found = await call(`/cards/lookup?q=${encodeURIComponent(query.trim())}`); await refresh(found.id); }
    catch (e) { setCard(null); notify(e.message, 'error'); }
    setBusy(false);
  };

  const run = async (path, body, okMsg) => {
    if (busy) return; // evita doble clic: un solo movimiento a la vez
    setBusy(true);
    try {
      const res = await call(`/cards/${card.id}/${path}`, { method: 'POST', body });
      notify(res.duplicate ? 'Esa referencia ya estaba registrada; no se sumó de nuevo.' : okMsg(res));
      setAmount(''); setReference('');
      await refresh(card.id);
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${box} p-4 space-y-3`}>
        <div className="text-sm font-semibold text-zinc-100">Buscar tarjeta</div>
        <div className="flex gap-2">
          <input className={input} placeholder="Código de tarjeta o teléfono" value={query}
            onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookup()} autoFocus />
          <button disabled={busy} onClick={lookup} className="px-3 rounded-md text-zinc-950 text-xs font-semibold" style={{ backgroundColor: themeColor }}><Search size={14} /></button>
        </div>

        {card && (
          <div className="space-y-3 pt-2">
            <div className="relative">
              <LoyaltyCardVisual card={card} program={program} companyName={companyName} color={themeColor} />
              <button title="Copiar enlace para el cliente" onClick={() => copyLink(card)} className="absolute top-3 right-12 text-zinc-900/70 hover:text-zinc-950"><Copy size={15} /></button>
            </div>

            {card.status === 'active' && (
              <>
                <div className="space-y-2">
                  {program?.kind !== 'stamps' && (
                    <div><span className={label}>Monto de la compra ($)</span>
                      <input className={input} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
                  )}
                  <div><span className={label}>Referencia / n.º de ticket (opcional)</span>
                    <input className={input} value={reference} onChange={e => setReference(e.target.value)} /></div>
                  <button disabled={busy || (program?.kind !== 'stamps' && !(Number(amount) > 0))}
                    onClick={() => run('earn', { purchase_amount: Number(amount) || 0, reference },
                      r => `+${r.points} ${program?.kind === 'stamps' ? 'sello' : 'puntos'}. Saldo: ${r.balance}${r.reward_ready ? ' — ¡recompensa lista!' : ''}`)}
                    className="w-full py-2 rounded-md text-zinc-950 text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: themeColor }}>
                    {program?.kind === 'stamps' ? 'Agregar 1 sello' : 'Acumular puntos'}
                  </button>
                  {program?.kind === 'stamps' && program.stamp_cooldown_minutes > 0 && (
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1"><Clock size={11} />Un sello por visita: la tarjeta espera {program.stamp_cooldown_minutes} min entre sellos.</div>
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t border-[#262626]">
                  <div className="text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-1"><Award size={13} />Canjear</div>
                  {program?.kind === 'stamps' ? (
                    <button disabled={busy || card.balance < program.stamps_goal}
                      onClick={() => run('redeem', {}, r => `Canjeado: ${r.reward}`)}
                      className="w-full py-2 rounded-md border border-[#3a3a3a] text-sm text-zinc-200 disabled:opacity-40">
                      Canjear {program.reward_description || 'recompensa'} ({program.stamps_goal} sellos)
                    </button>
                  ) : cardRewards.length === 0 ? (
                    <div className="text-xs text-zinc-500">Este programa no tiene recompensas activas.</div>
                  ) : cardRewards.map(r => (
                    <button key={r.id} disabled={busy || card.balance < r.cost}
                      onClick={() => run('redeem', { reward_id: r.id }, res => `Canjeado: ${res.reward}. Saldo: ${res.balance}`)}
                      className="w-full py-2 px-3 rounded-md border border-[#3a3a3a] text-sm text-zinc-200 disabled:opacity-40 flex justify-between">
                      <span>{r.name}</span><span>{r.cost} pts</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className={`${box} p-4`}>
        <div className="text-sm font-semibold text-zinc-100 mb-3">Últimos movimientos</div>
        {!card && <div className="text-sm text-zinc-500">Busca una tarjeta para ver su historial.</div>}
        {card && (card.transactions || []).length === 0 && <div className="text-sm text-zinc-500">Sin movimientos.</div>}
        {card && (card.transactions || []).map(t => (
          <div key={t.id} className="flex justify-between text-sm py-1.5 border-b border-[#222] last:border-0">
            <div>
              <div className="text-zinc-200">{KIND_LABEL[t.kind] || t.kind}{t.reference ? ` · ${t.reference}` : ''}</div>
              <div className="text-[11px] text-zinc-500">{fmtDate(t.created_at)}{t.created_by ? ` · ${t.created_by}` : ''}{t.notes ? ` · ${t.notes}` : ''}</div>
            </div>
            <div className={t.points >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.points > 0 ? '+' : ''}{t.points}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==============================================================
// SOLICITUDES DE SELLO (QR impreso): nada se suma hasta que el cajero aprueba viendo al cliente
// ==============================================================
function StampRequests({ call, notify, themeColor }) {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { setItems((await call('/requests')).requests || []); } catch { /* el siguiente ciclo reintenta */ }
  }, [call]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (r, approve) => {
    setBusyId(r.id);
    try {
      const res = await call(`/requests/${r.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
      notify(approve ? `Sello para ${r.customer_name}: ${res.balance}/${r.stamps_goal}${res.reward_ready ? ' — ¡premio listo!' : ''}` : 'Solicitud rechazada.');
    } catch (e) { notify(e.message, 'error'); }
    setBusyId(null);
    load();
  };

  if (items.length === 0) {
    return (
      <div className={`${box} p-3 text-xs text-zinc-500 flex items-center gap-2`}>
        <QrCode size={14} />Sin solicitudes de sello. Cuando un cliente escanee el QR impreso aparecerá aquí para que la apruebes.
      </div>
    );
  }
  return (
    <div className={`${box} p-4 space-y-2`} style={{ borderColor: `${themeColor}88` }}>
      <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: themeColor }} />
        Solicitudes de sello ({items.length})
      </div>
      <p className="text-[11px] text-zinc-500">Aprueba solo si el cliente está frente a ti y el código coincide con el de su pantalla.</p>
      {items.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 py-2 border-t border-[#262626]">
          <div className="font-mono text-2xl font-bold tracking-[0.3em] text-zinc-100">{r.short_code}</div>
          <div className="flex-1 min-w-[140px]">
            <div className="text-sm text-zinc-100">{r.customer_name}</div>
            <div className="text-[11px] text-zinc-500">{r.program_name} · {r.balance}/{r.stamps_goal} sellos · {new Date(r.created_at).toLocaleTimeString()}</div>
          </div>
          <button disabled={busyId === r.id} onClick={() => decide(r, false)} className="px-3 py-1.5 text-xs rounded-md border border-[#3a3a3a] text-zinc-300 disabled:opacity-40">Rechazar</button>
          <button disabled={busyId === r.id} onClick={() => decide(r, true)} className="px-4 py-1.5 text-xs font-semibold rounded-md text-zinc-950 disabled:opacity-40" style={{ backgroundColor: themeColor }}>Aprobar sello</button>
        </div>
      ))}
    </div>
  );
}

// ==============================================================
// QR IMPRESO: fijo por programa, para pegar en el local
// ==============================================================
function PrintQrView({ call, notify, programs, themeColor, tenantSlug, companyName }) {
  const stampPrograms = programs.filter(p => p.kind === 'stamps' && p.active);
  const [programId, setProgramId] = useState(null);
  const [qrToken, setQrToken] = useState('');
  const [channels, setChannels] = useState(null);
  const [qrError, setQrError] = useState('');

  const selected = programId || stampPrograms[0]?.id || null;
  const program = stampPrograms.find(p => p.id === selected);

  useEffect(() => {
    if (!selected) return;
    setQrToken('');
    setQrError('');
    call(`/programs/${selected}/qr`)
      .then(d => { setQrToken(d.qr_token); setChannels(d.channels || null); })
      .catch(e => setQrError(e.message || 'No se pudo cargar el QR.'));
  }, [selected, call]);

  if (stampPrograms.length === 0) {
    return <div className={`${box} p-6 text-sm text-zinc-400`}>El QR impreso funciona con programas por sellos. Crea uno en «Programas».</div>;
  }
  const link = qrToken ? printedQrLink(qrToken, tenantSlug) : '';

  const printIt = async () => {
    try {
      const img = await QRCode.toDataURL(link, { width: 900, margin: 1 });
      const w = window.open('', '_blank', 'width=700,height=900');
      if (!w) { notify('El navegador bloqueó la ventana de impresión.', 'error'); return; }
      const esc = (t) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR ${esc(program?.name)}</title>
        <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#111}
        h1{margin:8px 0 4px;font-size:34px}p{margin:6px 0;font-size:18px;color:#444}img{width:420px;height:420px;margin:24px auto}
        .co{letter-spacing:4px;text-transform:uppercase;font-size:14px;color:#666}.steps{font-size:15px;color:#333}</style></head>
        <body><div class="co">${esc(companyName)}</div><h1>Suma tu sello</h1>
        <p>${esc(program?.stamps_goal)} sellos = ${esc(program?.reward_description || 'recompensa')}</p>
        <img src="${img}" alt="QR"/>
        <p class="steps">1. Escanea con tu cámara · 2. Escribe tu correo o WhatsApp · 3. Muestra tu pantalla en caja</p>
        <script>window.onload=function(){window.print()}</script></body></html>`);
      w.document.close();
    } catch { notify('No se pudo preparar la impresión.', 'error'); }
  };

  const regenerate = async () => {
    if (!window.confirm('¿Generar un QR nuevo? El QR impreso actual dejará de funcionar y tendrás que imprimir el nuevo.')) return;
    try { setQrToken((await call(`/programs/${selected}/qr/regenerate`, { method: 'POST' })).qr_token); notify('QR nuevo generado. Imprímelo y reemplaza el anterior.'); }
    catch (e) { notify(e.message, 'error'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className={`${box} p-6 flex flex-col items-center gap-3 text-center`}>
        <select className={`${input} max-w-xs`} value={selected || ''} onChange={e => setProgramId(Number(e.target.value))}>
          {stampPrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="text-xs uppercase tracking-[0.25em] text-zinc-500 mt-2">{companyName}</div>
        <div className="text-xl font-bold text-zinc-100">Suma tu sello</div>
        <div className="p-3 bg-white rounded-2xl">
          {link ? <QrImage value={link} size={230} /> : (
            <div className="w-[230px] h-[230px] flex items-center justify-center text-center text-xs px-4 text-zinc-600">
              {qrError ? `No se pudo cargar el QR: ${qrError}` : 'Cargando QR…'}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={printIt} disabled={!link} className="px-4 py-2 text-sm font-semibold rounded-md text-zinc-950 disabled:opacity-40" style={{ backgroundColor: themeColor }}>Imprimir</button>
          <button onClick={regenerate} className="px-3 py-2 text-xs rounded-md border border-[#3a3a3a] text-zinc-300">Generar QR nuevo</button>
        </div>
      </div>
      <div className={`${box} p-5 space-y-3 text-sm text-zinc-300`}>
        <div className="font-semibold text-zinc-100">Cómo funciona</div>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Imprime este QR y pégalo junto a la caja. Siempre es el mismo.</li>
          <li>El cliente lo escanea y se identifica con su correo o WhatsApp (la primera vez recibe un código para confirmar que es suyo).</li>
          <li>Su teléfono muestra un <b>código de 4 letras</b> y la solicitud aparece en <b>Caja</b>.</li>
          <li>Tú compruebas que el código coincide y pulsas <b>Aprobar sello</b>. Solo entonces se suma, con animación en su teléfono y comprobante.</li>
        </ol>
        <p className="text-xs text-zinc-500">Si nadie la aprueba, la solicitud vence en 5 minutos. Una foto del QR no sirve para sumar sellos desde casa: siempre se necesita tu aprobación.</p>
        {program?.stamp_cooldown_minutes > 0 && <p className="text-xs text-zinc-500">Además, cada tarjeta espera {program.stamp_cooldown_minutes} min entre sellos.</p>}
        {channels && !channels.email && !channels.whatsapp && (
          <p className="text-xs text-amber-300">Aún no hay correo (SMTP) ni WhatsApp para enviar códigos y comprobantes: los clientes se identificarán sin código y tu aprobación en caja será la validación.</p>
        )}
      </div>
    </div>
  );
}

// ==============================================================
// MODALES
// ==============================================================
function SaveButton({ busy, themeColor, children }) {
  return <button type="submit" disabled={busy} className="w-full py-2 rounded-md text-zinc-950 text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: themeColor }}>{children}</button>;
}

function ProgramModal({ call, notify, themeColor, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', kind: 'stamps', points_per_currency: 1, stamps_goal: 10, reward_description: '', expiry_days: 0, terms: '', stamp_cooldown_minutes: 60 });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await call('/programs', { method: 'POST', body: { ...f, points_per_currency: Number(f.points_per_currency), stamps_goal: Number(f.stamps_goal), expiry_days: Number(f.expiry_days), stamp_cooldown_minutes: Number(f.stamp_cooldown_minutes) } });
      notify('Programa creado.'); onSaved(); onClose();
    } catch (err) { notify(err.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Nuevo programa" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><span className={label}>Nombre</span><input required className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Club Café" /></div>
        <div><span className={label}>Tipo</span>
          <select className={input} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
            <option value="stamps">Por sellos (1 por visita)</option>
            <option value="points">Por puntos (según el monto de compra)</option>
          </select></div>
        {f.kind === 'points' ? (
          <div><span className={label}>Puntos por cada $1</span><input type="number" min="0" step="0.1" className={input} value={f.points_per_currency} onChange={e => setF({ ...f, points_per_currency: e.target.value })} /></div>
        ) : (
          <>
            <div><span className={label}>Sellos para el premio</span><input type="number" min="1" max="30" className={input} value={f.stamps_goal} onChange={e => setF({ ...f, stamps_goal: e.target.value })} /></div>
            <div><span className={label}>Premio</span><input className={input} value={f.reward_description} onChange={e => setF({ ...f, reward_description: e.target.value })} placeholder="Café americano gratis" /></div>
            <div><span className={label}>Espera mínima entre sellos de una tarjeta (minutos)</span>
              <input type="number" min="0" className={input} value={f.stamp_cooldown_minutes} onChange={e => setF({ ...f, stamp_cooldown_minutes: e.target.value })} />
              <p className="text-[11px] text-zinc-500 mt-1">Evita que un cliente sume varios sellos en la misma visita. 0 = sin espera.</p></div>
          </>
        )}
        <div><span className={label}>Vencimiento por inactividad (días, 0 = no vence)</span><input type="number" min="0" className={input} value={f.expiry_days} onChange={e => setF({ ...f, expiry_days: e.target.value })} /></div>
        <div><span className={label}>Términos y condiciones (opcional)</span><textarea rows={2} className={input} value={f.terms} onChange={e => setF({ ...f, terms: e.target.value })} /></div>
        <SaveButton busy={busy} themeColor={themeColor}>Crear programa</SaveButton>
      </form>
    </Modal>
  );
}

function RewardModal({ call, notify, programs, themeColor, onClose, onSaved }) {
  const [f, setF] = useState({ program_id: programs[0]?.id || '', name: '', cost: 100, description: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await call('/rewards', { method: 'POST', body: { ...f, program_id: Number(f.program_id), cost: Number(f.cost) } }); notify('Recompensa creada.'); onSaved(); onClose(); }
    catch (err) { notify(err.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Nueva recompensa" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><span className={label}>Programa</span>
          <select className={input} value={f.program_id} onChange={e => setF({ ...f, program_id: e.target.value })}>
            {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div><span className={label}>Nombre</span><input required className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><span className={label}>Costo en puntos</span><input required type="number" min="1" className={input} value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} /></div>
        <div><span className={label}>Descripción (opcional)</span><input className={input} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
        <SaveButton busy={busy} themeColor={themeColor}>Crear recompensa</SaveButton>
      </form>
    </Modal>
  );
}

function CardModal({ call, notify, programs, themeColor, onClose, onSaved }) {
  const [f, setF] = useState({ program_id: programs[0]?.id || '', customer_name: '', phone: '', email: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const card = await call('/cards', { method: 'POST', body: { ...f, program_id: Number(f.program_id) } });
      notify(`Tarjeta ${card.code} creada.`); onSaved(card); onClose();
    } catch (err) { notify(err.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Nueva tarjeta" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><span className={label}>Programa</span>
          <select className={input} value={f.program_id} onChange={e => setF({ ...f, program_id: e.target.value })}>
            {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div><span className={label}>Nombre del cliente</span><input required className={input} value={f.customer_name} onChange={e => setF({ ...f, customer_name: e.target.value })} /></div>
        <div><span className={label}>Teléfono / WhatsApp</span><input className={input} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="+503 7000 0000" /></div>
        <div><span className={label}>Correo (opcional)</span><input type="email" className={input} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        <p className="text-[11px] text-zinc-500">Al crearla verás su QR para que el cliente la guarde en su teléfono.</p>
        <SaveButton busy={busy} themeColor={themeColor}>Crear tarjeta</SaveButton>
      </form>
    </Modal>
  );
}

// ==============================================================
// PÁGINAS PÚBLICAS (cliente final, sin login)
//   Tarjeta:  /?tarjeta=TOKEN&empresa=SLUG
//   Sello:    /?sello=TOKEN&empresa=SLUG   (QR del mostrador)
// ==============================================================
export const getPublicCardParams = () => {
  try {
    const p = new URLSearchParams(window.location.search);
    const tenant = p.get('empresa') || 'default';
    if (p.get('qr')) return { type: 'stamp', token: p.get('qr'), tenant };
    if (p.get('tarjeta')) return { type: 'card', token: p.get('tarjeta'), tenant };
    return null;
  } catch { return null; }
};

function PublicShell({ children }) {
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4">{children}</div>
    </div>
  );
}

function PublicCardBody({ data }) {
  const color = data?.company?.primary_color || '#3ecf8e';
  const stamps = data?.program?.kind === 'stamps';
  return (
    <>
      <LoyaltyCardVisual card={data} program={data.program} companyName={data.company?.name} color={color} />
      {data.status !== 'active' && <div className="text-center text-red-400 text-sm">Esta tarjeta está bloqueada. Consulta en el negocio.</div>}
      {stamps ? (
        <div className={`${box} p-4 text-sm text-zinc-300 text-center space-y-1`}>
          <div>Premio: <b className="text-zinc-100">{data.program.reward_description || 'recompensa'}</b></div>
          <div className="text-xs text-zinc-500">Escanea el QR del mostrador en cada visita para sumar tu sello.</div>
        </div>
      ) : (
        <div className={`${box} p-4 space-y-2`}>
          <div className="text-sm font-semibold text-zinc-100 flex items-center gap-1"><Gift size={15} />Recompensas</div>
          {data.rewards.length === 0 && <div className="text-sm text-zinc-500">Pronto habrá recompensas disponibles.</div>}
          {data.rewards.map((r, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className={r.available ? 'text-zinc-100' : 'text-zinc-500'}>{r.name}</span>
              <span style={r.available ? { color } : undefined} className={r.available ? 'font-semibold' : 'text-zinc-500'}>{r.cost} pts</span>
            </div>
          ))}
          <div className="text-[11px] text-zinc-500 pt-1">Ganas {data.program.points_per_currency} punto(s) por cada $1.</div>
        </div>
      )}
      {data.history?.length > 0 && (
        <div className={`${box} p-4`}>
          <div className="text-sm font-semibold text-zinc-100 mb-2">Movimientos recientes</div>
          {data.history.map((t, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="text-zinc-400">{KIND_LABEL[t.kind] || t.kind} · {new Date(t.created_at).toLocaleDateString()}</span>
              <span className={t.points >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.points > 0 ? '+' : ''}{t.points}</span>
            </div>
          ))}
        </div>
      )}
      {(data.program.expiry_days > 0 || data.program.terms) && (
        <div className="text-[11px] text-zinc-500 text-center space-y-1">
          {data.program.expiry_days > 0 && <div>El saldo vence tras {data.program.expiry_days} días sin compras.</div>}
          {data.program.terms && <div>{data.program.terms}</div>}
        </div>
      )}
    </>
  );
}

export function PublicLoyaltyCard({ apiBase, token, tenant }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiBase}/api/public/loyalty/${encodeURIComponent(tenant)}/cards/${encodeURIComponent(token)}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail || 'Tarjeta no encontrada.');
        saveCard(tenant, token); // queda guardada para sumar sellos con solo escanear el QR del mostrador
        setData(body);
      })
      .catch(e => setError(e.message));
  }, [apiBase, token, tenant]);

  return (
    <PublicShell>
      {error && <div className={`${box} p-6 text-center text-zinc-300`}>{error}</div>}
      {!data && !error && <div className="text-center text-zinc-500 text-sm">Cargando tarjeta…</div>}
      {data && <PublicCardBody data={data} />}
    </PublicShell>
  );
}

/** Flujo del cliente al escanear el QR impreso: identificarse, mostrar el código en caja y ver su sello animado. */
export function PublicStampFlow({ apiBase, token, tenant }) {
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState('loading'); // loading | contact | code | name | waiting | done | ended | error
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [codeRequired, setCodeRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [req, setReq] = useState(null);     // solicitud pendiente
  const [final, setFinal] = useState(null); // estado final (approved/rejected/expired) con la tarjeta
  const started = useRef(false);
  const base = `${apiBase}/api/public/loyalty/${encodeURIComponent(tenant)}`;
  const color = info?.company?.primary_color || '#3ecf8e';

  const post = useCallback(async (path, body) => {
    const res = await fetch(`${base}/stamp/${encodeURIComponent(token)}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Algo salió mal. Intenta de nuevo.');
    return data;
  }, [base, token]);

  const onRequest = useCallback((data) => {
    if (data.card_token) saveCard(tenant, data.card_token);
    setReq(data);
    setStep('waiting');
  }, [tenant]);

  useEffect(() => {
    if (started.current) return; // StrictMode monta dos veces
    started.current = true;
    (async () => {
      try {
        const res = await fetch(`${base}/stamp/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Este código QR ya no es válido.');
        setInfo(data);
        const saved = getSavedCards(tenant);
        if (saved.length) {
          const r = await post('', { card_tokens: saved });
          if (!r.needs_verification) { onRequest(r); return; }
        }
        setStep('contact');
      } catch (e) { setMsg(e.message); setStep('error'); }
    })();
  }, [base, token, tenant, post, onRequest]);

  // Esperando la aprobación del cajero
  useEffect(() => {
    if (step !== 'waiting' || !req?.request_token) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${base}/requests/${encodeURIComponent(req.request_token)}`);
        const data = await res.json();
        if (!alive || !res.ok) return;
        if (data.status !== 'pending') {
          setFinal(data);
          setStep(data.status === 'approved' ? 'done' : 'ended');
        }
      } catch { /* sin red: reintenta */ }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [step, req, base]);

  const sendContact = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try {
      const r = await post('/code', { contact });
      setCodeRequired(r.code_required);
      if (r.code_required) { setSentTo(`${r.sent_via === 'email' ? 'tu correo' : 'tu WhatsApp'} (${r.contact})`); setStep('code'); }
      else await verify();
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  };

  const verify = async (e) => {
    if (e) e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await post('/verify', { contact, code: codeRequired ? code : '', customer_name: name });
      if (r.needs_name) setStep('name');
      else onRequest(r);
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  };

  const retry = async () => {
    setFinal(null); setMsg(''); setStep('loading');
    try { onRequest(await post('', { card_tokens: getSavedCards(tenant) })); }
    catch (e) { setMsg(e.message); setStep('error'); }
  };

  const btn = 'w-full py-2.5 rounded-md text-zinc-950 text-sm font-semibold disabled:opacity-40';
  const goal = info?.program?.stamps_goal;

  return (
    <PublicShell>
      <style>{STAMP_CSS}</style>
      {info && step !== 'done' && (
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">{info.company?.name}</div>
          <div className="text-lg font-bold text-zinc-100">{info.program?.name}</div>
          <div className="text-xs text-zinc-400">{goal} sellos = {info.program?.reward_description || 'recompensa'}</div>
        </div>
      )}

      {step === 'loading' && <div className="text-center text-zinc-500 text-sm py-10">Cargando…</div>}

      {step === 'contact' && (
        <form className={`${box} p-5 space-y-3`} onSubmit={sendContact}>
          <div className="text-zinc-100 font-semibold">¿Con qué te identificamos?</div>
          <p className="text-sm text-zinc-400">Escribe tu correo o tu número de WhatsApp. Ahí te llegarán tus comprobantes.</p>
          <input required autoFocus className={input} value={contact} onChange={e => setContact(e.target.value)} placeholder="correo@ejemplo.com o 7000 0000" />
          <button disabled={busy} className={btn} style={{ backgroundColor: color }}>{busy ? 'Enviando…' : 'Continuar'}</button>
        </form>
      )}

      {step === 'code' && (
        <form className={`${box} p-5 space-y-3`} onSubmit={verify}>
          <div className="text-zinc-100 font-semibold">Revisa {sentTo}</div>
          <p className="text-sm text-zinc-400">Te enviamos un código de 6 dígitos. Solo te lo pediremos esta vez en este teléfono.</p>
          <input required autoFocus inputMode="numeric" maxLength={6} className={`${input} text-center text-2xl tracking-[0.5em] font-mono`} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          <button disabled={busy || code.length < 6} className={btn} style={{ backgroundColor: color }}>Confirmar</button>
          <button type="button" onClick={() => { setStep('contact'); setCode(''); }} className="w-full text-xs text-zinc-500">Usar otro correo o número</button>
        </form>
      )}

      {step === 'name' && (
        <form className={`${box} p-5 space-y-3`} onSubmit={verify}>
          <div className="text-zinc-100 font-semibold">¡Bienvenido! Creemos tu tarjeta</div>
          <p className="text-sm text-zinc-400">¿Cómo te llamas?</p>
          <input required autoFocus className={input} value={name} onChange={e => setName(e.target.value)} />
          <button disabled={busy} className={btn} style={{ backgroundColor: color }}>Crear mi tarjeta</button>
        </form>
      )}

      {step === 'waiting' && req && (
        <>
          <div className={`${box} p-6 text-center space-y-2`}>
            <div className="text-sm text-zinc-400">Muestra esta pantalla en caja</div>
            <div className="font-mono text-5xl font-extrabold tracking-[0.35em] text-zinc-100 zl-pulse">{req.short_code}</div>
            <div className="text-xs text-zinc-500 flex items-center justify-center gap-1"><Clock size={12} />Esperando que el cajero apruebe tu sello…</div>
          </div>
          {req.card && <LoyaltyCardVisual card={req.card} program={req.card.program} companyName={req.card.company?.name} color={color} />}
        </>
      )}

      {step === 'done' && final?.card && (
        <>
          <div className="text-center space-y-1 zl-rise">
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center zl-burst" style={{ backgroundColor: color }}>
              <Stamp size={30} className="text-zinc-950" />
            </div>
            <div className="text-2xl font-bold text-zinc-100">¡Sello agregado!</div>
            {final.card.balance >= final.card.program.stamps_goal
              ? <div className="text-sm font-semibold" style={{ color }}>¡Completaste tu tarjeta! Pide tu {final.card.program.reward_description || 'premio'} en caja.</div>
              : <div className="text-sm text-zinc-400">Te faltan {final.card.program.stamps_goal - final.card.balance} para tu {final.card.program.reward_description || 'premio'}.</div>}
            {(info?.channels?.email || info?.channels?.whatsapp) && <div className="text-xs text-zinc-500">Te enviamos el comprobante.</div>}
          </div>
          <LoyaltyCardVisual card={final.card} program={final.card.program} companyName={final.card.company?.name} color={color} popIndex={final.card.balance - 1} />
        </>
      )}

      {step === 'ended' && (
        <div className={`${box} p-6 text-center space-y-3`}>
          <div className="text-zinc-100 font-semibold">{final?.status === 'expired' ? 'La solicitud venció' : 'El sello no se agregó'}</div>
          <div className="text-sm text-zinc-400">{final?.message || (final?.status === 'expired' ? 'Nadie la aprobó a tiempo. Puedes pedirla de nuevo frente a la caja.' : 'El cajero no aprobó la solicitud.')}</div>
          <button onClick={retry} className={btn} style={{ backgroundColor: color }}>Pedir de nuevo</button>
        </div>
      )}

      {step === 'error' && <div className={`${box} p-6 text-center text-sm text-zinc-300`}>{msg}</div>}
      {msg && step !== 'error' && <div className="text-center text-sm text-red-400">{msg}</div>}
    </PublicShell>
  );
}
