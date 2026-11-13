import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Wallet,
  Coins,
  Receipt,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  PlusCircle,
  Printer,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Calendar,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  Clock,
  User,
  FileText,
  Lock,
  Unlock,
  X,
  CreditCard,
  QrCode,
  Banknote,
  Layers,
  UtensilsCrossed,
  Paperclip,
  Ban
} from 'lucide-react';
import {
  DenominationCounter,
  denominationTotal,
  ReceiptViewer,
  ReceiptAttachButton,
  readReceiptFile,
  uploadReceipt,
  FinanceReports,
  FinanceCategories,
  FinanceAudit,
  TX_TYPE_INFO
} from './FinanceExtras';

const MONEY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (val) => MONEY_FORMAT.format(parseFloat(val) || 0);

const formatDate = (ts) => {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const CATEGORY_LABELS = {
  sale: 'Venta',
  refund: 'Reembolso',
  manual_income: 'Ingreso Extra',
  supplies: 'Insumos & Comida',
  services: 'Servicios (Luz/Agua/Gas)',
  withdrawal: 'Retiro de Efectivo',
  payroll: 'Nómina / Sueldos',
  maintenance: 'Mantenimiento',
  other: 'Otro'
};

const PAYMENT_LABELS = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia / QR',
  other: 'Otro'
};

export default function FinancePanel({
  apiFetch,
  apiBase,
  themeColor = '#3ecf8e',
  themeRgb = '62, 207, 142',
  showToast,
  subTab = 'shift',
  setSubTab
}) {
  const [currentShift, setCurrentShift] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Modales
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [ticketModal, setTicketModal] = useState(null); // { title, text }
  const [voidTarget, setVoidTarget] = useState(null); // { tx, reason }
  const [viewingReceipt, setViewingReceipt] = useState(null); // tx
  const [categories, setCategories] = useState([]);

  // Formularios
  const [openForm, setOpenForm] = useState({ opened_by: 'Caja Principal', initial_cash: '50.00', notes: '' });
  const [closeForm, setCloseForm] = useState({ counted_cash: '', notes: '' });
  const [closeMode, setCloseMode] = useState('count'); // 'count' (por billetes y monedas) | 'total'
  const [denomCounts, setDenomCounts] = useState({});
  const [receiptFile, setReceiptFile] = useState(null);
  const [txForm, setTxForm] = useState({
    type: 'expense',
    category: 'supplies',
    amount: '',
    payment_method: 'cash',
    description: '',
    created_by: 'Admin'
  });
  const [submitting, setSubmitting] = useState(false);

  // Filtros Libro de Movimientos
  const [txFilterType, setTxFilterType] = useState('all');
  const [txFilterMethod, setTxFilterMethod] = useState('all');
  const [txFilterSource, setTxFilterSource] = useState('all');
  const [txSearch, setTxSearch] = useState('');
  const [txRange, setTxRange] = useState({ start: '', end: '' });

  const toast = (msg, isErr = false) => showToast?.(msg, isErr);

  // ------------------------------------------------------------------
  // CARGA DE DATOS
  // ------------------------------------------------------------------
  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const range = txRange.start && txRange.end ? `&start=${txRange.start}&end=${txRange.end}` : '';
      const [resShift, resShifts, resTxs, resSummary, resCats] = await Promise.all([
        apiFetch(`${apiBase}/api/finance/shifts/current`),
        apiFetch(`${apiBase}/api/finance/shifts?limit=50`),
        apiFetch(`${apiBase}/api/finance/transactions?limit=500${range}`),
        apiFetch(`${apiBase}/api/finance/summary?days=30`),
        apiFetch(`${apiBase}/api/finance/categories?include_inactive=true`)
      ]);
      if (resCats.ok) setCategories((await resCats.json()).categories || []);

      if (resShift.ok) {
        const data = await resShift.json();
        setCurrentShift(data.shift);
      }
      if (resShifts.ok) {
        const data = await resShifts.json();
        setShifts(data.shifts || []);
      }
      if (resTxs.ok) {
        const data = await resTxs.json();
        setTransactions(data.transactions || []);
      }
      if (resSummary.ok) {
        const data = await resSummary.json();
        setSummary(data);
      }
    } catch (err) {
      console.warn('Error fetching finance data:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRange.start, txRange.end]);

  const categoryLabels = useMemo(
    () => ({ ...CATEGORY_LABELS, cash_movement: 'Movimiento de caja', ...Object.fromEntries(categories.map(c => [c.key, c.label])) }),
    [categories]
  );
  const activeCategories = (type) => categories.filter(c => c.type === type && c.active && c.key !== 'sale');
  const defaultCategory = (type) => (type === 'income' ? 'manual_income' : activeCategories('expense')[0]?.key || 'supplies');
  const openMovement = (type) => {
    setTxForm({
      type,
      category: defaultCategory(type),
      amount: '',
      payment_method: 'cash',
      description: '',
      created_by: currentShift?.opened_by || 'Admin'
    });
    setReceiptFile(null);
    setShowExpenseModal(true);
  };
  const canVoid = (t) => !t.voided_at && (t.source_module || 'manual') === 'manual'
    && (t.shift_id === null || t.shift_id === undefined || t.shift_id === currentShift?.id);

  const handleVoid = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/transactions/${voidTarget.tx.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidTarget.reason.trim(), voided_by: currentShift?.opened_by || 'Admin' })
      });
      if (res.ok) {
        toast(`Movimiento #${voidTarget.tx.id} anulado`);
        setVoidTarget(null);
        fetchAll(true);
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'No se pudo anular', true);
      }
    } catch {
      toast('Error de red al anular', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Sincronizar ventas del restaurante
  const handleSyncRestaurant = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/sync-restaurant`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast(`✅ Sincronización completa: ${data.count} ventas vinculadas`);
        fetchAll(true);
      } else {
        toast('Error al sincronizar con restaurante', true);
      }
    } catch {
      toast('Error de red al sincronizar', true);
    } finally {
      setSyncing(false);
    }
  };

  // Abrir turno
  const handleOpenShift = async (e) => {
    e.preventDefault();
    const initial = parseFloat(openForm.initial_cash) || 0;
    setSubmitting(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/shifts/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opened_by: openForm.opened_by.trim() || 'Caja Principal',
          initial_cash: initial,
          notes: openForm.notes.trim()
        })
      });
      if (res.ok) {
        toast('✅ Turno de caja abierto correctamente');
        setShowOpenModal(false);
        fetchAll(true);
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'No se pudo abrir el turno', true);
      }
    } catch {
      toast('Error de red al abrir turno', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Cerrar turno (Corte Z)
  const handleCloseShift = async (e) => {
    e.preventDefault();
    const byCount = closeMode === 'count';
    const counted = byCount ? denominationTotal(denomCounts) : parseFloat(closeForm.counted_cash);
    if (isNaN(counted) || counted < 0) {
      toast('Ingresa un monto de efectivo contado válido', true);
      return;
    }
    const denominations = Object.fromEntries(
      Object.entries(denomCounts).map(([k, v]) => [k, parseInt(v, 10) || 0]).filter(([, v]) => v > 0)
    );
    setSubmitting(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/shifts/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(byCount ? { denominations } : { counted_cash: counted }),
          notes: closeForm.notes.trim(),
          closed_by: currentShift?.opened_by || 'Admin'
        })
      });
      if (res.ok) {
        const data = await res.json();
        toast('🔒 Turno de caja cerrado (Corte Z registrado)');
        setShowCloseModal(false);
        fetchAll(true);
        // Mostrar ticket de cierre de inmediato
        handleShowTicket(data.shift?.id, 'Corte Final Z');
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'No se pudo cerrar el turno', true);
      }
    } catch {
      toast('Error de red al cerrar turno', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Registrar gasto o ingreso manual
  const handleCreateTransaction = async (e) => {
    e.preventDefault();
    const amt = parseFloat(txForm.amount);
    if (!amt || amt <= 0) {
      toast('El monto debe ser mayor a 0', true);
      return;
    }
    if (!txForm.description.trim()) {
      toast('Ingresa un concepto o descripción', true);
      return;
    }
    const isCashMovement = txForm.type === 'withdrawal' || txForm.type === 'deposit';
    let receipt = null;
    try {
      receipt = await readReceiptFile(receiptFile);
    } catch (err) {
      toast(err.message, true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`${apiBase}/api/finance/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: txForm.type,
          category: isCashMovement ? 'cash_movement' : txForm.category,
          amount: amt,
          payment_method: isCashMovement ? 'cash' : txForm.payment_method,
          description: txForm.description.trim(),
          created_by: txForm.created_by.trim() || 'Admin'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (receipt) {
          try {
            await uploadReceipt({ apiFetch, apiBase, txId: data.transaction.id, receipt });
          } catch (err) {
            toast(`Movimiento guardado, pero el comprobante no: ${err.message}`, true);
          }
        }
        toast(`✅ ${TX_TYPE_INFO[txForm.type].label} registrado`);
        setShowExpenseModal(false);
        setReceiptFile(null);
        fetchAll(true);
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'No se pudo registrar el movimiento', true);
      }
    } catch {
      toast('Error al registrar movimiento', true);
    } finally {
      setSubmitting(false);
    }
  };

  // Ver ticket térmico
  const handleShowTicket = async (shiftId, title = 'Corte de Caja') => {
    try {
      const url = shiftId
        ? `${apiBase}/api/finance/shifts/${shiftId}/ticket`
        : `${apiBase}/api/finance/shifts/current/ticket`;
      const res = await apiFetch(url);
      if (res.ok) {
        const text = await res.text();
        setTicketModal({ title, text });
      } else {
        toast('No se pudo generar el ticket', true);
      }
    } catch {
      toast('Error al obtener ticket', true);
    }
  };

  // Filtrado de transacciones
  const filteredTxs = useMemo(() => {
    return transactions.filter(t => {
      if (txFilterType !== 'all' && t.type !== txFilterType) return false;
      if (txFilterMethod !== 'all' && (t.payment_method || 'cash').toLowerCase() !== txFilterMethod) return false;
      if (txFilterSource !== 'all' && (t.source_module || 'manual').toLowerCase() !== txFilterSource) return false;
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase();
        const haystack = [
          t.description,
          t.category,
          String(t.amount),
          t.source_reference_id,
          t.created_by
        ].map(v => (v || '').toLowerCase());
        if (!haystack.some(v => v.includes(q))) return false;
      }
      return true;
    });
  }, [transactions, txFilterType, txFilterMethod, txFilterSource, txSearch]);

  // Exportar CSV
  const handleExportCSV = () => {
    if (filteredTxs.length === 0) {
      toast('No hay transacciones para exportar', true);
      return;
    }
    const headers = ['ID', 'Fecha', 'Tipo', 'Categoría', 'Origen', 'Referencia', 'Descripción', 'Método Pago', 'Monto'];
    const rows = filteredTxs.map(t => {
      const dt = t.created_at ? new Date(t.created_at).toLocaleString() : '';
      return [
        t.id,
        `"${dt}"`,
        `"${(TX_TYPE_INFO[t.type] || {}).label || t.type}${t.voided_at ? ' (anulado)' : ''}"`,
        `"${categoryLabels[t.category] || t.category}"`,
        `"${t.source_module || 'manual'}"`,
        `"${t.source_reference_id || ''}"`,
        `"${(t.description || '').replace(/"/g, '""')}"`,
        `"${PAYMENT_LABELS[t.payment_method] || t.payment_method}"`,
        parseFloat(t.amount || 0).toFixed(2)
      ].join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `movimientos_caja_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('✅ Archivo CSV descargado');
  };

  const SECTION_INFO = {
    shift: { title: 'Turno & Arqueo', description: 'Control de caja chica en tiempo real, arqueos, cortes y fondo inicial.' },
    shifts_history: { title: 'Historial de Cortes', description: 'Auditoría de turnos cerrados (Corte Z), diferencias y tickets térmicos.' },
    transactions: { title: 'Libro de Movimientos', description: 'Registro universal de ingresos automáticos y gastos operativos.' },
    reports: { title: 'Reportes', description: 'Estado de resultados por rango de fechas, por mes y categoría, comparado con el período anterior.' },
    categories: { title: 'Categorías', description: 'Categorías de ingresos y gastos que se usan al registrar movimientos.' },
    audit: { title: 'Bitácora', description: 'Quién abrió, cerró, registró o anuló cada movimiento, y cuándo.' }
  };

  return (
    <div className="max-w-full mx-auto space-y-4 animate-fadeIn pb-6">
      {/* Encabezado General */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-md bg-[#222222] text-emerald-400 border border-[#2e2e2e]">
              <Wallet size={18} />
            </span>
            <h1 className="text-xl font-medium tracking-tight text-zinc-100">
              {SECTION_INFO[subTab]?.title || 'Caja & Finanzas'}
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            {SECTION_INFO[subTab]?.description || 'Módulo financiero universal.'}
          </p>
        </div>

        {/* Acciones del Encabezado */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchAll(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#232323] hover:bg-[#2e2e2e] border border-[#3e3e3e] rounded-md text-xs font-medium text-zinc-200 transition-all"
            title="Refrescar datos (sincroniza en tiempo real)"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>

          <button
            onClick={() => openMovement('expense')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 transition-all shadow-sm"
            style={{ backgroundColor: themeColor }}
          >
            <PlusCircle size={13} />
            <span>Nuevo movimiento</span>
          </button>
        </div>
      </div>

      {/* ==============================================================
          PESTAÑA 1: TURNO ACTUAL & ARQUEO DE CAJA
          ============================================================== */}
      {subTab === 'shift' && (
        <div className="space-y-4">
          {currentShift ? (
            <>
              {/* Banner de Turno Abierto */}
              <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Unlock size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-zinc-100">
                        Turno de Caja Activo #{currentShift.id}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        EN CURSO
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Responsable: <strong className="text-zinc-200">{currentShift.opened_by}</strong> · Abierto:{' '}
                      {currentShift.opened_at ? new Date(currentShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                      {currentShift.notes && <span className="ml-1 text-zinc-500">({currentShift.notes})</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleShowTicket(currentShift.id, 'Corte Parcial X')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-xs font-medium text-zinc-200 transition-all"
                  >
                    <Printer size={13} />
                    <span>Corte X (Parcial)</span>
                  </button>
                  <button
                    onClick={() => {
                      setCloseForm({ counted_cash: '', notes: '' });
                      setDenomCounts({});
                      setCloseMode('count');
                      setShowCloseModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-all shadow-sm"
                  >
                    <Lock size={13} />
                    <span>Cerrar Turno (Corte Z)</span>
                  </button>
                </div>
              </div>

              {/* Grid de Métricas de Caja */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider block">
                    Fondo Inicial (Base)
                  </span>
                  <p className="text-xl font-bold font-mono text-zinc-100 mt-1">
                    {money(currentShift.initial_cash)}
                  </p>
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">Para cambio / apertura</span>
                </div>

                <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider block">
                    Ventas en Efectivo
                  </span>
                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    +{money(currentShift.total_sales_cash)}
                  </p>
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">Ingresos en billetes/monedas</span>
                </div>

                <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider block">
                    Ventas Digitales
                  </span>
                  <p className="text-xl font-bold font-mono text-sky-400 mt-1">
                    +{money((currentShift.total_sales_card || 0) + (currentShift.total_sales_transfer || 0))}
                  </p>
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">Tarjeta, Transferencia y QR</span>
                </div>

                <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider block">
                    Salidas de efectivo
                  </span>
                  <p className="text-xl font-bold font-mono text-rose-400 mt-1">
                    -{money((currentShift.total_expenses_cash || 0) + (currentShift.total_withdrawals || 0))}
                  </p>
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    Gastos {money(currentShift.total_expenses_cash)} · Retiros {money(currentShift.total_withdrawals)}
                  </span>
                </div>
              </div>

              {/* Tarjeta de Arqueo Teórico en Cajón */}
              <div className="p-5 bg-gradient-to-r from-[#171717] to-[#1a1a1a] border border-[#2e2e2e] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <span className="text-xs uppercase font-bold text-zinc-400 tracking-wider">
                    Efectivo Teórico Esperado en Cajón
                  </span>
                  <p className="text-3xl font-extrabold font-mono text-emerald-400 mt-1">
                    {money(currentShift.expected_cash)}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Fondo {money(currentShift.initial_cash)} + ventas en efectivo {money(currentShift.total_sales_cash)}
                    {currentShift.total_deposits > 0 && <> + depósitos {money(currentShift.total_deposits)}</>}
                    {' '}− gastos {money(currentShift.total_expenses_cash)}
                    {currentShift.total_withdrawals > 0 && <> − retiros {money(currentShift.total_withdrawals)}</>}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {[
                    ['expense', 'Gasto', ArrowDownLeft, 'text-rose-400'],
                    ['withdrawal', 'Retiro de caja', Banknote, 'text-amber-300'],
                    ['deposit', 'Depósito a caja', Coins, 'text-sky-300'],
                    ['income', 'Ingreso extra', ArrowUpRight, 'text-emerald-400']
                  ].map(([type, label, Icon, color]) => (
                    <button
                      key={type}
                      onClick={() => openMovement(type)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] border border-[#3e3e3e] text-[13px] font-medium text-zinc-100 transition-colors"
                    >
                      <Icon size={14} className={color} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Vista de Caja Cerrada */
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-xl mx-auto my-6 space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#222222] border border-[#2f2f2f] flex items-center justify-center mx-auto text-zinc-400">
                <Lock size={24} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-100">La caja se encuentra cerrada</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Abre un nuevo turno de caja para comenzar a registrar ventas en efectivo, ingresos y gastos de operación.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setShowOpenModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-xs text-black shadow-md hover:brightness-110 transition-all"
                  style={{ backgroundColor: themeColor }}
                >
                  <Unlock size={14} />
                  <span>Abrir Turno de Caja</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==============================================================
          PESTAÑA 2: HISTORIAL DE CORTES (CIERRES Z)
          ============================================================== */}
      {subTab === 'shifts_history' && (
        <div className="space-y-3">
          {shifts.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md text-zinc-500 text-xs">
              No hay turnos registrados aún.
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717] shadow-sm">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-260px)] min-h-[320px]">
                <table className="w-full text-left border-collapse text-xs min-w-[1150px] whitespace-nowrap">
                  <thead className="sticky top-0 bg-[#141414] z-10 border-b border-[#2e2e2e] shadow-sm">
                    <tr className="text-zinc-400 font-medium">
                      <th className="py-3 px-4 font-semibold text-zinc-300">#Turno</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Responsable</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Apertura</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Cierre</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Fondo Inicial</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Ventas Efectivo</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Gastos Efectivo</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Efectivo Teórico</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Efectivo Contado</th>
                      <th className="py-3 px-4 text-center font-semibold text-zinc-300">Diferencia</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424]">
                    {shifts.map(sh => {
                      const diff = parseFloat(sh.difference || 0);
                      const isExact = Math.abs(diff) < 0.01;
                      const isOpen = sh.status === 'open';

                      return (
                        <tr key={sh.id} className="hover:bg-[#1a1a1a] transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-zinc-200">
                            #{sh.id}
                          </td>
                          <td className="py-3 px-4 font-medium text-zinc-200">
                            {sh.opened_by || 'Caja'}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-zinc-400">
                            {formatDate(sh.opened_at)}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {isOpen ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                EN CURSO
                              </span>
                            ) : (
                              <span className="text-zinc-400">{formatDate(sh.closed_at)}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-zinc-300">
                            {money(sh.initial_cash)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-400">
                            +{money(sh.total_sales_cash)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-rose-400">
                            -{money(sh.total_expenses_cash)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-zinc-200">
                            {money(sh.expected_cash)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-zinc-100">
                            {isOpen ? '-' : money(sh.counted_cash)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isOpen ? (
                              <span className="text-zinc-500 text-[10px]">-</span>
                            ) : isExact ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                Exacto $0.00
                              </span>
                            ) : diff < 0 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
                                Faltante -{money(Math.abs(diff))}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                Sobrante +{money(diff)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleShowTicket(sh.id, isOpen ? 'Corte Parcial X' : 'Corte Final Z')}
                              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#252525] rounded transition-colors"
                              title="Imprimir ticket térmico"
                            >
                              <Printer size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==============================================================
          PESTAÑA 3: LIBRO DE MOVIMIENTOS Y TRANSACCIONES
          ============================================================== */}
      {subTab === 'transactions' && (
        <div className="space-y-3">
          {/* Barra de Filtros */}
          <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                placeholder="Buscar por concepto, cliente o #referencia..."
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={txFilterType}
                onChange={e => setTxFilterType(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value="all">Todos los tipos</option>
                <option value="income">Ingresos</option>
                <option value="expense">Gastos</option>
                <option value="withdrawal">Retiros de caja</option>
                <option value="deposit">Depósitos a caja</option>
              </select>

              <select
                value={txFilterMethod}
                onChange={e => setTxFilterMethod(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value="all">Todos los métodos</option>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia / QR</option>
              </select>

              <select
                value={txFilterSource}
                onChange={e => setTxFilterSource(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value="all">Todos los orígenes</option>
                <option value="restaurant">Restaurante</option>
                <option value="manual">Manual / Caja</option>
              </select>

              <input
                type="date"
                value={txRange.start}
                onChange={e => setTxRange(r => ({ start: e.target.value, end: r.end || e.target.value }))}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                aria-label="Desde"
              />
              <input
                type="date"
                value={txRange.end}
                onChange={e => setTxRange(r => ({ start: r.start || e.target.value, end: e.target.value }))}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                aria-label="Hasta"
              />
              {(txRange.start || txRange.end) && (
                <button onClick={() => setTxRange({ start: '', end: '' })} className="text-xs text-zinc-400 hover:text-zinc-200">Quitar fechas</button>
              )}

              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#232323] hover:bg-[#2e2e2e] border border-[#3e3e3e] text-zinc-300 text-xs font-medium"
              >
                <Download size={12} />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {/* Tabla de Movimientos */}
          {filteredTxs.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md text-zinc-500 text-xs">
              No hay movimientos con los filtros seleccionados.
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717] shadow-sm">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[320px]">
                <table className="w-full text-left border-collapse text-xs min-w-[1050px] whitespace-nowrap">
                  <thead className="sticky top-0 bg-[#141414] z-10 border-b border-[#2e2e2e] shadow-sm">
                    <tr className="text-zinc-400 font-medium">
                      <th className="py-3 px-4 font-semibold text-zinc-300">#ID</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Fecha y Hora</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Tipo</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Origen</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Categoría</th>
                      <th className="py-3 px-4 font-semibold text-zinc-300">Concepto / Descripción</th>
                      <th className="py-3 px-4 text-center font-semibold text-zinc-300">Método</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300">Monto</th>
                      <th className="py-3 px-4 text-right font-semibold text-zinc-300"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424]">
                    {filteredTxs.map(t => {
                      const typeInfo = TX_TYPE_INFO[t.type] || TX_TYPE_INFO.expense;
                      const isInc = t.type === 'income';
                      const isRest = t.source_module === 'restaurant';
                      const isVoided = !!t.voided_at;

                      return (
                        <tr
                          key={t.id}
                          className={`hover:bg-[#1a1a1a] transition-colors ${isVoided ? 'opacity-50' : ''}`}
                          title={isVoided ? `Anulado: ${t.void_reason || ''}` : undefined}
                        >
                          <td className="py-3 px-4 font-mono text-zinc-400">
                            #{t.id}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-zinc-400">
                            {formatDate(t.created_at)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${typeInfo.className}`}>
                              {typeInfo.sign === '+' ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
                              {typeInfo.label}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {isRest ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                🍔 Restaurante
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                                ✍️ Caja
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-zinc-300 font-medium">
                            {categoryLabels[t.category] || t.category}
                          </td>
                          <td className="py-3 px-4 font-medium text-zinc-200">
                            <span className={isVoided ? 'line-through' : ''}>{t.description || '-'}</span>
                            {isVoided && (
                              <span className="block text-[11px] text-rose-300/80 mt-0.5">
                                Anulado · {t.void_reason || 'sin motivo'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#202020] text-zinc-300 border border-[#2d2d2d]">
                              {PAYMENT_LABELS[t.payment_method] || t.payment_method}
                            </span>
                          </td>
                          <td className={`py-3 px-4 text-right font-mono font-bold text-sm ${isVoided ? 'line-through text-zinc-500' : typeInfo.amount}`}>
                            {typeInfo.sign}{money(t.amount)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="inline-flex items-center gap-0.5">
                              {t.has_receipt ? (
                                <button onClick={() => setViewingReceipt(t)} className="p-1.5 rounded-md text-sky-300 hover:bg-[#252525]" title={`Ver comprobante (${t.receipt_name || 'archivo'})`}>
                                  <Paperclip size={13} />
                                </button>
                              ) : !isVoided && (
                                <ReceiptAttachButton apiFetch={apiFetch} apiBase={apiBase} tx={t} toast={toast} onDone={() => fetchAll(true)} />
                              )}
                              {canVoid(t) && (
                                <button onClick={() => setVoidTarget({ tx: t, reason: '' })} className="p-1.5 rounded-md text-zinc-500 hover:text-rose-300 hover:bg-[#252525]" title="Anular movimiento">
                                  <Ban size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==============================================================
          PESTAÑA 4: RESUMEN Y ESTADO DE RESULTADOS (P&L)
          ============================================================== */}
      {subTab === 'reports' && (
        <FinanceReports apiFetch={apiFetch} apiBase={apiBase} toast={toast} categoryLabels={categoryLabels} />
      )}

      {subTab === 'categories' && (
        <FinanceCategories apiFetch={apiFetch} apiBase={apiBase} toast={toast} categories={categories} onChanged={() => fetchAll(true)} />
      )}

      {subTab === 'audit' && (
        <FinanceAudit apiFetch={apiFetch} apiBase={apiBase} formatDate={formatDate} />
      )}

      {/* ==============================================================
          MODAL: ABRIR TURNO DE CAJA
          ============================================================== */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#262626] pb-3">
              <div className="flex items-center gap-2">
                <Unlock size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-zinc-100">Apertura de Turno de Caja</h3>
              </div>
              <button onClick={() => setShowOpenModal(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleOpenShift} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Responsable / Cajero:</label>
                <input
                  type="text"
                  required
                  value={openForm.opened_by}
                  onChange={e => setOpenForm({ ...openForm, opened_by: e.target.value })}
                  placeholder="Ej: Jonathan / Caja 1"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Fondo Inicial de Cambio ($):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={openForm.initial_cash}
                  onChange={e => setOpenForm({ ...openForm, initial_cash: e.target.value })}
                  placeholder="50.00"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-sm font-mono font-bold text-emerald-400 outline-none focus:border-zinc-500"
                />
                <span className="text-[10px] text-zinc-500 mt-0.5 block">Billetes y monedas con los que arranca el cajón.</span>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Notas (opcional):</label>
                <input
                  type="text"
                  value={openForm.notes}
                  onChange={e => setOpenForm({ ...openForm, notes: e.target.value })}
                  placeholder="Ej: Turno matutino, billetes chicos"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262626]">
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] text-zinc-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded font-semibold text-black hover:brightness-110 transition-all shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  {submitting ? 'Abriendo...' : 'Abrir Turno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: CERRAR TURNO (CORTE Z Y ARQUEO FÍSICO)
          ============================================================== */}
      {showCloseModal && currentShift && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-lg w-full p-5 space-y-4 shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#262626] pb-3">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-rose-400" />
                <h3 className="text-sm font-bold text-zinc-100">Cierre de Turno & Arqueo (Corte Z)</h3>
              </div>
              <button onClick={() => setShowCloseModal(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>

            {/* Resumen del Arqueo */}
            <div className="p-3 bg-[#121212] border border-[#262626] rounded-md space-y-1.5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>(+) Fondo inicial:</span>
                <span className="font-mono">{money(currentShift.initial_cash)}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>(+) Ventas efectivo:</span>
                <span className="font-mono">+{money(currentShift.total_sales_cash)}</span>
              </div>
              <div className="flex justify-between text-rose-400">
                <span>(-) Gastos efectivo:</span>
                <span className="font-mono">-{money(currentShift.total_expenses_cash)}</span>
              </div>
              {currentShift.total_deposits > 0 && (
                <div className="flex justify-between text-sky-300">
                  <span>(+) Depósitos a caja:</span>
                  <span className="font-mono">+{money(currentShift.total_deposits)}</span>
                </div>
              )}
              {currentShift.total_withdrawals > 0 && (
                <div className="flex justify-between text-amber-300">
                  <span>(-) Retiros de caja:</span>
                  <span className="font-mono">-{money(currentShift.total_withdrawals)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t border-[#262626] text-zinc-100">
                <span>(=) Efectivo esperado en cajón:</span>
                <span className="font-mono text-emerald-400 text-sm">{money(currentShift.expected_cash)}</span>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-3 text-xs">
              <div className="flex p-0.5 bg-[#121212] border border-[#2e2e2e] rounded-md text-[13px]">
                {[['count', 'Contar billetes y monedas'], ['total', 'Escribir el total']].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCloseMode(mode)}
                    className={`flex-1 py-1 rounded transition-colors ${closeMode === mode ? 'bg-[#2e2e2e] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {closeMode === 'count' ? (
                <div className="space-y-2">
                  <DenominationCounter counts={denomCounts} onChange={setDenomCounts} />
                  <div className="flex justify-between pt-2 border-t border-[#262626] text-[13px]">
                    <span className="text-zinc-300">Total contado</span>
                    <span className="font-mono font-medium text-zinc-100">{money(denominationTotal(denomCounts))}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-zinc-300 mb-1 font-medium">Efectivo contado ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    autoFocus
                    value={closeForm.counted_cash}
                    onChange={e => setCloseForm({ ...closeForm, counted_cash: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-base font-mono font-bold text-zinc-100 outline-none focus:border-zinc-400"
                  />
                </div>
              )}

              {/* Verificación de diferencia en tiempo real */}
              {(closeMode === 'count' ? Object.values(denomCounts).some(v => v !== '' && v !== undefined) : closeForm.counted_cash !== '' && !isNaN(parseFloat(closeForm.counted_cash))) && (
                (() => {
                  const countedNow = closeMode === 'count' ? denominationTotal(denomCounts) : parseFloat(closeForm.counted_cash);
                  const diff = Math.round((countedNow - (currentShift.expected_cash || 0)) * 100) / 100;
                  const isExact = Math.abs(diff) < 0.01;
                  return (
                    <div className={`p-2.5 rounded-md border text-xs font-semibold ${
                      isExact
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : diff < 0
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    }`}>
                      {isExact && '✓ Arqueo Cuadrado Exacto ($0.00)'}
                      {diff < 0 && `⚠️ FALTANTE EN CAJA: -${money(Math.abs(diff))}`}
                      {diff > 0 && `ℹ️ SOBRANTE EN CAJA: +${money(diff)}`}
                    </div>
                  );
                })()
              )}

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Notas de Cierre (opcional):</label>
                <input
                  type="text"
                  value={closeForm.notes}
                  onChange={e => setCloseForm({ ...closeForm, notes: e.target.value })}
                  placeholder="Ej: Se entregó el dinero a gerencia"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262626]">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] text-zinc-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded font-bold text-white bg-rose-600 hover:bg-rose-500 transition-all shadow-sm"
                >
                  {submitting ? 'Cerrando...' : 'Confirmar Cierre de Caja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: NUEVO MOVIMIENTO (GASTO O INGRESO EXTRA)
          ============================================================== */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#262626] pb-3">
              <div className="flex items-center gap-2">
                <PlusCircle size={16} className={TX_TYPE_INFO[txForm.type].amount} />
                <h3 className="text-sm font-bold text-zinc-100">
                  Registrar {TX_TYPE_INFO[txForm.type].label.toLowerCase()}
                </h3>
              </div>
              <button onClick={() => setShowExpenseModal(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0.5 p-0.5 bg-[#121212] border border-[#2e2e2e] rounded-md">
                {['expense', 'income', 'withdrawal', 'deposit'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTxForm({ ...txForm, type, category: defaultCategory(type) })}
                    className={`py-1 rounded text-[12px] font-medium transition-colors border ${
                      txForm.type === type ? TX_TYPE_INFO[type].className : 'border-transparent text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {TX_TYPE_INFO[type].label}
                  </button>
                ))}
              </div>
              {(txForm.type === 'withdrawal' || txForm.type === 'deposit') && (
                <p className="text-[12px] text-zinc-500">
                  {txForm.type === 'withdrawal'
                    ? 'Sacar efectivo del cajón (p. ej. para depositar al banco). Baja el efectivo esperado, pero no es un gasto.'
                    : 'Meter efectivo al cajón (p. ej. más cambio). Sube el efectivo esperado, pero no es una venta.'}
                </p>
              )}

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Monto ($):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  autoFocus
                  value={txForm.amount}
                  onChange={e => setTxForm({ ...txForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-base font-mono font-bold text-zinc-100 outline-none focus:border-zinc-400"
                />
              </div>

              {(txForm.type === 'income' || txForm.type === 'expense') && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-zinc-400 mb-1 font-medium">Categoría</label>
                    <select
                      value={txForm.category}
                      onChange={e => setTxForm({ ...txForm, category: e.target.value })}
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-200 outline-none"
                    >
                      {activeCategories(txForm.type).map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1 font-medium">Método de pago</label>
                    <select
                      value={txForm.payment_method}
                      onChange={e => setTxForm({ ...txForm, payment_method: e.target.value })}
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-200 outline-none"
                    >
                      <option value="cash">Efectivo (cajón)</option>
                      <option value="card">Tarjeta</option>
                      <option value="transfer">Transferencia</option>
                      <option value="other">Otro</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Concepto / Motivo:</label>
                <input
                  type="text"
                  required
                  value={txForm.description}
                  onChange={e => setTxForm({ ...txForm, description: e.target.value })}
                  placeholder="Ej: Compra de 2 bolsas de hielo y servilletas"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              {txForm.type !== 'deposit' && (
                <div>
                  <label className="block text-zinc-400 mb-1 font-medium">Comprobante (opcional)</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={e => setReceiptFile(e.target.files?.[0] || null)}
                    className="w-full text-[12px] text-zinc-400 file:mr-2 file:px-3 file:py-1 file:rounded-md file:border file:border-[#3e3e3e] file:bg-[#232323] file:text-zinc-200"
                  />
                  <span className="text-[11px] text-zinc-500">Foto de la factura o recibo (JPG, PNG, WEBP o PDF, máx. 1.4 MB).</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262626]">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] text-zinc-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded font-bold text-black hover:brightness-110 transition-all shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  {submitting ? 'Guardando...' : 'Guardar Movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
          <form onSubmit={handleVoid} className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md max-w-md w-full p-5 space-y-3">
            <h3 className="text-sm font-medium text-zinc-100">Anular movimiento #{voidTarget.tx.id}</h3>
            <p className="text-[13px] text-zinc-400">
              {voidTarget.tx.description} · {money(voidTarget.tx.amount)}. El movimiento queda en el libro marcado como anulado y deja de contar en los totales.
            </p>
            <label className="block space-y-1">
              <span className="text-[13px] text-zinc-300">Motivo</span>
              <input
                autoFocus
                required
                minLength={3}
                maxLength={300}
                value={voidTarget.reason}
                onChange={e => setVoidTarget({ ...voidTarget, reason: e.target.value })}
                placeholder="Ej: Registrado dos veces"
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setVoidTarget(null)} className="px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-[13px] text-zinc-300">Cancelar</button>
              <button type="submit" disabled={submitting} className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-[13px] font-medium text-white disabled:opacity-50">
                {submitting ? 'Anulando…' : 'Anular movimiento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {viewingReceipt && (
        <ReceiptViewer apiFetch={apiFetch} apiBase={apiBase} tx={viewingReceipt} onClose={() => setViewingReceipt(null)} />
      )}

      {/* ==============================================================
          MODAL: TICKET TÉRMICO DE CORTE DE CAJA (80MM)
          ============================================================== */}
      {ticketModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-md w-full p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#262626] pb-2.5">
              <div className="flex items-center gap-2">
                <Receipt size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-zinc-100">{ticketModal.title}</h3>
              </div>
              <button onClick={() => setTicketModal(null)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>

            <pre className="bg-[#0f0f0f] border border-[#242424] p-3.5 rounded text-[11px] font-mono leading-relaxed text-zinc-300 overflow-x-auto whitespace-pre max-h-[60vh] select-all">
              {ticketModal.text}
            </pre>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#262626]">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ticketModal.text);
                  toast('Texto del ticket copiado al portapapeles');
                }}
                className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] text-zinc-300 text-xs font-medium"
              >
                Copiar texto
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTicketModal(null)}
                  className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] text-zinc-300 text-xs font-medium"
                >
                  Cerrar
                </button>
                <button
                  onClick={() => {
                    const win = window.open('', '_blank');
                    const safe = ticketModal.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    win.document.write(`<pre style="font-family: monospace; font-size: 12px;">${safe}</pre>`);
                    win.document.close();
                    win.focus();
                    win.print();
                    win.close();
                  }}
                  className="px-4 py-1.5 rounded font-bold text-black hover:brightness-110 text-xs flex items-center gap-1.5 shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  <Printer size={13} />
                  <span>Imprimir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

