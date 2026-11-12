import React, { useState, useEffect, useMemo } from 'react';
import {
  Receipt,
  FileText,
  Settings,
  Plus,
  Search,
  RefreshCw,
  Printer,
  CheckCircle2,
  AlertCircle,
  X,
  Eye,
  DollarSign,
  Building2,
  ShieldCheck,
  QrCode,
  Calendar,
  User,
  Hash,
  Download,
  Ban,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Info,
  Maximize2,
  LifeBuoy
} from 'lucide-react';

const DTE_TYPES = {
  '00': {
    label: 'Ticket POS (Interno)',
    full: 'Ticket de Venta Interno',
    code: '00',
    badge: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    desc: 'Comprobante interno local sin transmisión al Ministerio de Hacienda.'
  },
  '01': {
    label: 'Factura (01)',
    full: 'Factura de Consumidor Final',
    code: '01',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    desc: 'Emisión para personas particulares. Los precios ya incluyen el 13% de IVA.'
  },
  '03': {
    label: 'Crédito Fiscal (03)',
    full: 'Comprobante de Crédito Fiscal (CCF)',
    code: '03',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    desc: 'Para empresas y contribuyentes de IVA. Desglosa IVA 13% y requiere NRC y Giro.'
  }
};

const DEPARTAMENTOS_SV = [
  'San Salvador', 'La Libertad', 'Santa Ana', 'San Miguel', 'Sonsonate',
  'Usulután', 'Ahuachapán', 'La Paz', 'Cabañas', 'Chalatenango',
  'Cuscatlán', 'Morazán', 'San Vicente', 'La Unión'
];

const UNIDADES_MEDIDA = [
  { id: '59', label: 'Unidad (U)' },
  { id: 'porc', label: 'Porción / Plato' },
  { id: 'lib', label: 'Libra (lb)' },
  { id: 'kg', label: 'Kilogramo (kg)' },
  { id: 'bot', label: 'Botella / Bebida' },
  { id: 'serv', label: 'Servicio' }
];

export default function InvoicingPanel({
  themeColor = '#10b981',
  apiBase = '',
  isIotInstalled = false,
  subTab = 'invoices',
  setSubTab
}) {
  const [activeTabState, setActiveTabState] = useState(subTab || 'invoices');
  const activeTab = subTab !== undefined ? subTab : activeTabState;
  const changeTab = (t) => {
    setActiveTabState(t);
    setSubTab?.(t);
  };

  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceViewMode, setInvoiceViewMode] = useState('ticket'); // 'ticket' | 'a4'
  const [printingId, setPrintingId] = useState(null);
  const [banner, setBanner] = useState(null);

  // Formulario nueva factura detallada
  const [newInvoice, setNewInvoice] = useState({
    dte_type: '01',
    customer_name: 'Consumidor Final',
    customer_doc_type: 'DUI',
    customer_nit: '',
    customer_nrc: '',
    customer_giro: '',
    customer_email: '',
    customer_phone: '',
    customer_departamento: 'San Salvador',
    customer_address: '',
    payment_method: 'cash',
    condition: 'contado',
    notes: '',
    apply_retention_1: false,
    items: [
      {
        code: 'PROD-01',
        name: 'Consumo Restaurante / Alimentos',
        item_type: 'bien',
        unit: '59',
        quantity: 1,
        unit_price: 10.0,
        tax_type: 'gravada',
        discount: 0.0
      }
    ]
  });

  // Formulario configuración Hacienda SV
  const [configForm, setConfigForm] = useState({
    hacienda_enabled: false,
    ambiente: '00',
    nit_emisor: '',
    nrc_emisor: '',
    nombre_comercial: '',
    razon_social: '',
    actividad_economica: '',
    codigo_actividad: '',
    establecimiento_codigo: 'M001',
    punto_venta_codigo: 'P001',
    departamento: 'San Salvador',
    direccion: '',
    telefono: '',
    correo: '',
    clave_api: ''
  });

  const notify = (msg, isError = false) => {
    setBanner({ msg, isError });
    setTimeout(() => setBanner(null), 4500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [invRes, statsRes, cfgRes] = await Promise.all([
        fetch(`${apiBase}/api/invoicing/invoices?limit=100`),
        fetch(`${apiBase}/api/invoicing/stats`),
        fetch(`${apiBase}/api/invoicing/config`)
      ]);

      if (invRes.ok) setInvoices(await invRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      if (cfgRes.ok) {
        const c = await cfgRes.json();
        setConfig(c);
        setConfigForm(prev => ({ ...prev, ...c }));
      }
    } catch {
      notify('Error al sincronizar con el servidor de facturación', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBase}/api/invoicing/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm)
      });
      if (res.ok) {
        const updated = await res.json();
        setConfig(updated);
        notify('Configuración de Facturación & Hacienda guardada correctamente');
      } else {
        const err = await res.json();
        notify(err.detail || 'Error al guardar configuración', true);
      }
    } catch {
      notify('Error de red al guardar configuración', true);
    }
  };

  // Cálculos financieros en tiempo real
  const financialTotals = useMemo(() => {
    let gravadas = 0;
    let exentas = 0;
    let noSujetas = 0;

    newInvoice.items.forEach(it => {
      const lineBruta = Math.max(0, (it.quantity || 1) * (parseFloat(it.unit_price) || 0) - (parseFloat(it.discount) || 0));
      if (it.tax_type === 'exenta') {
        exentas += lineBruta;
      } else if (it.tax_type === 'no_sujeta') {
        noSujetas += lineBruta;
      } else {
        gravadas += lineBruta;
      }
    });

    let subtotalNeto = 0;
    let iva = 0;
    let totalPagar = 0;

    if (newInvoice.dte_type === '03') {
      // Crédito Fiscal: gravadas es base imponible neta + IVA 13% aparte
      subtotalNeto = gravadas + exentas + noSujetas;
      iva = gravadas * 0.13;
      totalPagar = subtotalNeto + iva;
    } else {
      // Factura Consumidor Final: precios ya incluyen IVA
      totalPagar = gravadas + exentas + noSujetas;
      iva = gravadas - (gravadas / 1.13);
      subtotalNeto = totalPagar - iva;
    }

    let retencion1 = 0;
    if (newInvoice.apply_retention_1 && newInvoice.dte_type === '03') {
      retencion1 = gravadas * 0.01;
      totalPagar -= retencion1;
    }

    return {
      gravadas,
      exentas,
      noSujetas,
      subtotalNeto,
      iva,
      retencion1,
      totalPagar
    };
  }, [newInvoice]);

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!newInvoice.customer_name.trim()) {
      notify('El nombre o razón social del cliente es obligatorio', true);
      return;
    }
    if (newInvoice.dte_type === '03') {
      if (!newInvoice.customer_nrc?.trim()) {
        notify('Para Crédito Fiscal (03) el NRC del cliente es obligatorio', true);
        return;
      }
      if (!newInvoice.customer_nit?.trim()) {
        notify('Para Crédito Fiscal (03) el NIT o DUI del cliente es obligatorio', true);
        return;
      }
    }
    if (newInvoice.items.length === 0) {
      notify('Debes incluir al menos un ítem en la factura', true);
      return;
    }

    const payload = {
      dte_type: newInvoice.dte_type,
      customer_name: newInvoice.customer_name.trim(),
      customer_nit: newInvoice.customer_nit.trim(),
      customer_nrc: newInvoice.customer_nrc.trim(),
      customer_email: newInvoice.customer_email.trim(),
      customer_phone: newInvoice.customer_phone.trim(),
      customer_address: `${newInvoice.customer_address.trim()}${newInvoice.customer_departamento ? `, ${newInvoice.customer_departamento}` : ''}`.trim(),
      payment_method: newInvoice.payment_method,
      notes: newInvoice.notes.trim(),
      items: newInvoice.items.map(it => ({
        name: it.name.trim(),
        quantity: it.quantity,
        unit_price: it.unit_price,
        is_exempt: it.tax_type === 'exenta'
      }))
    };

    try {
      const res = await fetch(`${apiBase}/api/invoicing/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json();
        notify(`Comprobante ${created.control_number} emitido exitosamente`);
        setSelectedInvoice(created);
        loadData();
        changeTab('invoices');
      } else {
        const err = await res.json();
        notify(err.detail || 'Error al emitir el comprobante', true);
      }
    } catch {
      notify('Error de conexión al emitir comprobante', true);
    }
  };

  const handlePrintIoT = async (invoiceId) => {
    setPrintingId(invoiceId);
    try {
      const res = await fetch(`${apiBase}/api/invoicing/invoices/${invoiceId}/print`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify('✅ Factura enviada a las impresoras térmicas de caja');
      } else {
        notify(`⚠️ ${data.message || data.detail || 'No se pudo despachar por IoT'}`, true);
      }
    } catch {
      notify('Error de red al conectar con hardware IoT', true);
    } finally {
      setPrintingId(null);
    }
  };

  const handleVoidInvoice = async (invoiceId) => {
    if (!window.confirm('¿Seguro que deseas anular esta factura? Esta operación quedará registrada en auditoría tributaria.')) return;
    try {
      const res = await fetch(`${apiBase}/api/invoicing/invoices/${invoiceId}/void`, {
        method: 'POST'
      });
      if (res.ok) {
        notify('Factura marcada como ANULADA');
        loadData();
        if (selectedInvoice?.id === invoiceId) setSelectedInvoice(null);
      } else {
        const err = await res.json();
        notify(err.detail || 'Error al anular factura', true);
      }
    } catch {
      notify('Error de red al anular', true);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const matchType = typeFilter === 'all' || inv.dte_type === typeFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery = !q ||
        (inv.control_number || '').toLowerCase().includes(q) ||
        (inv.customer_name || '').toLowerCase().includes(q) ||
        (inv.generation_code || '').toLowerCase().includes(q);
      return matchType && matchQuery;
    });
  }, [invoices, typeFilter, searchQuery]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121212] text-zinc-200 overflow-hidden font-sans">
      {/* Top Banner Alert */}
      {banner && (
        <div className={`px-4 py-2.5 text-xs font-medium flex items-center justify-between border-b ${
          banner.isError ? 'bg-rose-950/80 text-rose-200 border-rose-800' : 'bg-emerald-950/80 text-emerald-200 border-emerald-800'
        }`}>
          <div className="flex items-center gap-2">
            {banner.isError ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <span>{banner.msg}</span>
          </div>
          <button onClick={() => setBanner(null)} className="hover:opacity-75"><X size={14} /></button>
        </div>
      )}

      {/* Header */}
      <div className="p-4 border-b border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3 bg-[#171717]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Receipt size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-zinc-100">Facturación & DTE El Salvador</h1>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                config?.hacienda_enabled
                  ? config?.ambiente === '01'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}>
                {config?.hacienda_enabled
                  ? config?.ambiente === '01' ? 'Hacienda SV: PRODUCCIÓN' : 'Hacienda SV: PRUEBAS (00)'
                  : 'Modo Interno / Offline'}
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Emisión de comprobantes fiscales con normativa DTE El Salvador (Factura 01, Crédito Fiscal 03) y Tickets POS locales.
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="bg-[#121212] px-3 py-1.5 rounded border border-[#2e2e2e]">
              <span className="text-zinc-500">Total Facturado:</span>
              <span className="text-emerald-400 font-bold ml-1.5">${(stats.total_amount || 0).toFixed(2)}</span>
            </div>
            <div className="bg-[#121212] px-3 py-1.5 rounded border border-[#2e2e2e]">
              <span className="text-zinc-500">Emitidos:</span>
              <span className="text-blue-400 font-bold ml-1.5">{stats.total_count || 0}</span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#121212] p-1 rounded-md border border-[#2e2e2e]">
          <button
            onClick={() => changeTab('invoices')}
            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'invoices' ? 'bg-[#232323] text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText size={14} />
            <span>Comprobantes</span>
          </button>
          <button
            onClick={() => changeTab('new')}
            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'new' ? 'bg-[#232323] text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Plus size={14} />
            <span>Nueva Factura</span>
          </button>
          <button
            onClick={() => changeTab('config')}
            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'config' ? 'bg-[#232323] text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Settings size={14} />
            <span>Hacienda SV</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* TAB 1: LISTADO DE COMPROBANTES */}
        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por correlativo, cliente o UUID..."
                    className="w-full bg-[#171717] border border-[#2e2e2e] rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-[#171717] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-300 outline-none"
                >
                  <option value="all">Todos los comprobantes</option>
                  <option value="01">Factura Consumidor Final (01)</option>
                  <option value="03">Crédito Fiscal (03)</option>
                  <option value="00">Ticket POS (00)</option>
                </select>
              </div>

              <button
                onClick={loadData}
                disabled={loading}
                className="px-3 py-1.5 rounded bg-[#1f1f1f] border border-[#2e2e2e] text-zinc-300 hover:text-zinc-100 text-xs flex items-center gap-1.5"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                <span>Actualizar</span>
              </button>
            </div>

            {/* Invoices Table */}
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#1f1f1f] border-b border-[#2e2e2e] text-zinc-400 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">N° Control DTE</th>
                      <th className="py-2.5 px-3">Tipo</th>
                      <th className="py-2.5 px-3">Cliente / Contribuyente</th>
                      <th className="py-2.5 px-3">Fecha / Hora</th>
                      <th className="py-2.5 px-3">Pago</th>
                      <th className="py-2.5 px-3 text-right">Subtotal Neto</th>
                      <th className="py-2.5 px-3 text-right">IVA (13%)</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262626]">
                    {filteredInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-zinc-500">
                          {loading ? 'Cargando comprobantes...' : 'No hay comprobantes emitidos aún.'}
                        </td>
                      </tr>
                    ) : (
                      filteredInvoices.map(inv => {
                        const typeInfo = DTE_TYPES[inv.dte_type] || { label: inv.dte_type, badge: 'bg-zinc-800' };
                        const isVoided = inv.status === 'voided';
                        return (
                          <tr key={inv.id} className="hover:bg-[#202020] transition-colors">
                            <td className="py-2.5 px-3 font-mono font-bold text-zinc-200">
                              {inv.control_number}
                              {inv.generation_code && (
                                <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[150px]" title={inv.generation_code}>
                                  UUID: {inv.generation_code}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${typeInfo.badge}`}>
                                {typeInfo.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-zinc-200">{inv.customer_name}</div>
                              {inv.customer_nit && (
                                <div className="text-[10px] text-zinc-400 font-mono">NIT/DUI: {inv.customer_nit}</div>
                              )}
                              {inv.customer_nrc && (
                                <div className="text-[10px] text-emerald-400 font-mono">NRC: {inv.customer_nrc}</div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-zinc-400 font-mono">
                              {inv.created_at ? new Date(inv.created_at).toLocaleString() : '-'}
                            </td>
                            <td className="py-2.5 px-3 capitalize text-zinc-300">
                              {inv.payment_method === 'cash' ? '💵 Efectivo' : inv.payment_method === 'card' ? '💳 Tarjeta' : '🏦 Transferencia'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                              ${(inv.subtotal_amount || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                              ${(inv.iva_amount || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 text-sm">
                              ${(inv.total_amount || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isVoided ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                  Anulada
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Emitida
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => { setSelectedInvoice(inv); setInvoiceViewMode('ticket'); }}
                                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                                  title="Ver detalle del comprobante"
                                >
                                  <Eye size={13} />
                                </button>
                                {isIotInstalled && (
                                  <button
                                    onClick={() => handlePrintIoT(inv.id)}
                                    disabled={printingId === inv.id}
                                    className="p-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 disabled:opacity-50"
                                    title="Imprimir vía hardware IoT (ESC/POS)"
                                  >
                                    <Printer size={13} className={printingId === inv.id ? 'animate-pulse' : ''} />
                                  </button>
                                )}
                                {!isVoided && (
                                  <button
                                    onClick={() => handleVoidInvoice(inv.id)}
                                    className="p-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300"
                                    title="Anular comprobante"
                                  >
                                    <Ban size={13} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FORMULARIO DETALLADO NUEVA FACTURA */}
        {activeTab === 'new' && (
          <form onSubmit={handleCreateInvoice} className="max-w-4xl mx-auto space-y-4 bg-[#171717] border border-[#2e2e2e] p-5 rounded-md">
            {/* Cabecera Tipo DTE */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#2e2e2e] pb-3 gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <Receipt size={16} className="text-blue-400" />
                  <span>Emisión Detallada de Documento Tributario (DTE)</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Conforme a los estándares del Ministerio de Hacienda de El Salvador
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(DTE_TYPES).map(([k, t]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNewInvoice({ ...newInvoice, dte_type: k })}
                    className={`px-3 py-1.5 rounded text-xs font-semibold border transition-all text-left ${
                      newInvoice.dte_type === k
                        ? 'bg-blue-600 text-white border-blue-500 shadow'
                        : 'bg-[#1f1f1f] text-zinc-400 border-[#2e2e2e] hover:text-zinc-200'
                    }`}
                  >
                    <div>{t.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Alerta explicativa del tipo seleccionado */}
            <div className="p-3 bg-[#121212] border border-[#262626] rounded text-xs text-zinc-300 flex items-center gap-2.5">
              <Info size={16} className="text-blue-400 shrink-0" />
              <span>{DTE_TYPES[newInvoice.dte_type]?.desc}</span>
            </div>

            {/* SECCIÓN 1: DATOS DEL CLIENTE / RECEPTOR */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <User size={13} className="text-emerald-400" />
                <span>1. Datos del Cliente / Receptor</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="md:col-span-2">
                  <label className="block text-zinc-400 font-semibold mb-1">Nombre o Razón Social *</label>
                  <input
                    type="text"
                    required
                    value={newInvoice.customer_name}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_name: e.target.value })}
                    placeholder="Consumidor Final / Nombre de la Empresa"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Tipo de Documento</label>
                  <select
                    value={newInvoice.customer_doc_type}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_doc_type: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                  >
                    <option value="DUI">DUI (El Salvador)</option>
                    <option value="NIT">NIT</option>
                    <option value="Pasaporte">Pasaporte</option>
                    <option value="Carnet">Carnet de Residente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Número de Documento {newInvoice.dte_type === '03' && <span className="text-rose-400">*</span>}
                  </label>
                  <input
                    type="text"
                    required={newInvoice.dte_type === '03'}
                    value={newInvoice.customer_nit}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_nit: e.target.value })}
                    placeholder="00000000-0"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                {newInvoice.dte_type === '03' && (
                  <div>
                    <label className="block text-emerald-400 font-semibold mb-1">
                      NRC (Registro Contribuyente) *
                    </label>
                    <input
                      type="text"
                      required
                      value={newInvoice.customer_nrc}
                      onChange={e => setNewInvoice({ ...newInvoice, customer_nrc: e.target.value })}
                      placeholder="123456-7"
                      className="w-full bg-[#121212] border border-emerald-500/50 rounded px-3 py-2 text-zinc-200 outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                )}

                {newInvoice.dte_type === '03' && (
                  <div>
                    <label className="block text-emerald-400 font-semibold mb-1">
                      Giro / Actividad Económica *
                    </label>
                    <input
                      type="text"
                      required
                      value={newInvoice.customer_giro}
                      onChange={e => setNewInvoice({ ...newInvoice, customer_giro: e.target.value })}
                      placeholder="Ej: Servicios de publicidad / Comercio"
                      className="w-full bg-[#121212] border border-emerald-500/50 rounded px-3 py-2 text-zinc-200 outline-none focus:border-emerald-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Correo Electrónico (Para envío DTE)</label>
                  <input
                    type="email"
                    value={newInvoice.customer_email}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_email: e.target.value })}
                    placeholder="cliente@ejemplo.com"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={newInvoice.customer_phone}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_phone: e.target.value })}
                    placeholder="2200-0000"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Departamento</label>
                  <select
                    value={newInvoice.customer_departamento}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_departamento: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                  >
                    {DEPARTAMENTOS_SV.map(dep => (
                      <option key={dep} value={dep}>{dep}</option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-zinc-400 font-semibold mb-1">Dirección / Complemento</label>
                  <input
                    type="text"
                    value={newInvoice.customer_address}
                    onChange={e => setNewInvoice({ ...newInvoice, customer_address: e.target.value })}
                    placeholder="Calle principal, Polígono B, Local #12"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: DETALLE DE ÍTEMS Y PRODUCTOS */}
            <div className="space-y-3 pt-3 border-t border-[#2e2e2e]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Layers size={13} className="text-blue-400" />
                  <span>2. Detalle de Ítems / Productos / Servicios</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setNewInvoice({
                    ...newInvoice,
                    items: [
                      ...newInvoice.items,
                      {
                        code: `PROD-${newInvoice.items.length + 1}`,
                        name: '',
                        item_type: 'bien',
                        unit: '59',
                        quantity: 1,
                        unit_price: 5.0,
                        tax_type: 'gravada',
                        discount: 0.0
                      }
                    ]
                  })}
                  className="px-2.5 py-1 rounded bg-[#252525] hover:bg-[#2d2d2d] text-zinc-200 text-xs flex items-center gap-1 border border-[#333]"
                >
                  <Plus size={12} />
                  <span>+ Agregar Ítem</span>
                </button>
              </div>

              <div className="space-y-2">
                {newInvoice.items.map((it, idx) => (
                  <div key={idx} className="bg-[#121212] p-3 rounded-md border border-[#262626] space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
                      {/* Código */}
                      <div className="md:col-span-2">
                        <label className="block text-[10px] text-zinc-500 mb-0.5">Código / SKU</label>
                        <input
                          type="text"
                          value={it.code}
                          onChange={e => {
                            const copy = [...newInvoice.items];
                            copy[idx].code = e.target.value;
                            setNewInvoice({ ...newInvoice, items: copy });
                          }}
                          placeholder="SKU-01"
                          className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-zinc-300 font-mono"
                        />
                      </div>

                      {/* Descripción */}
                      <div className="md:col-span-4">
                        <label className="block text-[10px] text-zinc-500 mb-0.5">Descripción del Producto / Servicio *</label>
                        <input
                          type="text"
                          required
                          value={it.name}
                          onChange={e => {
                            const copy = [...newInvoice.items];
                            copy[idx].name = e.target.value;
                            setNewInvoice({ ...newInvoice, items: copy });
                          }}
                          placeholder="Ej: Hamburguesa Angus BBQ / Servicio de Asesoría"
                          className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-zinc-200 font-medium"
                        />
                      </div>

                      {/* Tipo Bien / Servicio */}
                      <div className="md:col-span-2">
                        <label className="block text-[10px] text-zinc-500 mb-0.5">Tipo</label>
                        <select
                          value={it.item_type}
                          onChange={e => {
                            const copy = [...newInvoice.items];
                            copy[idx].item_type = e.target.value;
                            setNewInvoice({ ...newInvoice, items: copy });
                          }}
                          className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-zinc-300"
                        >
                          <option value="bien">Bien (Producto)</option>
                          <option value="servicio">Servicio</option>
                        </select>
                      </div>

                      {/* Unidad */}
                      <div className="md:col-span-2">
                        <label className="block text-[10px] text-zinc-500 mb-0.5">Unidad</label>
                        <select
                          value={it.unit}
                          onChange={e => {
                            const copy = [...newInvoice.items];
                            copy[idx].unit = e.target.value;
                            setNewInvoice({ ...newInvoice, items: copy });
                          }}
                          className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-zinc-300"
                        >
                          {UNIDADES_MEDIDA.map(u => (
                            <option key={u.id} value={u.id}>{u.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Afectación fiscal */}
                      <div className="md:col-span-2">
                        <label className="block text-[10px] text-zinc-500 mb-0.5">Tributo</label>
                        <select
                          value={it.tax_type}
                          onChange={e => {
                            const copy = [...newInvoice.items];
                            copy[idx].tax_type = e.target.value;
                            setNewInvoice({ ...newInvoice, items: copy });
                          }}
                          className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-zinc-300"
                        >
                          <option value="gravada">Gravada (13%)</option>
                          <option value="exenta">Exenta</option>
                          <option value="no_sujeta">No Sujeta</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[#1f1f1f] text-xs">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-zinc-400">Cantidad:</span>
                          <input
                            type="number"
                            min="1"
                            value={it.quantity}
                            onChange={e => {
                              const copy = [...newInvoice.items];
                              copy[idx].quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
                              setNewInvoice({ ...newInvoice, items: copy });
                            }}
                            className="w-14 bg-[#171717] border border-[#2e2e2e] rounded px-2 py-0.5 text-center font-mono font-bold text-zinc-200"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-zinc-400">P. Unitario ($):</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={it.unit_price}
                            onChange={e => {
                              const copy = [...newInvoice.items];
                              copy[idx].unit_price = parseFloat(e.target.value) || 0;
                              setNewInvoice({ ...newInvoice, items: copy });
                            }}
                            className="w-20 bg-[#171717] border border-[#2e2e2e] rounded px-2 py-0.5 text-right font-mono text-emerald-400 font-bold"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-zinc-400">Descuento ($):</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={it.discount}
                            onChange={e => {
                              const copy = [...newInvoice.items];
                              copy[idx].discount = parseFloat(e.target.value) || 0;
                              setNewInvoice({ ...newInvoice, items: copy });
                            }}
                            className="w-16 bg-[#171717] border border-[#2e2e2e] rounded px-2 py-0.5 text-right font-mono text-zinc-400"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500 font-mono text-[11px]">Subtotal Línea:</span>
                        <span className="font-mono font-bold text-zinc-100 text-sm">
                          ${Math.max(0, (it.quantity * it.unit_price) - (it.discount || 0)).toFixed(2)}
                        </span>
                        {newInvoice.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const copy = newInvoice.items.filter((_, i) => i !== idx);
                              setNewInvoice({ ...newInvoice, items: copy });
                            }}
                            className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 ml-2"
                            title="Eliminar ítem"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SECCIÓN 3: CONDICIÓN DE PAGO Y RESUMEN TRIBUTARIO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#2e2e2e]">
              <div className="space-y-3 text-xs">
                <h3 className="font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign size={13} className="text-amber-400" />
                  <span>3. Condiciones Comerciales</span>
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Forma de Pago</label>
                    <select
                      value={newInvoice.payment_method}
                      onChange={e => setNewInvoice({ ...newInvoice, payment_method: e.target.value })}
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                    >
                      <option value="cash">💵 Efectivo (Billetes / Monedas)</option>
                      <option value="card">💳 Tarjeta Débito / Crédito</option>
                      <option value="transfer">🏦 Transferencia Bancaria</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Condición de la Venta</label>
                    <select
                      value={newInvoice.condition}
                      onChange={e => setNewInvoice({ ...newInvoice, condition: e.target.value })}
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                    >
                      <option value="contado">Contado</option>
                      <option value="credito">Crédito</option>
                    </select>
                  </div>
                </div>

                {newInvoice.dte_type === '03' && (
                  <label className="flex items-center gap-2 cursor-pointer bg-[#121212] p-2.5 rounded border border-[#262626]">
                    <input
                      type="checkbox"
                      checked={newInvoice.apply_retention_1}
                      onChange={e => setNewInvoice({ ...newInvoice, apply_retention_1: e.target.checked })}
                      className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 accent-blue-600"
                    />
                    <span className="text-zinc-300 text-xs">
                      Aplicar Retención del 1% de IVA (Gran Contribuyente)
                    </span>
                  </label>
                )}

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Observaciones / Notas del Documento</label>
                  <textarea
                    rows={2}
                    value={newInvoice.notes}
                    onChange={e => setNewInvoice({ ...newInvoice, notes: e.target.value })}
                    placeholder="Ej: Orden Mesa #4 / Entrega inmediata"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-1.5 text-zinc-200 outline-none"
                  />
                </div>
              </div>

              {/* Resumen Fiscal Oficial */}
              <div className="bg-[#121212] p-4 rounded-md border border-[#2e2e2e] space-y-2 text-xs font-mono">
                <div className="text-zinc-300 font-bold font-sans text-xs border-b border-[#262626] pb-1 flex items-center justify-between">
                  <span>Liquidación Tributaria</span>
                  <span className="text-[10px] text-blue-400">{DTE_TYPES[newInvoice.dte_type]?.full}</span>
                </div>

                <div className="flex justify-between text-zinc-400">
                  <span>Ventas No Sujetas:</span>
                  <span>${financialTotals.noSujetas.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Ventas Exentas:</span>
                  <span>${financialTotals.exentas.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Ventas Gravadas:</span>
                  <span>${financialTotals.gravadas.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-300 font-semibold pt-1 border-t border-[#1f1f1f]">
                  <span>Subtotal Neto:</span>
                  <span>${financialTotals.subtotalNeto.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-300 font-semibold">
                  <span>IVA Débito Fiscal (13%):</span>
                  <span>${financialTotals.iva.toFixed(2)}</span>
                </div>
                {financialTotals.retencion1 > 0 && (
                  <div className="flex justify-between text-rose-400">
                    <span>(-) Retención 1% IVA:</span>
                    <span>-${financialTotals.retencion1.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm font-bold text-emerald-400 pt-2 border-t border-[#333]">
                  <span>TOTAL A PAGAR:</span>
                  <span className="text-base">${financialTotals.totalPagar.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#2e2e2e]">
              <button
                type="submit"
                className="px-6 py-2.5 rounded bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white flex items-center gap-2 transition-colors shadow-lg"
              >
                <ShieldCheck size={16} />
                <span>Emitir y Validar Documento Tributario</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: CONFIGURACIÓN HACIENDA EL SALVADOR */}
        {activeTab === 'config' && (
          <form onSubmit={handleSaveConfig} className="max-w-3xl mx-auto space-y-4 bg-[#171717] border border-[#2e2e2e] p-5 rounded-md">
            <div className="border-b border-[#2e2e2e] pb-3">
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Building2 size={16} className="text-blue-400" />
                <span>Configuración de Emisor Fiscal & Ministerio de Hacienda El Salvador</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Registra los datos fiscales de tu negocio para la emisión legal de DTE con firma, sellos y correlativos normados.
              </p>
            </div>

            {/* Switch Hacienda Activo */}
            <div className="flex items-center justify-between p-3.5 rounded bg-[#121212] border border-[#2e2e2e]">
              <div>
                <span className="font-semibold text-xs text-zinc-100">Transmisión Electrónica Oficial Hacienda SV</span>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Si se desactiva, el sistema emitirá tickets POS internos para venta comercial sin reporte al Ministerio de Hacienda.
                </p>
              </div>
              <input
                type="checkbox"
                checked={configForm.hacienda_enabled}
                onChange={e => setConfigForm({ ...configForm, hacienda_enabled: e.target.checked })}
                className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 accent-blue-600 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Ambiente de Operación</label>
                <select
                  value={configForm.ambiente}
                  onChange={e => setConfigForm({ ...configForm, ambiente: e.target.value })}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                >
                  <option value="00">00 - Pruebas / Sandbox Oficial MH</option>
                  <option value="01">01 - Producción Oficial en Vivo</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">NIT del Emisor *</label>
                <input
                  type="text"
                  required
                  value={configForm.nit_emisor}
                  onChange={e => setConfigForm({ ...configForm, nit_emisor: e.target.value })}
                  placeholder="0614-000000-000-0"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">NRC del Emisor (Registro Contribuyente) *</label>
                <input
                  type="text"
                  required
                  value={configForm.nrc_emisor}
                  onChange={e => setConfigForm({ ...configForm, nrc_emisor: e.target.value })}
                  placeholder="Ej: 123456-7"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nombre Comercial *</label>
                <input
                  type="text"
                  required
                  value={configForm.nombre_comercial}
                  onChange={e => setConfigForm({ ...configForm, nombre_comercial: e.target.value })}
                  placeholder="Ej: Restaurante El Buen Sabor"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Razón Social</label>
                <input
                  type="text"
                  value={configForm.razon_social}
                  onChange={e => setConfigForm({ ...configForm, razon_social: e.target.value })}
                  placeholder="Ej: Inversiones Gastronómicas S.A. de C.V."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Giro / Actividad Económica *</label>
                <input
                  type="text"
                  required
                  value={configForm.actividad_economica}
                  onChange={e => setConfigForm({ ...configForm, actividad_economica: e.target.value })}
                  placeholder="Restaurantes y servicios móviles de comidas"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Cód. Establecimiento (MH)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={configForm.establecimiento_codigo}
                  onChange={e => setConfigForm({ ...configForm, establecimiento_codigo: e.target.value })}
                  placeholder="M001"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Cód. Punto de Venta (MH)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={configForm.punto_venta_codigo}
                  onChange={e => setConfigForm({ ...configForm, punto_venta_codigo: e.target.value })}
                  placeholder="P001"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Departamento</label>
                <select
                  value={configForm.departamento}
                  onChange={e => setConfigForm({ ...configForm, departamento: e.target.value })}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                >
                  {DEPARTAMENTOS_SV.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Teléfono de Contacto</label>
                <input
                  type="text"
                  value={configForm.telefono}
                  onChange={e => setConfigForm({ ...configForm, telefono: e.target.value })}
                  placeholder="2200-0000"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-zinc-400 font-semibold mb-1">Dirección Completa del Establecimiento</label>
                <input
                  type="text"
                  value={configForm.direccion}
                  onChange={e => setConfigForm({ ...configForm, direccion: e.target.value })}
                  placeholder="Avenida Principal #123, Colonia San Benito, San Salvador"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-zinc-400 font-semibold mb-1">
                  Clave Privada / Token de API Ministerio de Hacienda
                </label>
                <input
                  type="password"
                  value={configForm.clave_api}
                  onChange={e => setConfigForm({ ...configForm, clave_api: e.target.value })}
                  placeholder="••••••••••••••••••••••••••••••••••••••••"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[#2e2e2e]">
              <button
                type="submit"
                className="px-5 py-2.5 rounded bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white flex items-center gap-1.5 transition-colors shadow"
              >
                <ShieldCheck size={15} />
                <span>Guardar Parámetros de Hacienda SV</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* MODAL DETALLE DE COMPROBANTE: DUAL TICKET 80MM / FORMATO FISCAL A4 */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1f1f1f]">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                  <Receipt size={15} className="text-blue-400" />
                  <span>Comprobante {selectedInvoice.control_number}</span>
                </span>
                <div className="flex rounded bg-[#121212] p-0.5 border border-[#2e2e2e]">
                  <button
                    onClick={() => setInvoiceViewMode('ticket')}
                    className={`px-2.5 py-0.5 text-[11px] font-semibold rounded ${
                      invoiceViewMode === 'ticket' ? 'bg-[#2a2a2a] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Ticket 80mm
                  </button>
                  <button
                    onClick={() => setInvoiceViewMode('a4')}
                    className={`px-2.5 py-0.5 text-[11px] font-semibold rounded ${
                      invoiceViewMode === 'a4' ? 'bg-[#2a2a2a] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Factura Fiscal A4
                  </button>
                </div>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="text-zinc-400 hover:text-zinc-200">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-[#0d0d0d]">
              {/* VISTA 1: TICKET 80MM */}
              {invoiceViewMode === 'ticket' && (
                <div className="max-w-xs mx-auto bg-white text-black p-4 rounded shadow font-mono text-[11px] leading-tight space-y-2 border border-zinc-300">
                  <div className="text-center space-y-0.5 border-b border-black pb-2">
                    <div className="font-bold text-sm tracking-tight">{config?.nombre_comercial || 'EMISOR AUTORIZADO'}</div>
                    <div className="text-[10px]">{config?.razon_social || ''}</div>
                    <div>NIT: {config?.nit_emisor || '0000-000000-000-0'}</div>
                    <div>NRC: {config?.nrc_emisor || '000000-0'}</div>
                    <div className="text-[10px]">{config?.direccion || 'San Salvador, El Salvador'}</div>
                    <div className="font-bold pt-1 text-xs">
                      {selectedInvoice.dte_type === '01' ? 'FACTURA CONSUMIDOR FINAL' : selectedInvoice.dte_type === '03' ? 'COMPROBANTE DE CRÉDITO FISCAL' : 'TICKET DE VENTA INTERNO'}
                    </div>
                  </div>

                  <div className="space-y-0.5 border-b border-dashed border-zinc-600 pb-2 text-[10px]">
                    <div><span className="font-bold">No. Control:</span> {selectedInvoice.control_number}</div>
                    {selectedInvoice.generation_code && (
                      <div className="break-all"><span className="font-bold">Cód. Generación:</span> {selectedInvoice.generation_code}</div>
                    )}
                    <div><span className="font-bold">Fecha / Hora:</span> {selectedInvoice.created_at ? new Date(selectedInvoice.created_at).toLocaleString() : ''}</div>
                    <div><span className="font-bold">Cliente:</span> {selectedInvoice.customer_name}</div>
                    {selectedInvoice.customer_nit && <div><span className="font-bold">NIT/DUI:</span> {selectedInvoice.customer_nit}</div>}
                    {selectedInvoice.customer_nrc && <div><span className="font-bold">NRC:</span> {selectedInvoice.customer_nrc}</div>}
                    <div><span className="font-bold">Pago:</span> {selectedInvoice.payment_method?.toUpperCase()}</div>
                  </div>

                  {/* Items */}
                  <div className="border-b border-black pb-2">
                    <div className="flex justify-between font-bold text-[10px] border-b border-zinc-400 pb-1 mb-1">
                      <span>CANT / DESCRIPCION</span>
                      <span>TOTAL</span>
                    </div>
                    {selectedInvoice.items && selectedInvoice.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between text-[10px] py-0.5">
                        <span className="truncate pr-2">{it.quantity}x {it.name}</span>
                        <span className="font-bold">${((it.quantity || 1) * (it.unit_price || 0)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="space-y-0.5 text-right font-bold text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-600 font-normal">Subtotal Neto:</span>
                      <span>${(selectedInvoice.subtotal_amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-600 font-normal">IVA (13%):</span>
                      <span>${(selectedInvoice.iva_amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-1 border-t border-black">
                      <span>TOTAL A PAGAR:</span>
                      <span>${(selectedInvoice.total_amount || 0).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="text-center pt-2 text-[9px] text-zinc-600 border-t border-dashed border-zinc-500 space-y-1">
                    {selectedInvoice.hacienda_stamp ? (
                      <div>Sello MH: <span className="font-mono">{selectedInvoice.hacienda_stamp}</span></div>
                    ) : (
                      <div>Documento legal autorizado</div>
                    )}
                    <div className="font-mono text-[8px] break-all">
                      https://admin.factura.gob.sv/consultaPublica?dte={selectedInvoice.generation_code}
                    </div>
                    <div>¡Gracias por su preferencia!</div>
                  </div>
                </div>
              )}

              {/* VISTA 2: FACTURA FISCAL DETALLADA A4 */}
              {invoiceViewMode === 'a4' && (
                <div className="bg-white text-black p-6 rounded shadow font-sans text-xs space-y-4 border border-zinc-300">
                  {/* Encabezado A4 */}
                  <div className="flex justify-between items-start border-b-2 border-black pb-3">
                    <div>
                      <h2 className="text-base font-bold text-black">{config?.nombre_comercial || 'EMISOR AUTORIZADO'}</h2>
                      <div className="text-zinc-700 text-[11px] font-medium">{config?.razon_social || ''}</div>
                      <div className="text-zinc-600 text-[11px]">Actividad: {config?.actividad_economica || 'Servicios'}</div>
                      <div className="text-zinc-600 text-[11px]">{config?.direccion || 'San Salvador, El Salvador'}</div>
                      <div className="text-zinc-600 text-[11px]">Tel: {config?.telefono || '2200-0000'}</div>
                    </div>
                    <div className="text-right space-y-1 bg-zinc-50 p-2.5 rounded border border-zinc-200">
                      <div className="font-bold text-xs uppercase text-blue-700">
                        {DTE_TYPES[selectedInvoice.dte_type]?.full}
                      </div>
                      <div className="font-mono font-bold text-xs">No. Control: {selectedInvoice.control_number}</div>
                      <div className="font-mono text-[10px] text-zinc-600 break-all">UUID: {selectedInvoice.generation_code}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        NIT: {config?.nit_emisor || '0000-000000-000-0'} | NRC: {config?.nrc_emisor || '000000-0'}
                      </div>
                    </div>
                  </div>

                  {/* Receptor */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-50 rounded border border-zinc-200 text-[11px]">
                    <div>
                      <div><span className="font-bold">Cliente / Receptor:</span> {selectedInvoice.customer_name}</div>
                      {selectedInvoice.customer_nit && <div><span className="font-bold">NIT / DUI:</span> {selectedInvoice.customer_nit}</div>}
                      {selectedInvoice.customer_nrc && <div><span className="font-bold">NRC:</span> {selectedInvoice.customer_nrc}</div>}
                    </div>
                    <div>
                      <div><span className="font-bold">Fecha de Emisión:</span> {selectedInvoice.created_at ? new Date(selectedInvoice.created_at).toLocaleString() : ''}</div>
                      <div><span className="font-bold">Forma de Pago:</span> {selectedInvoice.payment_method?.toUpperCase()}</div>
                      <div><span className="font-bold">Moneda:</span> Dólares de los Estados Unidos (USD)</div>
                    </div>
                  </div>

                  {/* Tabla A4 */}
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b-2 border-black bg-zinc-100">
                        <th className="py-1 px-2 font-bold">Cant.</th>
                        <th className="py-1 px-2 font-bold">Descripción</th>
                        <th className="py-1 px-2 font-bold text-right">Precio Unitario</th>
                        <th className="py-1 px-2 font-bold text-right">V. No Sujeta</th>
                        <th className="py-1 px-2 font-bold text-right">V. Exenta</th>
                        <th className="py-1 px-2 font-bold text-right">V. Gravada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {selectedInvoice.items && selectedInvoice.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-2 font-mono">{it.quantity}</td>
                          <td className="py-1.5 px-2 font-medium">{it.name}</td>
                          <td className="py-1.5 px-2 text-right font-mono">${(it.unit_price || 0).toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right font-mono">$0.00</td>
                          <td className="py-1.5 px-2 text-right font-mono">{it.is_exempt ? `$${((it.quantity || 1) * (it.unit_price || 0)).toFixed(2)}` : '$0.00'}</td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold">{!it.is_exempt ? `$${((it.quantity || 1) * (it.unit_price || 0)).toFixed(2)}` : '$0.00'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Resumen Final A4 */}
                  <div className="flex justify-between items-end pt-3 border-t-2 border-black">
                    <div className="text-[10px] text-zinc-600 space-y-1 max-w-xs">
                      <div><span className="font-bold">Estado:</span> {selectedInvoice.status === 'voided' ? 'ANULADA' : 'EMITIDA'}</div>
                      {selectedInvoice.hacienda_stamp && <div><span className="font-bold">Sello de Recepción:</span> {selectedInvoice.hacienda_stamp}</div>}
                      <div className="break-all font-mono">Consulta pública: https://admin.factura.gob.sv/consultaPublica?dte={selectedInvoice.generation_code}</div>
                    </div>

                    <div className="w-56 space-y-1 font-mono text-[11px] text-right">
                      <div className="flex justify-between">
                        <span className="text-zinc-600">Subtotal Neto:</span>
                        <span>${(selectedInvoice.subtotal_amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-600">IVA 13%:</span>
                        <span>${(selectedInvoice.iva_amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-black pt-1 border-t border-black">
                        <span>TOTAL:</span>
                        <span>${(selectedInvoice.total_amount || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-3 border-t border-[#2e2e2e] flex items-center justify-between gap-2 bg-[#1f1f1f]">
              <button
                onClick={() => window.print()}
                className="px-3.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
              >
                <Printer size={13} />
                <span>Imprimir Navegador / PDF</span>
              </button>
              {isIotInstalled && (
                <button
                  onClick={() => handlePrintIoT(selectedInvoice.id)}
                  disabled={printingId === selectedInvoice.id}
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-xs text-white flex items-center gap-1.5 shadow"
                >
                  <Printer size={13} className={printingId === selectedInvoice.id ? 'animate-pulse' : ''} />
                  <span>Imprimir Térmica IoT (Caja)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
