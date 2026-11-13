import React, { useEffect, useMemo, useState } from 'react';
import { Download, Paperclip, PlusCircle, RefreshCw, X, TrendingUp, TrendingDown } from 'lucide-react';

const MONEY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (val) => MONEY_FORMAT.format(parseFloat(val) || 0);

export const PAYMENT_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia / QR', other: 'Otro' };

export const TX_TYPE_INFO = {
  income: { label: 'Ingreso', sign: '+', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', amount: 'text-emerald-400' },
  expense: { label: 'Gasto', sign: '-', className: 'bg-rose-500/15 text-rose-400 border-rose-500/30', amount: 'text-rose-400' },
  withdrawal: { label: 'Retiro', sign: '-', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30', amount: 'text-amber-300' },
  deposit: { label: 'Depósito', sign: '+', className: 'bg-sky-500/15 text-sky-300 border-sky-500/30', amount: 'text-sky-300' }
};

// Dólar estadounidense: billetes y monedas (mismo orden que el backend)
export const DENOMINATIONS = [
  { key: '100', label: '$100', kind: 'Billete' }, { key: '50', label: '$50', kind: 'Billete' },
  { key: '20', label: '$20', kind: 'Billete' }, { key: '10', label: '$10', kind: 'Billete' },
  { key: '5', label: '$5', kind: 'Billete' }, { key: '1', label: '$1', kind: 'Billete / moneda' },
  { key: '0.25', label: '25¢', kind: 'Moneda' }, { key: '0.10', label: '10¢', kind: 'Moneda' },
  { key: '0.05', label: '5¢', kind: 'Moneda' }, { key: '0.01', label: '1¢', kind: 'Moneda' }
];

// Suma exacta en centavos (evita errores de punto flotante)
export const denominationTotal = (counts) =>
  DENOMINATIONS.reduce((cents, d) => cents + Math.round(parseFloat(d.key) * 100) * (parseInt(counts[d.key], 10) || 0), 0) / 100;

const inputClass = 'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500';
const btnSecondary = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 transition-colors disabled:opacity-50';

const errorDetail = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data.detail)) return data.detail.map(d => d.msg).join(' · ');
  return data.detail || fallback;
};

// ==============================================================
// CONTEO POR DENOMINACIÓN (cierre de caja)
// ==============================================================
export function DenominationCounter({ counts, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {DENOMINATIONS.map(d => {
        const qty = parseInt(counts[d.key], 10) || 0;
        return (
          <label key={d.key} className="flex items-center gap-2 text-[13px]">
            <span className="w-12 font-mono text-zinc-200">{d.label}</span>
            <span className="text-zinc-600">×</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={counts[d.key] ?? ''}
              onChange={e => onChange({ ...counts, [d.key]: e.target.value.replace(/[^0-9]/g, '') })}
              className="w-16 bg-[#121212] border border-[#2e2e2e] rounded-md px-2 py-1 font-mono text-zinc-100 outline-none focus:border-zinc-500"
              aria-label={`Cantidad de ${d.label}`}
              placeholder="0"
            />
            <span className="ml-auto font-mono text-[12px] text-zinc-500">{qty ? money(parseFloat(d.key) * qty) : ''}</span>
          </label>
        );
      })}
    </div>
  );
}

// ==============================================================
// COMPROBANTES
// ==============================================================
export const readReceiptFile = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) return reject(new Error('Usa una imagen (JPG, PNG, WEBP) o un PDF.'));
  if (file.size > 1_450_000) return reject(new Error('El archivo pesa más de 1.4 MB.'));
  const reader = new FileReader();
  reader.onload = () => resolve({ data_url: reader.result, filename: file.name });
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

export async function uploadReceipt({ apiFetch, apiBase, txId, receipt }) {
  const res = await apiFetch(`${apiBase}/api/finance/transactions/${txId}/receipt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt)
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'No se pudo adjuntar el comprobante.'));
}

export function ReceiptViewer({ apiFetch, apiBase, tx, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      const res = await apiFetch(`${apiBase}/api/finance/transactions/${tx.id}/receipt`);
      if (res.ok) setReceipt(await res.json());
      else setError(await errorDetail(res, 'No se pudo cargar el comprobante.'));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.id]);
  const isPdf = receipt?.data_url?.startsWith('data:application/pdf');
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md max-w-2xl w-full p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-100">Comprobante · movimiento #{tx.id}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Cerrar"><X size={16} /></button>
        </div>
        {error && <p className="text-[13px] text-rose-300">{error}</p>}
        {!receipt && !error && <p className="text-[13px] text-zinc-500">Cargando…</p>}
        {receipt && (isPdf
          ? <iframe title="Comprobante PDF" src={receipt.data_url} className="w-full h-[70vh] rounded-md bg-white" />
          : <img src={receipt.data_url} alt={receipt.filename} className="max-h-[70vh] mx-auto rounded-md" />)}
        {receipt && (
          <a href={receipt.data_url} download={receipt.filename} className={btnSecondary}>
            <Download size={14} /> Descargar
          </a>
        )}
      </div>
    </div>
  );
}

export function ReceiptAttachButton({ apiFetch, apiBase, tx, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`p-1.5 rounded-md cursor-pointer transition-colors ${busy ? 'opacity-50' : 'text-zinc-500 hover:text-zinc-200 hover:bg-[#252525]'}`} title="Adjuntar comprobante">
      <Paperclip size={13} />
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        disabled={busy}
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await uploadReceipt({ apiFetch, apiBase, txId: tx.id, receipt: await readReceiptFile(file) });
            toast('Comprobante adjuntado');
            onDone();
          } catch (err) {
            toast(err.message, true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

// ==============================================================
// REPORTES (estado de resultados por rango)
// ==============================================================
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PRESETS = [
  ['this_month', 'Este mes', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n]; }],
  ['last_month', 'Mes anterior', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)]; }],
  ['last_30', 'Últimos 30 días', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29), n]; }],
  ['this_year', 'Este año', () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), n]; }]
];
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`; };

function Change({ pct, invert = false }) {
  if (pct === null || pct === undefined) return <span className="text-[12px] text-zinc-500">sin datos del período anterior</span>;
  const good = invert ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] ${good ? 'text-emerald-400' : 'text-rose-400'}`}>
      <Icon size={12} /> {pct > 0 ? '+' : ''}{pct}% vs. período anterior
    </span>
  );
}

export function FinanceReports({ apiFetch, apiBase, toast, categoryLabels }) {
  const [preset, setPreset] = useState('this_month');
  const initial = PRESETS[0][2]();
  const [range, setRange] = useState({ start: ymd(initial[0]), end: ymd(initial[1]) });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (r = range) => {
    setLoading(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/reports?start=${r.start}&end=${r.end}`);
      if (!res.ok) throw new Error(await errorDetail(res, 'No se pudo generar el reporte.'));
      setReport(await res.json());
    } catch (err) {
      toast(err.message, true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const applyPreset = (id) => {
    const [a, b] = PRESETS.find(p => p[0] === id)[2]();
    const r = { start: ymd(a), end: ymd(b) };
    setPreset(id);
    setRange(r);
    load(r);
  };

  const exportCsv = () => {
    if (!report) return;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['Estado de resultados', `${report.start} a ${report.end}`].map(q).join(','),
      '',
      ['Concepto', 'Monto'].map(q).join(','),
      [q('Ingresos'), report.income.toFixed(2)].join(','),
      [q('Gastos'), report.expense.toFixed(2)].join(','),
      [q('Utilidad neta'), report.net.toFixed(2)].join(','),
      '',
      ['Mes', 'Ingresos', 'Gastos', 'Utilidad'].map(q).join(','),
      ...report.monthly.map(m => [q(monthLabel(m.month)), m.income.toFixed(2), m.expense.toFixed(2), m.net.toFixed(2)].join(',')),
      '',
      ['Tipo', 'Categoría', 'Monto'].map(q).join(','),
      ...report.by_category.map(c => [q(c.type === 'income' ? 'Ingreso' : 'Gasto'), q(c.label), c.amount.toFixed(2)].join(','))
    ];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estado_resultados_${report.start}_${report.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const income = report?.by_category.filter(c => c.type === 'income') || [];
  const expense = report?.by_category.filter(c => c.type === 'expense') || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex p-0.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
          {PRESETS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => applyPreset(id)}
              className={`px-3 py-1 rounded text-[13px] transition-colors ${preset === id ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="date" value={range.start} onChange={e => { setPreset(''); setRange({ ...range, start: e.target.value }); }} className={`${inputClass} w-auto py-1.5`} aria-label="Desde" />
          <span className="text-zinc-500 text-[13px]">a</span>
          <input type="date" value={range.end} onChange={e => { setPreset(''); setRange({ ...range, end: e.target.value }); }} className={`${inputClass} w-auto py-1.5`} aria-label="Hasta" />
          <button onClick={() => load()} className={btnSecondary} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Ver
          </button>
        </div>
        <button onClick={exportCsv} disabled={!report} className={`${btnSecondary} ml-auto`}>
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {!report ? (
        <div className="p-8 text-center text-zinc-500 text-[13px]">{loading ? 'Generando reporte…' : 'Sin datos.'}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ['Ingresos', report.income, 'text-zinc-100', report.previous.income_change_pct, false],
              ['Gastos', report.expense, 'text-zinc-100', report.previous.expense_change_pct, true],
              ['Utilidad neta', report.net, report.net >= 0 ? 'text-emerald-400' : 'text-rose-400', report.previous.net_change_pct, false]
            ].map(([label, value, cls, pct, invert]) => (
              <div key={label} className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-1">
                <span className="text-[13px] text-zinc-400">{label}</span>
                <p className={`text-2xl font-medium font-mono ${cls}`}>{money(value)}</p>
                <Change pct={pct} invert={invert} />
              </div>
            ))}
          </div>
          <p className="text-[12px] text-zinc-500">
            {report.transactions} movimientos · margen {report.margin_pct ?? '—'}% · comparado con {report.previous.start} a {report.previous.end}.
            {(report.withdrawals > 0 || report.deposits > 0) && ` Retiros de caja ${money(report.withdrawals)} y depósitos ${money(report.deposits)} no cuentan en la utilidad.`}
          </p>

          <div className="bg-[#171717] border border-[#2e2e2e] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2e2e2e] text-[13px] font-medium text-zinc-200">Por mes</div>
            {report.monthly.length === 0 ? (
              <p className="p-4 text-[13px] text-zinc-500">Sin movimientos en el rango.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-zinc-500">
                  <tr><th className="text-left font-normal px-4 py-2">Mes</th><th className="text-right font-normal px-4 py-2">Ingresos</th><th className="text-right font-normal px-4 py-2">Gastos</th><th className="text-right font-normal px-4 py-2">Utilidad</th></tr>
                </thead>
                <tbody className="divide-y divide-[#242424] font-mono">
                  {report.monthly.map(m => (
                    <tr key={m.month}>
                      <td className="px-4 py-2 font-sans text-zinc-200 capitalize">{monthLabel(m.month)}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">{money(m.income)}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">{money(m.expense)}</td>
                      <td className={`px-4 py-2 text-right ${m.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{money(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[['Ingresos por categoría', income, report.income], ['Gastos por categoría', expense, report.expense]].map(([title, rows, total]) => (
              <div key={title} className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2.5">
                <h3 className="text-[13px] font-medium text-zinc-200">{title}</h3>
                {rows.length === 0 && <p className="text-[13px] text-zinc-500">Sin datos.</p>}
                {rows.map(c => {
                  const pct = total ? Math.round((c.amount / total) * 100) : 0;
                  return (
                    <div key={c.key} className="space-y-1">
                      <div className="flex justify-between text-[13px]"><span className="text-zinc-300">{categoryLabels[c.key] || c.label}</span><span className="font-mono text-zinc-200">{money(c.amount)} · {pct}%</span></div>
                      <div className="h-1.5 bg-[#252525] rounded-full overflow-hidden"><div className="h-full bg-zinc-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2.5">
              <h3 className="text-[13px] font-medium text-zinc-200">Ingresos por método de pago</h3>
              {Object.keys(report.by_method).length === 0 && <p className="text-[13px] text-zinc-500">Sin datos.</p>}
              {Object.entries(report.by_method).map(([m, amt]) => {
                const pct = report.income ? Math.round((amt / report.income) * 100) : 0;
                return (
                  <div key={m} className="space-y-1">
                    <div className="flex justify-between text-[13px]"><span className="text-zinc-300">{PAYMENT_LABELS[m] || m}</span><span className="font-mono text-zinc-200">{money(amt)} · {pct}%</span></div>
                    <div className="h-1.5 bg-[#252525] rounded-full overflow-hidden"><div className="h-full bg-zinc-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==============================================================
// CATEGORÍAS
// ==============================================================
export function FinanceCategories({ apiFetch, apiBase, toast, categories, onChanged }) {
  const [form, setForm] = useState({ label: '', type: 'expense' });
  const [editing, setEditing] = useState(null); // { key, label }
  const [busy, setBusy] = useState(false);

  const call = async (url, method, body, ok) => {
    setBusy(true);
    try {
      const res = await apiFetch(`${apiBase}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await errorDetail(res, 'No se pudo guardar.'));
      toast(ok);
      onChanged();
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const groups = [['expense', 'Gastos'], ['income', 'Ingresos']];
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2 p-4 bg-[#171717] border border-[#2e2e2e] rounded-md"
        onSubmit={async e => {
          e.preventDefault();
          if (await call('/api/finance/categories', 'POST', { label: form.label.trim(), type: form.type }, 'Categoría creada')) setForm({ ...form, label: '' });
        }}
      >
        <label className="flex-1 min-w-[200px] space-y-1">
          <span className="text-[13px] text-zinc-400">Nueva categoría</span>
          <input className={inputClass} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Ej: Publicidad, Gasolina, Empaques" required minLength={2} />
        </label>
        <select className={`${inputClass} w-auto`} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} aria-label="Tipo">
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
        </select>
        <button type="submit" disabled={busy} className={btnSecondary}><PlusCircle size={14} /> Agregar</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(([type, title]) => (
          <div key={type} className="bg-[#171717] border border-[#2e2e2e] rounded-md">
            <div className="px-4 py-3 border-b border-[#2e2e2e] text-[13px] font-medium text-zinc-200">{title}</div>
            <ul className="divide-y divide-[#242424]">
              {categories.filter(c => c.type === type).map(c => (
                <li key={c.key} className={`flex items-center gap-2 px-4 py-2 text-[13px] ${c.active ? '' : 'opacity-50'}`}>
                  {editing?.key === c.key ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={async e => {
                        e.preventDefault();
                        if (await call(`/api/finance/categories/${c.key}`, 'PATCH', { label: editing.label.trim() }, 'Categoría actualizada')) setEditing(null);
                      }}
                    >
                      <input autoFocus className={`${inputClass} py-1`} value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} minLength={2} />
                      <button type="submit" className={btnSecondary} disabled={busy}>Guardar</button>
                      <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => setEditing(null)} aria-label="Cancelar"><X size={14} /></button>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 text-zinc-200">{c.label}</span>
                      {c.is_system && <span className="text-[11px] text-zinc-500">del sistema</span>}
                      {!c.active && <span className="text-[11px] text-zinc-500">desactivada</span>}
                      <button onClick={() => setEditing({ key: c.key, label: c.label })} className="text-[12px] text-zinc-400 hover:text-zinc-100">Renombrar</button>
                      {!c.is_system && (
                        <button
                          disabled={busy}
                          onClick={() => call(`/api/finance/categories/${c.key}`, 'PATCH', { active: !c.active }, c.active ? 'Categoría desactivada' : 'Categoría activada')}
                          className="text-[12px] text-zinc-400 hover:text-zinc-100"
                        >
                          {c.active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-zinc-500">Desactivar una categoría la oculta al registrar movimientos nuevos; los movimientos anteriores la conservan.</p>
    </div>
  );
}

// ==============================================================
// BITÁCORA DE AUDITORÍA
// ==============================================================
const AUDIT_LABELS = {
  shift_open: 'Apertura de caja', shift_close: 'Cierre de caja (corte Z)', tx_create: 'Movimiento registrado',
  tx_void: 'Movimiento anulado', receipt_attach: 'Comprobante adjuntado', category_create: 'Categoría creada', category_update: 'Categoría editada'
};

export function FinanceAudit({ apiFetch, apiBase, formatDate }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const res = await apiFetch(`${apiBase}/api/finance/audit?limit=300`);
    if (res.ok) setEntries((await res.json()).entries || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter(e => [e.actor, e.detail, AUDIT_LABELS[e.action], e.client_ip].some(v => (v || '').toLowerCase().includes(q))) : entries;
  }, [entries, filter]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={`${inputClass} max-w-sm`} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar por persona, acción o detalle…" />
        <button onClick={load} className={btnSecondary}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </div>
      <div className="bg-[#171717] border border-[#2e2e2e] rounded-md overflow-x-auto">
        <table className="w-full text-[13px] min-w-[760px]">
          <thead className="text-zinc-500 border-b border-[#2e2e2e]">
            <tr>
              <th className="text-left font-normal px-4 py-2">Fecha</th>
              <th className="text-left font-normal px-4 py-2">Acción</th>
              <th className="text-left font-normal px-4 py-2">Persona</th>
              <th className="text-left font-normal px-4 py-2">Detalle</th>
              <th className="text-left font-normal px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#242424]">
            {shown.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">{loading ? 'Cargando…' : 'Sin registros.'}</td></tr>
            )}
            {shown.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-2 font-mono text-[12px] text-zinc-400 whitespace-nowrap">{formatDate(e.created_at)}</td>
                <td className="px-4 py-2 text-zinc-200 whitespace-nowrap">
                  {AUDIT_LABELS[e.action] || e.action}{e.entity_id ? <span className="text-zinc-500"> #{e.entity_id}</span> : null}
                </td>
                <td className="px-4 py-2 text-zinc-300">{e.actor}</td>
                <td className="px-4 py-2 text-zinc-400">{e.detail}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-zinc-500">{e.client_ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-zinc-500">La bitácora no se puede editar ni borrar.</p>
    </div>
  );
}
