import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ServicesSettings from './ServicesSettings';
import {
  Briefcase,
  PlusCircle,
  RefreshCw,
  Trash2,
  Edit3,
  DollarSign,
  Phone,
  User,
  ShoppingBag,
  X,
  Search,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  Settings,
  ClipboardList,
  Calendar,
  Filter,
  Download,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Globe,
  FileText,
  Mail,
  Building2,
  BarChart3,
  Check,
  CheckSquare,
  Square,
  MessageSquare,
  Copy,
  ExternalLink
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constantes & Estilos (Sistema de Diseño idéntico a RestaurantPanel)
// ---------------------------------------------------------------------------
const STATUS_LEAD = {
  nuevo:       { label: 'Nuevo',       badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',     dot: 'bg-blue-400' },
  contactado:  { label: 'Contactado',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',   dot: 'bg-amber-400' },
  reunion:     { label: 'Reunión agendada', badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', dot: 'bg-cyan-400' },
  propuesta:   { label: 'Propuesta',   badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30', dot: 'bg-purple-400' },
  negociacion: { label: 'Negociación', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30', dot: 'bg-orange-400' },
  cliente:     { label: 'Cliente ✓',   badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
  perdido:     { label: 'Perdido',     badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',     dot: 'bg-rose-500' }
};

const STATUS_PROPOSAL = {
  borrador:  { label: 'Borrador',  badge: 'bg-zinc-800 text-zinc-400 border-zinc-700/60', dot: 'bg-zinc-500' },
  enviada:   { label: 'Enviada',   badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30', dot: 'bg-blue-400' },
  aceptada:  { label: 'Aceptada',  badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
  rechazada: { label: 'Rechazada', badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30', dot: 'bg-rose-500' }
};

const BUSINESS_TYPES = [
  { value: 'software',      label: 'Empresa de Software / Desarrollo' },
  { value: 'agencia',       label: 'Agencia Digital / Marketing' },
  { value: 'consultoria',   label: 'Consultoría / Asesoría' },
  { value: 'legal',         label: 'Despacho Legal / Firma' },
  { value: 'diseno',        label: 'Estudio de Diseño' },
  { value: 'contabilidad',  label: 'Contabilidad / Finanzas' },
  { value: 'otro',          label: 'Otro tipo de servicio' }
];

const RESPONSE_STYLES = [
  { value: 'profesional', label: 'Profesional (Claro y ejecutivo)' },
  { value: 'cercano',     label: 'Cercano (Amigable y conversacional)' },
  { value: 'tecnico',     label: 'Técnico (Especializado y preciso)' }
];

const inputClass =
  'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500';

const money = (v) => `$${(parseFloat(v) || 0).toLocaleString('es-SV', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-SV') : '—';

const downloadCSV = (filename, headers, rows) => {
  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const downloadJSON = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Componente Principal
// ---------------------------------------------------------------------------
export default function ServicesPanel({
  apiFetch,
  apiBase,
  themeColor = '#3ecf8e',
  showToast = () => {},
  subTab = 'services',
  setSubTab = () => {}
}) {
  // Normalizar subTab (soporta 'settings' o 'config')
  const currentSubTab = subTab === 'config' ? 'settings' : subTab;

  const SECTION_INFO = {
    services: {
      title: 'Catálogo de Servicios',
      description: 'Portafolio oficial de soluciones y servicios. La IA los presenta y cotiza exactamente como los configures aquí.'
    },
    leads: {
      title: 'Leads / CRM de Prospectos',
      description: 'Pipeline de prospectos capturados automáticamente desde WhatsApp y el chat web.'
    },
    proposals: {
      title: 'Propuestas Comerciales',
      description: 'Historial y auditoría de cotizaciones formales vinculadas a tus clientes.'
    },
    stats: {
      title: 'Estadísticas & Métricas',
      description: 'Desempeño comercial, embudo de conversión y volumen de propuestas abiertas vs cerradas.'
    },
    settings: {
      title: 'Configuración de Servicios',
      description: 'Perfil de empresa, propuesta de valor y tono que usará la IA como agente comercial.'
    }
  };

  // -------------------------------------------------------------------------
  // ESTADOS: Servicios
  // -------------------------------------------------------------------------
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceModal, setServiceModal] = useState(null); // null | 'new' | 'edit'
  const [editingService, setEditingService] = useState(null);
  const [serviceForm, setServiceForm] = useState({
    name: '', description: '', category: 'General', price_min: '', price_max: '', duration_days: '', is_active: true
  });
  const [importModal, setImportModal] = useState(false);

  // -------------------------------------------------------------------------
  // ESTADOS: Leads
  // -------------------------------------------------------------------------
  const [leads, setLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState('all');
  const [leadModal, setLeadModal] = useState(null);
  const [chatModalLead, setChatModalLead] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatData, setChatData] = useState(null);
  const [editingLead, setEditingLead] = useState(null);
  const [leadForm, setLeadForm] = useState({
    name: '', company: '', email: '', phone: '', service_interest: '', status: 'nuevo', source: 'manual', notes: ''
  });

  // -------------------------------------------------------------------------
  // ESTADOS: Propuestas
  // -------------------------------------------------------------------------
  const [proposals, setProposals] = useState([]);
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [proposalStatusFilter, setProposalStatusFilter] = useState('all');
  const [proposalModal, setProposalModal] = useState(null);
  const [editingProposal, setEditingProposal] = useState(null);
  const [proposalForm, setProposalForm] = useState({
    lead_id: '', title: '', services: '', total_amount: '', valid_days: 14, status: 'borrador', notes: ''
  });

  // -------------------------------------------------------------------------
  // ESTADOS: Estadísticas y Configuración
  // -------------------------------------------------------------------------
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [config, setConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // -------------------------------------------------------------------------
  // CARGAS DE DATOS
  // -------------------------------------------------------------------------
  const fetchServices = useCallback(async () => {
    setLoadingServices(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/services`);
      if (res.ok) setServices(await res.json());
    } catch {
      showToast('Error cargando servicios', 'error');
    } finally {
      setLoadingServices(false);
    }
  }, [apiFetch, apiBase, showToast]);

  const fetchLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/leads`);
      if (res.ok) setLeads(await res.json());
    } catch {
      showToast('Error cargando leads', 'error');
    } finally {
      setLoadingLeads(false);
    }
  }, [apiFetch, apiBase, showToast]);

  const fetchProposals = useCallback(async () => {
    setLoadingProposals(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/proposals`);
      if (res.ok) setProposals(await res.json());
    } catch {
      showToast('Error cargando propuestas', 'error');
    } finally {
      setLoadingProposals(false);
    }
  }, [apiFetch, apiBase, showToast]);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await apiFetch(`${apiBase}/api/services/stats`);
      if (res.ok) setStats(await res.json());
    } catch {
      showToast('Error cargando estadísticas', 'error');
    } finally {
      setLoadingStats(false);
    }
  }, [apiFetch, apiBase, showToast]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/services/config`);
      if (res.ok) setConfig(await res.json());
    } catch {
      showToast('Error cargando configuración', 'error');
    }
  }, [apiFetch, apiBase, showToast]);

  useEffect(() => {
    if (currentSubTab === 'services') fetchServices();
    if (currentSubTab === 'leads') fetchLeads();
    if (currentSubTab === 'proposals') { fetchProposals(); fetchLeads(); }
    if (currentSubTab === 'stats') fetchStats();
    if (currentSubTab === 'settings') fetchConfig();
  }, [currentSubTab, fetchServices, fetchLeads, fetchProposals, fetchStats, fetchConfig]);

  // -------------------------------------------------------------------------
  // SERVICIOS: Acciones
  // -------------------------------------------------------------------------
  // Solo búsqueda (sin botones de categoría): también encuentra por categoría
  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter(s => [s.name, s.description, s.category].some(v => (v || '').toLowerCase().includes(q)));
  }, [services, serviceSearch]);

  const handleSaveService = async (e) => {
    e.preventDefault();
    if (!serviceForm.name?.trim()) return showToast('El nombre del servicio es obligatorio', 'error');
    const payload = {
      name: serviceForm.name.trim(),
      description: serviceForm.description || '',
      category: serviceForm.category || 'General',
      price_min: serviceForm.price_min !== '' ? Number(serviceForm.price_min) : null,
      price_max: serviceForm.price_max !== '' ? Number(serviceForm.price_max) : null,
      duration_days: serviceForm.duration_days !== '' ? Number(serviceForm.duration_days) : null,
      is_active: Boolean(serviceForm.is_active)
    };
    try {
      if (editingService) {
        await apiFetch(`${apiBase}/api/services/services/${editingService.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast('Servicio actualizado');
      } else {
        await apiFetch(`${apiBase}/api/services/services`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast('Servicio creado');
      }
      setServiceModal(null);
      fetchServices();
    } catch {
      showToast('Error guardando servicio', 'error');
    }
  };

  const handleToggleActiveService = async (service) => {
    try {
      await apiFetch(`${apiBase}/api/services/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !service.is_active })
      });
      fetchServices();
    } catch {
      showToast('Error actualizando disponibilidad', 'error');
    }
  };

  const handleDeleteService = async (service) => {
    if (!window.confirm(`¿Eliminar servicio "${service.name}"?`)) return;
    try {
      await apiFetch(`${apiBase}/api/services/services/${service.id}`, { method: 'DELETE' });
      showToast('Servicio eliminado');
      fetchServices();
    } catch {
      showToast('Error eliminando servicio', 'error');
    }
  };

  const handleExportServicesCSV = () => {
    if (services.length === 0) return showToast('No hay servicios para exportar', 'error');
    const headers = ['ID', 'Servicio', 'Categoria', 'Precio_Desde', 'Precio_Hasta', 'Dias_Estimados', 'Activo', 'Descripcion'];
    const rows = services.map(s => [
      s.id,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.category || 'General').replace(/"/g, '""')}"`,
      s.price_min || '',
      s.price_max || '',
      s.duration_days || '',
      s.is_active ? 'SI' : 'NO',
      `"${(s.description || '').replace(/"/g, '""')}"`
    ].join(','));
    downloadCSV('catalogo_servicios', headers, rows);
    showToast('📥 Archivo CSV descargado');
  };

  // -------------------------------------------------------------------------
  // LEADS: Acciones & Filtros
  // -------------------------------------------------------------------------
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (leadStatusFilter !== 'all' && l.status !== leadStatusFilter) return false;
      if (leadSearch) {
        const q = leadSearch.toLowerCase();
        return l.name?.toLowerCase().includes(q) || l.company?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.phone?.includes(q);
      }
      return true;
    });
  }, [leads, leadStatusFilter, leadSearch]);


  const handleOpenLeadChat = async (lead) => {
    setChatModalLead(lead);
    setChatLoading(true);
    setChatData(null);
    try {
      const res = await apiFetch(`${apiBase}/api/services/leads/${lead.id}/conversation`);
      if (res.ok) {
        const data = await res.json();
        setChatData(data);
      } else {
        setChatData({ lead, messages: [], conversation_text: lead.conversation_text });
      }
    } catch {
      setChatData({ lead, messages: [], conversation_text: lead.conversation_text });
    } finally {
      setChatLoading(false);
    }
  };

  const handleSaveLead = async (e) => {
    e.preventDefault();
    if (!leadForm.name?.trim()) return showToast('El nombre del prospecto es obligatorio', 'error');
    try {
      if (editingLead) {
        await apiFetch(`${apiBase}/api/services/leads/${editingLead.id}`, {
          method: 'PATCH',
          body: JSON.stringify(leadForm)
        });
        showToast('Lead actualizado');
      } else {
        await apiFetch(`${apiBase}/api/services/leads`, {
          method: 'POST',
          body: JSON.stringify(leadForm)
        });
        showToast('Lead registrado');
      }
      setLeadModal(null);
      fetchLeads();
    } catch {
      showToast('Error guardando lead', 'error');
    }
  };

  const handleUpdateLeadStatus = async (lead, newStatus) => {
    try {
      await apiFetch(`${apiBase}/api/services/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      fetchLeads();
    } catch {
      showToast('Error actualizando estado', 'error');
    }
  };

  const handleDeleteLead = async (lead) => {
    if (!window.confirm(`¿Eliminar lead "${lead.name}"?`)) return;
    try {
      await apiFetch(`${apiBase}/api/services/leads/${lead.id}`, { method: 'DELETE' });
      showToast('Lead eliminado');
      fetchLeads();
    } catch {
      showToast('Error eliminando lead', 'error');
    }
  };

  const handleExportLeadsCSV = () => {
    if (filteredLeads.length === 0) return showToast('No hay leads para exportar', 'error');
    const headers = ['ID', 'Nombre', 'Empresa', 'Telefono', 'Email', 'Interes', 'Estado', 'Fuente', 'Notas', 'Fecha'];
    const rows = filteredLeads.map(l => [
      l.id,
      `"${(l.name || '').replace(/"/g, '""')}"`,
      `"${(l.company || '').replace(/"/g, '""')}"`,
      `"${(l.phone || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${(l.service_interest || '').replace(/"/g, '""')}"`,
      l.status || 'nuevo',
      l.source || 'manual',
      `"${(l.notes || '').replace(/"/g, '""')}"`,
      fmtDate(l.created_at)
    ].join(','));
    downloadCSV('leads_crm', headers, rows);
    showToast('📥 Archivo CSV descargado');
  };

  // -------------------------------------------------------------------------
  // PROPUESTAS: Acciones & Filtros
  // -------------------------------------------------------------------------
  const filteredProposals = useMemo(() => {
    return proposals.filter(p => {
      if (proposalStatusFilter !== 'all' && p.status !== proposalStatusFilter) return false;
      return true;
    });
  }, [proposals, proposalStatusFilter]);

  const handleSaveProposal = async (e) => {
    e.preventDefault();
    if (!proposalForm.lead_id) return showToast('Selecciona un lead para la propuesta', 'error');
    const payload = {
      lead_id: Number(proposalForm.lead_id),
      title: proposalForm.title || '',
      services: proposalForm.services || '',
      total_amount: Number(proposalForm.total_amount) || 0,
      valid_days: Number(proposalForm.valid_days) || 14,
      status: proposalForm.status || 'borrador',
      notes: proposalForm.notes || ''
    };
    try {
      if (editingProposal) {
        await apiFetch(`${apiBase}/api/services/proposals/${editingProposal.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast('Propuesta actualizada');
      } else {
        await apiFetch(`${apiBase}/api/services/proposals`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast('Propuesta creada');
      }
      setProposalModal(null);
      fetchProposals();
    } catch {
      showToast('Error guardando propuesta', 'error');
    }
  };

  const handleUpdateProposalStatus = async (proposal, newStatus) => {
    try {
      await apiFetch(`${apiBase}/api/services/proposals/${proposal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      fetchProposals();
    } catch {
      showToast('Error actualizando propuesta', 'error');
    }
  };

  const handleDeleteProposal = async (proposal) => {
    if (!window.confirm(`¿Eliminar propuesta #${proposal.id}?`)) return;
    try {
      await apiFetch(`${apiBase}/api/services/proposals/${proposal.id}`, { method: 'DELETE' });
      showToast('Propuesta eliminada');
      fetchProposals();
    } catch {
      showToast('Error eliminando propuesta', 'error');
    }
  };

  const handleExportProposalsCSV = () => {
    if (proposals.length === 0) return showToast('No hay propuestas para exportar', 'error');
    const headers = ['ID', 'Titulo', 'Lead_ID', 'Total', 'Vigencia_Dias', 'Estado', 'Fecha'];
    const rows = proposals.map(p => [
      p.id,
      `"${(p.title || `Propuesta #${p.id}`).replace(/"/g, '""')}"`,
      p.lead_id || '',
      p.total_amount || 0,
      p.valid_days || 14,
      p.status || 'borrador',
      fmtDate(p.created_at)
    ].join(','));
    downloadCSV('propuestas_comerciales', headers, rows);
    showToast('📥 Archivo CSV descargado');
  };

  // -------------------------------------------------------------------------
  // CONFIGURACIÓN: Guardar & Backup
  // -------------------------------------------------------------------------
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await apiFetch(`${apiBase}/api/services/config`, {
        method: 'PUT',
        body: JSON.stringify(config)
      });
      showToast('Configuración guardada ✓');
    } catch {
      showToast('Error guardando configuración', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleExportFullBackup = async () => {
    try {
      const [cfg, srv, ld, prop, st] = await Promise.all([
        apiFetch(`${apiBase}/api/services/config`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/services`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/leads`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/proposals`).then(r => r.json()),
        apiFetch(`${apiBase}/api/services/stats`).then(r => r.json())
      ]);
      downloadJSON('zenith_servicios_backup', {
        exported_at: new Date().toISOString(),
        module: 'services',
        version: '1.0.0',
        config: cfg,
        services: srv,
        leads: ld,
        proposals: prop,
        stats: st
      });
      showToast('📦 Respaldo JSON descargado');
    } catch {
      showToast('Error generando respaldo', 'error');
    }
  };

  return (
    <div className="max-w-full mx-auto space-y-4 animate-fadeIn pb-6">
      {/* ==============================================================
          ENCABEZADO GENERAL (Exactamente idéntico a RestaurantPanel)
          ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">
            {SECTION_INFO[currentSubTab]?.title || 'Servicios Profesionales'}
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5 max-w-2xl">
            {SECTION_INFO[currentSubTab]?.description || 'Módulo oficial de servicios y CRM.'}
          </p>
        </div>

        {/* Acciones principales de cada sección */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentSubTab === 'services' && (
            <>
              <button
                onClick={() => setImportModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all shadow-sm"
                title="Escanear tu sitio web o base de conocimiento con IA"
              >
                <Sparkles size={13} className="text-amber-400" />
                <span>Importar con IA</span>
              </button>

              {services.length > 0 && (
                <button
                  onClick={handleExportServicesCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all shrink-0"
                  title="Descargar catálogo en formato CSV"
                >
                  <Download size={13} />
                  <span>Exportar CSV</span>
                </button>
              )}

              <button
                onClick={() => {
                  setServiceForm({ name: '', description: '', category: 'General', price_min: '', price_max: '', duration_days: '', is_active: true });
                  setEditingService(null);
                  setServiceModal('new');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 transition-all shadow-sm"
                style={{ backgroundColor: themeColor }}
              >
                <PlusCircle size={13} />
                <span>Nuevo Servicio</span>
              </button>
            </>
          )}

          {currentSubTab === 'leads' && (
            <>
              {leads.length > 0 && (
                <button
                  onClick={handleExportLeadsCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all shrink-0"
                  title="Descargar prospectos en formato CSV"
                >
                  <Download size={13} />
                  <span>Exportar CSV</span>
                </button>
              )}

              <button
                onClick={() => {
                  setLeadForm({ name: '', company: '', email: '', phone: '', service_interest: '', status: 'nuevo', source: 'manual', notes: '' });
                  setEditingLead(null);
                  setLeadModal('new');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 transition-all shadow-sm"
                style={{ backgroundColor: themeColor }}
              >
                <PlusCircle size={13} />
                <span>Nuevo Lead</span>
              </button>
            </>
          )}

          {currentSubTab === 'proposals' && (
            <>
              {proposals.length > 0 && (
                <button
                  onClick={handleExportProposalsCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all shrink-0"
                  title="Descargar propuestas en formato CSV"
                >
                  <Download size={13} />
                  <span>Exportar CSV</span>
                </button>
              )}

              <button
                onClick={() => {
                  setProposalForm({ lead_id: leads[0]?.id || '', title: '', services: '', total_amount: '', valid_days: 14, status: 'borrador', notes: '' });
                  setEditingProposal(null);
                  setProposalModal('new');
                }}
                disabled={leads.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 transition-all shadow-sm disabled:opacity-40"
                style={{ backgroundColor: themeColor }}
              >
                <PlusCircle size={13} />
                <span>Nueva Propuesta</span>
              </button>
            </>
          )}

          {currentSubTab === 'settings' && (
            <button
              onClick={handleExportFullBackup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all shrink-0"
              title="Descargar copia completa de respaldo en JSON"
            >
              <Download size={13} />
              <span>Respaldo JSON</span>
            </button>
          )}
        </div>
      </div>

      {/* ==============================================================
          SUBTAB: CATÁLOGO DE SERVICIOS
          ============================================================== */}
      {currentSubTab === 'services' && (
        <div className="space-y-3">
          {/* Barra de Filtros & Búsqueda (Exactamente idéntica a Restaurant Menú) */}
          {services.length > 0 && (
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={serviceSearch}
                  onChange={e => setServiceSearch(e.target.value)}
                  placeholder="Buscar en servicios..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
              </div>
            </div>
          )}

          {loadingServices && services.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando catálogo de servicios...
            </div>
          ) : services.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
              <Briefcase size={36} className="mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">Aún no tienes servicios configurados</p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Puedes importarlos automáticamente desde tu sitio web o base de conocimiento con IA, o agregarlos manualmente uno por uno.
              </p>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setImportModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all shadow-sm"
                >
                  <Sparkles size={14} className="text-amber-400" />
                  <span>Importar con IA desde mi Sitio Web</span>
                </button>
                <button
                  onClick={() => {
                    setServiceForm({ name: '', description: '', category: 'General', price_min: '', price_max: '', duration_days: '', is_active: true });
                    setEditingService(null);
                    setServiceModal('new');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all"
                >
                  <PlusCircle size={13} />
                  <span>Crear manual</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {filteredServices.map(item => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-md border transition-all flex flex-col justify-between ${
                    item.is_active ? 'bg-[#171717] border-[#2e2e2e]' : 'bg-[#0e0f14] border-zinc-800/60 opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase font-medium tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {item.category || 'General'}
                        </span>
                        <h3 className="text-sm font-medium text-zinc-100 mt-1 truncate">{item.name}</h3>
                      </div>
                      <span className="text-base font-medium text-emerald-400 font-mono shrink-0">
                        {item.price_min && item.price_max
                          ? `${money(item.price_min)} – ${money(item.price_max)}`
                          : item.price_min
                          ? `Desde ${money(item.price_min)}`
                          : item.price_max
                          ? `Hasta ${money(item.price_max)}`
                          : 'A cotizar'}
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-xs text-zinc-400 leading-relaxed mb-2 line-clamp-3">{item.description}</p>
                    )}

                    {item.duration_days && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 bg-zinc-800 text-zinc-300 border-zinc-700">
                        Entrega estimada: {item.duration_days} días
                      </span>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#2e2e2e] flex items-center justify-between gap-2 mt-2">
                    <button
                      onClick={() => handleToggleActiveService(item)}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border transition-all ${
                        item.is_active
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      {item.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      <span>{item.is_active ? 'Disponible' : 'Pausado'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setServiceForm({
                            name: item.name,
                            description: item.description || '',
                            category: item.category || 'General',
                            price_min: item.price_min ?? '',
                            price_max: item.price_max ?? '',
                            duration_days: item.duration_days ?? '',
                            is_active: item.is_active
                          });
                          setEditingService(item);
                          setServiceModal('edit');
                        }}
                        className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                        title="Editar servicio"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteService(item)}
                        className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                        title="Eliminar servicio"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==============================================================
          SUBTAB: LEADS / CRM
          ============================================================== */}
      {currentSubTab === 'leads' && (
        <div className="space-y-3">
          {/* Métricas de Leads (Idénticas a Restaurant Historial stats) */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Total Prospectos</span>
              <p className="text-xl font-bold text-zinc-100 font-mono mt-0.5">{leads.length}</p>
            </div>
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Nuevos sin contactar</span>
              <p className="text-xl font-bold text-blue-400 font-mono mt-0.5">
                {leads.filter(l => l.status === 'nuevo').length}
              </p>
            </div>
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Reuniones agendadas</span>
              <p className="text-xl font-bold text-cyan-400 font-mono mt-0.5">
                {leads.filter(l => l.status === 'reunion').length}
              </p>
            </div>
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">En Negociación / Propuesta</span>
              <p className="text-xl font-bold text-amber-400 font-mono mt-0.5">
                {leads.filter(l => l.status === 'propuesta' || l.status === 'negociacion').length}
              </p>
            </div>
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Clientes Ganados</span>
              <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
                {leads.filter(l => l.status === 'cliente').length}
              </p>
            </div>
          </div>

          {/* Barra de Filtros */}
          <div className="flex flex-col md:flex-row gap-2 p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={leadSearch}
                onChange={e => setLeadSearch(e.target.value)}
                placeholder="Buscar prospecto por nombre, empresa, teléfono o correo..."
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
            <div className="w-full md:w-56">
              <select
                value={leadStatusFilter}
                onChange={e => setLeadStatusFilter(e.target.value)}
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="all">Todos los estados</option>
                {Object.entries(STATUS_LEAD).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabla de Leads (Estilo idéntico a Restaurant Historial de Pedidos) */}
          {loadingLeads && leads.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando prospectos...
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
              <Search size={28} className="mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">No se encontraron prospectos con estos filtros</p>
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717] shadow-sm">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)] min-h-[300px]">
                <table className="w-full text-left border-collapse text-xs min-w-[850px]">
                  <thead className="sticky top-0 bg-[#141414] z-10 border-b border-[#2e2e2e] shadow-sm">
                    <tr className="text-zinc-400 font-medium">
                      <th className="py-2.5 px-3">Prospecto / Empresa</th>
                      <th className="py-2.5 px-3">Contacto</th>
                      <th className="py-2.5 px-3">Interés</th>
                      <th className="py-2.5 px-3">Fuente</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424]">
                    {filteredLeads.map(lead => {
                      const st = STATUS_LEAD[lead.status] || STATUS_LEAD.nuevo;
                      return (
                        <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-200">{lead.name}</div>
                            {lead.company && (
                              <div className="text-[11px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <Building2 size={11} />
                                <span>{lead.company}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {lead.phone && (
                              <div className="text-zinc-300 flex items-center gap-1">
                                <Phone size={11} className="text-zinc-500" />
                                <span>{lead.phone}</span>
                              </div>
                            )}
                            {lead.email && (
                              <div className="text-zinc-400 text-[11px] flex items-center gap-1 mt-0.5">
                                <Mail size={11} className="text-zinc-500" />
                                <span>{lead.email}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-300">
                            {lead.service_interest || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 uppercase text-[10px] font-mono">
                            {lead.source || 'manual'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <select
                              value={lead.status}
                              onChange={e => handleUpdateLeadStatus(lead, e.target.value)}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border outline-none bg-transparent cursor-pointer ${st.badge}`}
                            >
                              {Object.entries(STATUS_LEAD).map(([k, v]) => (
                                <option key={k} value={k} className="bg-[#1a1a1a] text-zinc-200">{v.label}</option>
                              ))}
                            </select>
                            {lead.meeting_at && (
                              <div className="mt-1 text-[10px] text-cyan-300" title="Reunión">📅 {lead.meeting_at}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenLeadChat(lead)}
                                className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors"
                                title="Ver conversación completa"
                              >
                                <MessageSquare size={13} />
                              </button>
                              <button
                                onClick={() => {
                                  setLeadForm({ ...lead });
                                  setEditingLead(lead);
                                  setLeadModal('edit');
                                }}
                                className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                                title="Editar lead"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                onClick={() => handleDeleteLead(lead)}
                                className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                title="Eliminar lead"
                              >
                                <Trash2 size={13} />
                              </button>
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
          SUBTAB: PROPUESTAS COMERCIALES
          ============================================================== */}
      {currentSubTab === 'proposals' && (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row justify-between gap-2 p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
            <span className="text-xs text-zinc-400 flex items-center gap-1.5">
              <FileText size={13} className="text-zinc-500" />
              <span>{filteredProposals.length} cotizaciones registradas</span>
            </span>
            <div className="w-full md:w-56">
              <select
                value={proposalStatusFilter}
                onChange={e => setProposalStatusFilter(e.target.value)}
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="all">Todos los estados</option>
                {Object.entries(STATUS_PROPOSAL).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingProposals && proposals.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando propuestas...
            </div>
          ) : filteredProposals.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
              <FileText size={28} className="mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">No hay propuestas registradas</p>
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717] shadow-sm">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)] min-h-[300px]">
                <table className="w-full text-left border-collapse text-xs min-w-[850px]">
                  <thead className="sticky top-0 bg-[#141414] z-10 border-b border-[#2e2e2e] shadow-sm">
                    <tr className="text-zinc-400 font-medium">
                      <th className="py-2.5 px-3">#ID / Título</th>
                      <th className="py-2.5 px-3">Cliente / Lead</th>
                      <th className="py-2.5 px-3 text-right">Monto Total</th>
                      <th className="py-2.5 px-3 text-center">Vigencia</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424]">
                    {filteredProposals.map(p => {
                      const st = STATUS_PROPOSAL[p.status] || STATUS_PROPOSAL.borrador;
                      const leadObj = leads.find(l => l.id === p.lead_id);
                      return (
                        <tr key={p.id} className="hover:bg-[#1a1a1a] transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-200">{p.title || `Propuesta #${p.id}`}</div>
                            <div className="text-[11px] text-zinc-500">{fmtDate(p.created_at)}</div>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-300">
                            {leadObj ? leadObj.name : `Lead #${p.lead_id}`}
                            {leadObj?.company && <span className="text-zinc-500 ml-1">({leadObj.company})</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-400 text-sm">
                            {money(p.total_amount)}
                          </td>
                          <td className="py-2.5 px-3 text-center text-zinc-400">
                            {p.valid_days} días
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <select
                              value={p.status}
                              onChange={e => handleUpdateProposalStatus(p, e.target.value)}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border outline-none bg-transparent cursor-pointer ${st.badge}`}
                            >
                              {Object.entries(STATUS_PROPOSAL).map(([k, v]) => (
                                <option key={k} value={k} className="bg-[#1a1a1a] text-zinc-200">{v.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  setProposalForm({ ...p });
                                  setEditingProposal(p);
                                  setProposalModal('edit');
                                }}
                                className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                                title="Editar propuesta"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                onClick={() => handleDeleteProposal(p)}
                                className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                title="Eliminar propuesta"
                              >
                                <Trash2 size={13} />
                              </button>
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
          SUBTAB: ESTADÍSTICAS & MÉTRICAS
          ============================================================== */}
      {currentSubTab === 'stats' && (
        <div className="space-y-4">
          {loadingStats ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando estadísticas...
            </div>
          ) : !stats ? null : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Servicios Activos</span>
                  <p className="text-xl font-bold text-zinc-100 font-mono mt-0.5">{stats.services_active}</p>
                </div>
                <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Tasa de Conversión</span>
                  <p className="text-xl font-bold text-amber-400 font-mono mt-0.5">{stats.conversion_rate}%</p>
                </div>
                <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Pipeline Abierto</span>
                  <p className="text-xl font-bold text-blue-400 font-mono mt-0.5">{money(stats.pipeline_value)}</p>
                </div>
                <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Ingresos Cerrados</span>
                  <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{money(stats.closed_value)}</p>
                </div>
              </div>

              {/* Embudo de Conversión */}
              <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Embudo de Ventas (Pipeline)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { key: 'nuevo', label: 'Nuevos' },
                    { key: 'contactado', label: 'Contactados' },
                    { key: 'propuesta', label: 'Propuesta' },
                    { key: 'negociacion', label: 'Negociación' },
                    { key: 'cliente', label: 'Clientes Ganados' }
                  ].map(step => (
                    <div key={step.key} className="p-3 bg-[#121212] border border-[#262626] rounded-md text-center">
                      <div className="text-xl font-bold text-zinc-100 font-mono">
                        {stats.leads_by_status?.[step.key] || 0}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{step.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ==============================================================
          SUBTAB: CONFIGURACIÓN ENTERPRISE (ARM, BANT, Modelos & Identidad)
          ============================================================== */}
      {currentSubTab === 'settings' && (
        <ServicesSettings
          apiFetch={apiFetch}
          apiBase={apiBase}
          themeColor={themeColor}
          showToast={showToast}
        />
      )}

      {/* ==============================================================
          MODAL: NUEVO / EDITAR SERVICIO
          ============================================================== */}
      {serviceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md max-w-md w-full shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h2 className="text-sm font-semibold text-zinc-100">
                {editingService ? 'Editar Servicio' : 'Nuevo Servicio'}
              </h2>
              <button onClick={() => setServiceModal(null)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nombre del Servicio *</label>
                <input
                  type="text"
                  required
                  value={serviceForm.name}
                  onChange={e => setServiceForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ej. Desarrollo de Aplicación Móvil"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Categoría</label>
                <input
                  type="text"
                  value={serviceForm.category}
                  onChange={e => setServiceForm(p => ({ ...p, category: e.target.value }))}
                  placeholder="Ej. Móvil, Web, Cloud, Consultoría"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Descripción del Alcance</label>
                <textarea
                  rows={3}
                  value={serviceForm.description}
                  onChange={e => setServiceForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="¿Qué incluye y qué tecnologías se utilizan?"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Precio Desde ($)</label>
                  <input
                    type="number"
                    value={serviceForm.price_min}
                    onChange={e => setServiceForm(p => ({ ...p, price_min: e.target.value }))}
                    placeholder="1000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Precio Hasta ($)</label>
                  <input
                    type="number"
                    value={serviceForm.price_max}
                    onChange={e => setServiceForm(p => ({ ...p, price_max: e.target.value }))}
                    placeholder="5000"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Días Estimados de Entrega</label>
                <input
                  type="number"
                  value={serviceForm.duration_days}
                  onChange={e => setServiceForm(p => ({ ...p, duration_days: e.target.value }))}
                  placeholder="Ej. 30"
                  className={inputClass}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
                <button
                  type="button"
                  onClick={() => setServiceModal(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: IMPORTAR CON IA (Desde Web o Base de Conocimiento)
          ============================================================== */}
      {importModal && (
        <ImportAiModal
          apiFetch={apiFetch}
          apiBase={apiBase}
          themeColor={themeColor}
          showToast={showToast}
          onClose={() => setImportModal(false)}
          onImported={fetchServices}
        />
      )}

      
      {/* ==============================================================
          MODAL: CONVERSACIÓN COMPLETA DEL LEAD (WHATSAPP / WEB)
          ============================================================== */}
      {chatModalLead && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-md max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh]">
            {/* Encabezado */}
            <div className="flex items-center justify-between p-3.5 border-b border-[#2e2e2e]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <MessageSquare size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-zinc-100">{chatModalLead.name}</h2>
                    {chatModalLead.company && (
                      <span className="text-[11px] text-zinc-400">· {chatModalLead.company}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                    {chatModalLead.phone && (
                      <span className="flex items-center gap-1 font-mono text-zinc-300">
                        <Phone size={10} className="text-zinc-500" />
                        {chatModalLead.phone}
                      </span>
                    )}
                    {chatModalLead.service_interest && (
                      <span className="bg-zinc-800/80 px-1.5 py-0.2 rounded text-[10px] text-zinc-300 border border-zinc-700">
                        {chatModalLead.service_interest}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => setChatModalLead(null)} className="text-zinc-400 hover:text-white p-1">
                <X size={16} />
              </button>
            </div>

            {/* Cuerpo del Chat / Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#121212]/50 min-h-[300px]">
              {chatLoading ? (
                <div className="py-12 text-center text-zinc-500 text-xs space-y-2">
                  <RefreshCw size={20} className="animate-spin mx-auto text-emerald-400" />
                  <p>Cargando transcripción de la conversación...</p>
                </div>
              ) : chatData?.messages && chatData.messages.length > 0 ? (
                chatData.messages.map((m, idx) => {
                  const isUser = m.role === 'user';
                  return (
                    <div
                      key={m.id || idx}
                      className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-zinc-500 font-mono">
                        <span>{isUser ? '👤 Cliente' : '🤖 Fantasma Digital (IA)'}</span>
                        {m.created_at && (
                          <span>· {String(m.created_at).slice(11, 16)}</span>
                        )}
                      </div>
                      <div
                        className={`max-w-[85%] rounded-md px-3.5 py-2 text-xs leading-relaxed border whitespace-pre-wrap ${
                          isUser
                            ? 'bg-[#18201a] border-emerald-500/30 text-zinc-100 shadow-sm'
                            : 'bg-[#1f1f1f] border-[#2e2e2e] text-zinc-200'
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })
              ) : chatData?.conversation_text ? (
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-md p-3 text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {chatData.conversation_text}
                </div>
              ) : (
                <div className="py-12 text-center space-y-2 text-zinc-500 text-xs">
                  <MessageSquare size={28} className="mx-auto text-zinc-600" />
                  <p className="font-medium text-zinc-300">Aún no hay mensajes grabados para este lead</p>
                  <p className="max-w-xs mx-auto text-zinc-500 text-[11px]">
                    Cuando el cliente continúe la conversación en WhatsApp o el bot le responda, los mensajes aparecerán aquí automáticamente.
                  </p>
                </div>
              )}
            </div>

            {/* Pie con Acciones */}
            <div className="p-3 border-t border-[#2e2e2e] bg-[#171717] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  const txt = chatData?.conversation_text || chatData?.messages?.map(m => `${m.role === 'user' ? 'Cliente' : 'IA'}: ${m.content}`).join('\n\n') || '';
                  if (txt) {
                    navigator.clipboard.writeText(txt);
                    showToast('📋 Conversación copiada al portapapeles');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#242424] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all"
              >
                <Copy size={13} />
                <span>Copiar Historial</span>
              </button>

              <div className="flex items-center gap-2">
                {chatModalLead.phone && (
                  <a
                    href={`https://wa.me/${chatModalLead.phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm"
                  >
                    <span>Abrir en WhatsApp</span>
                    <ExternalLink size={12} />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setChatModalLead(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: NUEVO / EDITAR LEAD
          ============================================================== */}
      {leadModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md max-w-md w-full shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h2 className="text-sm font-semibold text-zinc-100">
                {editingLead ? 'Editar Lead' : 'Nuevo Lead'}
              </h2>
              <button onClick={() => setLeadModal(null)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveLead} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={leadForm.name}
                  onChange={e => setLeadForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ej. Roberto Martínez"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Empresa</label>
                <input
                  type="text"
                  value={leadForm.company}
                  onChange={e => setLeadForm(p => ({ ...p, company: e.target.value }))}
                  placeholder="Ej. Inversiones El Salvador"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={leadForm.phone}
                    onChange={e => setLeadForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+503 7000-0000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Correo</label>
                  <input
                    type="email"
                    value={leadForm.email}
                    onChange={e => setLeadForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="cliente@empresa.com"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Servicio de Interés</label>
                <input
                  type="text"
                  value={leadForm.service_interest}
                  onChange={e => setLeadForm(p => ({ ...p, service_interest: e.target.value }))}
                  placeholder="Ej. Sistema ERP, App Móvil"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Estado</label>
                <select
                  value={leadForm.status}
                  onChange={e => setLeadForm(p => ({ ...p, status: e.target.value }))}
                  className={inputClass}
                >
                  {Object.entries(STATUS_LEAD).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
                <button
                  type="button"
                  onClick={() => setLeadModal(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: NUEVA / EDITAR PROPUESTA
          ============================================================== */}
      {proposalModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md max-w-md w-full shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h2 className="text-sm font-semibold text-zinc-100">
                {editingProposal ? 'Editar Propuesta' : 'Nueva Propuesta'}
              </h2>
              <button onClick={() => setProposalModal(null)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveProposal} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Lead / Cliente Asociado *</label>
                <select
                  required
                  value={proposalForm.lead_id}
                  onChange={e => setProposalForm(p => ({ ...p, lead_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Selecciona un lead...</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>{l.name} {l.company ? `(${l.company})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Título de la Propuesta</label>
                <input
                  type="text"
                  value={proposalForm.title}
                  onChange={e => setProposalForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="Ej. Desarrollo de Plataforma E-commerce"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Monto Total ($)</label>
                  <input
                    type="number"
                    value={proposalForm.total_amount}
                    onChange={e => setProposalForm(p => ({ ...p, total_amount: e.target.value }))}
                    placeholder="2500"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Vigencia (días)</label>
                  <input
                    type="number"
                    value={proposalForm.valid_days}
                    onChange={e => setProposalForm(p => ({ ...p, valid_days: e.target.value }))}
                    placeholder="14"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Estado</label>
                <select
                  value={proposalForm.status}
                  onChange={e => setProposalForm(p => ({ ...p, status: e.target.value }))}
                  className={inputClass}
                >
                  {Object.entries(STATUS_PROPOSAL).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
                <button
                  type="button"
                  onClick={() => setProposalModal(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-Componente Modal: Importación Inteligente con IA
// ---------------------------------------------------------------------------
function ImportAiModal({ apiFetch, apiBase, themeColor, showToast, onClose, onImported }) {
  const [step, setStep] = useState('select'); // 'select' | 'extracting' | 'review' | 'saving'
  const [source, setSource] = useState('knowledge');
  const [url, setUrl] = useState('');
  const [extracted, setExtracted] = useState([]);
  const [selected, setSelected] = useState({});

  const runExtraction = async () => {
    if (source === 'url' && !url.trim()) return showToast('Ingresa una URL válida', 'error');
    setStep('extracting');
    try {
      const payload = source === 'url' ? { source: 'url', url: url.trim() } : { source: 'knowledge' };
      const res = await apiFetch(`${apiBase}/api/services/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error en la extracción' }));
        throw new Error(err.detail || 'Error en la extracción');
      }
      const data = await res.json();
      const items = data.services || [];
      if (items.length === 0) throw new Error('No se detectaron servicios en el contenido.');
      setExtracted(items);
      const sel = {};
      items.forEach((_, i) => { sel[i] = true; });
      setSelected(sel);
      setStep('review');
    } catch (err) {
      showToast(err.message || 'Error extrayendo servicios', 'error');
      setStep('select');
    }
  };

  const handleSaveBulk = async () => {
    const toSave = extracted.filter((_, i) => selected[i]);
    if (toSave.length === 0) return showToast('Selecciona al menos un servicio', 'error');
    setStep('saving');
    try {
      await apiFetch(`${apiBase}/api/services/services/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          services: toSave.map(s => ({
            name: s.name,
            category: s.category || 'General',
            description: s.description || '',
            price_min: s.price_min ? Number(s.price_min) : null,
            price_max: s.price_max ? Number(s.price_max) : null,
            duration_days: s.duration_days ? Number(s.duration_days) : null,
            is_active: true
          }))
        })
      });
      showToast(`✅ ${toSave.length} servicios importados al catálogo`);
      onImported();
      onClose();
    } catch (err) {
      showToast(err.message || 'Error guardando servicios', 'error');
      setStep('review');
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
      <div className={`max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-md ${step === 'review' ? 'max-w-3xl' : 'max-w-lg'} w-full shadow-2xl p-4 space-y-3`}>
        <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold text-sm">
            <Sparkles size={15} className="text-amber-400" />
            <span>Importar Servicios desde mi Sitio Web con IA</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {step === 'select' && (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Gemini analizará tu contenido web y estructurará automáticamente los nombres, precios y plazos de tus servicios para que puedas revisarlos antes de sumarlos al catálogo.
            </p>

            <div className="space-y-2">
              <div
                onClick={() => setSource('knowledge')}
                className={`p-3 rounded-md border cursor-pointer transition-all flex items-start gap-2.5 ${
                  source === 'knowledge' ? 'bg-[#1e1c18] border-amber-500/40 text-zinc-100' : 'bg-[#121212] border-[#2e2e2e] text-zinc-400'
                }`}
              >
                <FileText size={16} className={source === 'knowledge' ? 'text-amber-400' : 'text-zinc-500'} />
                <div>
                  <div className="text-xs font-semibold">Usar páginas de mi Base de Conocimiento</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Analiza los documentos y sitios ya indexados en tu empresa</div>
                </div>
              </div>

              <div
                onClick={() => setSource('url')}
                className={`p-3 rounded-md border cursor-pointer transition-all flex items-start gap-2.5 ${
                  source === 'url' ? 'bg-[#1e1c18] border-amber-500/40 text-zinc-100' : 'bg-[#121212] border-[#2e2e2e] text-zinc-400'
                }`}
              >
                <Globe size={16} className={source === 'url' ? 'text-amber-400' : 'text-zinc-500'} />
                <div className="flex-1">
                  <div className="text-xs font-semibold">Escanear URL directa de mi sitio</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Ingresa el enlace donde tienes listados tus servicios</div>
                  {source === 'url' && (
                    <input
                      type="url"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder="https://miempresa.com/servicios"
                      onClick={e => e.stopPropagation()}
                      className="w-full mt-2 bg-[#171717] border border-[#3e3e3e] rounded px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
              <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300">
                Cancelar
              </button>
              <button
                onClick={runExtraction}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 shadow-sm"
                style={{ backgroundColor: themeColor }}
              >
                <Sparkles size={13} />
                <span>Analizar y Extraer</span>
              </button>
            </div>
          </div>
        )}

        {step === 'extracting' && (
          <div className="py-12 text-center space-y-2">
            <RefreshCw size={26} className="animate-spin mx-auto text-amber-400" />
            <p className="text-xs font-semibold text-zinc-200">Gemini está analizando tu sitio web...</p>
            <p className="text-[11px] text-zinc-500">Identificando servicios, entregables y rangos de precio.</p>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400 pb-2 border-b border-[#2e2e2e]">
              <span>Servicios detectados: <strong className="text-zinc-100">{extracted.length}</strong> ({selectedCount} seleccionados)</span>
              <div className="flex gap-2">
                <button onClick={() => { const s = {}; extracted.forEach((_, i) => s[i] = true); setSelected(s); }} className="hover:text-white underline">Todos</button>
                <span>|</span>
                <button onClick={() => setSelected({})} className="hover:text-white underline">Ninguno</button>
              </div>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {extracted.map((s, idx) => {
                const isSel = Boolean(selected[idx]);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-md border text-xs transition-all ${
                      isSel ? 'bg-[#141414] border-amber-500/30' : 'bg-[#111] border-[#262626] opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <button type="button" onClick={() => setSelected(p => ({ ...p, [idx]: !p[idx] }))} className="mt-0.5 text-zinc-400">
                        {isSel ? <CheckSquare size={16} className="text-amber-400" /> : <Square size={16} />}
                      </button>
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={s.name || ''}
                            onChange={e => {
                              const copy = [...extracted];
                              copy[idx] = { ...copy[idx], name: e.target.value };
                              setExtracted(copy);
                            }}
                            className="w-full bg-[#1c1c1c] border border-[#2e2e2e] rounded px-2 py-1 text-xs font-semibold text-zinc-100 outline-none"
                          />
                          <input
                            type="text"
                            value={s.category || ''}
                            onChange={e => {
                              const copy = [...extracted];
                              copy[idx] = { ...copy[idx], category: e.target.value };
                              setExtracted(copy);
                            }}
                            className="w-36 bg-[#1c1c1c] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-amber-300 font-mono outline-none"
                          />
                        </div>
                        <textarea
                          rows={2}
                          value={s.description || ''}
                          onChange={e => {
                            const copy = [...extracted];
                            copy[idx] = { ...copy[idx], description: e.target.value };
                            setExtracted(copy);
                          }}
                          className="w-full bg-[#1c1c1c] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none resize-none"
                        />
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <span className="text-zinc-500 block">Precio Desde ($)</span>
                            <input
                              type="number"
                              value={s.price_min ?? ''}
                              onChange={e => {
                                const copy = [...extracted];
                                copy[idx] = { ...copy[idx], price_min: e.target.value };
                                setExtracted(copy);
                              }}
                              className="w-full bg-[#1c1c1c] border border-[#2e2e2e] rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none"
                            />
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Precio Hasta ($)</span>
                            <input
                              type="number"
                              value={s.price_max ?? ''}
                              onChange={e => {
                                const copy = [...extracted];
                                copy[idx] = { ...copy[idx], price_max: e.target.value };
                                setExtracted(copy);
                              }}
                              className="w-full bg-[#1c1c1c] border border-[#2e2e2e] rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none"
                            />
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Días Estimados</span>
                            <input
                              type="number"
                              value={s.duration_days ?? ''}
                              onChange={e => {
                                const copy = [...extracted];
                                copy[idx] = { ...copy[idx], duration_days: e.target.value };
                                setExtracted(copy);
                              }}
                              className="w-full bg-[#1c1c1c] border border-[#2e2e2e] rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-[#2e2e2e]">
              <button onClick={() => setStep('select')} className="text-xs text-zinc-400 hover:text-white">
                Volver
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300">
                  Cancelar
                </button>
                <button
                  onClick={handleSaveBulk}
                  disabled={selectedCount === 0}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110 shadow-sm disabled:opacity-40"
                  style={{ backgroundColor: themeColor }}
                >
                  Incorporar ({selectedCount}) al Catálogo
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="py-12 text-center space-y-2">
            <RefreshCw size={26} className="animate-spin mx-auto text-emerald-400" />
            <p className="text-xs font-semibold text-zinc-200">Guardando servicios en la base de datos...</p>
          </div>
        )}
      </div>
    </div>
  );
}
