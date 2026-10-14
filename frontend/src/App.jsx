import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  PlusCircle,
  Globe,
  MessageSquare,
  Settings,
  RefreshCw,
  Search,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff,
  Menu,
  X,
  Zap,
  Database,
  Send,
  Building,
  Bot,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Layers,
  Compass,
  CheckSquare,
  Square,
  ListFilter,
  Upload,
  Image as ImageIcon,
  Palette,
  Phone,
  Sparkles,
  Save,
  MessageCircle,
  Clock,
  UserCheck,
  UserX,
  Users,
  Play,
  Pause,
  PhoneCall,
  QrCode,
  Smartphone,
  Wifi,
  WifiOff,
  LogOut,
  Copy,
  Check,
  Tag,
  FileText,
  Edit3
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const BRAND_COLOR_PRESETS = [
  { name: 'Esmeralda Zenith', hex: '#3ecf8e' },
  { name: 'Azul Cyber', hex: '#3b82f6' },
  { name: 'Púrpura Royal', hex: '#8b5cf6' },
  { name: 'Ámbar Tech', hex: '#f59e0b' },
  { name: 'Rosa Neón', hex: '#ec4899' },
  { name: 'Cian Digital', hex: '#06b6d4' },
  { name: 'Verde Neón', hex: '#10b981' },
  { name: 'Rojo Carmesí', hex: '#ef4444' }
];

const HANDOFF_TAG_PRESETS = [
  'COTIZACIÓN',
  'ECOMMERCE',
  'AUTOMATIZACIÓN',
  'DESARROLLO WEB',
  'VENTAS',
  'SOPORTE TÉCNICO',
  'RECLAMO',
  'URGENTE',
  'CONSULTA GENERAL',
  'ATENCIÓN HUMANA'
];

function getTagBadgeStyle(tag) {
  const t = (tag || '').toUpperCase().trim();
  if (t.includes('COTIZ')) {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  }
  if (t.includes('ECOM') || t.includes('TIENDA')) {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  }
  if (t.includes('AUTO') || t.includes('BOT') || t.includes('FLUJO')) {
    return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40';
  }
  if (t.includes('WEB') || t.includes('SOFTWARE') || t.includes('DESARROLL')) {
    return 'bg-violet-500/15 text-violet-300 border-violet-500/40';
  }
  if (t.includes('VENT')) {
    return 'bg-teal-500/15 text-teal-300 border-teal-500/40';
  }
  if (t.includes('SOPORT') || t.includes('TECNIC') || t.includes('TÉCNIC')) {
    return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
  }
  if (t.includes('RECLAM') || t.includes('QUEJA')) {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  }
  if (t.includes('URGENT') || t.includes('EMERGENC')) {
    return 'bg-red-500/25 text-red-300 border-red-500/50 animate-pulse';
  }
  if (t.includes('CONSULT') || t.includes('INFO')) {
    return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40';
  }
  return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return '62, 207, 142';
  let c = hex.trim().replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  if (c.length !== 6) return '62, 207, 142';
  const num = parseInt(c, 16);
  if (isNaN(num)) return '62, 207, 142';
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
}

function FormattedChatMessage({ text, isUser }) {
  if (isUser) {
    return <div className="whitespace-pre-wrap leading-relaxed">{text}</div>;
  }

  // Sanitizar cualquier asterisco residual
  const clean = (text || '')
    .replace(/\*\*\*/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '');

  // Separar párrafos y viñetas
  const paragraphs = clean.split(/\n+/).filter(p => p.trim());

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-zinc-200">
      {paragraphs.map((p, i) => {
        const trimmed = p.trim();
        // Si es una viñeta tipo 🔹 o • o guión
        if (trimmed.startsWith('🔹') || trimmed.startsWith('•') || trimmed.startsWith('-')) {
          const content = trimmed.replace(/^[🔹•\-]\s*/, '');
          const colonIdx = content.indexOf(':');
          if (colonIdx > 0 && colonIdx < 45) {
            const title = content.substring(0, colonIdx);
            const desc = content.substring(colonIdx + 1);
            return (
              <div key={i} className="flex items-start gap-2.5 py-1.5 px-3 bg-[#11131a] rounded-lg border border-white/5 my-1 hover:border-emerald-500/20 transition-colors">
                <span className="text-emerald-400 text-sm mt-0.5 shrink-0 select-none">🔹</span>
                <div>
                  <strong className="text-zinc-100 font-semibold">{title}:</strong>
                  <span className="text-zinc-300 ml-1.5">{desc}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-2.5 py-0.5">
              <span className="text-emerald-400 text-sm mt-0.5 shrink-0 select-none">🔹</span>
              <span className="text-zinc-200">{content}</span>
            </div>
          );
        }

        // Párrafo de texto normal
        return (
          <p key={i} className="text-zinc-200 leading-relaxed">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

const ROUTES = {
  library: {
    id: 'library',
    path: '/knowledge-base',
    label: 'Base de Conocimiento',
    category: 'MOTOR DE CONOCIMIENTO',
    breadcrumb: 'Base de Conocimiento'
  },
  'add-text': {
    id: 'add-text',
    path: '/create-document',
    label: 'Redactar Documento',
    category: 'MOTOR DE CONOCIMIENTO',
    breadcrumb: 'Redactar Documento'
  },
  scrape: {
    id: 'scrape',
    path: '/web-scraper',
    label: 'Rastreador Web & Sitemap',
    category: 'MOTOR DE CONOCIMIENTO',
    breadcrumb: 'Rastreador Web & Sitemap'
  },
  whatsapp: {
    id: 'whatsapp',
    path: '/whatsapp-gateway',
    label: 'WhatsApp Gateway',
    category: 'CANAL DE COMUNICACIÓN',
    breadcrumb: 'Conexión WhatsApp Web'
  },
  chat: {
    id: 'chat',
    path: '/playground',
    label: 'Simulador de Chat',
    category: 'PRUEBAS EN VIVO',
    breadcrumb: 'Simulador de Chat'
  },
  settings: {
    id: 'settings',
    path: '/brand-settings',
    label: 'Identidad & Motores IA',
    category: 'CONFIGURACIÓN DEL SISTEMA',
    breadcrumb: 'Identidad & Motores IA'
  },
  handoffs: {
    id: 'handoffs',
    path: '/human-handoff',
    label: 'Usuarios con IA Pausada',
    category: 'GESTIÓN DE OPERACIONES',
    breadcrumb: 'Usuarios con IA Pausada'
  }
};

const getTabFromPath = (pathname) => {
  const clean = (pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/create-document' || clean === '/new-document' || clean === '/add-text') return 'add-text';
  if (clean === '/web-scraper' || clean === '/scraper' || clean === '/crawler' || clean === '/scrape') return 'scrape';
  if (clean === '/whatsapp-gateway' || clean === '/whatsapp' || clean === '/qr') return 'whatsapp';
  if (clean === '/playground' || clean === '/chat' || clean === '/simulation') return 'chat';
  if (clean === '/brand-settings' || clean === '/settings' || clean === '/brand') return 'settings';
  if (clean === '/human-handoff' || clean === '/paused-users' || clean === '/handoff' || clean === '/handoffs') return 'handoffs';
  return 'library';
};

const getPathFromTab = (tabId) => {
  return ROUTES[tabId]?.path || '/knowledge-base';
};

export default function App() {
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(window.location.pathname));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const navigateTo = (tabId, replace = false) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
    const targetPath = getPathFromTab(tabId);
    if (window.location.pathname !== targetPath) {
      if (replace) {
        window.history.replaceState({ tab: tabId }, '', targetPath);
      } else {
        window.history.pushState({ tab: tabId }, '', targetPath);
      }
    }
  };

  // Sincronizar navegación con el historial del navegador (Atrás / Adelante)
  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getTabFromPath(window.location.pathname));
    };

    if (window.location.pathname === '/') {
      window.history.replaceState({ tab: 'library' }, '', '/knowledge-base');
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Datos globales del sistema
  const [stats, setStats] = useState({
    database_type: 'PostgreSQL',
    total_db_items: 0,
    cached: true,
    active_provider: 'gemini',
    active_model: 'gemini-2.5-flash',
    company: '',
    bot_name: '',
    company_logo: '',
    bot_avatar: '',
    primary_color: '#3ecf8e',
    welcome_message: '',
    transfer_message: '',
    support_phone: '',
    website_url: '',
    wa_connected: false,
    gateway_state: ''
  });

  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Formulario Nuevo Documento
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newContent, setNewContent] = useState('');
  const [isSavingText, setIsSavingText] = useState(false);

  // Scraper Mode: 'crawler' (multi-URL sitemap) vs 'single'
  const [scraperMode, setScraperMode] = useState('crawler');

  // Single URL Scraper
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeCategory, setScrapeCategory] = useState('sitio-web');
  const [isScraping, setIsScraping] = useState(false);

  // Multi-URL Crawler (Sitemap / Internal Link Discovery)
  const [crawlerUrl, setCrawlerUrl] = useState('');
  const [crawlerCategory, setCrawlerCategory] = useState('sitio-web');
  const [crawlerMaxUrls, setCrawlerMaxUrls] = useState(40);
  const [isCrawling, setIsCrawling] = useState(false);
  const [discoveredUrls, setDiscoveredUrls] = useState([]);
  const [isBatchIndexing, setIsBatchIndexing] = useState(false);

  // Formulario Settings (cargado dinámicamente desde la BD)
  const [settingsForm, setSettingsForm] = useState({
    company_name: '',
    bot_name: '',
    company_logo: '',
    bot_avatar: '',
    primary_color: '#3ecf8e',
    bot_tone: '',
    brand_instructions: '',
    welcome_message: '',
    transfer_message: '',
    support_phone: '',
    effective_support_phone: '',
    detected_whatsapp_phone: '',
    handoff_inactivity_hours: 6.0,
    website_url: '',
    ai_provider: '',
    gemini_api_key: '',
    gemini_model: '',
    openai_api_key: '',
    openai_model: '',
    whatsapp_gateway_url: ''
  });
  const [activeHandoffs, setActiveHandoffs] = useState([]);
  const [handoffSearch, setHandoffSearch] = useState('');
  const [releasingId, setReleasingId] = useState(null);
  const [isReleasingAll, setIsReleasingAll] = useState(false);
  const [showManualPauseModal, setShowManualPauseModal] = useState(false);
  const [manualPausePhone, setManualPausePhone] = useState('');
  const [manualPauseReason, setManualPauseReason] = useState('Atención personalizada con asesor humano');
  const [manualPauseTag, setManualPauseTag] = useState('COTIZACIÓN');
  const [manualPauseNotes, setManualPauseNotes] = useState('');
  const [isPausingManual, setIsPausingManual] = useState(false);

  // Modal para editar Tag y Nota del Asesor
  const [editingHandoff, setEditingHandoff] = useState(null);
  const [editTag, setEditTag] = useState('ATENCIÓN HUMANA');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const logoInputRef = useRef(null);
  const avatarInputRef = useRef(null);

  // Playground Chat
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '¡Hola! Soy tu Asistente Operativo. Pregúntame sobre los servicios, garantías, precios o cualquier dato indexado en la base de datos.',
      isCustomized: false
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', isError: false });

  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  // ==============================================================
  // ESTADO Y MÉTODOS DEL CANAL DE WHATSAPP GATEWAY (BAILEYS)
  // ==============================================================
  const [waStatus, setWaStatus] = useState({
    status: 'CONNECTING',
    connected: false,
    phone_number: '',
    user: null,
    connectedAt: null,
    hasQr: false,
    reconnectAttempts: 0
  });
  const [waQrData, setWaQrData] = useState({
    status: 'CONNECTING',
    qrString: null,
    qrDataUrl: null
  });
  const [isRefreshingWa, setIsRefreshingWa] = useState(false);
  const [isLoggingOutWa, setIsLoggingOutWa] = useState(false);
  const [testWaPhone, setTestWaPhone] = useState('');
  const [testWaMessage, setTestWaMessage] = useState('¡Hola! Mensaje de prueba desde Zenith Studio Dashboard.');
  const [isSendingTestWa, setIsSendingTestWa] = useState(false);
  const [hasCopiedPhone, setHasCopiedPhone] = useState(false);

  const fetchWhatsAppStatus = async () => {
    setIsRefreshingWa(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/status`);
      if (res.ok) {
        const data = await res.json();
        setWaStatus(data);
        if (data.status === 'WAITING_QR') {
          fetchWhatsAppQr();
        }
      }
    } catch (err) {
      console.warn('Error fetching WhatsApp status:', err);
    } finally {
      setIsRefreshingWa(false);
    }
  };

  const fetchWhatsAppQr = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/qr`);
      if (res.ok) {
        const data = await res.json();
        setWaQrData(data);
        if (data.phone_number) {
          setWaStatus(prev => ({ ...prev, phone_number: data.phone_number }));
        }
      }
    } catch (err) {
      console.warn('Error fetching WhatsApp QR:', err);
    }
  };

  const handleWhatsAppLogout = async () => {
    if (!window.confirm('¿Seguro que deseas desvincular el dispositivo de WhatsApp? El bot dejará de responder mensajes hasta que vuelvas a escanear el código QR.')) {
      return;
    }
    setIsLoggingOutWa(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/logout`, { method: 'POST' });
      if (res.ok) {
        showToast('📱 Sesión de WhatsApp desvinculada exitosamente.');
        await Promise.all([fetchWhatsAppStatus(), fetchWhatsAppQr(), fetchStats()]);
      } else {
        showToast('No se pudo desvincular la sesión.', true);
      }
    } catch (err) {
      showToast('Error desvinculando dispositivo: ' + err.message, true);
    } finally {
      setIsLoggingOutWa(false);
    }
  };

  const handleSendTestWa = async (e) => {
    e.preventDefault();
    if (!testWaPhone.trim() || !testWaMessage.trim() || isSendingTestWa) return;
    setIsSendingTestWa(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testWaPhone.trim(), message: testWaMessage.trim() })
      });
      if (res.ok) {
        showToast(`✅ ¡Mensaje enviado con éxito a +${testWaPhone.replace(/\D/g, '')}!`);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(`Error al enviar mensaje: ${errData.detail || 'Fallo de entrega'}`, true);
      }
    } catch (err) {
      showToast('Error al enviar mensaje: ' + err.message, true);
    } finally {
      setIsSendingTestWa(false);
    }
  };

  const copyPhoneNumber = (phone) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setHasCopiedPhone(true);
    showToast('📋 Número copiado al portapapeles');
    setTimeout(() => setHasCopiedPhone(false), 2000);
  };

  // Manejo de carga de imágenes (Base64 data URI para persistencia universal)
  const handleImageFileChange = (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Por favor selecciona un archivo de imagen válido (PNG, JPG, SVG, WebP)', true);
      return;
    }

    if (file.size > 2.5 * 1024 * 1024) {
      showToast('La imagen es algo pesada. Recomendamos menos de 2.5 MB', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUri = event.target.result;
      setSettingsForm(prev => ({ ...prev, [field]: dataUri }));
      showToast(`✨ ${field === 'company_logo' ? 'Logo de empresa' : 'Avatar del bot'} cargado`);
    };
    reader.onerror = () => {
      showToast('Error al leer el archivo de imagen', true);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = (field) => {
    setSettingsForm(prev => ({ ...prev, [field]: '' }));
    showToast(`${field === 'company_logo' ? 'Logo' : 'Avatar'} removido`);
  };

  // Carga inicial y polling periódico
  useEffect(() => {
    fetchStats();
    fetchKnowledge();
    fetchSettings();
    fetchActiveHandoffs();
    fetchWhatsAppStatus();
    const interval = setInterval(() => {
      fetchStats();
      fetchActiveHandoffs();
      fetchWhatsAppStatus();
      if (activeTab === 'whatsapp' || waStatus.status === 'WAITING_QR') {
        fetchWhatsAppQr();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeTab, waStatus.status]);

  const fetchStats = async () => {
    try {
      const [resKb, resRoot] = await Promise.all([
        fetch(`${API_BASE}/api/knowledge/stats`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/`).then(r => r.json()).catch(() => ({}))
      ]);

      const gw = resRoot.gateway_integration || {};
      const isConnected = Boolean(gw.connected);
      const gwState = gw.gateway_state || (isConnected ? 'CONNECTED' : 'DISCONNECTED');

      setStats({
        database_type: resKb.database_type || 'PostgreSQL',
        total_db_items: resKb.total_db_items ?? 0,
        cached: resKb.cached ?? true,
        active_provider: resRoot.active_provider || 'gemini',
        company: resRoot.company || resRoot.company_name || '',
        bot_name: resRoot.bot_name || 'Asistente Operativo',
        company_logo: resRoot.company_logo || '',
        bot_avatar: resRoot.bot_avatar || '',
        primary_color: resRoot.primary_color || '#3ecf8e',
        welcome_message: resRoot.welcome_message || '',
        transfer_message: resRoot.transfer_message || '',
        support_phone: resRoot.support_phone || '',
        effective_support_phone: resRoot.effective_support_phone || '',
        handoff_inactivity_hours: resRoot.handoff_inactivity_hours ?? 6.0,
        website_url: resRoot.website_url || '',
        wa_connected: isConnected,
        gateway_state: gwState
      });

      if (resRoot.welcome_message) {
        setMessages(prev => {
          if (prev.length === 1 && prev[0].role === 'assistant' && !prev[0].isCustomized) {
            return [{ role: 'assistant', text: resRoot.welcome_message, isCustomized: true }];
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchKnowledge = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/knowledge`);
      const data = await res.json();
      const list = data.items || [];
      setItems(list);
      const cats = Array.from(new Set(list.map(i => i.category || 'general')));
      setCategories(cats);
    } catch (err) {
      console.error('Error fetching knowledge:', err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      const data = await res.json();
      setSettingsForm({
        company_name: data.company_name || '',
        bot_name: data.bot_name || '',
        company_logo: data.company_logo || '',
        bot_avatar: data.bot_avatar || '',
        primary_color: data.primary_color || '#3ecf8e',
        bot_tone: data.bot_tone || '',
        brand_instructions: data.brand_instructions || '',
        welcome_message: data.welcome_message || '',
        transfer_message: data.transfer_message || '',
        support_phone: data.support_phone || '',
        effective_support_phone: data.effective_support_phone || '',
        detected_whatsapp_phone: data.detected_whatsapp_phone || '',
        handoff_inactivity_hours: data.handoff_inactivity_hours ?? 6.0,
        website_url: data.website_url || '',
        ai_provider: data.ai_provider || '',
        gemini_api_key: data.gemini_api_key || '',
        gemini_model: data.gemini_model || '',
        openai_api_key: data.openai_api_key || '',
        openai_model: data.openai_model || '',
        whatsapp_gateway_url: data.whatsapp_gateway_url || ''
      });
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const fetchActiveHandoffs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/handoff/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveHandoffs(data.active_handoffs || []);
      }
    } catch (err) {
      console.error('Error fetching active handoffs:', err);
    }
  };

  const handleReleaseHandoff = async (sessionId) => {
    setReleasingId(sessionId);
    try {
      const res = await fetch(`${API_BASE}/api/handoff/${encodeURIComponent(sessionId)}/release`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast(`▶️ IA reanudada exitosamente para ${sessionId}.`);
      await Promise.all([fetchActiveHandoffs(), fetchStats()]);
    } catch (err) {
      showToast('Error al despausar la IA: ' + err.message, true);
    } finally {
      setReleasingId(null);
    }
  };

  const handleReleaseAllHandoffs = async () => {
    if (activeHandoffs.length === 0) return;
    setIsReleasingAll(true);
    try {
      const res = await fetch(`${API_BASE}/api/handoff/release-all`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      showToast(`▶️ Se despausó la IA para ${data.count || activeHandoffs.length} usuario(s). IA reactivada.`);
      await Promise.all([fetchActiveHandoffs(), fetchStats()]);
    } catch (err) {
      showToast('Error al despausar usuarios: ' + err.message, true);
    } finally {
      setIsReleasingAll(false);
    }
  };

  const handlePauseHandoffManual = async (e) => {
    e.preventDefault();
    const phone = manualPausePhone.trim();
    if (!phone) return;
    setIsPausingManual(true);
    try {
      const res = await fetch(`${API_BASE}/api/handoff/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: phone,
          reason: manualPauseReason.trim() || 'Pausado manualmente desde el portal',
          tag: manualPauseTag.trim() || 'ATENCIÓN HUMANA',
          notes: manualPauseNotes.trim() || ''
        })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`⏸️ IA pausada para ${phone} con etiqueta [${manualPauseTag}].`);
      setManualPausePhone('');
      setManualPauseReason('Atención personalizada con asesor humano');
      setManualPauseTag('COTIZACIÓN');
      setManualPauseNotes('');
      setShowManualPauseModal(false);
      await Promise.all([fetchActiveHandoffs(), fetchStats()]);
    } catch (err) {
      showToast('Error al pausar la IA: ' + err.message, true);
    } finally {
      setIsPausingManual(false);
    }
  };

  const handleUpdateHandoffMeta = async (sessionId) => {
    if (!sessionId) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_BASE}/api/handoff/${encodeURIComponent(sessionId)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: editTag.trim() || 'ATENCIÓN HUMANA',
          notes: editNotes.trim()
        })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`🏷️ Tag y nota del asesor guardados para ${sessionId}`);
      setEditingHandoff(null);
      await fetchActiveHandoffs();
    } catch (err) {
      showToast('Error al actualizar datos del cliente: ' + err.message, true);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const filteredHandoffs = activeHandoffs.filter(h => {
    if (!handoffSearch.trim()) return true;
    const q = handoffSearch.toLowerCase();
    const sid = (h.session_id || '').toLowerCase();
    const reason = (h.reason || '').toLowerCase();
    const tag = (h.tag || '').toLowerCase();
    const notes = (h.notes || '').toLowerCase();
    return sid.includes(q) || reason.includes(q) || tag.includes(q) || notes.includes(q);
  });

  const handleSyncCache = async () => {
    setIsSyncing(true);
    try {
      await fetch(`${API_BASE}/api/knowledge/sync`, { method: 'POST' });
      showToast('⚡ In-Memory Hot Cache sincronizado con éxito');
      fetchStats();
    } catch (err) {
      showToast('Error sincronizando el caché', true);
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const handleCreateDoc = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setIsSavingText(true);
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory.trim() || 'general',
          content: newContent.trim()
        })
      });
      if (!res.ok) throw new Error(await res.text());

      showToast('✨ Documento guardado e indexado en el caché');
      setNewTitle('');
      setNewContent('');
      setActiveTab('library');
      fetchKnowledge();
      fetchStats();
    } catch (err) {
      showToast('Error al guardar documento: ' + err.message, true);
    } finally {
      setIsSavingText(false);
    }
  };

  const handleSingleScrape = async (e) => {
    e.preventDefault();
    if (!scrapeUrl.trim()) return;

    setIsScraping(true);
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: scrapeUrl.trim(),
          category: scrapeCategory.trim() || 'sitio-web'
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      showToast(`✨ Sitio "${data.title}" extraído con éxito`);
      setScrapeUrl('');
      setActiveTab('library');
      fetchKnowledge();
      fetchStats();
    } catch (err) {
      showToast('Error al extraer sitio: ' + err.message, true);
    } finally {
      setIsScraping(false);
    }
  };

  // Descubrir todas las URLs del sitio (Crawler / Sitemap)
  const handleCrawlSite = async (e) => {
    e.preventDefault();
    if (!crawlerUrl.trim()) return;

    setIsCrawling(true);
    setDiscoveredUrls([]);
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: crawlerUrl.trim(),
          max_urls: Number(crawlerMaxUrls) || 40
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDiscoveredUrls(data.urls || []);
      showToast(`🔍 Se descubrieron ${data.total_found} URLs internas en ${data.domain}`);
    } catch (err) {
      showToast('Error descubriendo URLs del sitio: ' + err.message, true);
    } finally {
      setIsCrawling(false);
    }
  };

  const toggleSelectAllUrls = (select) => {
    setDiscoveredUrls(prev => prev.map(u => ({ ...u, selected: select })));
  };

  const toggleUrlSelection = (targetUrl) => {
    setDiscoveredUrls(prev => prev.map(u =>
      u.url === targetUrl ? { ...u, selected: !u.selected } : u
    ));
  };

  // Indexar en lote las URLs seleccionadas
  const handleBatchIndexUrls = async () => {
    const selectedUrls = discoveredUrls.filter(u => u.selected).map(u => u.url);
    if (selectedUrls.length === 0) {
      showToast('Selecciona al menos una URL para indexar', true);
      return;
    }

    setIsBatchIndexing(true);
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/batch-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: selectedUrls,
          category: crawlerCategory.trim() || 'sitio-web'
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      showToast(`✨ Se indexaron con éxito ${data.total_indexed} páginas en el caché.`);
      setActiveTab('library');
      fetchKnowledge();
      fetchStats();
    } catch (err) {
      showToast('Error en la indexación en lote: ' + err.message, true);
    } finally {
      setIsBatchIndexing(false);
    }
  };

  const handleDeleteItem = async (id) => {
    if (!confirm('¿Seguro que deseas eliminar este conocimiento de la base de datos?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Fallo al borrar');
      showToast('Documento eliminado');
      fetchKnowledge();
      fetchStats();
    } catch (err) {
      showToast('Error al eliminar: ' + err.message, true);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      const updatedName = data.settings?.company_name || settingsForm.company_name;

      setStats(prev => ({
        ...prev,
        company: updatedName,
        bot_name: settingsForm.bot_name,
        company_logo: settingsForm.company_logo,
        bot_avatar: settingsForm.bot_avatar,
        primary_color: settingsForm.primary_color,
        support_phone: settingsForm.support_phone,
        effective_support_phone: data.settings?.effective_support_phone || settingsForm.effective_support_phone
      }));

      showToast('✨ Personalización guardada con éxito en la Base de Datos');
      await Promise.all([fetchStats(), fetchSettings()]);
    } catch (err) {
      showToast('Error al guardar configuración: ' + err.message, true);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || isChatLoading) return;

    const userMsg = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'react-playground-session', message: text })
      });
      const data = await res.json();
      if (data.reply && data.reply.trim().length > 0) {
        setMessages(prev => [...prev, { role: 'assistant', text: data.reply, transferred: data.transferred_to_human }]);
      }
      if (data.transferred_to_human) {
        fetchActiveHandoffs();
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Error al comunicarse con la IA.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Filtrado de documentos
  const filteredItems = items.filter(item => {
    const q = searchQuery.toLowerCase();
    const matchQuery = !q || item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q);
    const matchCat = !selectedCategory || item.category === selectedCategory;
    return matchQuery && matchCat;
  });

  const companyInitial = (stats.company || 'Z').trim().charAt(0).toUpperCase();
  const selectedUrlsCount = discoveredUrls.filter(u => u.selected).length;

  // Color de acento de la marca dinámico e interactivo al 100%
  const themeColor = settingsForm.primary_color || stats.primary_color || '#3ecf8e';
  const themeRgb = hexToRgb(themeColor);

  // Sincronizar variables CSS dinámicas globales en el documento
  useEffect(() => {
    document.documentElement.style.setProperty('--theme-primary', themeColor);
    document.documentElement.style.setProperty('--theme-primary-rgb', themeRgb);
  }, [themeColor, themeRgb]);

  return (
    <div className="flex min-h-screen bg-[#0c0d12] text-zinc-100 font-sans">
      <style>{`
        :root {
          --theme-primary: ${themeColor} !important;
          --theme-primary-rgb: ${themeRgb} !important;
        }
        ::selection {
          background-color: rgba(${themeRgb}, 0.35) !important;
          color: #ffffff !important;
        }
        /* Campos de texto al recibir foco */
        input:focus, textarea:focus, select:focus {
          border-color: ${themeColor} !important;
          outline: none !important;
          box-shadow: 0 0 0 1px rgba(${themeRgb}, 0.35) !important;
        }
        /* Convertir todos los acentos verdes al color seleccionado */
        .text-\\[\\#3ecf8e\\],
        .text-emerald-400,
        .text-emerald-500,
        [class*="text-[#3ecf8e]"] {
          color: ${themeColor} !important;
        }
        .bg-\\[\\#3ecf8e\\],
        .bg-emerald-500,
        [class*="bg-[#3ecf8e]"]:not([class*="/"]) {
          background-color: ${themeColor} !important;
        }
        .border-\\[\\#3ecf8e\\],
        .border-emerald-500,
        [class*="border-[#3ecf8e]"]:not([class*="/"]) {
          border-color: ${themeColor} !important;
        }
        .bg-\\[\\#3ecf8e\\]\\/5,
        .bg-\\[\\#3ecf8e\\]\\/10,
        .bg-\\[\\#3ecf8e\\]\\/20,
        .bg-emerald-500\\/10,
        .bg-emerald-950,
        .bg-emerald-950\\/60,
        .bg-emerald-950\\/70,
        [class*="bg-[#3ecf8e]/"],
        [class*="bg-emerald-950"] {
          background-color: rgba(${themeRgb}, 0.15) !important;
        }
        .border-\\[\\#3ecf8e\\]\\/20,
        .border-\\[\\#3ecf8e\\]\\/40,
        .border-emerald-500\\/20,
        .border-emerald-800,
        .border-emerald-800\\/50,
        .border-emerald-800\\/60,
        [class*="border-[#3ecf8e]/"],
        [class*="border-emerald-800"] {
          border-color: rgba(${themeRgb}, 0.35) !important;
        }
        .hover\\:bg-\\[\\#3ecf8e\\]:hover,
        .hover\\:bg-emerald-400:hover,
        [class*="hover:bg-[#3ecf8e]"]:hover,
        [class*="hover:bg-emerald-400"]:hover {
          background-color: ${themeColor} !important;
          filter: brightness(1.15) !important;
        }
        .hover\\:text-\\[\\#3ecf8e\\]:hover,
        .hover\\:text-emerald-400:hover,
        [class*="hover:text-[#3ecf8e]"]:hover {
          color: ${themeColor} !important;
        }
        .hover\\:border-\\[\\#3ecf8e\\]:hover,
        [class*="hover:border-[#3ecf8e]"]:hover {
          border-color: ${themeColor} !important;
        }
        .hover\\:bg-\\[\\#3ecf8e\\]\\/10:hover,
        .hover\\:bg-emerald-900\\/60:hover,
        [class*="hover:bg-emerald-900"]:hover {
          background-color: rgba(${themeRgb}, 0.22) !important;
        }
        .focus\\:border-\\[\\#3ecf8e\\]:focus {
          border-color: ${themeColor} !important;
        }
        .focus\\:ring-\\[\\#3ecf8e\\]:focus {
          --tw-ring-color: ${themeColor} !important;
        }
        .accent-\\[\\#3ecf8e\\],
        input[type="checkbox"],
        input[type="radio"] {
          accent-color: ${themeColor} !important;
        }
        .shadow-emerald-950,
        .shadow-emerald-950\\/20 {
          box-shadow: 0 10px 15px -3px rgba(${themeRgb}, 0.25) !important;
        }
        *::-webkit-scrollbar-thumb:hover {
          background: ${themeColor} !important;
        }
      `}</style>

      {/* ==============================================================
          SIDEBAR (ESTILO SUPABASE STUDIO)
          ============================================================== */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#111218] border-r border-[#1f2330] flex flex-col transition-transform duration-200 md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-[#1f2330] flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            {stats.company_logo ? (
              <img
                src={stats.company_logo}
                alt={stats.company || 'Logo'}
                className="w-9 h-9 rounded-lg object-contain bg-zinc-900 border border-[#1f2330] p-0.5 shrink-0 shadow-md"
              />
            ) : (
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center font-extrabold text-white text-lg shadow-lg shrink-0 transition-colors"
                style={{ backgroundColor: themeColor }}
              >
                {companyInitial}
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-zinc-100 truncate">{stats.company || 'Zenith Platform'}</span>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: themeColor }}
                ></span>
                <span className="truncate">{stats.bot_name || 'Asistente Operativo'}</span>
              </div>
            </div>
          </div>
          <button className="md:hidden text-zinc-400 hover:text-white p-1" onClick={() => setMobileMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-1.5 text-[10px] font-extrabold tracking-wider text-zinc-500 uppercase">
            MOTOR DE CONOCIMIENTO
          </div>

          <button
            onClick={() => navigateTo('library')}
            style={activeTab === 'library' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'library'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <BookOpen size={18} style={{ color: activeTab === 'library' ? themeColor : undefined }} className={activeTab === 'library' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
              <span className="truncate">Base de Conocimiento</span>
            </div>
            <span
              style={activeTab === 'library' ? {
                backgroundColor: `rgba(${themeRgb}, 0.2)`,
                color: themeColor
              } : {}}
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                activeTab === 'library' ? '' : 'bg-zinc-850 text-zinc-400'
              }`}
            >
              {stats.total_db_items}
            </span>
          </button>

          <button
            onClick={() => navigateTo('add-text')}
            style={activeTab === 'add-text' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'add-text'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <PlusCircle size={18} style={{ color: activeTab === 'add-text' ? themeColor : undefined }} className={activeTab === 'add-text' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
            <span className="truncate">Redactar Documento</span>
          </button>

          <button
            onClick={() => navigateTo('scrape')}
            style={activeTab === 'scrape' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'scrape'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Globe size={18} style={{ color: activeTab === 'scrape' ? themeColor : undefined }} className={activeTab === 'scrape' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
            <span className="truncate">Rastreador Web & Sitemap</span>
          </button>

          <div className="pt-4 px-3 pb-1.5 text-[10px] font-extrabold tracking-wider text-zinc-500 uppercase flex items-center justify-between">
            <span>CANAL WHATSAPP</span>
            <span
              className={`w-2 h-2 rounded-full ${
                waStatus.connected || waStatus.status === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : waStatus.status === 'WAITING_QR'
                    ? 'bg-amber-400'
                    : 'bg-zinc-600'
              }`}
            ></span>
          </div>

          <button
            onClick={() => navigateTo('whatsapp')}
            style={activeTab === 'whatsapp' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'whatsapp'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <MessageCircle size={18} style={{ color: activeTab === 'whatsapp' ? themeColor : undefined }} className={activeTab === 'whatsapp' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
              <span className="truncate">WhatsApp Gateway</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                waStatus.connected || waStatus.status === 'CONNECTED'
                  ? 'bg-emerald-500/20 text-emerald-400 font-bold'
                  : waStatus.status === 'WAITING_QR'
                    ? 'bg-amber-500/20 text-amber-400 font-bold'
                    : 'bg-zinc-850 text-zinc-500'
              }`}
            >
              {waStatus.connected || waStatus.status === 'CONNECTED' ? 'ONLINE' : (waStatus.status === 'WAITING_QR' ? 'QR' : 'OFFLINE')}
            </span>
          </button>

          <div className="pt-4 px-3 pb-1.5 text-[10px] font-extrabold tracking-wider text-zinc-500 uppercase">
            PRUEBAS EN VIVO
          </div>

          <button
            onClick={() => navigateTo('chat')}
            style={activeTab === 'chat' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'chat'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <MessageSquare size={18} style={{ color: activeTab === 'chat' ? themeColor : undefined }} className={activeTab === 'chat' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
              <span className="truncate">Simulador de Chat</span>
            </div>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: themeColor }} title="Playground activo"></span>
          </button>

          <div className="pt-4 px-3 pb-1.5 text-[10px] font-extrabold tracking-wider text-zinc-500 uppercase flex items-center justify-between">
            <span>GESTIÓN DE OPERACIONES</span>
            {activeHandoffs.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title={`${activeHandoffs.length} usuarios con IA pausada`}></span>
            )}
          </div>

          <button
            onClick={() => navigateTo('handoffs')}
            style={activeTab === 'handoffs' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'handoffs'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <UserCheck size={18} style={{ color: activeTab === 'handoffs' ? themeColor : undefined }} className={activeTab === 'handoffs' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
              <span className="truncate">Usuarios con IA Pausada</span>
            </div>
            {activeHandoffs.length > 0 ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                {activeHandoffs.length}
              </span>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-850 text-zinc-500">
                0
              </span>
            )}
          </button>

          <div className="pt-4 px-3 pb-1.5 text-[10px] font-extrabold tracking-wider text-zinc-500 uppercase">
            CONFIGURACIÓN DEL SISTEMA
          </div>

          <button
            onClick={() => navigateTo('settings')}
            style={activeTab === 'settings' ? {
              backgroundColor: `rgba(${themeRgb}, 0.12)`,
              color: themeColor
            } : {}}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === 'settings'
                ? 'font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Settings size={18} style={{ color: activeTab === 'settings' ? themeColor : undefined }} className={activeTab === 'settings' ? '' : 'text-zinc-400 group-hover:text-zinc-300'} />
            <span className="truncate">Identidad & Motores IA</span>
          </button>
        </nav>

        {/* Footer Sidebar */}
        <div className="p-4 border-t border-[#1f2330] bg-black/20 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 bg-[#0c0d12] border border-[#1f2330] rounded-lg text-xs">
            <span className="text-zinc-400">WhatsApp Gateway</span>
            <span
              style={{
                color: (stats.wa_connected || stats.gateway_state === 'CONNECTED') ? themeColor : undefined
              }}
              className={`font-semibold ${
                stats.wa_connected || stats.gateway_state === 'CONNECTED'
                  ? ''
                  : stats.gateway_state === 'WAITING_QR'
                    ? 'text-amber-400'
                    : stats.gateway_state === 'CONNECTING' || stats.gateway_state === 'RECONNECTING'
                      ? 'text-sky-400 animate-pulse'
                      : 'text-rose-400'
              }`}
            >
              {stats.gateway_state || (stats.wa_connected ? 'CONNECTED' : 'DISCONNECTED')}
            </span>
          </div>

          <div className="flex gap-2">
            <a
              href="http://localhost:3000/qr"
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-1.5 px-2 bg-zinc-800/60 hover:bg-zinc-800 border border-[#1f2330] rounded-md text-[11px] font-medium text-center text-zinc-300 hover:text-white transition-colors"
            >
              📲 Ver QR
            </a>
            <a
              href={`${API_BASE}/docs`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-1.5 px-2 bg-zinc-800/60 hover:bg-zinc-800 border border-[#1f2330] rounded-md text-[11px] font-medium text-center text-zinc-300 hover:text-white transition-colors"
            >
              📖 Swagger
            </a>
          </div>
        </div>
      </aside>

      {/* ==============================================================
          MAIN CONTENT WORKSPACE
          ============================================================== */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen min-w-0">

        {/* Top Header */}
        <header className="h-16 px-6 bg-[#111218]/80 backdrop-blur-md border-b border-[#1f2330] sticky top-0 z-30 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button className="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg border border-[#1f2330]" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 font-medium">{stats.company || 'Zenith Platform'}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-200 font-bold">
                {ROUTES[activeTab]?.breadcrumb || 'Knowledge Base'}
              </span>
              <span className="hidden sm:inline-block text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 ml-1">
                {ROUTES[activeTab]?.path || '/knowledge-base'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => navigateTo('whatsapp')}
                className={`flex items-center gap-1.5 px-3 py-1 bg-[#151720] border rounded-full text-xs font-medium transition-all ${
                  waStatus.connected || waStatus.status === 'CONNECTED'
                    ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                    : waStatus.status === 'WAITING_QR'
                      ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                      : 'border-[#1f2330] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  waStatus.connected || waStatus.status === 'CONNECTED'
                    ? 'bg-emerald-400 animate-pulse'
                    : waStatus.status === 'WAITING_QR'
                      ? 'bg-amber-400'
                      : 'bg-zinc-500'
                }`}></span>
                <span className="font-mono text-[11px]">
                  {waStatus.connected || waStatus.status === 'CONNECTED'
                    ? (waStatus.phone_number || stats.detected_whatsapp_phone || 'WhatsApp Activo')
                    : (waStatus.status === 'WAITING_QR' ? 'Vincular WhatsApp' : 'WhatsApp Offline')}
                </span>
              </button>
              <div className="px-3 py-1 bg-[#151720] border border-[#1f2330] rounded-full text-xs font-medium text-zinc-400">
                BD: <strong className="text-zinc-200">{stats.database_type}</strong>
              </div>
              <div className="px-3 py-1 bg-[#151720] border border-[#1f2330] rounded-full text-xs font-medium text-zinc-400">
                Latencia: <strong className="text-[#3ecf8e]" style={{ color: themeColor }}>&lt; 1 ms</strong>
              </div>
              <div className="px-3 py-1 bg-[#151720] border border-[#1f2330] rounded-full text-xs font-medium text-zinc-400">
                Motor: <strong className="text-zinc-200">{stats.active_model}</strong>
              </div>
            </div>

            <button
              onClick={handleSyncCache}
              disabled={isSyncing}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#151720] hover:bg-[#3ecf8e]/10 border border-[#1f2330] hover:border-[#3ecf8e] text-zinc-200 hover:text-[#3ecf8e] rounded-lg text-xs font-semibold transition-all"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin text-[#3ecf8e]' : ''} style={{ color: isSyncing ? themeColor : undefined }} />
              <span>Sincronizar</span>
            </button>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">

          {/* ==============================================================
              TAB 1: BASE DE CONOCIMIENTO (LIBRARY)
              ============================================================== */}
          {activeTab === 'library' && (
            <div className="space-y-6 animate-fadeIn">
              {/* Metric Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Documentos Indexados</span>
                  <div className="mt-2 text-2xl font-extrabold text-zinc-100">{stats.total_db_items}</div>
                  <span className="text-xs text-zinc-400 mt-1">Guardados en {stats.database_type}</span>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">In-Memory Hot Cache</span>
                  <div className="mt-2 text-2xl font-extrabold text-[#3ecf8e]" style={{ color: themeColor }}>0.00 ms</div>
                  <span className="text-xs text-zinc-400 mt-1">Recuperación instantánea</span>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Motor Activo</span>
                  <div className="mt-2 text-2xl font-extrabold text-zinc-100 uppercase">{stats.active_provider}</div>
                  <span className="text-xs text-zinc-400 mt-1">{stats.active_model}</span>
                </div>

                <div
                  onClick={() => navigateTo('whatsapp')}
                  className="p-4 bg-[#151720] border border-[#1f2330] hover:border-zinc-700/80 rounded-xl flex flex-col justify-between cursor-pointer transition-all hover:-translate-y-0.5 group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider group-hover:text-zinc-300">WhatsApp Gateway</span>
                    <ExternalLink size={13} className="text-zinc-500 group-hover:text-zinc-300" />
                  </div>
                  <div
                    style={(waStatus.connected || waStatus.status === 'CONNECTED' || stats.wa_connected) ? { color: themeColor } : {}}
                    className={`mt-2 text-2xl font-extrabold ${
                      waStatus.connected || waStatus.status === 'CONNECTED' || stats.wa_connected
                        ? 'text-[#3ecf8e]'
                        : waStatus.status === 'WAITING_QR'
                          ? 'text-amber-400'
                          : waStatus.status === 'CONNECTING' || waStatus.status === 'RECONNECTING'
                            ? 'text-sky-400'
                            : 'text-rose-400'
                    }`}
                  >
                    {waStatus.connected || waStatus.status === 'CONNECTED' || stats.wa_connected ? 'ONLINE' : (waStatus.status || 'OFFLINE')}
                  </div>
                  <span className="text-xs text-zinc-400 mt-1 truncate">
                    {waStatus.phone_number || stats.detected_whatsapp_phone || 'Microservicio Baileys'}
                  </span>
                </div>
              </div>

              {/* Header de Sección y Filtros */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                <div>
                  <h1 className="text-xl font-bold text-zinc-100">Documentos y Sitios Web en Producción</h1>
                  <p className="text-sm text-zinc-400 mt-0.5">La IA responderá basándose estrictamente en estos datos con cero alucinaciones.</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('scrape')}
                    className="inline-flex items-center gap-2 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs rounded-lg border border-[#1f2330] transition-all"
                  >
                    <Globe size={15} />
                    <span>Escanear Sitio Web</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('add-text')}
                    style={{ backgroundColor: themeColor }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all shrink-0 hover:brightness-110"
                  >
                    <PlusCircle size={16} />
                    <span>Nuevo Documento</span>
                  </button>
                </div>
              </div>

              {/* Barra de Filtro */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar por título o contenido en el catálogo..."
                    className="w-full pl-10 pr-4 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none transition-colors"
                  />
                </div>

                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="px-3 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-300 outline-none w-full sm:w-56"
                >
                  <option value="">Todas las categorías</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Grid de Tarjetas */}
              {filteredItems.length === 0 ? (
                <div className="p-12 text-center bg-[#151720] border border-dashed border-[#1f2330] rounded-xl space-y-3">
                  <BookOpen size={36} className="mx-auto text-zinc-600" />
                  <p className="text-sm text-zinc-400">No se encontraron documentos que coincidan con la búsqueda.</p>
                  <button onClick={() => setActiveTab('add-text')} style={{ color: themeColor }} className="text-xs font-semibold hover:underline">
                    Crear un nuevo documento ahora
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map(item => (
                    <div key={item.id} className="p-5 bg-[#151720] border border-[#1f2330] hover:border-zinc-700/80 rounded-xl flex flex-col justify-between gap-4 transition-all hover:-translate-y-0.5">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-sm text-zinc-100 line-clamp-2 leading-snug">{item.title}</h3>
                          <span
                            style={item.source_type !== 'url' ? {
                              backgroundColor: `rgba(${themeRgb}, 0.15)`,
                              color: themeColor,
                              borderColor: `rgba(${themeRgb}, 0.35)`
                            } : {}}
                            className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded tracking-wide shrink-0 border ${item.source_type === 'url' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : ''}`}
                          >
                            {item.source_type}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <span>Categoría: <strong className="text-zinc-300">{item.category}</strong></span>
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center gap-1">
                              <span>URL</span>
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>

                        <div className="font-mono text-xs text-zinc-400 bg-[#0e1017] p-3 rounded-lg border border-white/5 line-clamp-4 leading-relaxed">
                          {item.content}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-[#1f2330]">
                        <button
                          onClick={() => setSelectedDoc(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white bg-[#0e1017] hover:bg-zinc-800 border border-[#1f2330] rounded-md transition-colors"
                        >
                          <Eye size={13} />
                          <span>Ver Completo</span>
                        </button>

                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
                        >
                          <Trash2 size={13} />
                          <span>Eliminar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ==============================================================
              TAB 2: NUEVO DOCUMENTO (ADD TEXT)
              ============================================================== */}
          {activeTab === 'add-text' && (
            <div className="max-w-3xl space-y-6 animate-fadeIn">
              <div>
                <h1 className="text-xl font-bold text-zinc-100">Nuevo Documento de Conocimiento</h1>
                <p className="text-sm text-zinc-400 mt-1">Ingresa especificaciones técnicas, políticas de garantía, precios o manuales operativos.</p>
              </div>

              <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl">
                <form onSubmit={handleCreateDoc} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Título del Documento *</label>
                      <input
                        type="text"
                        required
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        placeholder="Ej: Catálogo de Servicios y Precios 2026"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Categoría</label>
                      <input
                        type="text"
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        placeholder="Ej: precios, políticas, soporte"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Contenido Detallado *</label>
                    <textarea
                      required
                      rows={10}
                      value={newContent}
                      onChange={e => setNewContent(e.target.value)}
                      placeholder="Redacta o pega aquí la información exacta que el bot debe utilizar..."
                      className="w-full px-3.5 py-3 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-xs font-mono text-zinc-200 outline-none leading-relaxed"
                    />
                    <div className="flex justify-between items-center text-xs text-zinc-500 mt-2">
                      <span>Admite texto plano y Markdown. Se sanitiza a UTF-8 automáticamente.</span>
                      <span>{newContent.length} caracteres</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="px-4 py-2 border border-[#1f2330] hover:bg-zinc-800 text-zinc-300 font-semibold text-sm rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      disabled={isSavingText}
                      style={{ backgroundColor: themeColor }}
                      className="inline-flex items-center gap-2 px-5 py-2 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all disabled:opacity-50 hover:brightness-110"
                    >
                      {isSavingText ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" />
                          <span>Guardando...</span>
                        </>
                      ) : (
                        <>
                          <PlusCircle size={16} />
                          <span>Guardar e Indexar</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==============================================================
              TAB 3: WEB SCRAPER & CRAWLER MULTI-URL (NUEVA FUNCIÓN)
              ============================================================== */}
          {activeTab === 'scrape' && (
            <div className="max-w-4xl space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-zinc-100">Extractor Web Inteligente</h1>
                  <p className="text-sm text-zinc-400 mt-1">Escanea páginas web individuales o mapea automáticamente todas las URLs de tu sitio web.</p>
                </div>

                {/* Selector de Modo */}
                <div className="flex bg-[#111218] p-1 border border-[#1f2330] rounded-lg shrink-0">
                  <button
                    onClick={() => setScraperMode('crawler')}
                    style={scraperMode === 'crawler' ? { backgroundColor: themeColor } : {}}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scraperMode === 'crawler' ? 'text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    <Layers size={14} />
                    <span>Mapear Sitio Completo</span>
                  </button>
                  <button
                    onClick={() => setScraperMode('single')}
                    style={scraperMode === 'single' ? { backgroundColor: themeColor } : {}}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scraperMode === 'single' ? 'text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    <Globe size={14} />
                    <span>Página Única</span>
                  </button>
                </div>
              </div>

              {/* MODO 1: MAPEAR SITIO COMPLETO (CRAWLER / SITEMAP) */}
              {scraperMode === 'crawler' && (
                <div className="space-y-6">
                  {/* Formulario de Descubrimiento */}
                  <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-sm">
                      <Compass size={17} style={{ color: themeColor }} />
                      <span>Paso 1: Mapear URLs Internas del Sitio Web</span>
                    </div>

                    <form onSubmit={handleCrawlSite} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">URL Raíz del Sitio *</label>
                          <input
                            type="url"
                            required
                            value={crawlerUrl}
                            onChange={e => setCrawlerUrl(e.target.value)}
                            placeholder="https://fantasmadigital.dev"
                            className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Máximo de URLs</label>
                          <select
                            value={crawlerMaxUrls}
                            onChange={e => setCrawlerMaxUrls(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                          >
                            <option value="20">20 páginas</option>
                            <option value="40">40 páginas (Recomendado)</option>
                            <option value="60">60 páginas</option>
                            <option value="100">100 páginas</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-zinc-500">Rastreará /sitemap.xml y todos los enlaces internos <code>&lt;a href&gt;</code> del mismo dominio.</span>

                        <button
                          type="submit"
                          disabled={isCrawling}
                          style={{ backgroundColor: themeColor }}
                          className="inline-flex items-center gap-2 px-5 py-2 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all disabled:opacity-50 hover:brightness-110"
                        >
                          {isCrawling ? (
                            <>
                              <RefreshCw size={15} className="animate-spin" />
                              <span>Rastreando enlaces...</span>
                            </>
                          ) : (
                            <>
                              <Search size={15} />
                              <span>Descubrir URLs del Sitio</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Resultados del Mapeo: Lista de URLs encontradas */}
                  {discoveredUrls.length > 0 && (
                    <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4 animate-scaleUp">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1f2330]">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base text-zinc-100">URLs Detectadas ({discoveredUrls.length} páginas)</h3>
                            <span
                              className="px-2 py-0.5 rounded text-xs font-bold border"
                              style={{
                                backgroundColor: `rgba(${themeRgb}, 0.12)`,
                                borderColor: `rgba(${themeRgb}, 0.3)`,
                                color: themeColor
                              }}
                            >
                              {selectedUrlsCount} seleccionadas
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">Marca o desmarca las URLs que deseas incorporar a la base de conocimiento.</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleSelectAllUrls(true)}
                            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-medium transition-colors"
                          >
                            Seleccionar Todas
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSelectAllUrls(false)}
                            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-medium transition-colors"
                          >
                            Deseleccionar
                          </button>
                        </div>
                      </div>

                      {/* Lista scrolleable de URLs */}
                      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-2">
                        {discoveredUrls.map((item, idx) => (
                          <label
                            key={item.url}
                            style={item.selected ? {
                              backgroundColor: `rgba(${themeRgb}, 0.12)`,
                              borderColor: `rgba(${themeRgb}, 0.4)`
                            } : {}}
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${item.selected ? 'text-zinc-100 font-medium' : 'bg-[#0e1017] border-[#1f2330] text-zinc-400 hover:border-zinc-700'}`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="text-zinc-500 font-mono text-[11px] w-6 shrink-0">{idx + 1}.</span>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleUrlSelection(item.url)}
                                style={{ accentColor: themeColor }}
                                className="w-4 h-4 rounded cursor-pointer shrink-0"
                              />
                              <span className="font-mono text-zinc-200 font-medium truncate">{item.path}</span>
                            </div>

                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-zinc-400 hover:text-white shrink-0 p-1 transition-colors"
                              title="Abrir URL en pestaña nueva"
                            >
                              <ExternalLink size={13} />
                            </a>
                          </label>
                        ))}
                      </div>

                      {/* Paso 2: Acción de Indexación en Lote */}
                      <div className="pt-4 border-t border-[#1f2330] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Categoría:</label>
                          <input
                            type="text"
                            value={crawlerCategory}
                            onChange={e => setCrawlerCategory(e.target.value)}
                            placeholder="sitio-web"
                            className="px-3 py-1.5 bg-[#0e1017] border border-[#1f2330] rounded-md text-xs text-zinc-200 outline-none w-36"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleBatchIndexUrls}
                          disabled={isBatchIndexing || selectedUrlsCount === 0}
                          style={{ backgroundColor: themeColor }}
                          className="inline-flex items-center gap-2 px-6 py-2.5 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all disabled:opacity-50 hover:brightness-110"
                        >
                          {isBatchIndexing ? (
                            <>
                              <RefreshCw size={16} className="animate-spin" />
                              <span>Extrayendo e indexando ({selectedUrlsCount} URLs)...</span>
                            </>
                          ) : (
                            <>
                              <Zap size={16} />
                              <span>Indexar URLs Seleccionadas ({selectedUrlsCount})</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MODO 2: PÁGINA ÚNICA */}
              {scraperMode === 'single' && (
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-5 animate-scaleUp">
                  <form onSubmit={handleSingleScrape} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">URL del Sitio Web *</label>
                        <input
                          type="url"
                          required
                          value={scrapeUrl}
                          onChange={e => setScrapeUrl(e.target.value)}
                          placeholder="https://tuempresa.com/servicios"
                          className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Categoría</label>
                        <input
                          type="text"
                          value={scrapeCategory}
                          onChange={e => setScrapeCategory(e.target.value)}
                          placeholder="Ej: sitio-web, landing"
                          className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    <div
                      className="p-4 rounded-lg text-xs text-zinc-400 leading-relaxed border"
                      style={{
                        backgroundColor: `rgba(${themeRgb}, 0.08)`,
                        borderColor: `rgba(${themeRgb}, 0.3)`
                      }}
                    >
                      <strong style={{ color: themeColor }} className="block mb-1">⚡ Detección Inteligente de Codificación:</strong>
                      El scraper analiza los bytes brutos y convierte el HTML a UTF-8 puro, eliminando caracteres corruptos (mojibake) y actualizando el In-Memory Hot Cache en menos de 30 milisegundos.
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={isScraping}
                        style={{ backgroundColor: themeColor }}
                        className="inline-flex items-center gap-2 px-5 py-2 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all disabled:opacity-50 hover:brightness-110"
                      >
                        {isScraping ? (
                          <>
                            <RefreshCw size={15} className="animate-spin" />
                            <span>Extrayendo Sitio...</span>
                          </>
                        ) : (
                          <>
                            <Globe size={16} />
                            <span>Extraer e Indexar Sitio</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ==============================================================
              TAB 4: PLAYGROUND / CHAT
              ============================================================== */}
          {activeTab === 'chat' && (
            <div className="max-w-4xl space-y-6 animate-fadeIn">
              <div>
                <h1 className="text-xl font-bold text-zinc-100">Playground de Conversación</h1>
                <p className="text-sm text-zinc-400 mt-1">Interactúa con el asistente para comprobar cómo responde con base en tu nuevo catálogo y políticas.</p>
              </div>

              <div className="flex flex-col h-[580px] bg-[#111218] border border-[#1f2330] rounded-xl overflow-hidden shadow-2xl">
                {/* Chat Top Banner */}
                <div className="px-5 py-3 bg-[#0e1017] border-b border-[#1f2330] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {stats.bot_avatar ? (
                      <img
                        src={stats.bot_avatar}
                        alt="Bot Avatar"
                        className="w-8 h-8 rounded-full object-cover border border-[#1f2330] shadow-sm"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                        style={{ backgroundColor: themeColor }}
                      >
                        <Bot size={16} />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                        <span>{stats.bot_name || 'Asistente Operativo'}</span>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: themeColor }}></span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate max-w-xs">{stats.company || 'Atención en Línea'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(stats.effective_support_phone || stats.support_phone) && (
                      <span className="hidden sm:inline-flex text-[11px] text-zinc-300 items-center gap-1.5 bg-zinc-900/90 px-2.5 py-1 rounded-md border border-[#1f2330]">
                        <PhoneCall size={12} style={{ color: themeColor }} />
                        <span className="text-zinc-500 text-[10px]">Soporte:</span>
                        <span className="font-mono">{stats.effective_support_phone || stats.support_phone}</span>
                      </span>
                    )}
                    <button
                      onClick={() => setMessages([{
                        role: 'assistant',
                        text: stats.welcome_message || '¡Hola! Soy tu Asistente Operativo. Pregúntame sobre los servicios, garantías, precios o cualquier dato indexado en la base de datos.',
                        isCustomized: true
                      }])}
                      className="px-2.5 py-1 bg-zinc-800/60 hover:bg-zinc-800 border border-[#1f2330] rounded-md text-[11px] text-zinc-300 transition-colors"
                      title="Reiniciar conversación"
                    >
                      Reiniciar
                    </button>
                  </div>
                </div>

                {/* Banner de Silencio de IA / Agente Humano Activo (Playground) */}
                {activeHandoffs.some(h => h.session_id === 'react-playground-session') && (
                  <div className="px-5 py-2.5 bg-amber-950/70 border-b border-amber-800/60 flex items-center justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-center gap-2">
                      <Clock size={15} className="text-amber-400 shrink-0" />
                      <span>
                        <strong>Modo Agente Humano Activo:</strong> La IA está en silencio para esta sesión ({stats.handoff_inactivity_hours || 6}h de inactividad).
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReleaseHandoff('react-playground-session')}
                      style={{ backgroundColor: themeColor }}
                      className="px-2.5 py-1 text-zinc-950 font-bold rounded text-[11px] transition-colors shrink-0 shadow hover:brightness-110"
                    >
                      ▶️ Reanudar IA Ahora
                    </button>
                  </div>
                )}

                {/* Messages Box */}
                <div className="flex-1 p-6 overflow-y-auto space-y-4">
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex items-start gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'assistant' && (
                        stats.bot_avatar ? (
                          <img
                            src={stats.bot_avatar}
                            alt="Avatar"
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#1f2330] mt-0.5 shadow-sm"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white mt-0.5 shadow-sm"
                            style={{ backgroundColor: themeColor }}
                          >
                            <Bot size={15} />
                          </div>
                        )
                      )}
                      <div
                        className={`max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed ${m.role === 'user'
                            ? 'text-white rounded-br-none shadow-sm'
                            : 'bg-[#181a24] text-zinc-200 border border-[#1f2330] rounded-bl-none shadow-md'
                          }`}
                        style={m.role === 'user' ? { backgroundColor: themeColor } : {}}
                      >
                        <FormattedChatMessage text={m.text} isUser={m.role === 'user'} />
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start items-center gap-2.5">
                      {stats.bot_avatar ? (
                        <img src={stats.bot_avatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#1f2330]" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: themeColor }}>
                          <Bot size={15} />
                        </div>
                      )}
                      <div className="px-4 py-3 bg-[#181a24] border border-[#1f2330] rounded-xl text-xs text-zinc-400 flex items-center gap-2">
                        <RefreshCw size={14} className="animate-spin" style={{ color: themeColor }} />
                        <span>Escribiendo respuesta...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input Bar */}
                <form onSubmit={handleSendMessage} className="p-4 bg-[#0e1017] border-t border-[#1f2330] flex gap-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="Haz una pregunta como si fueras un cliente en WhatsApp..."
                    className="flex-1 px-4 py-2.5 bg-[#151720] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading}
                    style={{ backgroundColor: themeColor }}
                    className="px-4 py-2.5 text-zinc-950 font-bold rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-2 shrink-0 hover:brightness-110"
                  >
                    <span>Enviar</span>
                    <Send size={15} />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ==============================================================
              TAB: WHATSAPP GATEWAY (VINCULACIÓN QR & MONITOREO EN VIVO)
              ============================================================== */}
          {activeTab === 'whatsapp' && (
            <div className="space-y-6 animate-fadeIn pb-12">
              {/* Header de Sección */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1f2330]">
                <div>
                  <div className="flex items-center gap-2">
                    <MessageCircle size={22} style={{ color: themeColor }} />
                    <h1 className="text-xl font-bold text-zinc-100">Conexión WhatsApp Web & Gateway</h1>
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">
                    Vincula tu número de WhatsApp para que el Asistente Operativo IA responda de forma autónoma con Baileys Multi-Device.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="http://localhost:3000/qr"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-semibold border border-[#1f2330] transition-all"
                  >
                    <span>Abrir /qr Independiente</span>
                    <ExternalLink size={13} />
                  </a>

                  <button
                    onClick={async () => {
                      await Promise.all([fetchWhatsAppStatus(), fetchWhatsAppQr()]);
                      showToast('🔄 Estado de WhatsApp actualizado');
                    }}
                    disabled={isRefreshingWa}
                    className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#151720] hover:bg-zinc-800 border border-[#1f2330] text-zinc-200 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={isRefreshingWa ? 'animate-spin' : ''} style={{ color: themeColor }} />
                    <span>Actualizar</span>
                  </button>
                </div>
              </div>

              {/* Grid Principal */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Columna Izquierda: Estado de la Vinculación / Código QR */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="p-6 bg-[#111218] border border-[#1f2330] rounded-2xl shadow-xl space-y-6">
                    {/* Header de la tarjeta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-md"
                          style={{
                            backgroundColor: `rgba(${themeRgb}, 0.14)`,
                            color: themeColor,
                            border: `1px solid rgba(${themeRgb}, 0.3)`
                          }}
                        >
                          <Smartphone size={20} />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-zinc-100">Estado de la Sesión</h2>
                          <p className="text-xs text-zinc-400">Microservicio Socket Baileys</p>
                        </div>
                      </div>

                      {/* Status Pill */}
                      <div
                        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider font-mono border ${
                          waStatus.connected || waStatus.status === 'CONNECTED'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35'
                            : waStatus.status === 'WAITING_QR'
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/35'
                              : waStatus.status === 'CONNECTING' || waStatus.status === 'RECONNECTING'
                                ? 'bg-sky-500/15 text-sky-400 border-sky-500/35'
                                : 'bg-rose-500/15 text-rose-400 border-rose-500/35'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            waStatus.connected || waStatus.status === 'CONNECTED'
                              ? 'bg-emerald-400 animate-pulse'
                              : waStatus.status === 'WAITING_QR'
                                ? 'bg-amber-400 animate-pulse'
                                : waStatus.status === 'CONNECTING' || waStatus.status === 'RECONNECTING'
                                  ? 'bg-sky-400 animate-pulse'
                                  : 'bg-rose-400'
                          }`}
                        ></span>
                        <span>{waStatus.status || (waStatus.connected ? 'CONNECTED' : 'DISCONNECTED')}</span>
                      </div>
                    </div>

                    {/* Contenido Dinámico según Estado */}
                    {(waStatus.connected || waStatus.status === 'CONNECTED') ? (
                      <div className="space-y-6 pt-2">
                        {/* Hero Card Conectado */}
                        <div className="p-6 bg-[#161922] border border-[#1f2330] rounded-xl text-center space-y-4">
                          <div
                            className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border-2 shadow-lg"
                            style={{
                              backgroundColor: `rgba(${themeRgb}, 0.15)`,
                              borderColor: themeColor,
                              color: themeColor
                            }}
                          >
                            <CheckCircle2 size={36} />
                          </div>

                          <div>
                            <h3 className="text-lg font-bold text-white">Dispositivo Vinculado Exitosamente</h3>
                            <p className="text-xs text-zinc-400 mt-1">
                              El bot está activo y procesando mensajes entrantes en tiempo real con IA.
                            </p>
                          </div>

                          {/* Número y Badge */}
                          <div className="inline-flex items-center gap-2 bg-[#0e1017] border border-[#1f2330] px-4 py-2 rounded-xl">
                            <span className="text-base">📱</span>
                            <span className="font-mono text-base font-bold text-white tracking-wide">
                              {waStatus.phone_number || stats.detected_whatsapp_phone || 'Número Conectado'}
                            </span>
                            <button
                              onClick={() => copyPhoneNumber(waStatus.phone_number || stats.detected_whatsapp_phone)}
                              className="ml-2 p-1 text-zinc-400 hover:text-white transition-colors"
                              title="Copiar número"
                            >
                              {hasCopiedPhone ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>

                        {/* Metadatos y Capacidades */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-3.5 bg-[#161922] border border-[#1f2330] rounded-xl flex items-center gap-3">
                            <Bot size={20} style={{ color: themeColor }} className="shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-bold tracking-wider">Motor Activo</span>
                              <span className="text-xs font-bold text-zinc-200 truncate block">
                                {stats.active_provider.toUpperCase()} ({stats.active_model})
                              </span>
                            </div>
                          </div>

                          <div className="p-3.5 bg-[#161922] border border-[#1f2330] rounded-xl flex items-center gap-3">
                            <Zap size={20} className="text-amber-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-bold tracking-wider">In-Memory Hot Cache</span>
                              <span className="text-xs font-bold text-zinc-200 block">
                                &lt; 1 ms (Catálogo en RAM)
                              </span>
                            </div>
                          </div>

                          <div className="p-3.5 bg-[#161922] border border-[#1f2330] rounded-xl flex items-center gap-3">
                            <ShieldCheck size={20} className="text-sky-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-bold tracking-wider">Reconexión Automática</span>
                              <span className="text-xs font-bold text-zinc-200 block">
                                Infinita con Backoff
                              </span>
                            </div>
                          </div>

                          <div className="p-3.5 bg-[#161922] border border-[#1f2330] rounded-xl flex items-center gap-3">
                            <Clock size={20} className="text-purple-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-bold tracking-wider">Handoff a Humano</span>
                              <span className="text-xs font-bold text-zinc-200 block">
                                Silencio de {stats.handoff_inactivity_hours || 6}h
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Botón de Desvinculación */}
                        <div className="pt-2">
                          <button
                            onClick={handleWhatsAppLogout}
                            disabled={isLoggingOutWa}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
                          >
                            <LogOut size={16} />
                            <span>{isLoggingOutWa ? 'Desvinculando Sesión...' : 'Desvincular Dispositivo de WhatsApp'}</span>
                          </button>
                        </div>
                      </div>
                    ) : waStatus.status === 'WAITING_QR' ? (
                      <div className="space-y-6 pt-2 text-center">
                        {/* Marco del Código QR */}
                        <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl border-2 border-zinc-700/60 mx-auto">
                          {waQrData.qrDataUrl ? (
                            <img
                              src={waQrData.qrDataUrl}
                              alt="Código QR WhatsApp"
                              className="w-60 h-60 block object-contain mx-auto rounded-lg"
                            />
                          ) : (
                            <div className="w-60 h-60 flex flex-col items-center justify-center text-zinc-700">
                              <RefreshCw size={28} className="animate-spin mb-2" />
                              <span className="text-xs font-bold">Generando QR seguro...</span>
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-zinc-400 flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                          <span>Sondeo en vivo activo: se conectará automáticamente al escanear</span>
                        </div>

                        {/* Instrucciones de Escaneo */}
                        <div className="p-4 bg-[#161922] border border-[#1f2330] rounded-xl text-left space-y-3">
                          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">
                            ¿Cómo vincular tu WhatsApp?
                          </span>
                          <div className="space-y-2 text-xs text-zinc-300 leading-relaxed">
                            <div className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                              <span>Abre <strong>WhatsApp</strong> en tu teléfono móvil.</span>
                            </div>
                            <div className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                              <span>Ve a <strong>Ajustes</strong> (iPhone) o pulsa <strong>Menú ⋮</strong> (Android) &gt; <strong>Dispositivos vinculados</strong>.</span>
                            </div>
                            <div className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                              <span>Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara al código QR de arriba.</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center space-y-4">
                        <RefreshCw size={36} className="animate-spin mx-auto text-sky-400" />
                        <div>
                          <h3 className="text-base font-bold text-zinc-100">
                            {waStatus.status === 'CONNECTING' ? 'Estableciendo Conexión...' : 'Reconectando Socket...'}
                          </h3>
                          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                            Inicializando cliente Baileys Multi-Device e intentando enlazar socket seguro de WhatsApp.
                          </p>
                        </div>
                        <button
                          onClick={fetchWhatsAppStatus}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-[#1f2330] transition-all"
                        >
                          Verificar Estado Ahora
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Columna Derecha: Probador de Envíos en Vivo & Arquitectura */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Tarjeta 1: Enviar Mensaje de Prueba */}
                  <div className="p-6 bg-[#111218] border border-[#1f2330] rounded-2xl shadow-xl space-y-4">
                    <div className="flex items-center gap-2">
                      <Send size={18} style={{ color: themeColor }} />
                      <h2 className="text-base font-bold text-zinc-100">Prueba de Envío Directo</h2>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Envía un mensaje de prueba a cualquier número de WhatsApp para comprobar la conexión activa del microservicio.
                    </p>

                    <form onSubmit={handleSendTestWa} className="space-y-4 pt-1">
                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                          Número Destinatario (con código de país) *
                        </label>
                        <input
                          type="tel"
                          required
                          value={testWaPhone}
                          onChange={e => setTestWaPhone(e.target.value)}
                          placeholder="Ej: 50371234567 o +503 7123-4567"
                          className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                          Mensaje *
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={testWaMessage}
                          onChange={e => setTestWaMessage(e.target.value)}
                          placeholder="Escribe el mensaje de prueba..."
                          className="w-full px-3.5 py-2 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none resize-none"
                        ></textarea>
                      </div>

                      <button
                        type="submit"
                        disabled={isSendingTestWa || (!waStatus.connected && waStatus.status !== 'CONNECTED')}
                        style={{ backgroundColor: themeColor }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-zinc-950 font-bold text-sm rounded-lg shadow-lg transition-all disabled:opacity-40 hover:brightness-110"
                      >
                        {isSendingTestWa ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            <span>Enviando...</span>
                          </>
                        ) : (
                          <>
                            <Send size={15} />
                            <span>Enviar Mensaje de Prueba</span>
                          </>
                        )}
                      </button>

                      {(!waStatus.connected && waStatus.status !== 'CONNECTED') && (
                        <p className="text-[11px] text-amber-400 text-center">
                          ⚠️ Debes vincular el WhatsApp escaneando el código QR para habilitar el envío.
                        </p>
                      )}
                    </form>
                  </div>

                </div>

              </div>
            </div>
          )}

          {/* ==============================================================
              TAB 5: AJUSTES DE MARCA (SETTINGS)
              ============================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-6 animate-fadeIn pb-12">
              {/* Ocultos: inputs tipo archivo para subir logo y avatar */}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={e => handleImageFileChange(e, 'company_logo')}
              />
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={e => handleImageFileChange(e, 'bot_avatar')}
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1f2330]">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles size={20} style={{ color: themeColor }} />
                    <h1 className="text-xl font-bold text-zinc-100">Ajustes de Marca</h1>
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">Configura logotipos, colores, identidad corporativa, números de contacto y claves de IA guardados en la Base de Datos.</p>
                </div>
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap self-start sm:self-auto border"
                  style={{
                    backgroundColor: `rgba(${themeRgb}, 0.12)`,
                    borderColor: `rgba(${themeRgb}, 0.25)`,
                    color: themeColor
                  }}
                >
                  <Database size={14} />
                  <span>Base de Datos: {stats?.database_type || 'PostgreSQL'}</span>
                </div>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-6">

                {/* ==========================================
                    SECCIÓN 1: IDENTIDAD VISUAL & LOGOTIPOS
                    ========================================== */}
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-6">
                  <div className="flex items-center justify-between pb-3 border-b border-[#1f2330]">
                    <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base">
                      <Palette size={18} style={{ color: themeColor }} />
                      <span>Identidad Visual, Logotipos & Paleta de Color</span>
                    </div>
                    <span
                      className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold border"
                      style={{
                        backgroundColor: `rgba(${themeRgb}, 0.12)`,
                        borderColor: `rgba(${themeRgb}, 0.3)`,
                        color: themeColor
                      }}
                    >
                      100% Dinámico
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    {/* Logo de la Empresa */}
                    <div className="p-4 bg-[#0e1017] border border-[#1f2330] rounded-lg flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Logo de la Empresa / Marca</label>
                        <p className="text-xs text-zinc-500 mb-4">Se muestra en el encabezado de la barra lateral y reportes.</p>

                        <div className="flex items-center gap-4 mb-4">
                          <div className="w-20 h-20 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                            {settingsForm.company_logo ? (
                              <img src={settingsForm.company_logo} alt="Logo" className="w-full h-full object-contain p-1" />
                            ) : (
                              <div className="text-center text-zinc-600 flex flex-col items-center">
                                <ImageIcon size={24} />
                                <span className="text-[10px] mt-1">Sin logo</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-2 flex-1">
                            <button
                              type="button"
                              onClick={() => logoInputRef.current?.click()}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
                            >
                              <Upload size={14} />
                              <span>{settingsForm.company_logo ? 'Cambiar Logo' : 'Subir Archivo'}</span>
                            </button>
                            {settingsForm.company_logo && (
                              <button
                                type="button"
                                onClick={() => handleRemoveImage('company_logo')}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs rounded-lg border border-rose-500/20 transition-colors"
                              >
                                <Trash2 size={13} />
                                <span>Eliminar Logo</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">O pegar URL directa de imagen:</label>
                        <input
                          type="url"
                          value={settingsForm.company_logo?.startsWith('data:') ? '' : settingsForm.company_logo}
                          onChange={e => setSettingsForm(prev => ({ ...prev, company_logo: e.target.value }))}
                          placeholder="https://tuempresa.com/logo.png"
                          className="w-full px-3 py-1.5 bg-[#151720] border border-[#1f2330] rounded-md text-xs text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    {/* Avatar del Asistente */}
                    <div className="p-4 bg-[#0e1017] border border-[#1f2330] rounded-lg flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Avatar del Asistente IA</label>
                        <p className="text-xs text-zinc-500 mb-4">Aparece en cada mensaje del asistente en el chat y WhatsApp.</p>

                        <div className="flex items-center gap-4 mb-4">
                          <div
                            className="w-20 h-20 rounded-full border-2 flex items-center justify-center overflow-hidden shrink-0 shadow-lg"
                            style={{ borderColor: themeColor, backgroundColor: '#181a24' }}
                          >
                            {settingsForm.bot_avatar ? (
                              <img src={settingsForm.bot_avatar} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                              <Bot size={32} style={{ color: themeColor }} />
                            )}
                          </div>

                          <div className="space-y-2 flex-1">
                            <button
                              type="button"
                              onClick={() => avatarInputRef.current?.click()}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
                            >
                              <Upload size={14} />
                              <span>{settingsForm.bot_avatar ? 'Cambiar Avatar' : 'Subir Archivo'}</span>
                            </button>
                            {settingsForm.bot_avatar && (
                              <button
                                type="button"
                                onClick={() => handleRemoveImage('bot_avatar')}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs rounded-lg border border-rose-500/20 transition-colors"
                              >
                                <Trash2 size={13} />
                                <span>Eliminar Avatar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">O pegar URL directa de avatar:</label>
                        <input
                          type="url"
                          value={settingsForm.bot_avatar?.startsWith('data:') ? '' : settingsForm.bot_avatar}
                          onChange={e => setSettingsForm(prev => ({ ...prev, bot_avatar: e.target.value }))}
                          placeholder="https://tuempresa.com/avatar.png"
                          className="w-full px-3 py-1.5 bg-[#151720] border border-[#1f2330] rounded-md text-xs text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    {/* Paleta de Color de la Marca */}
                    <div className="p-4 bg-[#0e1017] border border-[#1f2330] rounded-lg flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Color de Acento de la Marca</label>
                        <p className="text-xs text-zinc-500 mb-3">Define los acentos visuales, botones, badges e indicadores del sistema.</p>

                        <div className="grid grid-cols-4 gap-2 mb-4">
                          {BRAND_COLOR_PRESETS.map(p => (
                            <button
                              key={p.hex}
                              type="button"
                              onClick={() => setSettingsForm(prev => ({ ...prev, primary_color: p.hex }))}
                              className={`h-8 rounded-lg flex items-center justify-center transition-transform hover:scale-105 border ${settingsForm.primary_color?.toLowerCase() === p.hex.toLowerCase()
                                  ? 'border-white ring-2 ring-white/40 scale-105'
                                  : 'border-transparent'
                                }`}
                              style={{ backgroundColor: p.hex }}
                              title={p.name}
                            >
                              {settingsForm.primary_color?.toLowerCase() === p.hex.toLowerCase() && (
                                <CheckCircle2 size={14} className="text-zinc-950 font-bold" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[#1f2330]">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={settingsForm.primary_color || '#3ecf8e'}
                            onChange={e => setSettingsForm(prev => ({ ...prev, primary_color: e.target.value }))}
                            className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-0"
                            title="Seleccionar color personalizado"
                          />
                          <input
                            type="text"
                            value={settingsForm.primary_color || '#3ecf8e'}
                            onChange={e => setSettingsForm(prev => ({ ...prev, primary_color: e.target.value }))}
                            placeholder="#3ecf8e"
                            className="flex-1 px-3 py-1.5 bg-[#151720] border border-[#1f2330] rounded-md text-xs font-mono text-zinc-200 outline-none"
                          />
                        </div>
                        <div
                          className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center justify-between text-zinc-950"
                          style={{ backgroundColor: themeColor }}
                        >
                          <span>Vista Previa de Botón</span>
                          <span>✓ Activo</span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 2: IDENTIDAD CORPORATIVA & CONTACTO
                    ========================================== */}
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                  <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base pb-2 border-b border-[#1f2330]">
                    <Building size={18} style={{ color: themeColor }} />
                    <span>Identidad Corporativa & Canales de Contacto</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Nombre de la Empresa o Marca *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.company_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, company_name: e.target.value }))}
                        placeholder="Ej: Fantasma Digital / Zenith Studio"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Aparece en los saludos del bot, encabezados y firma.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Nombre del Asistente IA *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.bot_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, bot_name: e.target.value }))}
                        placeholder="Ej: Asistente Operativo / GhostBot"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Nombre con el que el bot se presenta a los usuarios.</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                          Teléfono / WhatsApp de Soporte Humano
                        </label>
                      </div>

                      <div className="relative">
                        <input
                          type="text"
                          value={settingsForm.support_phone}
                          onChange={e => setSettingsForm(prev => ({ ...prev, support_phone: e.target.value }))}
                          placeholder={settingsForm.detected_whatsapp_phone ? `Automático (${settingsForm.detected_whatsapp_phone})` : 'Dejar vacío para usar el mismo WhatsApp conectado'}
                          className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500 font-mono"
                        />
                      </div>

                      {/* Info y Botones de acción rápida para el teléfono */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1.5">
                          <PhoneCall size={12} className="text-[#3ecf8e]" />
                          <span>
                            Número activo para clientes: <strong className="text-zinc-200 font-mono">{settingsForm.effective_support_phone || settingsForm.support_phone || settingsForm.detected_whatsapp_phone || '+503 7707 9798'}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {settingsForm.detected_whatsapp_phone && settingsForm.support_phone !== settingsForm.detected_whatsapp_phone && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettingsForm(prev => ({ ...prev, support_phone: prev.detected_whatsapp_phone }));
                                showToast(`Asignado número de WhatsApp: ${settingsForm.detected_whatsapp_phone}`);
                              }}
                              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[11px] transition-colors border border-zinc-700"
                            >
                              Copiar conectado ({settingsForm.detected_whatsapp_phone})
                            </button>
                          )}
                          {settingsForm.support_phone && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettingsForm(prev => ({ ...prev, support_phone: '' }));
                                showToast('Restablecido a automático (mismo número conectado)');
                              }}
                              className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 text-[#3ecf8e] rounded text-[11px] transition-colors border border-emerald-800/50"
                            >
                              Dejar en Automático
                            </button>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] text-zinc-500 block">
                        Por defecto se usa automáticamente el mismo número conectado en WhatsApp. Si configuras otro aquí, la IA entregará este número cuando un cliente pida hablar con un humano.
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Sitio Web Oficial / Tienda</label>
                      <input
                        type="url"
                        value={settingsForm.website_url}
                        onChange={e => setSettingsForm(prev => ({ ...prev, website_url: e.target.value }))}
                        placeholder="https://tuempresa.com"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">URL oficial referenciada por el bot en cotizaciones y consultas.</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Tono y Personalidad</label>
                    <textarea
                      rows={2}
                      value={settingsForm.bot_tone}
                      onChange={e => setSettingsForm(prev => ({ ...prev, bot_tone: e.target.value }))}
                      placeholder="Ej: Profesional, cálido, resolutivo y empático. Adaptado al español de El Salvador."
                      className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none font-sans focus:border-zinc-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Directrices Especiales & Reglas de la Marca</label>
                    <textarea
                      rows={3}
                      value={settingsForm.brand_instructions}
                      onChange={e => setSettingsForm(prev => ({ ...prev, brand_instructions: e.target.value }))}
                      placeholder="Ej: Resaltar nuestra garantía de 12 meses. Si preguntan por proyectos a medida, solicitar su WhatsApp o correo para seguimiento..."
                      className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none font-sans focus:border-zinc-500"
                    />
                    <span className="text-[11px] text-zinc-500 mt-1 block">Inyectado en tiempo real en las directrices del System Prompt de IA.</span>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 3: CONTROL DE AGENTES HUMANOS & HANDOFF (INACTIVIDAD)
                    ========================================== */}
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-6">
                  <div className="flex items-center justify-between pb-3 border-b border-[#1f2330]">
                    <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base">
                      <UserCheck size={18} style={{ color: themeColor }} />
                      <span>Agentes Humanos & Silencio de IA (Human Handoff)</span>
                    </div>
                    <span
                      className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1 border"
                      style={{
                        backgroundColor: `rgba(${themeRgb}, 0.15)`,
                        borderColor: `rgba(${themeRgb}, 0.35)`,
                        color: themeColor
                      }}
                    >
                      <Clock size={12} />
                      Inactividad: {settingsForm.handoff_inactivity_hours || 6}h
                    </span>
                  </div>

                  <div className="p-4 bg-[#0e1017] border border-[#1f2330] rounded-lg space-y-3">
                    <div className="flex items-start gap-3">
                      <div
                        className="p-2 rounded-lg shrink-0 mt-0.5"
                        style={{
                          backgroundColor: `rgba(${themeRgb}, 0.15)`,
                          color: themeColor
                        }}
                      >
                        <Clock size={18} />
                      </div>
                      <div className="text-xs text-zinc-300 leading-relaxed space-y-1">
                        <p className="font-semibold text-zinc-100">
                          Regla de Protección de Agente Humano:
                        </p>
                        <p className="text-zinc-400">
                          Si la IA transfiere a un cliente a un agente humano, <strong>la IA dejará de responder de inmediato</strong> a esa conversación para no interrumpir la atención del agente.
                        </p>
                        <p className="text-zinc-400">
                          La IA permanecerá en silencio hasta que pasen <strong>{settingsForm.handoff_inactivity_hours || 6} horas de inactividad</strong> (sin que el cliente o el agente envíen nuevos mensajes), momento en el cual se reactivará automáticamente. También puedes reactivar la IA de forma instantánea usando el botón de liberación manual.
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#1f2330]">
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                        Tiempo de Inactividad para Reactivar la IA (en Horas)
                      </label>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-2 max-w-xs">
                          <input
                            type="number"
                            min="0.5"
                            max="72"
                            step="0.5"
                            value={settingsForm.handoff_inactivity_hours ?? 6.0}
                            onChange={e => setSettingsForm(prev => ({ ...prev, handoff_inactivity_hours: parseFloat(e.target.value) || 6.0 }))}
                            className="w-28 px-3.5 py-2 bg-[#151720] border border-[#1f2330] rounded-lg text-sm text-zinc-100 font-mono outline-none focus:border-zinc-500"
                          />
                          <span className="text-xs text-zinc-400 font-medium">horas sin mensajes</span>
                        </div>

                        {/* Botones rápidos de preset */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-zinc-500 mr-1">Presets:</span>
                          {[1, 2, 4, 6, 12, 24].map(h => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => {
                                setSettingsForm(prev => ({ ...prev, handoff_inactivity_hours: h }));
                                showToast(`Configurado en ${h} horas de inactividad`);
                              }}
                              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                                Number(settingsForm.handoff_inactivity_hours) === h
                                  ? 'text-zinc-950 font-bold shadow-sm'
                                  : 'bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border-zinc-750'
                              }`}
                              style={Number(settingsForm.handoff_inactivity_hours) === h ? {
                                backgroundColor: themeColor,
                                borderColor: themeColor
                              } : {}}
                            >
                              {h}h
                            </button>
                          ))}
                        </div>
                      </div>

                      {activeHandoffs.length > 0 && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-amber-300">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                            <span>Hay <strong>{activeHandoffs.length}</strong> usuario(s) con la IA pausada actualmente en atención humana.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigateTo('handoffs')}
                            className="text-xs font-bold text-amber-400 hover:text-amber-300 underline underline-offset-2 flex items-center gap-1 shrink-0"
                          >
                            <span>Ver y Despausar en el Panel</span>
                            <ExternalLink size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 4: MENSAJES AUTOMATIZADOS
                    ========================================== */}
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                  <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base pb-2 border-b border-[#1f2330]">
                    <MessageCircle size={18} style={{ color: themeColor }} />
                    <span>Mensajes Automatizados del Asistente</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Mensaje de Bienvenida (Saludo Inicial)</label>
                      <textarea
                        rows={3}
                        value={settingsForm.welcome_message}
                        onChange={e => setSettingsForm(prev => ({ ...prev, welcome_message: e.target.value }))}
                        placeholder="Ej: ¡Hola! Bienvenido a Fantasma Digital. Soy tu Asistente Operativo. ¿En qué te puedo asesorar hoy?"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none font-sans focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Mensaje inicial en el Playground y para nuevos chats en WhatsApp.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Mensaje de Transferencia a Humano</label>
                      <textarea
                        rows={3}
                        value={settingsForm.transfer_message}
                        onChange={e => setSettingsForm(prev => ({ ...prev, transfer_message: e.target.value }))}
                        placeholder="Ej: He notificado a nuestro equipo humano. En unos momentos uno de nuestros especialistas continuará tu atención por este chat."
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none font-sans focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Respuesta automática cuando el cliente solicita un agente humano.</span>
                    </div>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 4: MOTORES DE IA, CLAVES & RED
                    ========================================== */}
                <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                  <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base pb-2 border-b border-[#1f2330]">
                    <Key size={18} style={{ color: themeColor }} />
                    <span>Motores de IA, Claves API & Red</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Proveedor Principal de IA</label>
                      <select
                        value={settingsForm.ai_provider}
                        onChange={e => setSettingsForm(prev => ({ ...prev, ai_provider: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.ai_provider && <option value="">-- Seleccionar Proveedor --</option>}
                        <option value="gemini">Google Gemini (Recomendado - Ultra Rápido)</option>
                        <option value="openai">OpenAI (GPT-4o Mini / GPT-4o)</option>
                      </select>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Failover automático: si uno falla por cuota o red, el otro responde.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Modelo de Google Gemini</label>
                      <select
                        value={settingsForm.gemini_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, gemini_model: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.gemini_model && <option value="">-- Seleccionar Modelo Gemini --</option>}
                        <option value="gemini-2.5-flash">gemini-2.5-flash (Última generación - Máxima velocidad)</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro (Razonamiento complejo)</option>
                        <option value="gemini-1.5-flash">gemini-1.5-flash (Versión previa)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Google Gemini API Key</label>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={settingsForm.gemini_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, gemini_api_key: e.target.value }))}
                          placeholder="AIzaSy..."
                          className="w-full pl-3.5 pr-10 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey(!showGeminiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                        >
                          {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Persistencia garantizada en la BD PostgreSQL/SQLite.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">OpenAI API Key (Respaldo)</label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          value={settingsForm.openai_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, openai_api_key: e.target.value }))}
                          placeholder="sk-proj-..."
                          className="w-full pl-3.5 pr-10 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                        >
                          {showOpenaiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Opcional para contingencias.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Modelo de OpenAI</label>
                      <select
                        value={settingsForm.openai_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, openai_model: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.openai_model && <option value="">-- Seleccionar Modelo OpenAI --</option>}
                        <option value="gpt-4o-mini">gpt-4o-mini (Rápido y económico)</option>
                        <option value="gpt-4o">gpt-4o (Modelo insignia)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">WhatsApp Gateway URL (Microservicio)</label>
                      <input
                        type="text"
                        value={settingsForm.whatsapp_gateway_url}
                        onChange={e => setSettingsForm(prev => ({ ...prev, whatsapp_gateway_url: e.target.value }))}
                        placeholder="http://localhost:3000 o http://whatsapp-gateway:3000"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Dirección interna del microservicio Baileys.</span>
                    </div>
                  </div>
                </div>

                {/* Botón de Guardado */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    style={{ backgroundColor: themeColor }}
                    className="inline-flex items-center gap-2 px-7 py-3 text-zinc-950 font-bold text-sm rounded-lg shadow-xl transition-all disabled:opacity-50 hover:brightness-110 hover:shadow-2xl"
                  >
                    {isSavingSettings ? (
                      <>
                        <RefreshCw size={17} className="animate-spin" />
                        <span>Guardando Cambios...</span>
                      </>
                    ) : (
                      <>
                        <Save size={17} />
                        <span>Guardar Cambios</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ==============================================================
              SECCIÓN: GESTIÓN DE ATENCIÓN HUMANA & USUARIOS CON IA PAUSADA
              ============================================================== */}
          {activeTab === 'handoffs' && (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Header con gradiente y contexto */}
              <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1.5">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shadow-lg"
                      style={{ backgroundColor: `rgba(${themeRgb}, 0.15)`, color: themeColor }}
                    >
                      <UserCheck size={20} />
                    </div>
                    <h2 className="text-xl font-bold text-zinc-100">Usuarios con IA Pausada (Atención Humana)</h2>
                  </div>
                  <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
                    Conversaciones derivadas a asesores humanos. La IA permanece en silencio para respetar la atención personalizada. Puedes despausar individualmente a cada cliente o en lote para que la IA retome el control de inmediato.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={fetchActiveHandoffs}
                    className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0c0d12] hover:bg-zinc-800 border border-[#1f2330] rounded-lg text-xs font-medium text-zinc-300 transition-colors"
                  >
                    <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                    <span>Actualizar</span>
                  </button>

                  <button
                    onClick={() => setShowManualPauseModal(true)}
                    className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0c0d12] hover:bg-zinc-800 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <Pause size={14} />
                    <span>+ Pausar IA a un Número</span>
                  </button>

                  <button
                    onClick={handleReleaseAllHandoffs}
                    disabled={activeHandoffs.length === 0 || isReleasingAll}
                    style={activeHandoffs.length > 0 ? { backgroundColor: themeColor } : {}}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-950 font-bold text-xs rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 shadow-md"
                  >
                    {isReleasingAll ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Despausando en lote...</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" />
                        <span>Despausar Todos ({activeHandoffs.length})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Métricas Rápidas */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">IA Pausada Activa</span>
                    <span className="text-2xl font-black text-amber-400 font-mono">{activeHandoffs.length}</span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">clientes en manos de asesor</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <UserX size={20} />
                  </div>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Ventana de Inactividad</span>
                    <span className="text-2xl font-black text-zinc-100 font-mono">{stats.handoff_inactivity_hours ?? 6.0}h</span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">reactivación autónoma</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-[#1f2330] flex items-center justify-center text-zinc-400">
                    <Clock size={20} />
                  </div>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Canal WhatsApp</span>
                    <span className="text-base font-bold text-zinc-200 block truncate">
                      {stats.wa_connected || stats.gateway_state === 'CONNECTED' ? 'En Línea & Conectado' : 'Desconectado'}
                    </span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">
                      {stats.effective_support_phone || 'Línea de soporte'}
                    </span>
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    stats.wa_connected || stats.gateway_state === 'CONNECTED'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-850 text-zinc-500 border border-zinc-750'
                  }`}>
                    <MessageCircle size={20} />
                  </div>
                </div>
              </div>

              {/* Filtro / Buscador */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={handoffSearch}
                    onChange={e => setHandoffSearch(e.target.value)}
                    placeholder="Buscar por teléfono, sesión o motivo..."
                    className="w-full pl-10 pr-4 py-2 bg-[#151720] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none focus:border-zinc-500 font-sans"
                  />
                  {handoffSearch && (
                    <button onClick={() => setHandoffSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="text-xs text-zinc-500">
                  Mostrando {filteredHandoffs.length} de {activeHandoffs.length} usuarios pausados
                </div>
              </div>

              {/* Lista de Usuarios Pausados */}
              {activeHandoffs.length === 0 ? (
                <div className="p-12 bg-[#151720] border border-[#1f2330] rounded-xl text-center space-y-4 shadow-sm">
                  <div
                    className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center shadow-lg border border-[#1f2330]"
                    style={{ backgroundColor: `rgba(${themeRgb}, 0.1)`, color: themeColor }}
                  >
                    <CheckCircle2 size={32} />
                  </div>
                  <div className="max-w-md mx-auto">
                    <h3 className="text-base font-bold text-zinc-100">Ningún usuario tiene la IA pausada</h3>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      Todas las conversaciones están siendo atendidas de forma 100% automatizada por la IA. En cuanto un cliente solicite un asesor humano o intervengas, aparecerá listado aquí en tiempo real para que puedas despausarlo con un solo clic.
                    </p>
                  </div>
                  <div className="pt-2 flex justify-center gap-3">
                    <button
                      onClick={() => setShowManualPauseModal(true)}
                      className="px-4 py-2 rounded-lg bg-[#0c0d12] border border-[#1f2330] hover:bg-zinc-800 text-xs font-semibold text-zinc-300 transition-colors"
                    >
                      + Pausar IA a un número de prueba
                    </button>
                    <button
                      onClick={() => navigateTo('chat')}
                      style={{ color: themeColor }}
                      className="px-4 py-2 rounded-lg bg-[#0c0d12] border border-[#1f2330] hover:bg-zinc-800 text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      <span>Ir al Simulador de Chat</span>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              ) : filteredHandoffs.length === 0 ? (
                <div className="p-8 bg-[#151720] border border-[#1f2330] rounded-xl text-center text-zinc-400 text-xs">
                  No se encontraron usuarios pausados que coincidan con "{handoffSearch}".
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredHandoffs.map((handoff) => {
                    const sid = handoff.session_id || '';
                    const isReleasing = releasingId === sid;
                    const cleanPhone = sid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '');
                    const isWhatsAppLid = sid.includes('@lid');
                    const currentTag = handoff.tag || 'ATENCIÓN HUMANA';

                    return (
                      <div
                        key={sid}
                        className="p-4 bg-[#151720] border border-[#1f2330] hover:border-zinc-700/60 rounded-xl transition-all flex flex-col justify-between gap-4 group"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                          <div className="flex items-start gap-3.5 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                              <Pause size={18} />
                            </div>

                            <div className="min-w-0 space-y-1.5 flex-1">
                              {/* Teléfono, Badges de Pausa y Tag Directo */}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-bold text-sm text-zinc-100 flex items-center gap-1.5">
                                  {isWhatsAppLid ? sid : (cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`)}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(cleanPhone);
                                    showToast('Número copiado al portapapeles');
                                  }}
                                  className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
                                  title="Copiar identificador"
                                >
                                  <Copy size={13} />
                                </button>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  ⏸️ IA Pausada
                                </span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${getTagBadgeStyle(currentTag)}`}>
                                  🏷️ {currentTag}
                                </span>
                              </div>

                              {/* Metadatos: Motivo y Horas Restantes */}
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                                <span className="text-zinc-300">
                                  <strong className="text-zinc-500">Motivo:</strong> {handoff.reason || 'Derivado a agente humano'}
                                </span>
                                {handoff.transferred_at && (
                                  <span className="text-zinc-500 flex items-center gap-1">
                                    <Clock size={12} />
                                    Pausado: {new Date(handoff.transferred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                )}
                                <span className="text-amber-400/90 font-mono text-[11px]">
                                  {handoff.remaining_inactivity_hours !== undefined ? `~${handoff.remaining_inactivity_hours}h restantes` : ''}
                                </span>
                              </div>

                              {/* NOTA PARA EL ASESOR (Lo que el cliente busca) */}
                              {handoff.notes ? (
                                <div className="mt-2.5 p-3 rounded-lg bg-[#0c0d12] border border-amber-500/20 text-xs text-zinc-200">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                      <FileText size={12} />
                                      <span>Nota para el Asesor (Lo que el cliente busca):</span>
                                    </span>
                                    <button
                                      onClick={() => {
                                        setEditingHandoff(handoff);
                                        setEditTag(handoff.tag || 'ATENCIÓN HUMANA');
                                        setEditNotes(handoff.notes || '');
                                      }}
                                      className="text-[11px] text-zinc-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                                      title="Editar nota o tag"
                                    >
                                      <Edit3 size={11} />
                                      <span>Editar</span>
                                    </button>
                                  </div>
                                  <p className="text-zinc-200 leading-relaxed font-sans">{handoff.notes}</p>
                                </div>
                              ) : (
                                <div className="mt-2">
                                  <button
                                    onClick={() => {
                                      setEditingHandoff(handoff);
                                      setEditTag(handoff.tag || 'ATENCIÓN HUMANA');
                                      setEditNotes(handoff.notes || '');
                                    }}
                                    className="text-[11px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                                  >
                                    <Edit3 size={11} />
                                    <span>+ Agregar nota para el asesor</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Acciones del Asesor: Editar Tag/Nota, Simulador y Despausar */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-start">
                            <button
                              onClick={() => {
                                setEditingHandoff(handoff);
                                setEditTag(handoff.tag || 'ATENCIÓN HUMANA');
                                setEditNotes(handoff.notes || '');
                              }}
                              className="px-3 py-1.5 bg-[#0c0d12] hover:bg-zinc-800 border border-[#1f2330] rounded-lg text-xs text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5"
                              title="Editar etiqueta y nota del asesor"
                            >
                              <Tag size={13} className="text-amber-400" />
                              <span>Tag / Nota</span>
                            </button>

                            <button
                              onClick={() => {
                                navigateTo('chat');
                                showToast(`Sesión ${sid} lista en el simulador`);
                              }}
                              className="px-3 py-1.5 bg-[#0c0d12] hover:bg-zinc-800 border border-[#1f2330] rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
                              title="Probar en simulador de chat"
                            >
                              <MessageSquare size={13} />
                              <span>Simulador</span>
                            </button>

                            <button
                              onClick={() => handleReleaseHandoff(sid)}
                              disabled={isReleasing}
                              style={{ backgroundColor: themeColor }}
                              className="inline-flex items-center gap-2 px-4 py-2 text-zinc-950 font-bold text-xs rounded-lg transition-all hover:brightness-110 shadow-md disabled:opacity-50"
                            >
                              {isReleasing ? (
                                <>
                                  <RefreshCw size={14} className="animate-spin" />
                                  <span>Reanudando...</span>
                                </>
                              ) : (
                                <>
                                  <Play size={14} fill="currentColor" />
                                  <span>Despausar IA</span>
                                </>
                              )}
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

        </main>
      </div>

      {/* Modal para pausar manualmente a un usuario */}
      {showManualPauseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151720] border border-[#1f2330] rounded-xl max-w-md w-full shadow-2xl animate-scaleUp">
            <div className="p-4 border-b border-[#1f2330] flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Pause size={16} />
                <span>Pausar IA Manualmente para un Usuario</span>
              </div>
              <button
                onClick={() => setShowManualPauseModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePauseHandoffManual} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Número de Teléfono o ID de Sesión
                </label>
                <input
                  type="text"
                  required
                  value={manualPausePhone}
                  onChange={e => setManualPausePhone(e.target.value)}
                  placeholder="Ej: +50371234567 o 50371234567"
                  className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-sm text-zinc-100 outline-none font-mono focus:border-amber-400/50"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">Número de WhatsApp del cliente con código de país.</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Motivo de la Pausa
                </label>
                <input
                  type="text"
                  value={manualPauseReason}
                  onChange={e => setManualPauseReason(e.target.value)}
                  placeholder="Ej: Atención personalizada con asesor comercial"
                  className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Etiqueta Directa del Chat (Tag)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {HANDOFF_TAG_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setManualPauseTag(t)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-all ${
                        manualPauseTag === t
                          ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                          : 'border-[#1f2330] bg-[#0e1017] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={manualPauseTag}
                  onChange={e => setManualPauseTag(e.target.value.toUpperCase())}
                  placeholder="Ej: COTIZACIÓN"
                  className="w-full px-3 py-2 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-100 font-mono outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Nota para el Asesor (Lo que el cliente busca)
                </label>
                <textarea
                  rows={2}
                  value={manualPauseNotes}
                  onChange={e => setManualPauseNotes(e.target.value)}
                  placeholder="Ej: El cliente desea cotización de paquetes empresariales."
                  className="w-full px-3.5 py-2 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none focus:border-amber-400/50 resize-none font-sans"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowManualPauseModal(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPausingManual}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isPausingManual ? <RefreshCw size={14} className="animate-spin" /> : <Pause size={14} />}
                  <span>Pausar IA</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para editar Tag Directo y Nota para el Asesor */}
      {editingHandoff && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151720] border border-[#1f2330] rounded-xl max-w-lg w-full shadow-2xl animate-scaleUp">
            <div className="p-4 border-b border-[#1f2330] flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Tag size={16} />
                <span>Gestionar Tag y Nota para el Asesor</span>
              </div>
              <button
                onClick={() => setEditingHandoff(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0e1017] border border-[#1f2330]">
                <span className="text-xs text-zinc-400 font-medium">Cliente / Sesión:</span>
                <span className="font-mono text-xs font-bold text-zinc-100">{editingHandoff.session_id}</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Etiqueta Directa del Chat (Tag)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {HANDOFF_TAG_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEditTag(t)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all ${
                        editTag === t
                          ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                          : 'border-[#1f2330] bg-[#0e1017] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={editTag}
                  onChange={e => setEditTag(e.target.value.toUpperCase())}
                  placeholder="O escribe una etiqueta personalizada..."
                  className="w-full px-3.5 py-2 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-100 font-mono outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Nota Ejecutiva para el Asesor</span>
                  <span className="text-[10px] text-zinc-500 font-normal">¿Qué busca o necesita el cliente?</span>
                </label>
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Escribe el resumen de lo que el cliente requiere para que el asesor lo sepa de inmediato..."
                  className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] rounded-lg text-xs text-zinc-200 outline-none leading-relaxed focus:border-amber-400/50 font-sans resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingHandoff(null)}
                  className="px-4 py-2 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => handleUpdateHandoffMeta(editingHandoff.session_id)}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingEdit ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>Guardar Tag y Nota</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL DE LECTURA COMPLETA
          ============================================================== */}
      {selectedDoc && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151720] border border-[#1f2330] rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl animate-scaleUp">
            <div className="p-4 border-b border-[#1f2330] flex items-center justify-between">
              <h3 className="font-bold text-base text-zinc-100 truncate pr-4">{selectedDoc.title}</h3>
              <button
                onClick={() => setSelectedDoc(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed select-text">
              {selectedDoc.content}
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          TOAST NOTIFICATION
          ============================================================== */}
      {toast.show && (
        <div
          style={toast.isError ? {} : { borderLeftColor: themeColor }}
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-2xl text-sm font-semibold flex items-center gap-2.5 bg-[#161a24] text-white border-l-4 ${toast.isError ? 'border-red-500' : ''}`}
        >
          {toast.isError ? <AlertCircle size={18} className="text-red-400" /> : <CheckCircle2 size={18} style={{ color: themeColor }} />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
