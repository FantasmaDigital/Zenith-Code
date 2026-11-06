import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Download,
  Trash2,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Sparkles,
  AlertCircle,
  UtensilsCrossed,
  ShieldCheck,
  Check,
  Layers,
  ArrowRight,
  Wallet
} from 'lucide-react';

const MODULE_ICONS = {
  restaurant: UtensilsCrossed,
  UtensilsCrossed: UtensilsCrossed,
  finance: Wallet,
  wallet: Wallet,
  Wallet: Wallet,
  Boxes: Boxes,
  Layers: Layers
};

export default function ModulesPanel({
  apiFetch,
  apiBase,
  themeColor,
  themeRgb,
  installedModules,
  onModulesChange,
  navigateTo,
  showToast
}) {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);

  const fetchModules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${apiBase}/api/modules`);
      if (res.ok) {
        const data = await res.json();
        setModules(data);
      } else {
        setError('No se pudo cargar la lista de módulos');
      }
    } catch (err) {
      setError(err.message || 'Error de conexión con el backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  const handleInstall = async (mod) => {
    setActionLoading(mod.id);
    try {
      const res = await apiFetch(`${apiBase}/api/modules/${mod.id}/install`, {
        method: 'POST'
      });
      if (res.ok) {
        if (showToast) showToast(`✨ Módulo "${mod.name}" instalado exitosamente`);
        await fetchModules();
        if (onModulesChange) onModulesChange();
      } else {
        const data = await res.json().catch(() => ({}));
        if (showToast) showToast(`Error: ${data.detail || 'No se pudo instalar'}`, true);
      }
    } catch (err) {
      if (showToast) showToast(`Error al instalar: ${err.message}`, true);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUninstall = async (mod) => {
    if (!window.confirm(`¿Estás seguro de desinstalar el módulo "${mod.name}"? Las tablas y datos se conservarán en la base de datos.`)) {
      return;
    }
    setActionLoading(mod.id);
    try {
      const res = await apiFetch(`${apiBase}/api/modules/${mod.id}/uninstall`, {
        method: 'POST'
      });
      if (res.ok) {
        if (showToast) showToast(`Módulo "${mod.name}" desinstalado`);
        await fetchModules();
        if (onModulesChange) onModulesChange();
      } else {
        const data = await res.json().catch(() => ({}));
        if (showToast) showToast(`Error: ${data.detail || 'No se pudo desinstalar'}`, true);
      }
    } catch (err) {
      if (showToast) showToast(`Error al desinstalar: ${err.message}`, true);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-4">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">
            Gestor de Módulos & Extensiones
          </h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            Activa o desinstala capacidades empresariales según el rubro de tu negocio. Cada módulo extiende automáticamente la base de datos, el panel de control y el conocimiento de la IA para WhatsApp.
          </p>
        </div>

        <button
          onClick={fetchModules}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-[#232323] hover:bg-[#2e2e2e] border border-[#3e3e3e] rounded-md text-[13px] font-medium text-zinc-200 transition-all disabled:opacity-50 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
          <span className="text-xs text-zinc-400 font-medium">Módulos Disponibles</span>
          <p className="text-2xl font-medium text-zinc-100 mt-1">{modules.length}</p>
        </div>
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
          <span className="text-xs text-zinc-400 font-medium">Módulos Instalados</span>
          <p className="text-2xl font-medium text-emerald-400 mt-1">
            {modules.filter(m => m.installed).length}
          </p>
        </div>
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md col-span-2 sm:col-span-1">
          <span className="text-xs text-zinc-400 font-medium">Arquitectura</span>
          <p className="text-xs font-mono text-zinc-300 mt-2 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-400" /> Plug & Play Modular
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded-md text-rose-300 text-sm">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid de Módulos */}
      {loading && modules.length === 0 ? (
        <div className="p-4 text-center text-zinc-500 text-sm">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
          Descubriendo módulos disponibles en el sistema...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modules.map((mod) => {
            const IconComponent = MODULE_ICONS[mod.icon] || MODULE_ICONS[mod.id] || Boxes;
            const isInstalled = Boolean(mod.installed);
            const isBusy = actionLoading === mod.id;

            return (
              <div
                key={mod.id}
                className={`relative flex flex-col justify-between p-4 rounded-md border transition-all ${
                  isInstalled
                    ? 'bg-[#121212] border-emerald-500/30'
                    : 'bg-[#171717] border-[#2e2e2e] hover:border-zinc-700'
                }`}
              >
                <div>
                  {/* Top: Icon + Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div
                      className="w-12 h-12 rounded-md flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: isInstalled ? `rgba(${themeRgb}, 0.15)` : '#262626',
                        color: isInstalled ? themeColor : '#94a3b8'
                      }}
                    >
                      <IconComponent size={24} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
                        v{mod.version || '1.0.0'}
                      </span>
                      {isInstalled ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                          <CheckCircle2 size={12} /> Instalado
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                          Disponible
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-medium text-zinc-100">{mod.name}</h3>
                      <span className="text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400">
                        {mod.category || 'Módulo'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {mod.description}
                    </p>
                  </div>

                  {/* Capacidades integradas */}
                  <div className="mt-2 pt-2 border-t border-[#2e2e2e] grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-400" /> Tablero en panel
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-400" /> Auto-toma en WhatsApp
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-400" /> Tablas en BD
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-400" /> Prompt IA dinámico
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="mt-2 pt-2 border-t border-[#2e2e2e] flex items-center justify-between gap-2">
                  {isInstalled ? (
                    <>
                      <button
                        onClick={() => handleUninstall(mod)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-50"
                      >
                        {isBusy ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        <span>Desinstalar</span>
                      </button>

                      <button
                        onClick={() => navigateTo(mod.id)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium text-black hover:brightness-110 transition-all ml-auto"
                        style={{ backgroundColor: themeColor }}
                      >
                        <span>Abrir Tablero</span>
                        <ArrowRight size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleInstall(mod)}
                      disabled={isBusy}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-black hover:brightness-110 transition-all disabled:opacity-50"
                      style={{ backgroundColor: themeColor }}
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Instalando tablas y rutas...</span>
                        </>
                      ) : (
                        <>
                          <Download size={14} />
                          <span>Instalar Módulo</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

