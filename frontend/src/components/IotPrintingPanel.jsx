import React, { useState, useEffect } from 'react';
import {
  Printer,
  Wifi,
  Usb,
  Plus,
  RefreshCw,
  Trash2,
  Edit2,
  Play,
  CheckCircle2,
  AlertCircle,
  X,
  Server,
  Activity,
  ChefHat,
  Receipt,
  Layers,
  FileText
} from 'lucide-react';

const ROLE_CONFIG = {
  kitchen: { label: 'Cocina (Comandas)', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30', icon: ChefHat },
  cashier: { label: 'Caja (Tickets / Facturas)', badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: Receipt },
  all: { label: 'Cocina & Caja (Universal)', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: Layers }
};

export default function IotPrintingPanel({
  themeColor = '#10b981',
  apiBase = '',
  subTab = 'printers',
  setSubTab
}) {
  const [activeTabState, setActiveTabState] = useState(subTab || 'printers');
  const activeTab = subTab !== undefined ? subTab : activeTabState;
  const changeTab = (t) => {
    setActiveTabState(t);
    setSubTab?.(t);
  };
  const [printers, setPrinters] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [banner, setBanner] = useState(null);

  // Modal Impresora
  const [showModal, setShowModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState(null);
  const [form, setForm] = useState({
    name: 'Impresora Cocina ESC/POS',
    connection_type: 'network',
    ip_address: '192.168.1.200',
    port: 9100,
    role: 'kitchen',
    paper_width: '80mm',
    auto_cut: true,
    open_drawer: false,
    is_active: true
  });

  const notify = (msg, isError = false) => {
    setBanner({ msg, isError });
    setTimeout(() => setBanner(null), 4500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pRes, lRes] = await Promise.all([
        fetch(`${apiBase}/api/iot/printers`),
        fetch(`${apiBase}/api/iot/logs?limit=50`)
      ]);
      if (pRes.ok) setPrinters(await pRes.json());
      if (lRes.ok) setLogs(await lRes.json());
    } catch {
      notify('Error al conectar con el servidor de hardware IoT', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdd = () => {
    setEditingPrinter(null);
    setForm({
      name: 'Impresora Térmica 80mm',
      connection_type: 'network',
      ip_address: '192.168.1.',
      port: 9100,
      role: 'kitchen',
      paper_width: '80mm',
      auto_cut: true,
      open_drawer: false,
      is_active: true
    });
    setShowModal(true);
  };

  const handleOpenEdit = (printer) => {
    setEditingPrinter(printer);
    setForm({
      name: printer.name,
      connection_type: printer.connection_type || 'network',
      ip_address: printer.ip_address || '',
      port: printer.port || 9100,
      role: printer.role || 'kitchen',
      paper_width: printer.paper_width || '80mm',
      auto_cut: printer.auto_cut ?? true,
      open_drawer: printer.open_drawer ?? false,
      is_active: printer.is_active ?? true
    });
    setShowModal(true);
  };

  const handleSavePrinter = async (e) => {
    e.preventDefault();
    try {
      const url = editingPrinter
        ? `${apiBase}/api/iot/printers/${editingPrinter.id}`
        : `${apiBase}/api/iot/printers`;
      const method = editingPrinter ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      if (res.ok) {
        notify(`Impresora «${form.name}» ${editingPrinter ? 'actualizada' : 'registrada'} con éxito`);
        setShowModal(false);
        loadData();
      } else {
        const err = await res.json();
        notify(err.detail || 'Error al guardar impresora', true);
      }
    } catch {
      notify('Error de red al guardar impresora', true);
    }
  };

  const handleDeletePrinter = async (printerId, name) => {
    if (!window.confirm(`¿Seguro que deseas eliminar la impresora «${name}»?`)) return;
    try {
      const res = await fetch(`${apiBase}/api/iot/printers/${printerId}`, { method: 'DELETE' });
      if (res.ok) {
        notify(`Impresora «${name}» eliminada`);
        loadData();
      } else {
        const err = await res.json();
        notify(err.detail || 'Error al eliminar', true);
      }
    } catch {
      notify('Error de red al eliminar', true);
    }
  };

  const handleTestPrinter = async (printer) => {
    setTestingId(printer.id);
    try {
      const res = await fetch(`${apiBase}/api/iot/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printer_id: printer.id,
          custom_text: `Zenith POS IoT - Prueba de Hardware\nImpresora: ${printer.name}\nIP: ${printer.ip_address}:${printer.port}`
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(`✅ ${printer.name}: Conexión exitosa e impresión despachada.`);
      } else {
        notify(`⚠️ Error en ${printer.name}: ${data.message || data.detail || 'Impresora no responde en la red local'}`, true);
      }
      loadData();
    } catch {
      notify(`Error de red al intentar conectar con ${printer.name}`, true);
    } finally {
      setTestingId(null);
    }
  };

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
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Printer size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-zinc-100">Impresión IoT & Hardware</h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-purple-500/15 text-purple-300 border-purple-500/30">
                ESC/POS Socket RAW 9100
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Impresoras térmicas de red (Ethernet / WiFi) y USB para comandas en cocina y tickets/facturas en caja.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-[#1f1f1f] border border-[#2e2e2e] text-zinc-300 hover:text-zinc-100 text-xs flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>
          <button
            onClick={handleOpenAdd}
            className="px-3.5 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow"
          >
            <Plus size={14} />
            <span>+ Agregar Impresora</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#141414] flex items-center gap-2">
        <button
          onClick={() => changeTab('printers')}
          className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
            activeTab === 'printers' ? 'bg-[#252525] text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Server size={13} />
          <span>Impresoras Registradas ({printers.length})</span>
        </button>
        <button
          onClick={() => changeTab('logs')}
          className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
            activeTab === 'logs' ? 'bg-[#252525] text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileText size={13} />
          <span>Historial de Impresión ({logs.length})</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* TAB 1: LISTADO DE IMPRESORAS */}
        {activeTab === 'printers' && (
          <div className="space-y-4">
            {printers.length === 0 ? (
              <div className="p-8 border border-dashed border-[#2e2e2e] rounded-lg text-center max-w-md mx-auto space-y-3">
                <Printer size={32} className="mx-auto text-zinc-600" />
                <h3 className="text-sm font-semibold text-zinc-300">No hay impresoras configuradas</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Agrega una impresora térmica conectada a tu red local (puerto 9100) para imprimir comandas en cocina o tickets en caja automáticamente.
                </p>
                <button
                  onClick={handleOpenAdd}
                  className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  <span>Configurar Primera Impresora</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {printers.map(p => {
                  const roleInfo = ROLE_CONFIG[p.role] || { label: p.role, badge: 'bg-zinc-800' };
                  const isTesting = testingId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="bg-[#171717] border border-[#2e2e2e] rounded-md p-4 flex flex-col justify-between hover:border-zinc-700 transition-all shadow-sm"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${roleInfo.badge}`}>
                              {roleInfo.label}
                            </span>
                            <h3 className="text-sm font-bold text-zinc-100 mt-1.5">{p.name}</h3>
                          </div>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            p.is_active
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}>
                            {p.is_active ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>

                        {/* Specs */}
                        <div className="space-y-1 text-xs text-zinc-400 bg-[#121212] p-2.5 rounded border border-[#262626] font-mono">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-zinc-500">
                              {p.connection_type === 'network' ? <Wifi size={13} className="text-blue-400" /> : <Usb size={13} className="text-amber-400" />}
                              <span>Conexión:</span>
                            </span>
                            <span className="text-zinc-200 uppercase">{p.connection_type}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Dirección:</span>
                            <span className="text-zinc-200">{p.ip_address}:{p.port}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Papel / Corte:</span>
                            <span className="text-zinc-200">{p.paper_width} | {p.auto_cut ? 'Auto-corte' : 'Manual'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="pt-3 border-t border-[#2e2e2e] flex items-center justify-between gap-2 mt-3">
                        <button
                          onClick={() => handleTestPrinter(p)}
                          disabled={isTesting}
                          className="px-2.5 py-1.5 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Play size={12} className={isTesting ? 'animate-spin' : ''} />
                          <span>{isTesting ? 'Conectando...' : 'Probar Impresión'}</span>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenEdit(p)}
                            className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                            title="Editar impresora"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDeletePrinter(p.id, p.name)}
                            className="p-1.5 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            title="Eliminar impresora"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: HISTORIAL DE IMPRESIONES */}
        {activeTab === 'logs' && (
          <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1f1f1f] border-b border-[#2e2e2e] text-zinc-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Tipo de Trabajo</th>
                  <th className="py-2.5 px-3">Referencia</th>
                  <th className="py-2.5 px-3">Impresora</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Detalle / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262626] font-mono">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-500 font-sans">
                      No hay registros de impresión todavía.
                    </td>
                  </tr>
                ) : (
                  logs.map(lg => (
                    <tr key={lg.id} className="hover:bg-[#202020] transition-colors">
                      <td className="py-2.5 px-3 text-zinc-400">
                        {lg.created_at ? new Date(lg.created_at).toLocaleString() : '-'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          lg.job_type === 'kitchen_comanda'
                            ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
                            : lg.job_type === 'cashier_invoice'
                              ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                              : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}>
                          {lg.job_type === 'kitchen_comanda' ? 'Comanda Cocina' : lg.job_type === 'cashier_invoice' ? 'Factura / Ticket' : 'Test Impresión'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-zinc-200">
                        {lg.ref_id || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300">
                        {lg.printer_name || `ID #${lg.printer_id}`}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          lg.status === 'success'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        }`}>
                          {lg.status === 'success' ? 'Exitoso' : 'Error'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 font-sans truncate max-w-xs" title={lg.error_msg}>
                        {lg.error_msg || 'Enviado al socket TCP'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL CONFIGURAR IMPRESORA */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePrinter}
            className="bg-[#171717] border border-[#2e2e2e] rounded-lg max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-3">
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Printer size={16} className="text-purple-400" />
                <span>{editingPrinter ? 'Editar Impresora Térmica' : 'Registrar Nueva Impresora'}</span>
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-zinc-200">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nombre Descriptivo *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Impresora Cocina / Barra de Bebidas"
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Conexión</label>
                  <select
                    value={form.connection_type}
                    onChange={e => setForm({ ...form, connection_type: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                  >
                    <option value="network">Red (Ethernet / WiFi)</option>
                    <option value="usb">USB Local</option>
                    <option value="browser">Navegador Web</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Área / Rol</label>
                  <select
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                  >
                    <option value="kitchen">Cocina (Comandas)</option>
                    <option value="cashier">Caja (Facturas / Tickets)</option>
                    <option value="all">Todas las áreas</option>
                  </select>
                </div>
              </div>

              {form.connection_type === 'network' && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-zinc-400 font-semibold mb-1">Dirección IP Local *</label>
                    <input
                      type="text"
                      required
                      value={form.ip_address}
                      onChange={e => setForm({ ...form, ip_address: e.target.value })}
                      placeholder="192.168.1.200"
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Puerto RAW</label>
                    <input
                      type="number"
                      required
                      value={form.port}
                      onChange={e => setForm({ ...form, port: parseInt(e.target.value, 10) || 9100 })}
                      placeholder="9100"
                      className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 font-mono outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Ancho de Papel</label>
                  <select
                    value={form.paper_width}
                    onChange={e => setForm({ ...form, paper_width: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-3 py-2 text-zinc-200 outline-none"
                  >
                    <option value="80mm">80mm (Estándar)</option>
                    <option value="58mm">58mm (Compacta)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.auto_cut}
                      onChange={e => setForm({ ...form, auto_cut: e.target.checked })}
                      className="w-4 h-4 rounded bg-[#121212] border-[#2e2e2e] accent-purple-600"
                    />
                    <span className="text-zinc-300">Corte automático</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.open_drawer}
                      onChange={e => setForm({ ...form, open_drawer: e.target.checked })}
                      className="w-4 h-4 rounded bg-[#121212] border-[#2e2e2e] accent-purple-600"
                    />
                    <span className="text-zinc-300">Abrir gaveta de dinero</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#2e2e2e]">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 font-semibold text-xs text-white shadow"
              >
                {editingPrinter ? 'Actualizar Impresora' : 'Guardar Impresora'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

