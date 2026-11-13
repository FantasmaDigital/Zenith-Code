import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Plus,
  RefreshCw,
  Power,
  KeyRound,
  LogIn,
  AlertCircle,
  CheckCircle2,
  Search,
  BookOpen,
  ShieldCheck,
  Database,
  ExternalLink,
  Sparkles,
  X,
  Check,
  Layers,
  ArrowRight,
  MessageCircle,
  Trash2
} from 'lucide-react';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

// Estados del canal de WhatsApp que devuelve /api/tenants/whatsapp
const WA_TONES = {
  ok: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warn: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
  info: 'text-sky-300 bg-sky-500/10 border-sky-500/25',
  bad: 'text-rose-300 bg-rose-500/10 border-rose-500/25',
  idle: 'text-zinc-400 bg-zinc-800 border-zinc-700'
};
const WA_STATUS = {
  CONNECTED: { label: 'WhatsApp conectado', tone: 'ok' },
  META_CONFIGURED: { label: 'Meta API configurada', tone: 'ok' },
  WAITING_QR: { label: 'Esperando escaneo de QR', tone: 'warn', attention: true },
  QR_EXPIRED: { label: 'QR vencido, sin vincular', tone: 'warn', attention: true },
  NOT_STARTED: { label: 'WhatsApp sin vincular', tone: 'idle', attention: true },
  META_INCOMPLETE: { label: 'Meta API incompleta', tone: 'warn', attention: true },
  INITIALIZING: { label: 'Conectando…', tone: 'info' },
  CONNECTING: { label: 'Conectando…', tone: 'info' },
  RECONNECTING: { label: 'Reconectando…', tone: 'info', attention: true },
  STOPPED: { label: 'WhatsApp detenido', tone: 'bad', attention: true },
  DISCONNECTED: { label: 'WhatsApp desvinculado', tone: 'bad', attention: true },
  UNREACHABLE: { label: 'Gateway sin respuesta', tone: 'bad', attention: true },
  ERROR: { label: 'Error al consultar', tone: 'bad', attention: true },
  UNKNOWN: { label: 'Estado desconocido', tone: 'idle' }
};

function WhatsappBadge({ info }) {
  if (!info || info.status === 'INACTIVE') return null;
  const meta = WA_STATUS[info.status] || WA_STATUS.UNKNOWN;
  const tip = info.stop_reason || info.error || '';
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 ${WA_TONES[meta.tone]}`}
    >
      <MessageCircle size={11} />
      {meta.label}
    </span>
  );
}

function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function generateRandomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let pwd = 'Z';
  for (let i = 0; i < 11; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

/**
 * Gestión de empresas.
 * Vista exclusiva para el Superadministrador de la plataforma.
 * Permite:
 * 1. Crear empresas con su propia base de datos y esquema aislado.
 * 2. Visualizar empresas activas e inactivas con métricas y filtros.
 * 3. Activar/Desactivar empresas y gestionar contraseñas.
 * 4. Conmutar a la Base de Conocimiento individual de cada empresa con un solo clic.
 */
// Productos que se venden por separado (deben coincidir con FEATURES del backend)
const PRODUCTS = [
  { id: 'arm', label: 'Agente IA (ARM)', hint: 'Agente, WhatsApp, bandeja, clientes y conocimiento' },
  { id: 'loyalty', label: 'Fidelidad', hint: 'Tarjetas de fidelidad por puntos o sellos' }
];
const toggleFeature = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

export default function TenantsPanel({
  apiFetch,
  apiBase,
  themeColor = '#3ecf8e',
  actingTenant = '',
  onOperate,
  onTenantDeleted,
  showToast
}) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [search, setSearch] = useState('');
  const [waStatus, setWaStatus] = useState({}); // slug -> estado del canal de WhatsApp
  const [waSummary, setWaSummary] = useState(null);
  const [waLoading, setWaLoading] = useState(false);

  // Modal / Formulario Nueva Empresa
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    gateway_url: '',
    admin_name: '',
    admin_email: '',
    admin_phone: '',
    features: ['arm']
  });
  const [createdInvite, setCreatedInvite] = useState(null); // resultado de la invitación al admin
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal Cambio Contraseña
  const [pwdModalTenant, setPwdModalTenant] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  // Modal Eliminar Empresa (exige la contraseña del superadmin)
  const [deleteTenant, setDeleteTenant] = useState(null);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${apiBase}/api/tenants`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo cargar la lista de empresas.');
      setTenants(data.tenants || []);
    } catch (e) {
      setError(e.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, apiBase]);

  // Estado de WhatsApp de todas las empresas (va aparte: un gateway lento no frena la lista)
  const loadWhatsapp = useCallback(async () => {
    setWaLoading(true);
    try {
      const res = await apiFetch(`${apiBase}/api/tenants/whatsapp`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo consultar WhatsApp.');
      const map = {};
      (data.tenants || []).forEach(item => { map[item.slug] = item; });
      setWaStatus(map);
      setWaSummary(data.summary || null);
    } catch (e) {
      setWaSummary(null);
    } finally {
      setWaLoading(false);
    }
  }, [apiFetch, apiBase]);

  useEffect(() => {
    load();
    loadWhatsapp();
    // Refresco automático cada 30 s para detectar caídas sin recargar la página
    const timer = setInterval(loadWhatsapp, 30000);
    return () => clearInterval(timer);
  }, [load, loadWhatsapp]);

  // Manejo de Nombre y Slug auto-generado
  const handleNameChange = (e) => {
    const val = e.target.value;
    setForm(prev => {
      const next = { ...prev, name: val };
      if (!slugManuallyEdited) {
        next.slug = slugify(val);
      }
      return next;
    });
  };

  const handleSlugChange = (e) => {
    setSlugManuallyEdited(true);
    setForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
  };

  const cleanSlug = (form.slug || '').trim().toLowerCase();
  const slugOk = SLUG_RE.test(cleanSlug);
  const adminEmail = (form.admin_email || '').trim();
  const adminPhoneDigits = (form.admin_phone || '').replace(/\D/g, '');
  const adminEmailOk = !adminEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail);
  const adminPhoneOk = !adminPhoneDigits || (adminPhoneDigits.length >= 8 && adminPhoneDigits.length <= 15);
  const adminOk = Boolean((adminEmail || adminPhoneDigits) && adminEmailOk && adminPhoneOk);
  const canCreate = Boolean(
    form.name.trim() &&
    slugOk &&
    adminOk &&
    form.features.length > 0 &&
    !saving
  );

  const handleCreateTenant = async (e) => {
    e.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${apiBase}/api/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: cleanSlug,
          name: form.name.trim(),
          gateway_url: form.gateway_url.trim(),
          admin_name: form.admin_name.trim(),
          admin_email: adminEmail,
          admin_phone: adminPhoneDigits,
          features: form.features
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo crear la empresa.');

      const inv = data.admin_invitation || {};
      showToast?.(inv.sent_via && inv.sent_via !== 'link'
        ? `Empresa «${data.name}» creada. Invitación enviada al administrador por ${inv.sent_via === 'email' ? 'correo' : 'WhatsApp'}.`
        : `Empresa «${data.name}» creada. Comparte el enlace de invitación con el administrador.`);
      setCreatedInvite({ company: data.name, ...inv });
      setForm({ name: '', slug: '', gateway_url: '', admin_name: '', admin_email: '', admin_phone: '', features: ['arm'] });
      setSlugManuallyEdited(false);
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const patchTenant = async (slug, body, okMsg) => {
    setError('');
    try {
      const res = await apiFetch(`${apiBase}/api/tenants/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo actualizar la empresa.');
      showToast?.(okMsg || 'Cambio guardado.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleActive = (t) => {
    if (t.slug === 'default') {
      alert('La empresa principal de la plataforma no se puede desactivar.');
      return;
    }
    const willDeactivate = t.active;
    if (
      willDeactivate &&
      !window.confirm(`¿Desactivar la empresa «${t.name}»? Sus usuarios no podrán entrar al panel ni su bot de WhatsApp responderá mientras esté inactiva. Toda su información y base de conocimiento se conservan intactas.`)
    ) {
      return;
    }
    patchTenant(
      t.slug,
      { active: !t.active },
      t.active ? `Empresa «${t.name}» desactivada.` : `Empresa «${t.name}» activada con éxito.`
    );
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    if (!pwdModalTenant || newPassword.length < 8) return;
    setPwdSaving(true);
    try {
      await patchTenant(pwdModalTenant.slug, { password: newPassword }, `Contraseña de «${pwdModalTenant.name}» actualizada.`);
      setPwdModalTenant(null);
      setNewPassword('');
    } finally {
      setPwdSaving(false);
    }
  };

  const openDeleteModal = (t) => {
    setDeleteTenant(t);
    setDeleteConfirmSlug('');
    setDeletePassword('');
    setDeleteError('');
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTenant(null);
    setDeletePassword('');
  };

  const handleDeleteTenant = async (e) => {
    e.preventDefault();
    if (!deleteTenant || deleteConfirmSlug.trim() !== deleteTenant.slug || !deletePassword) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await apiFetch(`${apiBase}/api/tenants/${deleteTenant.slug}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword, confirm_slug: deleteConfirmSlug.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo eliminar la empresa.');
      const { slug, name } = deleteTenant;
      setDeleteTenant(null);
      setDeletePassword('');
      showToast?.(`Empresa «${name}» eliminada.`);
      onTenantDeleted?.(slug);
      await load();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // Filtrado y estadísticas
  const total = tenants.length;
  const activeCount = tenants.filter(t => t.active).length;
  const inactiveCount = tenants.filter(t => !t.active).length;

  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      if (filter === 'active' && !t.active) return false;
      if (filter === 'inactive' && t.active) return false;
      if (filter === 'attention' && !(t.active && WA_STATUS[waStatus[t.slug]?.status]?.attention)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tenants, filter, search, waStatus]);

  const currentOperatingSlug = actingTenant || 'default';
  const currentOperatingTenant = tenants.find(t => t.slug === currentOperatingSlug);

  return (
    <div className="space-y-6 max-w-6xl pb-16 animate-fadeIn">
      {/* Header Superior */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-black font-bold shadow-sm"
              style={{ backgroundColor: themeColor }}
            >
              <Building2 size={18} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              Gestión de Empresas
            </h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            Crea empresas y administra su estado. Cada empresa dispone de su propia{' '}
            <strong className="text-zinc-200">Base de Conocimiento aislada</strong>, menú de restaurante, cortes de caja chica y canales de WhatsApp independientes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { load(); loadWhatsapp(); }}
            disabled={loading}
            className="p-2 rounded-md border border-[#2e2e2e] bg-[#171717] text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
            title="Recargar empresas"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-zinc-200' : ''} />
          </button>

          <button
            onClick={() => {
              setForm({
                name: '',
                slug: '',
                gateway_url: '',
                admin_name: '',
                admin_email: '',
                admin_phone: '',
                features: ['arm']
              });
              setSlugManuallyEdited(false);
              setShowModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-semibold text-black transition-all shadow-sm hover:opacity-95"
            style={{ backgroundColor: themeColor }}
          >
            <Plus size={16} />
            <span>Nueva Empresa</span>
          </button>
        </div>
      </div>

      {/* Alerta de Error */}
      {error && (
        <div role="alert" className="flex items-start gap-2.5 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-200">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Tarjetas de Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-lg">
          <div className="text-xs font-medium text-zinc-500">Total Empresas</div>
          <div className="mt-1.5 text-2xl font-bold text-zinc-100">{total}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Registradas en la plataforma</div>
        </div>

        <div
          onClick={() => setFilter('active')}
          className={`p-4 bg-[#171717] border rounded-lg cursor-pointer transition-colors ${
            filter === 'active' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-[#2e2e2e] hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Empresas Activas</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400">{activeCount}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Operativas con bot y panel</div>
        </div>

        <div
          onClick={() => setFilter('inactive')}
          className={`p-4 bg-[#171717] border rounded-lg cursor-pointer transition-colors ${
            filter === 'inactive' ? 'border-zinc-500/50 bg-zinc-500/5' : 'border-[#2e2e2e] hover:border-zinc-700'
          }`}
        >
          <div className="text-xs font-medium text-zinc-500">Desactivadas / Pausadas</div>
          <div className="mt-1.5 text-2xl font-bold text-zinc-400">{inactiveCount}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Acceso temporalmente bloqueado</div>
        </div>

        <div
          onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
          title="Ver solo las empresas cuyo WhatsApp necesita atención"
          className={`p-4 bg-[#171717] border rounded-lg cursor-pointer transition-colors ${
            filter === 'attention' ? 'border-amber-500/50 bg-amber-500/5' : 'border-[#2e2e2e] hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">WhatsApp conectados</span>
            <MessageCircle size={13} className={waLoading ? 'text-zinc-500 animate-pulse' : 'text-emerald-400'} />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-zinc-100">
            {waSummary ? `${waSummary.connected}/${waSummary.total}` : '—'}
          </div>
          <div className={`text-[11px] mt-0.5 ${waSummary?.attention ? 'text-amber-300' : 'text-zinc-500'}`}>
            {waSummary
              ? (waSummary.attention ? `${waSummary.attention} requieren atención` : 'Todo en orden')
              : 'Consultando…'}
          </div>
        </div>

        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-lg flex flex-col justify-between">
          <div className="text-xs font-medium text-zinc-500">Empresa en Operación</div>
          <div className="mt-1.5 text-sm font-semibold text-zinc-100 truncate flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColor }} />
            <span className="truncate">{currentOperatingTenant?.name || 'Comedor (Principal)'}</span>
          </div>
          <div className="text-[11px] text-zinc-500 truncate font-mono">
            slug: {currentOperatingSlug}
          </div>
        </div>
      </div>

      {/* Banner Informativo sobre Aislamiento de Base de Conocimiento */}
      <div className="bg-[#141414] border border-[#2e2e2e] rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-300">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-400 shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div>
            <span className="font-semibold text-zinc-100">Aislamiento Estricto de Base de Conocimiento</span>
            <p className="text-zinc-400 text-[12px] mt-0.5">
              Cada empresa tiene su propio esquema de base de datos. Los documentos, FAQs, políticas y menú indexados en una empresa son 100% invisibles para las demás. Al conmutar empresa, el Asistente de IA responderá exclusivamente con la información de esa empresa.
            </p>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-[#171717] p-1 rounded-lg border border-[#2e2e2e]">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-[#262626] text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Todas ({total})
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              filter === 'active'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Solo Activas ({activeCount})
          </button>
          <button
            onClick={() => setFilter('inactive')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === 'inactive'
                ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Inactivas ({inactiveCount})
          </button>
          <button
            onClick={() => setFilter('attention')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              filter === 'attention'
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageCircle size={12} />
            WhatsApp por atender ({waSummary?.attention ?? 0})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por nombre o slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 bg-[#171717] border border-[#2e2e2e] rounded-md pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-200"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Lista de Empresas */}
      <div className="space-y-3">
        {filteredTenants.map((t) => {
          const isCurrent = t.slug === currentOperatingSlug;
          const isDefault = t.slug === 'default';

          return (
            <div
              key={t.slug}
              className={`bg-[#171717] border rounded-lg p-4 transition-all hover:border-zinc-600/80 flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${
                isCurrent
                  ? 'border-emerald-500/40 ring-1 ring-emerald-500/20 shadow-md shadow-emerald-500/5'
                  : 'border-[#2e2e2e]'
              }`}
            >
              {/* Información de la Empresa */}
              <div className="flex items-start gap-3.5 min-w-0">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 uppercase ${
                    t.active
                      ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-900 text-zinc-500 border border-[#2e2e2e]'
                  }`}
                >
                  {t.name.trim().charAt(0) || 'E'}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-zinc-100 truncate">
                      {t.name}
                    </span>

                    {/* Estado Activa / Inactiva */}
                    {t.active ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                        Desactivada
                      </span>
                    )}

                    {isDefault && (
                      <span className="text-[11px] font-medium text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5">
                        Principal
                      </span>
                    )}

                    {PRODUCTS.map(prod => {
                      const feats = t.features || ['arm'];
                      const on = feats.includes(prod.id);
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          disabled={isDefault}
                          title={isDefault ? 'La empresa principal tiene todos los productos' : (on ? `Quitar ${prod.label} del plan` : `Agregar ${prod.label} al plan`)}
                          onClick={() => {
                            const next = toggleFeature(feats, prod.id);
                            if (next.length === 0) { alert('La empresa debe tener al menos un producto.'); return; }
                            if (on && !window.confirm(`¿Quitar «${prod.label}» del plan de «${t.name}»? Sus datos se conservan, pero dejará de tener acceso.`)) return;
                            patchTenant(t.slug, { features: next }, `Plan de «${t.name}» actualizado.`);
                          }}
                          className={`text-[11px] font-medium rounded-full px-2 py-0.5 border ${on ? 'text-sky-300 bg-sky-500/10 border-sky-500/30' : 'text-zinc-600 border-dashed border-zinc-700 line-through'} ${isDefault ? 'cursor-default' : 'hover:brightness-125'}`}
                        >
                          {prod.label}
                        </button>
                      );
                    })}

                    {t.active && <WhatsappBadge info={waStatus[t.slug]} />}

                    {isCurrent && (
                      <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <Sparkles size={11} />
                        En Uso Ahora
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 mt-1">
                    <span className="font-mono text-zinc-500">slug: {t.slug}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-zinc-400">
                      <Database size={11} className="text-zinc-500" /> Base de datos individual
                    </span>
                    {waStatus[t.slug]?.phone_number && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-emerald-300/90">{waStatus[t.slug].phone_number}</span>
                      </>
                    )}
                    {t.meta_phone_number_id && (
                      <>
                        <span>•</span>
                        <span className="text-zinc-400">Meta ID: {t.meta_phone_number_id}</span>
                      </>
                    )}
                    {t.created_at && (
                      <>
                        <span>•</span>
                        <span className="text-zinc-500">
                          Creada: {new Date(t.created_at).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 xl:pt-0 border-t xl:border-t-0 border-[#262626]">
                {/* Conmutar a Base de Conocimiento de esta Empresa */}
                {(t.features || ['arm']).includes('arm') && (
                <button
                  onClick={() => onOperate?.(isDefault ? '' : t.slug, 'library')}
                  title="Abrir la Base de Conocimiento aislada de esta empresa"
                  className="h-8 px-2.5 rounded-md border border-[#2e2e2e] bg-[#141414] hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors"
                >
                  <BookOpen size={13} className="text-sky-400" />
                  <span>Base de Conocimiento</span>
                </button>
                )}

                {/* Ir directo a la conexión de WhatsApp de esta empresa (QR, desvincular) */}
                {t.active && (t.features || ['arm']).includes('arm') && (
                  <button
                    onClick={() => onOperate?.(isDefault ? '' : t.slug, 'whatsapp')}
                    title="Abrir la conexión de WhatsApp de esta empresa"
                    className="h-8 px-2.5 rounded-md border border-[#2e2e2e] bg-[#141414] hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors"
                  >
                    <MessageCircle size={13} className="text-emerald-400" />
                    <span>WhatsApp</span>
                  </button>
                )}

                {/* Administrar / Operar Empresa */}
                <button
                  onClick={() => onOperate?.(isDefault ? '' : t.slug)}
                  className={`h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
                    isCurrent
                      ? 'bg-zinc-800 border border-zinc-700 text-zinc-300'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-black font-semibold shadow-sm'
                  }`}
                  style={!isCurrent ? { backgroundColor: themeColor } : {}}
                >
                  <LogIn size={13} />
                  <span>{isCurrent ? 'Operando' : 'Entrar a Operar'}</span>
                </button>

                {/* Cambiar Contraseña */}
                <button
                  onClick={() => {
                    setPwdModalTenant(t);
                    setNewPassword(generateRandomPassword());
                  }}
                  title="Cambiar contraseña de acceso para esta empresa"
                  className="h-8 w-8 rounded-md border border-[#2e2e2e] bg-[#141414] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-colors"
                >
                  <KeyRound size={13} />
                </button>

                {/* Activar / Desactivar */}
                {!isDefault && (
                  <button
                    onClick={() => handleToggleActive(t)}
                    title={t.active ? 'Desactivar empresa' : 'Activar empresa'}
                    className={`h-8 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      t.active
                        ? 'border-zinc-700 bg-[#141414] hover:bg-rose-500/10 text-zinc-400 hover:text-rose-400'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    }`}
                  >
                    <Power size={13} />
                    <span>{t.active ? 'Desactivar' : 'Activar'}</span>
                  </button>
                )}

                {/* Eliminar (requiere contraseña del superadmin) */}
                {!isDefault && (
                  <button
                    onClick={() => openDeleteModal(t)}
                    title="Eliminar empresa"
                    className="h-8 w-8 rounded-md border border-[#2e2e2e] bg-[#141414] hover:bg-rose-500/10 text-zinc-400 hover:text-rose-400 flex items-center justify-center transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {!loading && filteredTenants.length === 0 && (
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-10 text-center space-y-3">
            <Building2 size={32} className="mx-auto text-zinc-600" />
            <div className="text-sm font-medium text-zinc-300">
              {search
                ? `No se encontraron empresas con el término «${search}».`
                : filter === 'active'
                  ? 'No hay empresas activas en este momento.'
                  : 'No hay empresas que coincidan con el filtro.'}
            </div>
            <button
              onClick={() => {
                setFilter('all');
                setSearch('');
              }}
              className="text-xs text-emerald-400 hover:underline"
            >
              Restablecer filtros
            </button>
          </div>
        )}
      </div>

      {/* MODAL: CREAR NUEVA EMPRESA */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Cabecera fija del Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626] shrink-0">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-black shrink-0"
                  style={{ backgroundColor: themeColor }}
                >
                  <Building2 size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100 leading-tight">Crear Nueva Empresa</h2>
                  <p className="text-[11px] text-zinc-400">Configura el entorno aislado y su administrador inicial</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-md hover:bg-[#232323] transition-colors"
                aria-label="Cerrar modal"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="flex flex-col flex-1 min-h-0">
              {/* Cuerpo con scroll interno si la pantalla es pequeña */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Fila 1: Nombre + Slug */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-300">
                      Nombre de la Empresa <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Sucursal Escalón Gourmet"
                      value={form.name}
                      onChange={handleNameChange}
                      className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-medium text-zinc-300">
                        Identificador (Slug) <span className="text-rose-400">*</span>
                      </label>
                      <span className="text-[10px] text-zinc-500">Para login y ruta</span>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="sucursal-escalon"
                      value={form.slug}
                      onChange={handleSlugChange}
                      className={`w-full h-9 bg-[#121212] border rounded-md px-3 text-sm font-mono text-zinc-100 placeholder-zinc-500 outline-none transition-colors ${
                        form.slug && !slugOk ? 'border-amber-500/60' : 'border-[#2e2e2e] focus:border-emerald-500'
                      }`}
                    />
                    {form.slug && !slugOk && (
                      <p className="text-[11px] text-amber-300">
                        2 a 40 caracteres: minúsculas, números y guiones.
                      </p>
                    )}
                  </div>
                </div>

                {/* Productos contratados (plan) */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">Productos contratados</label>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCTS.map(prod => {
                      const on = form.features.includes(prod.id);
                      return (
                        <button
                          type="button"
                          key={prod.id}
                          onClick={() => setForm(f => ({ ...f, features: toggleFeature(f.features, prod.id) }))}
                          className={`px-3 py-1.5 rounded-md border text-xs transition-colors ${on ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300' : 'border-[#2e2e2e] text-zinc-400 hover:text-zinc-200'}`}
                          title={prod.hint}
                        >
                          {on ? '✓ ' : ''}{prod.label}
                        </button>
                      );
                    })}
                  </div>
                  {form.features.length === 0 && <p className="text-[11px] text-amber-300">Elige al menos un producto.</p>}
                </div>

                {/* Fila 2: Gateway WhatsApp (opcional) */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">
                    Gateway WhatsApp <span className="text-zinc-500 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="http://whatsapp-gateway:3000"
                    value={form.gateway_url}
                    onChange={(e) => setForm(f => ({ ...f, gateway_url: e.target.value }))}
                    className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                {/* Administrador de la empresa (obligatorio) */}
                <div className="space-y-2.5 bg-[#121212] border border-[#262626] rounded-lg p-3.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">
                      Administrador de la empresa <span className="text-rose-400">*</span>
                    </span>
                    <span className="text-[11px] text-zinc-500">Recibirá invitación de acceso</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Nombre completo (opcional)"
                    value={form.admin_name}
                    onChange={(e) => setForm(f => ({ ...f, admin_name: e.target.value }))}
                    className="w-full h-9 bg-[#171717] border border-[#2e2e2e] rounded-md px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500 transition-colors"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="email"
                      placeholder="correo@empresa.com"
                      value={form.admin_email}
                      onChange={(e) => setForm(f => ({ ...f, admin_email: e.target.value }))}
                      className={`w-full h-9 bg-[#171717] border rounded-md px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors ${
                        adminEmailOk ? 'border-[#2e2e2e] focus:border-emerald-500' : 'border-amber-500/60'
                      }`}
                    />
                    <input
                      type="tel"
                      placeholder="WhatsApp (ej. 50370000000)"
                      value={form.admin_phone}
                      onChange={(e) => setForm(f => ({ ...f, admin_phone: e.target.value }))}
                      className={`w-full h-9 bg-[#171717] border rounded-md px-3 text-sm font-mono text-zinc-100 placeholder-zinc-500 outline-none transition-colors ${
                        adminPhoneOk ? 'border-[#2e2e2e] focus:border-emerald-500' : 'border-amber-500/60'
                      }`}
                    />
                  </div>
                  <p className={`text-[11px] ${adminOk || (!adminEmail && !adminPhoneDigits) ? 'text-zinc-500' : 'text-amber-300'}`}>
                    {!adminEmailOk
                      ? 'El correo no es válido.'
                      : !adminPhoneOk
                        ? 'El teléfono debe tener de 8 a 15 dígitos con código de país.'
                        : 'Indica al menos un correo o un WhatsApp de contacto.'}
                  </p>
                </div>

                {/* Resumen Informativo compacto */}
                <div className="bg-[#121212] border border-[#262626] rounded-lg px-3.5 py-2.5 text-[11px] text-zinc-400 flex items-start gap-2.5">
                  <BookOpen size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong className="text-zinc-300">Entorno 100% aislado:</strong> se crea su esquema privado en base de datos, sin módulos preinstalados para que tú o el administrador elijan qué activar.
                  </p>
                </div>
              </div>

              {/* Pie fijo con acciones */}
              <div className="px-6 py-3.5 border-t border-[#262626] bg-[#141414] flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="h-9 px-4 rounded-md border border-[#2e2e2e] text-xs font-medium text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canCreate}
                  className="h-9 px-5 rounded-md text-xs font-semibold text-black transition-all disabled:opacity-50 flex items-center gap-1.5"
                  style={{ backgroundColor: themeColor }}
                >
                  {saving ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Creando Empresa…</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Crear Empresa</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: INVITACIÓN AL ADMINISTRADOR DE LA NUEVA EMPRESA */}
      {createdInvite && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-zinc-100">Empresa «{createdInvite.company}» creada</h2>
            <p className="text-xs text-zinc-400">
              {createdInvite.sent_via === 'email' && 'La invitación del administrador se envió por correo.'}
              {createdInvite.sent_via === 'whatsapp' && 'La invitación del administrador se envió por WhatsApp.'}
              {(!createdInvite.sent_via || createdInvite.sent_via === 'link') && 'No se pudo enviar la invitación automáticamente. Comparte este enlace con el administrador:'}
            </p>
            {createdInvite.error && <p className="text-[11px] text-amber-300">{createdInvite.error}</p>}
            {createdInvite.link && (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={createdInvite.link}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-xs font-mono text-zinc-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(createdInvite.link).then(() => showToast?.('Enlace copiado.'))}
                  className="h-9 px-3 rounded-md border border-[#2e2e2e] text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Copiar
                </button>
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setCreatedInvite(null)}
                className="h-9 px-5 rounded-md text-xs font-semibold text-black"
                style={{ backgroundColor: themeColor }}
              >
                Listo
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: CAMBIO DE CONTRASEÑA */}
      {pwdModalTenant && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#262626]">
              <div className="flex items-center gap-2">
                <KeyRound size={17} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Cambiar Contraseña: {pwdModalTenant.name}
                </h2>
              </div>
              <button
                onClick={() => setPwdModalTenant(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSavePassword} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-zinc-300">Nueva Contraseña</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateRandomPassword())}
                    className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <Sparkles size={11} /> Aleatoria
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm font-mono text-zinc-100 outline-none focus:border-amber-500"
                />
                {newPassword && newPassword.length < 8 && (
                  <p className="text-[11px] text-amber-400">Mínimo 8 caracteres.</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwdModalTenant(null)}
                  className="h-8 px-3 rounded-md border border-[#2e2e2e] text-xs text-zinc-300 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={newPassword.length < 8 || pwdSaving}
                  className="h-8 px-4 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition-colors disabled:opacity-50"
                >
                  {pwdSaving ? 'Guardando…' : 'Actualizar Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: ELIMINAR EMPRESA */}
      {deleteTenant && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-rose-500/30 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#262626]">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-rose-400" />
                <h2 className="text-sm font-semibold text-zinc-100">Eliminar empresa: {deleteTenant.name}</h2>
              </div>
              <button onClick={closeDeleteModal} className="text-zinc-400 hover:text-zinc-200">
                <X size={16} />
              </button>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/20 rounded-md p-3 text-[12px] text-rose-200 space-y-1">
              <p>Se eliminarán la empresa, sus usuarios e invitaciones, y se desvinculará su WhatsApp. Nadie podrá volver a entrar a ella.</p>
              <p className="text-rose-300/80">Su base de datos se archiva en el servidor (no se borra) por si necesitas recuperarla manualmente. Si solo quieres pausarla, usa «Desactivar».</p>
            </div>

            <form onSubmit={handleDeleteTenant} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Escribe <span className="font-mono text-zinc-100">{deleteTenant.slug}</span> para confirmar
                </label>
                <input
                  type="text"
                  autoFocus
                  autoComplete="off"
                  value={deleteConfirmSlug}
                  onChange={(e) => setDeleteConfirmSlug(e.target.value)}
                  className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm font-mono text-zinc-100 outline-none focus:border-rose-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">Contraseña del administrador de la plataforma</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full h-9 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm text-zinc-100 outline-none focus:border-rose-500"
                />
              </div>

              {deleteError && (
                <div className="flex items-center gap-2 text-[12px] text-rose-300">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="h-8 px-3 rounded-md border border-[#2e2e2e] text-xs text-zinc-300 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deleting || !deletePassword || deleteConfirmSlug.trim() !== deleteTenant.slug}
                  className="h-8 px-4 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Eliminando…' : 'Eliminar empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
