import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  Boxes,
  Building2,
  UtensilsCrossed,
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
  Edit3,
  Mic,
  MicOff,
  Paperclip,
  ChevronDown,
  Kanban,
  ClipboardList,
  BarChart3,
  FileCode2,
  Wallet,
  Coins,
  Receipt,
  ArrowLeftRight,
  TrendingUp,
  Tags,
  ScrollText,
  LifeBuoy,
  Inbox,
  Workflow,
  History,
  MessagesSquare,
  Power,
  AlertTriangle,
  Package,
  ChefHat,
  ShoppingBag,
  Printer,
  Briefcase,
  UserPlus,
  CreditCard,
} from 'lucide-react';
import ModulesPanel from './components/ModulesPanel';
import TenantsPanel from './components/TenantsPanel';
import RestaurantPanel from './components/RestaurantPanel';
import FinancePanel from './components/FinancePanel';
import InventoryPanel from './components/InventoryPanel';
import InvoicingPanel from './components/InvoicingPanel';
import IotPrintingPanel from './components/IotPrintingPanel';
import ServicesPanel from './components/ServicesPanel';
import ModuleGuide from './components/ModuleGuide';
import CustomersPanel from './components/CustomersPanel';
import AgentPanel from './components/AgentPanel';
import InboxPanel from './components/InboxPanel';
import UsersPanel from './components/UsersPanel';
import LoyaltyPanel, { PublicLoyaltyCard, PublicStampFlow, getPublicCardParams } from './components/LoyaltyPanel';
import LandingScreen from './components/LandingScreen';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// ==============================================================
// SESIÓN DEL PANEL: token firmado por el backend (expira en 12 h)
// ==============================================================
const AUTH_STORAGE_KEY = 'zenith_admin_token';
const UNAUTHORIZED_EVENT = 'zenith:unauthorized';

const getStoredToken = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const { token, expires_at } = JSON.parse(raw);
    return token && expires_at * 1000 > Date.now() ? token : null;
  } catch {
    return null;
  }
};

const storeToken = (data) => {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Sin almacenamiento disponible: la sesión dura lo que dure la pestaña
  }
};

const TENANT_STORAGE_KEY = 'zenith_login_tenant';
const ACTING_TENANT_KEY = 'zenith_acting_tenant';

const parseTokenPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  try {
    const part = token.split('.')[0];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const getStoredAuth = () => {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null') || {}; } catch { return {}; }
};

const isSuperadmin = () => {
  const auth = getStoredAuth();
  if (auth && auth.superadmin === true) return true;
  const token = getStoredToken();
  if (!token) return false;
  const payload = parseTokenPayload(token);
  if (!payload) return false;
  if (payload.uid !== undefined && payload.uid !== null) return false;
  if (payload.sa === true) return true;
  if (!payload.tenant || payload.tenant === 'default') return true;
  return false;
};

const getCurrentRole = () => {
  const payload = parseTokenPayload(getStoredToken());
  return (payload && payload.urole) || 'owner';
};
const getCurrentUserId = () => {
  const payload = parseTokenPayload(getStoredToken());
  return payload && payload.uid !== undefined ? payload.uid : null;
};
const canManageUsers = () => ['owner', 'admin'].includes(getCurrentRole());

const ROOT_TABS = new Set([
  'knowledge-base', 'create-document', 'new-document', 'add-text',
  'web-scraper', 'scraper', 'crawler', 'scrape',
  'whatsapp-gateway', 'whatsapp', 'qr',
  'playground', 'chat', 'simulation',
  'brand-settings', 'settings', 'brand',
  'human-handoff', 'paused-users', 'handoff', 'handoffs',
  'modules', 'ecosystem',
  'tenants', 'empresas',
  'users', 'usuarios',
  'restaurant', 'pedidos', 'ordenes',
  'inventory', 'inventario', 'stock', 'insumos',
  'finance', 'caja', 'finanzas',
  'customers', 'clientes', 'contacts',
  'agent', 'agente',
  'invoicing', 'facturacion', 'dte', 'factura', 'facturas',
  'iot-printing', 'iot_printing', 'iot', 'impresoras', 'hardware',
  'inbox', 'bandeja',
  'services', 'servicios', 'leads', 'proposals', 'propuestas',
  'loyalty', 'fidelidad', 'tarjetas',
  'auth'
]);

// Empresa de la pantalla de acceso: /auth/:empresa (o /:empresa/... si llegó sin sesión)
const getAuthSlug = () => {
  const parts = window.location.pathname.toLowerCase().split('/').filter(Boolean);
  if (parts[0] === 'auth') return parts[1] || '';
  // eslint-disable-next-line no-use-before-define
  return getTenantFromUrl();
};

const getTenantFromUrl = (pathname) => {
  try {
    const path = pathname !== undefined ? pathname : (typeof window !== 'undefined' ? window.location.pathname : '');
    const parts = (path || '').toLowerCase().split('/').filter(Boolean);
    if (parts.length === 0) return '';
    const first = parts[0];
    if (ROOT_TABS.has(first)) return '';
    // Protección adicional: si contiene palabras clave del sistema, nunca es un tenant
    if (first.includes('iot') || first.includes('invoic') || first.includes('factura') || first.includes('print') || first.includes('service')) return '';
    return first;
  } catch {
    return '';
  }
};

// Un superadmin puede operar otra empresa: se envía X-Tenant-Id en cada petición
// La URL (/:slug/...) tiene máxima prioridad para soportar multi-pestaña real.
// La empresa principal («default») aparece en la URL con su propio slug (p. ej. /fantasma-digital)
const getDefaultSlug = () => getStoredAuth().default_slug || '';
const isDefaultSlug = (slug) => !slug || slug === 'default' || slug === getDefaultSlug();
// Slug de la empresa a la que pertenece el usuario que inició sesión
const getOwnSlug = () => {
  const auth = getStoredAuth();
  if (auth.tenant_slug) return auth.tenant_slug;
  return auth.tenant && auth.tenant !== 'default' ? auth.tenant : getDefaultSlug();
};

const getActingTenant = () => {
  const urlTenant = getTenantFromUrl();
  if (urlTenant) {
    if (isDefaultSlug(urlTenant) || ROOT_TABS.has(urlTenant)) return '';
    return urlTenant;
  }
  if (!isSuperadmin()) return '';
  try {
    const val = localStorage.getItem(ACTING_TENANT_KEY) || '';
    if (ROOT_TABS.has(val) || val.includes('iot') || val.includes('invoic') || val.includes('factura') || val.includes('service')) {
      localStorage.removeItem(ACTING_TENANT_KEY);
      return '';
    }
    return isDefaultSlug(val) ? '' : val;
  } catch { return ''; }
};
const setActingTenant = (slug) => {
  try {
    if (slug && !isDefaultSlug(slug)) localStorage.setItem(ACTING_TENANT_KEY, slug); else localStorage.removeItem(ACTING_TENANT_KEY);
  } catch { /* ignorar */ }
};

// Slug que debe ir en la URL para la empresa que se está viendo
const urlSlugFor = (tenant) => {
  if (tenant && !isDefaultSlug(tenant)) return tenant;
  return isSuperadmin() ? getDefaultSlug() : getOwnSlug();
};

// Normaliza la URL al entrar: «/» y «/default/...» llevan al slug de la empresa,
// y un usuario normal nunca se queda en el slug de otra empresa.
const canonicalizeUrl = () => {
  const path = window.location.pathname;
  const parts = path.split('/').filter(Boolean);
  if ((parts[0] || '').toLowerCase() === 'tenants' || (parts[0] || '').toLowerCase() === 'empresas') return;
  if ((parts[0] || '').toLowerCase() === 'auth') {
    // Con sesión iniciada, /auth/... lleva directo al panel
    const slug = urlSlugFor(getActingTenant());
    window.history.replaceState(null, '', slug ? `/${slug}/knowledge-base` : '/knowledge-base');
    return;
  }
  const urlTenant = getTenantFromUrl(path);
  const rest = urlTenant ? `/${parts.slice(1).join('/')}` : path;
  let target;
  if (!urlTenant) target = urlSlugFor(getActingTenant());
  else if (urlTenant === 'default') target = getDefaultSlug();
  else if (!isSuperadmin() && getOwnSlug() && urlTenant !== getOwnSlug()) target = getOwnSlug();
  if (!target) return;
  const next = `/${target}${rest === '/' || rest === '' ? '/knowledge-base' : rest}`;
  if (next !== path) window.history.replaceState(null, '', next + window.location.search);
};

const clearStoredToken = () => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(ACTING_TENANT_KEY);
  } catch {
    // Ignorar
  }
};

// fetch con el token del panel; ante un 401 cierra la sesión y vuelve al login
const apiFetch = async (url, options = {}) => {
  const token = getStoredToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const acting = getActingTenant();
  if (acting) headers['X-Tenant-Id'] = acting;
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearStoredToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
};

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
    <div className="space-y-2 text-sm leading-relaxed text-zinc-200">
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
              <div key={i} className="flex items-start gap-2 py-1.5 px-2.5 bg-[#11131a] rounded-md border border-white/5 my-1 hover:border-emerald-500/20 transition-colors">
                <span className="text-emerald-400 text-sm mt-0.5 shrink-0 select-none">🔹</span>
                <div>
                  <strong className="text-zinc-100 font-semibold">{title}:</strong>
                  <span className="text-zinc-300 ml-1.5">{desc}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-2 py-0.5">
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
    category: 'Motor de conocimiento',
    breadcrumb: 'Base de Conocimiento'
  },
  'add-text': {
    id: 'add-text',
    path: '/create-document',
    label: 'Redactar Documento',
    category: 'Motor de conocimiento',
    breadcrumb: 'Redactar Documento'
  },
  scrape: {
    id: 'scrape',
    path: '/web-scraper',
    label: 'Rastreador Web & Sitemap',
    category: 'Motor de conocimiento',
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
    category: 'Pruebas en vivo',
    breadcrumb: 'Simulador de Chat'
  },
  settings: {
    id: 'settings',
    path: '/brand-settings',
    label: 'Identidad & Motores IA',
    category: 'Configuración del sistema',
    breadcrumb: 'Identidad & Motores IA'
  },
  handoffs: {
    id: 'handoffs',
    path: '/human-handoff',
    label: 'Usuarios con IA Pausada',
    category: 'GESTIÓN DE OPERACIONES',
    breadcrumb: 'Usuarios con IA Pausada'
  }
,
    tenants: {
      id: 'tenants',
      path: '/tenants',
      label: 'Empresas',
      category: 'Configuración del sistema',
      breadcrumb: 'Empresas'
    },
    users: {
      id: 'users',
      path: '/users',
      label: 'Usuarios',
      category: 'Configuración del sistema',
      breadcrumb: 'Usuarios'
    },
    modules: {
      id: 'modules',
      path: '/modules',
      label: 'Gestor de Módulos',
      category: 'Configuración del sistema',
      breadcrumb: 'Gestor de Módulos'
    },
    restaurant: {
      id: 'restaurant',
      path: '/restaurant',
      label: 'Restaurante & Pedidos',
      category: 'GESTIÓN DE OPERACIONES',
      breadcrumb: 'Restaurante & Pedidos'
    },
    inventory: {
      id: 'inventory',
      path: '/inventory',
      label: 'Inventario & Insumos',
      category: 'GESTIÓN DE OPERACIONES',
      breadcrumb: 'Inventario & Insumos'
    },
    agent: {
      id: 'agent',
      path: '/agent',
      label: 'Agente IA',
      category: 'AGENTE IA',
      breadcrumb: 'Agente IA'
    },
    inbox: {
      id: 'inbox',
      path: '/inbox',
      label: 'Bandeja',
      category: 'ATENCIÓN AL CLIENTE',
      breadcrumb: 'Bandeja'
    },
    customers: {
      id: 'customers',
      path: '/customers',
      label: 'Clientes',
      category: 'ATENCIÓN AL CLIENTE',
      breadcrumb: 'Clientes'
    },
    finance: {
      id: 'finance',
      path: '/finance',
      label: 'Caja & Finanzas',
      category: 'GESTIÓN FINANCIERA',
      breadcrumb: 'Caja & Finanzas'
    },
    invoicing: {
      id: 'invoicing',
      path: '/invoicing',
      label: 'Facturación & DTE',
      category: 'FINANZAS & FISCAL',
      breadcrumb: 'Facturación'
    },
    iot_printing: {
      id: 'iot_printing',
      path: '/iot-printing',
      label: 'Impresión IoT',
      category: 'HARDWARE & IOT',
      breadcrumb: 'Impresoras'
    },
    loyalty: {
      id: 'loyalty',
      path: '/loyalty',
      label: 'Tarjetas de Fidelidad',
      category: 'FIDELIZACIÓN',
      breadcrumb: 'Tarjetas de Fidelidad'
    }
  };

// Pantallas que pertenecen al ARM (agente, WhatsApp, conocimiento): se ocultan si el plan no lo incluye
const ARM_TABS = new Set(['library', 'add-text', 'scrape', 'whatsapp', 'chat', 'handoffs', 'inbox', 'customers', 'agent']);

const getTabFromPath = (pathname) => {
  const clean = (pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/create-document' || clean === '/new-document' || clean === '/add-text') return 'add-text';
  if (clean === '/web-scraper' || clean === '/scraper' || clean === '/crawler' || clean === '/scrape') return 'scrape';
  if (clean === '/whatsapp-gateway' || clean === '/whatsapp' || clean === '/qr') return 'whatsapp';
  if (clean === '/playground' || clean === '/chat' || clean === '/simulation') return 'chat';
  if (clean === '/brand-settings' || clean === '/settings' || clean === '/brand') return 'settings';
  if (clean === '/human-handoff' || clean === '/paused-users' || clean === '/handoff' || clean === '/handoffs') return 'handoffs';
  if (clean === '/modules' || clean === '/ecosystem') return 'modules';
  if (clean === '/tenants' || clean === '/empresas') return 'tenants';
  if (clean === '/users' || clean === '/usuarios') return 'users';
  if (clean === '/restaurant' || clean === '/pedidos' || clean === '/ordenes') return 'restaurant';
  if (clean === '/inventory' || clean === '/inventario' || clean === '/stock' || clean === '/insumos') return 'inventory';
  if (clean === '/finance' || clean === '/caja' || clean === '/finanzas') return 'finance';
  if (clean === '/invoicing' || clean === '/facturacion' || clean === '/dte') return 'invoicing';
  if (clean === '/iot-printing' || clean === '/iot' || clean === '/impresoras') return 'iot_printing';
  if (clean === '/customers' || clean === '/clientes' || clean === '/contacts') return 'customers';
  if (clean === '/agent' || clean === '/agente') return 'agent';
  if (clean === '/inbox' || clean === '/bandeja') return 'inbox';
  if (clean === '/loyalty' || clean === '/fidelidad' || clean === '/tarjetas') return 'loyalty';
  return 'library';
};

const getPathFromTab = (tabId) => {
  return ROUTES[tabId]?.path || '/knowledge-base';
};

// Sub-secciones de los módulos: cada una tiene su propia URL (/restaurant/menu, /finance/reports…)
// para que al recargar o compartir el enlace se abra la misma pantalla.
const SUB_ROUTES = {
  loyalty: {
    default: 'pos',
    slugs: { pos: 'pos', kiosk: 'kiosk', cards: 'cards', programs: 'programs', rewards: 'rewards', stats: 'stats', guide: 'guide' }
  },
  agent: {
    default: 'approvals',
    slugs: { approvals: 'approvals', automations: 'automations', history: 'history', metrics: 'metrics' }
  },
  restaurant: {
    default: 'kanban',
    slugs: { kanban: 'kanban', orders: 'orders', menu: 'menu', stats: 'stats', settings: 'settings', guide: 'guide' }
  },
  inventory: {
    default: 'stock',
    slugs: { stock: 'stock', recipes: 'recipes', purchases: 'purchases', waste: 'waste', kardex: 'kardex', guide: 'guide' }
  },
  finance: {
    default: 'shift',
    slugs: {
      shift: 'shift', shifts_history: 'shift-history', transactions: 'transactions', reports: 'reports',
      categories: 'categories', audit: 'audit', guide: 'guide'
    }
  },
  invoicing: {
    default: 'invoices',
    slugs: { invoices: 'invoices', new: 'new', config: 'config', guide: 'guide' }
  },
  iot_printing: {
    default: 'printers',
    slugs: { printers: 'printers', logs: 'logs', guide: 'guide' }
  },
  services: {
    default: 'services',
    slugs: { services: 'services', leads: 'leads', proposals: 'proposals', stats: 'stats', settings: 'settings', config: 'settings', guide: 'guide' }
  }
};

const parseLocation = (pathname) => {
  const parts = (pathname || '').toLowerCase().split('/').filter(Boolean);
  if (parts.length === 0) return { tenant: '', tab: 'library', sub: null };

  let tenant = '';
  let restParts = parts;
  if (!ROOT_TABS.has(parts[0])) {
    tenant = isDefaultSlug(parts[0]) ? '' : parts[0];
    restParts = parts.slice(1);
  }
  if (restParts.length === 0) return { tenant, tab: 'library', sub: null };

  const tab = getTabFromPath(restParts.length ? `/${restParts[0]}` : '/');
  if (tab === 'customers' || tab === 'inbox') {
    return { tenant, tab, sub: /^\d+$/.test(restParts[1] || '') ? restParts[1] : null };
  }
  const sub = SUB_ROUTES[tab];
  if (!sub) return { tenant, tab, sub: null };
  const match = Object.entries(sub.slugs).find(([, slug]) => slug === restParts[1]);
  return { tenant, tab, sub: match ? match[0] : sub.default };
};

const buildPath = (tab, subTab, targetTenant) => {
  const base = getPathFromTab(tab);
  let rel = base;
  if (tab === 'customers' || tab === 'inbox') {
    rel = subTab ? `${base}/${subTab}` : base;
  } else {
    const sub = SUB_ROUTES[tab];
    rel = sub ? `${base}/${sub.slugs[subTab] || sub.slugs[sub.default]}` : base;
  }
  if (tab === 'tenants') return '/tenants';
  const tenant = urlSlugFor(targetTenant !== undefined ? targetTenant : getActingTenant());
  return tenant ? `/${tenant}${rel}` : rel;
};

// ==============================================================
// MENÚ LATERAL: elementos y grupos desplegables
// ==============================================================
function NavBadge({ badge }) {
  if (badge === undefined || badge === null || badge === '') return null;
  if (typeof badge === 'object') {
    const tones = {
      ok: 'bg-emerald-500/15 text-emerald-400',
      warn: 'bg-amber-500/15 text-amber-400',
      muted: 'bg-zinc-800 text-zinc-500'
    };
    return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tones[badge.tone] || tones.muted}`}>{badge.text}</span>;
  }
  return <span className="text-[11px] tabular-nums text-zinc-500">{badge}</span>;
}

function NavItem({ icon: Icon, label, active, onClick, badge, themeColor, nested = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 rounded-md text-[13px] transition-colors group ${
        nested ? 'pl-8 pr-2.5 py-1.5' : 'px-2.5 py-1.5'
      } ${active ? 'bg-[#262626] text-zinc-50 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f1f]'}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={nested ? 14 : 16} className="shrink-0" style={{ color: active ? themeColor : undefined }} />}
        <span className="truncate">{label}</span>
      </span>
      <NavBadge badge={badge} />
    </button>
  );
}

function NavGroup({ id, icon: Icon, label, open, onToggle, hasActive, indicator, themeColor, children }) {
  return (
    <div>
      <button
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
          hasActive && !open ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f1f]'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon size={16} className="shrink-0" style={{ color: hasActive ? themeColor : undefined }} />
          <span className="truncate">{label}</span>
        </span>
        <span className="flex items-center gap-2">
          {indicator}
          <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
        </span>
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

function Dashboard({ onLogout }) {
  useState(canonicalizeUrl); // solo en el primer render, antes de leer la URL
  const initialLocation = parseLocation(window.location.pathname);
  if (initialLocation.tenant && isSuperadmin()) {
    setActingTenant(initialLocation.tenant);
  }
  const [activeTab, setActiveTab] = useState(initialLocation.tab);
  const [restaurantSubTab, setRestaurantSubTab] = useState(
    initialLocation.tab === 'restaurant' ? initialLocation.sub : SUB_ROUTES.restaurant.default
  );
  const [inventorySubTab, setInventorySubTab] = useState(
    initialLocation.tab === 'inventory' ? initialLocation.sub : SUB_ROUTES.inventory.default
  );
  const [financeSubTab, setFinanceSubTab] = useState(
    initialLocation.tab === 'finance' ? initialLocation.sub : SUB_ROUTES.finance.default
  );
  const [invoicingSubTab, setInvoicingSubTab] = useState(
    initialLocation.tab === 'invoicing' ? initialLocation.sub : SUB_ROUTES.invoicing.default
  );
  const [iotSubTab, setIotSubTab] = useState(
    initialLocation.tab === 'iot_printing' ? initialLocation.sub : SUB_ROUTES.iot_printing.default
  );
  const [servicesSubTab, setServicesSubTab] = useState(
    initialLocation.tab === 'services' ? initialLocation.sub : SUB_ROUTES.services.default
  );
  const [customerId, setCustomerId] = useState(initialLocation.tab === 'customers' ? initialLocation.sub : null);
  const [inboxId, setInboxId] = useState(initialLocation.tab === 'inbox' ? initialLocation.sub : null);
  const [agentSubTab, setAgentSubTab] = useState(initialLocation.tab === 'agent' ? initialLocation.sub : SUB_ROUTES.agent.default);
  const [loyaltySubTab, setLoyaltySubTab] = useState(initialLocation.tab === 'loyalty' ? initialLocation.sub : SUB_ROUTES.loyalty.default);
  // Productos contratados por la empresa (plan). null = aún no se sabe: se asume ARM para que el menú no parpadee
  const [features, setFeatures] = useState(null);
  const hasArm = features === null || features.includes('arm');
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [openNavGroups, setOpenNavGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zenith_nav_groups') || '{}'); } catch { return {}; }
  });
  const toggleNavGroup = (id) => setOpenNavGroups(prev => {
    const next = { ...prev, [id]: !(prev[id] ?? true) };
    localStorage.setItem('zenith_nav_groups', JSON.stringify(next));
    return next;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const navigateTo = (tabId) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
  };

  // La URL refleja siempre la pantalla actual (página + sub-sección).
  // Al cargar se normaliza sin crear historial (p. ej. /caja -> /finance/shift); después cada cambio crea una entrada.
  const firstUrlSync = useRef(true);
  const currentSubTab = activeTab === 'restaurant' ? restaurantSubTab
    : activeTab === 'inventory' ? inventorySubTab
    : activeTab === 'finance' ? financeSubTab
    : activeTab === 'invoicing' ? invoicingSubTab
    : activeTab === 'iot_printing' ? iotSubTab
    : activeTab === 'services' ? servicesSubTab
    : activeTab === 'customers' ? customerId
    : activeTab === 'agent' ? agentSubTab
    : activeTab === 'loyalty' ? loyaltySubTab
    : activeTab === 'inbox' ? inboxId : null;
  useEffect(() => {
    const path = buildPath(activeTab, currentSubTab);
    if (window.location.pathname !== path) {
      const method = firstUrlSync.current ? 'replaceState' : 'pushState';
      window.history[method]({ tab: activeTab, sub: currentSubTab }, '', path + window.location.search);
    }
    firstUrlSync.current = false;
  }, [activeTab, currentSubTab]);

  // Atrás / Adelante del navegador: leer la pantalla desde la URL
  useEffect(() => {
    const handlePopState = () => {
      const { tenant, tab, sub } = parseLocation(window.location.pathname);
      const currentActing = getActingTenant();
      if (tenant !== currentActing && isSuperadmin()) {
        setActingTenant(tenant);
        window.location.reload();
        return;
      }
      setActiveTab(tab);
      if (tab === 'restaurant') setRestaurantSubTab(sub);
      if (tab === 'inventory') setInventorySubTab(sub);
      if (tab === 'finance') setFinanceSubTab(sub);
      if (tab === 'invoicing') setInvoicingSubTab(sub);
      if (tab === 'iot_printing') setIotSubTab(sub);
      if (tab === 'services') setServicesSubTab(sub);
      if (tab === 'customers') setCustomerId(sub);
      if (tab === 'agent') setAgentSubTab(sub);
      if (tab === 'inbox') setInboxId(sub);
      if (tab === 'loyalty') setLoyaltySubTab(sub);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Datos globales del sistema
  const [installedModules, setInstalledModules] = useState([]);
  const [moduleManifests, setModuleManifests] = useState({});
  const [modulesLoaded, setModulesLoaded] = useState(false);

  const fetchInstalledModules = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/modules`);
      if (res.ok) {
        const data = await res.json();
        const installed = data.filter(m => m.installed).map(m => m.id);
        setInstalledModules(installed);
        setModuleManifests(Object.fromEntries(data.map(m => [m.id, m])));
        setModulesLoaded(true);
      }
    } catch (e) {
      console.warn('Error fetching installed modules:', e);
    }
  };

  useEffect(() => {
    fetchInstalledModules();
    // Validar y sincronizar rol de superadmin con el backend
    apiFetch(`${API_BASE}/api/auth/check`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && Array.isArray(data.features)) setFeatures(data.features);
        if (data && data.superadmin !== undefined) {
          const stored = getStoredAuth();
          const slugs = { default_slug: data.default_slug || stored.default_slug };
          // Para un superadmin, «tenant» es la empresa que está operando, no la suya
          if (!data.superadmin) slugs.tenant_slug = data.tenant_slug || stored.tenant_slug;
          if (stored.superadmin !== data.superadmin) {
            storeToken({ ...stored, ...slugs, superadmin: data.superadmin, tenant: data.tenant });
          } else if (slugs.default_slug !== stored.default_slug || (slugs.tenant_slug && slugs.tenant_slug !== stored.tenant_slug)) {
            storeToken({ ...stored, ...slugs });
          }
          canonicalizeUrl(); // sesiones antiguas: ya se conoce el slug
        }
      })
      .catch(() => {});
  }, []);

  const [headerTenants, setHeaderTenants] = useState([]);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);

  const [stats, setStats] = useState(() => {
    let cachedCompany = '';
    let cachedLogo = '';
    let cachedBot = '';
    let cachedColor = '#3ecf8e';
    try {
      const tenantKey = getActingTenant() || 'default';
      cachedCompany = localStorage.getItem(`zenith_cached_company_${tenantKey}`) || '';
      cachedLogo = localStorage.getItem(`zenith_cached_logo_${tenantKey}`) || '';
      cachedBot = localStorage.getItem(`zenith_cached_bot_${tenantKey}`) || '';
      cachedColor = localStorage.getItem(`zenith_cached_color_${tenantKey}`) || '#3ecf8e';
    } catch {}
    return {
      database_type: 'PostgreSQL',
      total_db_items: 0,
      cached: true,
      active_provider: 'gemini',
      active_model: 'gemini-2.5-flash',
      company: cachedCompany,
      bot_name: cachedBot,
      company_logo: cachedLogo,
      bot_avatar: '',
      primary_color: cachedColor,
      welcome_message: '',
      transfer_message: '',
      support_phone: '',
      website_url: '',
      wa_connected: false,
      gateway_state: '',
      tenant_active: true
    };
  });

  const [isReactivatingTenant, setIsReactivatingTenant] = useState(false);
  const handleReactivateCurrentTenant = async () => {
    const slug = getActingTenant();
    if (!slug) return;
    setIsReactivatingTenant(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/tenants/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`Empresa "${stats.company || slug}" reactivada con éxito.`);
      await fetchStats();
    } catch (err) {
      showToast('Error al reactivar empresa: ' + err.message, true);
    } finally {
      setIsReactivatingTenant(false);
    }
  };

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
  const [settingsForm, setSettingsForm] = useState(() => {
    let cachedColor = '#3ecf8e';
    let cachedCompany = '';
    let cachedBot = '';
    let cachedLogo = '';
    try {
      const tenantKey = getActingTenant() || 'default';
      cachedColor = localStorage.getItem(`zenith_cached_color_${tenantKey}`) || '#3ecf8e';
      cachedCompany = localStorage.getItem(`zenith_cached_company_${tenantKey}`) || '';
      cachedBot = localStorage.getItem(`zenith_cached_bot_${tenantKey}`) || '';
      cachedLogo = localStorage.getItem(`zenith_cached_logo_${tenantKey}`) || '';
    } catch {}
    return {
      company_name: cachedCompany,
      bot_name: cachedBot,
      company_logo: cachedLogo,
      bot_avatar: '',
      primary_color: cachedColor,
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
    };
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
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatAudioBase64, setChatAudioBase64] = useState(null);
  const [chatAudioBlobUrl, setChatAudioBlobUrl] = useState(null);
  const [chatAudioMimeType, setChatAudioMimeType] = useState('audio/webm');
  const [chatImageBase64, setChatImageBase64] = useState(null);
  const [chatImagePreview, setChatImagePreview] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const chatAudioInputRef = useRef(null);
  const chatImageInputRef = useRef(null);

  const startRecordingAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '');
      const options = preferredMime ? { mimeType: preferredMime } : {};
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      const actualMime = recorder.mimeType || preferredMime || 'audio/webm';
      setChatAudioMimeType(actualMime);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        const blobUrl = URL.createObjectURL(audioBlob);
        setChatAudioBlobUrl(blobUrl);

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result.split(',')[1];
          setChatAudioBase64(base64String);
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      showToast('🎙️ Grabando nota de voz... Habla ahora.');
    } catch (err) {
      showToast('No se pudo acceder al micrófono: ' + err.message, true);
    }
  };

  const stopRecordingAudio = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      showToast('✅ Nota de voz lista para enviar.');
    }
  };

  const handleAudioFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setChatAudioBlobUrl(blobUrl);
    setChatAudioMimeType(file.type || 'audio/ogg');

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      setChatAudioBase64(base64String);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    showToast('🎙️ Archivo de audio cargado.');
  };

  const handleImageFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setChatImagePreview(previewUrl);

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      setChatImageBase64(base64String);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    showToast('🖼️ Comprobante / Imagen adjunta.');
  };

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', isError: false });

  const showToast = useCallback((message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  }, []);

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
  const [waChannel, setWaChannel] = useState('baileys');
  const [isLoggingOutWa, setIsLoggingOutWa] = useState(false);
  const [testWaPhone, setTestWaPhone] = useState('');
  const [testWaMessage, setTestWaMessage] = useState('¡Hola! Mensaje de prueba desde Zenith Studio Dashboard.');
  const [isSendingTestWa, setIsSendingTestWa] = useState(false);
  const [hasCopiedPhone, setHasCopiedPhone] = useState(false);

  const fetchWhatsAppStatus = async () => {
    setIsRefreshingWa(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/whatsapp/status`);
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
      const res = await apiFetch(`${API_BASE}/api/whatsapp/qr`);
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
      const res = await apiFetch(`${API_BASE}/api/whatsapp/logout`, { method: 'POST' });
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
      const res = await apiFetch(`${API_BASE}/api/whatsapp/send`, {
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
    fetchSettings();
    // Sin ARM en el plan no se consulta WhatsApp, bandeja, conocimiento ni aprobaciones del agente
    if (!hasArm) return undefined;
    fetchKnowledge();
    fetchActiveHandoffs();
    fetchWhatsAppStatus();
    fetchPendingApprovals();
    let ticks = 0;
    const interval = setInterval(() => {
      fetchStats();
      fetchActiveHandoffs();
      if (++ticks % 8 === 0) fetchPendingApprovals();
      fetchWhatsAppStatus();
      if (activeTab === 'whatsapp' || waStatus.status === 'WAITING_QR') {
        fetchWhatsAppQr();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeTab, waStatus.status, hasArm]);

  // Si la empresa no tiene ARM, esas pantallas no existen: se lleva al usuario a su producto
  useEffect(() => {
    if (!hasArm && modulesLoaded && ARM_TABS.has(activeTab)) {
      setActiveTab(installedModules.includes('loyalty') ? 'loyalty' : 'settings');
    }
  }, [hasArm, modulesLoaded, activeTab, installedModules]);

  const fetchStats = async () => {
    try {
      const [resKb, resRoot] = await Promise.all([
        apiFetch(`${API_BASE}/api/knowledge/stats`).then(r => r.json()).catch(() => ({})),
        apiFetch(`${API_BASE}/`).then(r => r.json()).catch(() => ({}))
      ]);

      const gw = resRoot.gateway_integration || {};
      const isConnected = Boolean(gw.connected);
      const gwState = gw.gateway_state || (isConnected ? 'CONNECTED' : 'DISCONNECTED');
      const companyName = resRoot.company || resRoot.company_name || '';
      const tenantKey = getActingTenant() || 'default';

      try {
        if (companyName) localStorage.setItem(`zenith_cached_company_${tenantKey}`, companyName);
        if (resRoot.bot_name) localStorage.setItem(`zenith_cached_bot_${tenantKey}`, resRoot.bot_name);
        if (resRoot.company_logo !== undefined) localStorage.setItem(`zenith_cached_logo_${tenantKey}`, resRoot.company_logo || '');
        if (resRoot.primary_color) localStorage.setItem(`zenith_cached_color_${tenantKey}`, resRoot.primary_color);
      } catch {}

      setStats({
        database_type: resKb.database_type || 'PostgreSQL',
        total_db_items: resKb.total_db_items ?? 0,
        cached: resKb.cached ?? true,
        active_provider: resRoot.active_provider || 'gemini',
        company: companyName,
        tenant_active: resRoot.tenant_active ?? true,
        bot_name: resRoot.bot_name || 'Asistente Operativo',
        company_logo: resRoot.company_logo || '',
        bot_avatar: resRoot.bot_avatar || '',
        primary_color: resRoot.primary_color || '#3ecf8e',
        welcome_message: resRoot.effective_welcome?.text || resRoot.welcome_message || '',
        welcome_source: resRoot.effective_welcome?.source || '',
        welcome_source_name: resRoot.effective_welcome?.source_name || '',
        transfer_message: resRoot.transfer_message || '',
        support_phone: resRoot.support_phone || '',
        effective_support_phone: resRoot.effective_support_phone || '',
        handoff_inactivity_hours: resRoot.handoff_inactivity_hours ?? 6.0,
        website_url: resRoot.website_url || '',
        wa_connected: isConnected,
        gateway_state: gwState
      });

      const effectiveWelcome = resRoot.effective_welcome?.text || resRoot.welcome_message;
      if (effectiveWelcome) {
        setMessages(prev => {
          if (prev.length === 1 && prev[0].role === 'assistant' && !prev[0].isCustomized) {
            return [{ role: 'assistant', text: effectiveWelcome, isCustomized: true }];
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
      const res = await apiFetch(`${API_BASE}/api/knowledge`);
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
      const res = await apiFetch(`${API_BASE}/api/settings`);
      const data = await res.json();
      try {
        const tenantKey = getActingTenant() || 'default';
        if (data.company_name) localStorage.setItem(`zenith_cached_company_${tenantKey}`, data.company_name);
        if (data.bot_name) localStorage.setItem(`zenith_cached_bot_${tenantKey}`, data.bot_name);
        if (data.company_logo !== undefined) localStorage.setItem(`zenith_cached_logo_${tenantKey}`, data.company_logo || '');
        if (data.primary_color) localStorage.setItem(`zenith_cached_color_${tenantKey}`, data.primary_color);
      } catch {}
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

  const fetchPendingApprovals = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/agent/tasks?status=pending_approval&limit=1`);
      if (res.ok) setPendingApprovals((await res.json()).counts?.pending_approval || 0);
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  };

  const fetchActiveHandoffs = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/handoff/active`);
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
      const res = await apiFetch(`${API_BASE}/api/handoff/${encodeURIComponent(sessionId)}/release`, { method: 'POST' });
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
      const res = await apiFetch(`${API_BASE}/api/handoff/release-all`, { method: 'POST' });
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
      const res = await apiFetch(`${API_BASE}/api/handoff/pause`, {
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
      const res = await apiFetch(`${API_BASE}/api/handoff/${encodeURIComponent(sessionId)}/update`, {
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

  const handleCreateDoc = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setIsSavingText(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/knowledge/text`, {
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
      const res = await apiFetch(`${API_BASE}/api/knowledge/url`, {
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
      const res = await apiFetch(`${API_BASE}/api/knowledge/crawl`, {
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
      const res = await apiFetch(`${API_BASE}/api/knowledge/batch-urls`, {
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
      const res = await apiFetch(`${API_BASE}/api/knowledge/${id}`, { method: 'DELETE' });
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
      const res = await apiFetch(`${API_BASE}/api/settings`, {
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
    if (e) e.preventDefault();
    const text = chatInput.trim();
    if ((!text && !chatAudioBase64 && !chatImageBase64) || isChatLoading) return;

    const userMsg = {
      role: 'user',
      text,
      audioUrl: chatAudioBlobUrl,
      imageUrl: chatImagePreview
    };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    const audioToSend = chatAudioBase64;
    const imageToSend = chatImageBase64;
    setChatAudioBase64(null);
    setChatAudioBlobUrl(null);
    setChatImageBase64(null);
    setChatImagePreview(null);
    setIsChatLoading(true);

    try {
      const res = await apiFetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'react-playground-session',
          message: text,
          audio_base64: audioToSend,
          audio_mime_type: chatAudioMimeType || 'audio/webm',
          image_base64: imageToSend,
          image_mime_type: 'image/jpeg'
        })
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
    <div className="flex min-h-screen bg-[#121212] text-zinc-100 font-sans">
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
        [class^="text-[#3ecf8e]"], [class*=" text-[#3ecf8e]"] {
          color: ${themeColor} !important;
        }
        .bg-\\[\\#3ecf8e\\],
        .bg-emerald-500,
        [class^="bg-[#3ecf8e]"]:not([class*="/"]), [class*=" bg-[#3ecf8e]"]:not([class*="/"]) {
          background-color: ${themeColor} !important;
        }
        .border-\\[\\#3ecf8e\\],
        .border-emerald-500,
        [class^="border-[#3ecf8e]"]:not([class*="/"]), [class*=" border-[#3ecf8e]"]:not([class*="/"]) {
          border-color: ${themeColor} !important;
        }
        .bg-\\[\\#3ecf8e\\]\\/5,
        .bg-\\[\\#3ecf8e\\]\\/10,
        .bg-\\[\\#3ecf8e\\]\\/20,
        .bg-emerald-500\\/10,
        .bg-emerald-950,
        .bg-emerald-950\\/60,
        .bg-emerald-950\\/70,
        [class^="bg-[#3ecf8e]/"], [class*=" bg-[#3ecf8e]/"],
        [class^="bg-emerald-950"], [class*=" bg-emerald-950"] {
          background-color: rgba(${themeRgb}, 0.15) !important;
        }
        .border-\\[\\#3ecf8e\\]\\/20,
        .border-\\[\\#3ecf8e\\]\\/40,
        .border-emerald-500\\/20,
        .border-emerald-800,
        .border-emerald-800\\/50,
        .border-emerald-800\\/60,
        [class^="border-[#3ecf8e]/"], [class*=" border-[#3ecf8e]/"],
        [class^="border-emerald-800"], [class*=" border-emerald-800"] {
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
        .,
        .\\/20 {
          box-shadow: 0 10px 15px -3px rgba(${themeRgb}, 0.25) !important;
        }
        *::-webkit-scrollbar-thumb:hover {
          background: ${themeColor} !important;
        }
      `}</style>

      {/* ==============================================================
          SIDEBAR (ESTILO SUPABASE STUDIO)
          ============================================================== */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-[#171717] border-r border-[#2e2e2e] flex flex-col transition-transform duration-200 md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand Header */}
        <div className="h-14 px-3 border-b border-[#2e2e2e] flex items-center justify-between">
          {!stats.company ? (
            <div className="flex items-center gap-2 overflow-hidden animate-pulse">
              <div className="w-8 h-8 rounded-md bg-zinc-800/80 shrink-0" />
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="h-3.5 w-24 bg-zinc-800/80 rounded" />
                <div className="h-2.5 w-16 bg-zinc-800/50 rounded" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 overflow-hidden">
              {stats.company_logo ? (
                <img
                  src={stats.company_logo}
                  alt={stats.company}
                  className="w-8 h-8 rounded-md object-contain bg-zinc-900 border border-[#2e2e2e] p-0.5 shrink-0"
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center font-semibold text-white text-sm shrink-0 transition-colors"
                  style={{ backgroundColor: themeColor }}
                >
                  {companyInitial}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-medium text-sm text-zinc-100 truncate">{stats.company}</span>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: themeColor }}
                  ></span>
                  <span className="truncate">{stats.bot_name || 'Asistente Operativo'}</span>
                </div>
              </div>
            </div>
          )}
          <button className="md:hidden text-zinc-400 hover:text-white p-1" onClick={() => setMobileMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {(() => {
            const waOnline = waStatus.connected || waStatus.status === 'CONNECTED';
            const waBadge = waOnline
              ? { text: 'Online', tone: 'ok' }
              : waStatus.status === 'WAITING_QR' ? { text: 'QR', tone: 'warn' } : { text: 'Offline', tone: 'muted' };
            const isRestaurant = (sub) => activeTab === 'restaurant' && restaurantSubTab === sub;
            const goRestaurant = (sub) => { setRestaurantSubTab(sub); navigateTo('restaurant'); };
            const isInventory = (sub) => activeTab === 'inventory' && inventorySubTab === sub;
            const goInventory = (sub) => { setInventorySubTab(sub); navigateTo('inventory'); };
            const isFinance = (sub) => activeTab === 'finance' && financeSubTab === sub;
            const goFinance = (sub) => { setFinanceSubTab(sub); navigateTo('finance'); };
            const isInvoice = (sub) => activeTab === 'invoicing' && invoicingSubTab === sub;
            const goInvoicing = (sub) => { setInvoicingSubTab(sub); navigateTo('invoicing'); };
            const isIot = (sub) => activeTab === 'iot_printing' && iotSubTab === sub;
            const goIot = (sub) => { setIotSubTab(sub); navigateTo('iot_printing'); };
            const isServices = (sub) => activeTab === 'services' && servicesSubTab === sub;
            const goServices = (sub) => { setServicesSubTab(sub); navigateTo('services'); };
            const isLoyalty = (sub) => activeTab === 'loyalty' && loyaltySubTab === sub;
            const goLoyalty = (sub) => { setLoyaltySubTab(sub); navigateTo('loyalty'); };
            const ARM_GROUPS = new Set(['service', 'agent', 'knowledge']);
            const groups = [
              installedModules.includes('loyalty') && {
                id: 'loyalty', label: 'Tarjetas de Fidelidad', icon: CreditCard,
                items: [
                  { label: 'Caja', icon: Coins, active: isLoyalty('pos'), onClick: () => goLoyalty('pos') },
                  { label: 'QR impreso', icon: QrCode, active: isLoyalty('kiosk'), onClick: () => goLoyalty('kiosk') },
                  { label: 'Tarjetas', icon: CreditCard, active: isLoyalty('cards'), onClick: () => goLoyalty('cards') },
                  { label: 'Programas', icon: Settings, active: isLoyalty('programs'), onClick: () => goLoyalty('programs') },
                  { label: 'Recompensas', icon: Sparkles, active: isLoyalty('rewards'), onClick: () => goLoyalty('rewards') },
                  { label: 'Reportes', icon: BarChart3, active: isLoyalty('stats'), onClick: () => goLoyalty('stats') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isLoyalty('guide'), onClick: () => goLoyalty('guide') }
                ]
              },
              installedModules.includes('restaurant') && {
                id: 'restaurant', label: 'Restaurante', icon: UtensilsCrossed,
                items: [
                  { label: 'Tablero', icon: Kanban, active: isRestaurant('kanban'), onClick: () => goRestaurant('kanban') },
                  { label: 'Historial de Pedidos', icon: ClipboardList, active: isRestaurant('orders'), onClick: () => goRestaurant('orders') },
                  { label: 'Menú', icon: UtensilsCrossed, active: isRestaurant('menu'), onClick: () => goRestaurant('menu') },
                  { label: 'Estadísticas', icon: BarChart3, active: isRestaurant('stats'), onClick: () => goRestaurant('stats') },
                  { label: 'Configuración', icon: Settings, active: isRestaurant('settings'), onClick: () => goRestaurant('settings') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isRestaurant('guide'), onClick: () => goRestaurant('guide') }
                ]
              },
              installedModules.includes('inventory') && {
                id: 'inventory', label: 'Inventario & Insumos', icon: Package,
                items: [
                  { label: 'Existencias & Stock', icon: Package, active: isInventory('stock'), onClick: () => goInventory('stock') },
                  { label: 'Recetas & Escandallo', icon: ChefHat, active: isInventory('recipes'), onClick: () => goInventory('recipes') },
                  { label: 'Compras & Entradas', icon: ShoppingBag, active: isInventory('purchases'), onClick: () => goInventory('purchases') },
                  { label: 'Mermas & Bajas', icon: Trash2, active: isInventory('waste'), onClick: () => goInventory('waste') },
                  { label: 'Kardex / Movimientos', icon: ArrowLeftRight, active: isInventory('kardex'), onClick: () => goInventory('kardex') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isInventory('guide'), onClick: () => goInventory('guide') }
                ]
              },
              installedModules.includes('finance') && {
                id: 'finance', label: 'Caja & Finanzas', icon: Wallet,
                items: [
                  { label: 'Turno & Arqueo', icon: Coins, active: isFinance('shift'), onClick: () => goFinance('shift') },
                  { label: 'Historial Cortes', icon: Receipt, active: isFinance('shifts_history'), onClick: () => goFinance('shifts_history') },
                  { label: 'Movimientos', icon: ArrowLeftRight, active: isFinance('transactions'), onClick: () => goFinance('transactions') },
                  { label: 'Reportes', icon: TrendingUp, active: isFinance('reports'), onClick: () => goFinance('reports') },
                  { label: 'Categorías', icon: Tags, active: isFinance('categories'), onClick: () => goFinance('categories') },
                  { label: 'Bitácora', icon: ScrollText, active: isFinance('audit'), onClick: () => goFinance('audit') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isFinance('guide'), onClick: () => goFinance('guide') }
                ]
              },
              installedModules.includes('invoicing') && {
                id: 'invoicing', label: 'Facturación & DTE', icon: Receipt,
                items: [
                  { label: 'Comprobantes Emitidos', icon: FileText, active: isInvoice('invoices'), onClick: () => goInvoicing('invoices') },
                  { label: 'Nueva Factura / DTE', icon: PlusCircle, active: isInvoice('new'), onClick: () => goInvoicing('new') },
                  { label: 'Configuración Hacienda SV', icon: Settings, active: isInvoice('config'), onClick: () => goInvoicing('config') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isInvoice('guide'), onClick: () => goInvoicing('guide') }
                ]
              },
              installedModules.includes('iot_printing') && {
                id: 'iot_printing', label: 'Impresión IoT', icon: Printer,
                items: [
                  { label: 'Impresoras Registradas', icon: Printer, active: isIot('printers'), onClick: () => goIot('printers') },
                  { label: 'Historial de Trabajos', icon: ScrollText, active: isIot('logs'), onClick: () => goIot('logs') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isIot('guide'), onClick: () => goIot('guide') }
                ]
              },
              installedModules.includes('services') && {
                id: 'services', label: 'Servicios Profesionales', icon: Briefcase,
                items: [
                  { label: 'Servicios', icon: Briefcase, active: isServices('services'), onClick: () => goServices('services') },
                  { label: 'Leads / CRM', icon: Users, active: isServices('leads'), onClick: () => goServices('leads') },
                  { label: 'Propuestas', icon: FileText, active: isServices('proposals'), onClick: () => goServices('proposals') },
                  { label: 'Estadísticas', icon: BarChart3, active: isServices('stats'), onClick: () => goServices('stats') },
                  { label: 'Configuración', icon: Settings, active: isServices('settings') || isServices('config'), onClick: () => goServices('settings') },
                  { label: 'Guía de uso', icon: LifeBuoy, active: isServices('guide'), onClick: () => goServices('guide') }
                ]
              },
              {
                id: 'service', label: 'Atención al cliente', icon: MessageCircle,
                indicator: activeHandoffs.length > 0
                  ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title={`${activeHandoffs.length} con IA pausada`} />
                  : null,
                items: [
                  { label: 'Bandeja', icon: MessagesSquare, active: activeTab === 'inbox', onClick: () => navigateTo('inbox'), badge: activeHandoffs.length > 0 ? { text: activeHandoffs.length, tone: 'warn' } : undefined },
                  { label: 'Clientes', icon: Users, active: activeTab === 'customers', onClick: () => { setCustomerId(null); navigateTo('customers'); } },
                  { tab: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, badge: waBadge },
                  { tab: 'handoffs', label: 'IA pausada', icon: UserCheck, badge: activeHandoffs.length > 0 ? { text: activeHandoffs.length, tone: 'warn' } : 0 }
                ]
              },
              {
                id: 'agent', label: 'Agente IA', icon: Bot,
                indicator: pendingApprovals > 0
                  ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title={`${pendingApprovals} por aprobar`} />
                  : null,
                items: [
                  { label: 'Aprobaciones', icon: Inbox, active: activeTab === 'agent' && agentSubTab === 'approvals', onClick: () => { setAgentSubTab('approvals'); navigateTo('agent'); }, badge: pendingApprovals ? { text: pendingApprovals, tone: 'warn' } : undefined },
                  { label: 'Automatizaciones', icon: Workflow, active: activeTab === 'agent' && agentSubTab === 'automations', onClick: () => { setAgentSubTab('automations'); navigateTo('agent'); } },
                  { label: 'Historial', icon: History, active: activeTab === 'agent' && agentSubTab === 'history', onClick: () => { setAgentSubTab('history'); navigateTo('agent'); } },
                  { label: 'Métricas', icon: BarChart3, active: activeTab === 'agent' && agentSubTab === 'metrics', onClick: () => { setAgentSubTab('metrics'); navigateTo('agent'); } }
                ]
              },
              {
                id: 'knowledge', label: 'Conocimiento', icon: BookOpen,
                items: [
                  { tab: 'library', label: 'Base de conocimiento', icon: BookOpen, badge: stats.total_db_items },
                  { tab: 'add-text', label: 'Redactar documento', icon: PlusCircle },
                  { tab: 'scrape', label: 'Rastreador web', icon: Globe }
                ]
              },
              {
                id: 'system', label: 'Configuración', icon: Settings,
                items: canManageUsers() ? [
                  { tab: 'settings', label: 'Identidad e IA', icon: Sparkles },
                  { tab: 'users', label: 'Usuarios', icon: UserPlus },
                  // Solo el administrador de la plataforma agrega o quita módulos a una empresa
                  ...(isSuperadmin() ? [{ tab: 'modules', label: 'Módulos', icon: Boxes }] : [])
                ] : [
                  { tab: 'settings', label: 'Identidad e IA', icon: Sparkles }
                ]
              }
            ].filter(Boolean).filter(g => hasArm || !ARM_GROUPS.has(g.id));

            return (
              <>
                {isSuperadmin() && (
                  <NavItem
                    icon={Building2}
                    label="Empresas"
                    active={activeTab === 'tenants'}
                    onClick={() => navigateTo('tenants')}
                    themeColor={themeColor}
                  />
                )}
                <div className="h-1.5" />
                {groups.map(group => {
                  const items = group.items.map(item => ({
                    ...item,
                    active: item.active ?? activeTab === item.tab,
                    onClick: item.onClick ?? (() => navigateTo(item.tab))
                  }));
                  const hasActive = items.some(i => i.active);
                  return (
                    <NavGroup
                      key={group.id}
                      id={group.id}
                      icon={group.icon}
                      label={group.label}
                      open={openNavGroups[group.id] ?? true}
                      onToggle={toggleNavGroup}
                      hasActive={hasActive}
                      indicator={group.indicator}
                      themeColor={themeColor}
                    >
                      {items.map(item => (
                        <NavItem key={item.label} {...item} nested themeColor={themeColor} />
                      ))}
                    </NavGroup>
                  );
                })}
                <div className="h-2" />
                {hasArm && (
                  <NavItem
                    icon={MessageSquare}
                    label="Simulador de chat"
                    active={activeTab === 'chat'}
                    onClick={() => navigateTo('chat')}
                    themeColor={themeColor}
                  />
                )}
              </>
            );
          })()}
        </nav>

        {/* Footer Sidebar */}
        <div className="p-2 border-t border-[#2e2e2e] flex items-center gap-1">
          {hasArm && (
          <a
            href="http://localhost:3000/qr"
            target="_blank"
            rel="noreferrer"
            title="Abrir página del QR de WhatsApp"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f1f] transition-colors"
          >
            <QrCode size={14} /> QR
          </a>
          )}
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            title="Documentación de la API"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f1f] transition-colors"
          >
            <FileCode2 size={14} /> API
          </a>
          <button
            onClick={onLogout}
            title="Cerrar sesión del panel"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut size={14} /> Salir
          </button>
        </div>
      </aside>

      {/* ==============================================================
          MAIN CONTENT WORKSPACE
          ============================================================== */}
      <div className="flex-1 md:ml-60 flex flex-col min-h-screen min-w-0">

        {/* Top Header */}
        <header className="h-14 px-4 md:px-6 bg-[#121212]/90 backdrop-blur-md border-b border-[#2e2e2e] sticky top-0 z-30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="md:hidden p-2 text-zinc-400 hover:text-white rounded-md border border-[#2e2e2e]" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              {isSuperadmin() ? (
                <div className="relative">
                  <button
                    onClick={() => {
                      setTenantDropdownOpen(v => !v);
                      if (!tenantDropdownOpen) {
                        apiFetch(`${API_BASE}/api/tenants`)
                          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
                          .then(d => setHeaderTenants(d.tenants || []))
                          .catch(err => showToast('No se pudo cargar la lista de empresas: ' + err.message, true));
                      }
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-[#171717] hover:bg-zinc-800 border border-[#2e2e2e] hover:border-zinc-700 rounded-md text-xs font-semibold text-zinc-100 transition-colors shadow-sm"
                    title="Conmutar empresa (Multi-Tenant)"
                  >
                    <Building2 size={13} className="text-emerald-400 shrink-0" />
                    {stats.company ? (
                      <span className="max-w-[130px] truncate">{stats.company}</span>
                    ) : (
                      <span className="inline-block w-20 h-3 bg-zinc-800 rounded animate-pulse" />
                    )}
                    <ChevronDown size={12} className="text-zinc-500 shrink-0" />
                  </button>

                  {tenantDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setTenantDropdownOpen(false)} />
                      <div className="absolute left-0 mt-1.5 w-72 bg-[#171717] border border-[#2e2e2e] rounded-lg shadow-2xl py-1.5 z-50 animate-fadeIn">
                        <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-[#242424]">
                          Empresas
                        </div>
                        <div className="max-h-60 overflow-y-auto divide-y divide-[#242424]">
                          {headerTenants.map(t => {
                            const isCurrent = (getActingTenant() || 'default') === t.slug;
                            return (
                              <button
                                key={t.slug}
                                onClick={() => {
                                  setTenantDropdownOpen(false);
                                  if (isCurrent) return;
                                  const targetSlug = t.slug === 'default' ? '' : t.slug;
                                  setActingTenant(targetSlug);
                                  // Al cambiar de empresa se abre la misma pantalla raíz (sin ids de otra empresa)
                                  const tabToKeep = activeTab === 'tenants' ? 'library' : activeTab;
                                  const nextUrl = buildPath(tabToKeep, null, targetSlug);
                                  window.location.assign(nextUrl);
                                }}
                                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-zinc-800 transition-colors ${
                                  isCurrent ? 'bg-zinc-800/80 text-emerald-300 font-medium' : 'text-zinc-300'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                      t.active ? 'bg-emerald-400' : 'bg-zinc-600'
                                    }`}
                                  />
                                  <span className="truncate">{t.name}</span>
                                  {t.slug === 'default' && (
                                    <span className="text-[10px] text-zinc-500 font-mono">(principal)</span>
                                  )}
                                </div>
                                {isCurrent && <Check size={13} className="text-emerald-400 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                        <div className="p-1.5 pt-2 border-t border-[#262626]">
                          <button
                            onClick={() => {
                              setTenantDropdownOpen(false);
                              navigateTo('tenants');
                            }}
                            className="w-full text-center py-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium hover:bg-emerald-500/10 rounded transition-colors"
                          >
                            Gestionar empresas
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                stats.company ? (
                  <span className="text-zinc-500 font-medium">{stats.company}</span>
                ) : (
                  <span className="inline-block w-20 h-3.5 bg-zinc-800 rounded animate-pulse" />
                )
              )}
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-200 font-medium">
                {ROUTES[activeTab]?.breadcrumb || 'Knowledge Base'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              {hasArm && (
              <button
                onClick={() => navigateTo('whatsapp')}
                className={`flex items-center gap-1.5 px-3 py-1 bg-[#1c1c1c] border rounded-full text-xs font-medium transition-all ${
                  waStatus.connected || waStatus.status === 'CONNECTED'
                    ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                    : waStatus.status === 'WAITING_QR'
                      ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                      : 'border-[#2e2e2e] text-zinc-400 hover:text-zinc-200'
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
              )}
            </div>

          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 md:px-8 py-6 md:py-8">

          {/* Banner de aviso cuando la empresa está desactivada */}
          {stats.tenant_active === false && (
            <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                  <Power size={20} />
                </div>
                <div>
                  <div className="font-semibold text-sm text-amber-200">
                    Esta empresa ({stats.company || getActingTenant() || 'seleccionada'}) se encuentra desactivada
                  </div>
                  <div className="text-xs text-amber-300/80 mt-0.5">
                    Sus pedidos, el bot de WhatsApp y la atención al cliente están suspendidos.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isSuperadmin() ? (
                  <>
                    <button
                      onClick={handleReactivateCurrentTenant}
                      disabled={isReactivatingTenant}
                      className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold shadow transition-colors disabled:opacity-50"
                    >
                      {isReactivatingTenant ? 'Activando...' : 'Reactivar Empresa'}
                    </button>
                    <button
                      onClick={() => { setActingTenant(''); window.location.assign('/tenants'); }}
                      className="px-3 py-1.5 rounded-md border border-amber-500/40 hover:bg-amber-500/20 text-xs font-medium text-amber-300 transition-colors"
                    >
                      Volver a Empresas
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onLogout}
                    className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
                  >
                    Cerrar Sesión
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ==============================================================
              TAB 1: BASE DE CONOCIMIENTO (LIBRARY)
              ============================================================== */}
          {activeTab === 'library' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Base de conocimiento</h1>
                  <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
                    La IA responde a tus clientes basándose únicamente en estos datos.
                  </p>
                </div>
              </div>
              {/* Metric Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                  <span className="text-xs font-medium text-zinc-500">Documentos Indexados</span>
                  <div className="mt-2 text-2xl font-semibold text-zinc-100">{stats.total_db_items}</div>
                  <span className="text-xs text-zinc-400 mt-1">Guardados en {stats.database_type}</span>
                </div>

                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                  <span className="text-xs font-medium text-zinc-500">In-Memory Hot Cache</span>
                  <div className="mt-2 text-2xl font-semibold text-[#3ecf8e]" style={{ color: themeColor }}>0.00 ms</div>
                  <span className="text-xs text-zinc-400 mt-1">Recuperación instantánea</span>
                </div>

                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                  <span className="text-xs font-medium text-zinc-500">Motor Activo</span>
                  <div className="mt-2 text-2xl font-semibold text-zinc-100 uppercase">{stats.active_provider}</div>
                  <span className="text-xs text-zinc-400 mt-1">{stats.active_model}</span>
                </div>

                <div
                  onClick={() => navigateTo('whatsapp')}
                  className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] hover:border-zinc-700/80 rounded-md flex flex-col justify-between cursor-pointer transition-all hover:-translate-y-0.5 group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500 group-hover:text-zinc-300">WhatsApp Gateway</span>
                    <ExternalLink size={13} className="text-zinc-500 group-hover:text-zinc-300" />
                  </div>
                  <div
                    style={(waStatus.connected || waStatus.status === 'CONNECTED' || stats.wa_connected) ? { color: themeColor } : {}}
                    className={`mt-2 text-2xl font-semibold ${
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
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium text-zinc-100">Documentos y sitios web</h2>
                  <p className="text-[13px] text-zinc-400 mt-0.5">La IA responde basándose estrictamente en estos datos.</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('scrape')}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-[13px] rounded-md border border-[#2e2e2e] transition-all"
                  >
                    <Globe size={15} />
                    <span>Escanear Sitio Web</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('add-text')}
                    style={{ backgroundColor: themeColor }}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all shrink-0 hover:brightness-110"
                  >
                    <PlusCircle size={16} />
                    <span>Nuevo Documento</span>
                  </button>
                </div>
              </div>

              {/* Barra de Filtro */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar por título o contenido en el catálogo..."
                    className="w-full pl-10 pr-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none transition-colors"
                  />
                </div>

                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-300 outline-none w-full sm:w-56"
                >
                  <option value="">Todas las categorías</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Grid de Tarjetas */}
              {filteredItems.length === 0 ? (
                <div className="p-4 text-center bg-[#1c1c1c] border border-dashed border-[#2e2e2e] rounded-md space-y-2">
                  <BookOpen size={36} className="mx-auto text-zinc-600" />
                  <p className="text-sm text-zinc-400">No se encontraron documentos que coincidan con la búsqueda.</p>
                  <button onClick={() => setActiveTab('add-text')} style={{ color: themeColor }} className="text-xs font-semibold hover:underline">
                    Crear un nuevo documento ahora
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredItems.map(item => (
                    <div key={item.id} className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] hover:border-zinc-700/80 rounded-md flex flex-col justify-between gap-2 transition-all hover:-translate-y-0.5">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium text-sm text-zinc-100 line-clamp-2 leading-snug">{item.title}</h3>
                          <span
                            style={item.source_type !== 'url' ? {
                              backgroundColor: `rgba(${themeRgb}, 0.15)`,
                              color: themeColor,
                              borderColor: `rgba(${themeRgb}, 0.35)`
                            } : {}}
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md tracking-wide shrink-0 border ${item.source_type === 'url' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : ''}`}
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

                        <div className="font-mono text-xs text-zinc-400 bg-[#141414] p-4 rounded-md border border-white/5 line-clamp-4 leading-relaxed">
                          {item.content}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#2e2e2e]">
                        <button
                          onClick={() => setSelectedDoc(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-zinc-400 hover:text-white bg-[#141414] hover:bg-zinc-800 border border-[#2e2e2e] rounded-md transition-colors"
                        >
                          <Eye size={13} />
                          <span>Ver Completo</span>
                        </button>

                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
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
            <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Nuevo Documento de Conocimiento</h1>
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
                    <Building2 size={12} />
                    <span>Empresa destino: {stats.company || 'Empresa Principal'}</span>
                  </span>
                </div>
                <p className="text-sm text-zinc-400 mt-1">Este conocimiento se guardará de forma individual y aislada exclusivamente para <strong>{stats.company || 'esta empresa'}</strong>.</p>
              </div>

              <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md">
                <form onSubmit={handleCreateDoc} className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Título del Documento *</label>
                      <input
                        type="text"
                        required
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        placeholder="Ej: Catálogo de Servicios y Precios 2026"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Categoría</label>
                      <input
                        type="text"
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        placeholder="Ej: precios, políticas, soporte"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-2">Contenido Detallado *</label>
                    <textarea
                      required
                      rows={10}
                      value={newContent}
                      onChange={e => setNewContent(e.target.value)}
                      placeholder="Redacta o pega aquí la información exacta que el bot debe utilizar..."
                      className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-xs font-mono text-zinc-200 outline-none leading-relaxed"
                    />
                    <div className="flex justify-between items-center text-xs text-zinc-500 mt-2">
                      <span>Admite texto plano y Markdown. Se sanitiza a UTF-8 automáticamente.</span>
                      <span>{newContent.length} caracteres</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="px-3 py-1.5 border border-[#2e2e2e] hover:bg-zinc-800 text-zinc-300 font-medium text-[13px] rounded-md transition-colors"
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      disabled={isSavingText}
                      style={{ backgroundColor: themeColor }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-50 hover:brightness-110"
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
            <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Extractor Web Inteligente</h1>
                  <p className="text-sm text-zinc-400 mt-1">Escanea páginas web individuales o mapea automáticamente todas las URLs de tu sitio web.</p>
                </div>

                {/* Selector de Modo */}
                <div className="flex bg-[#171717] p-1 border border-[#2e2e2e] rounded-md shrink-0">
                  <button
                    onClick={() => setScraperMode('crawler')}
                    style={scraperMode === 'crawler' ? { backgroundColor: themeColor } : {}}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${scraperMode === 'crawler' ? 'text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    <Layers size={14} />
                    <span>Mapear Sitio Completo</span>
                  </button>
                  <button
                    onClick={() => setScraperMode('single')}
                    style={scraperMode === 'single' ? { backgroundColor: themeColor } : {}}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${scraperMode === 'single' ? 'text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    <Globe size={14} />
                    <span>Página Única</span>
                  </button>
                </div>
              </div>

              {/* MODO 1: MAPEAR SITIO COMPLETO (CRAWLER / SITEMAP) */}
              {scraperMode === 'crawler' && (
                <div className="space-y-2">
                  {/* Formulario de Descubrimiento */}
                  <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                    <div className="flex items-center gap-2 text-zinc-200 font-medium text-sm">
                      <Compass size={17} style={{ color: themeColor }} />
                      <span>Paso 1: Mapear URLs Internas del Sitio Web</span>
                    </div>

                    <form onSubmit={handleCrawlSite} className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-zinc-300 mb-2">URL Raíz del Sitio *</label>
                          <input
                            type="url"
                            required
                            value={crawlerUrl}
                            onChange={e => setCrawlerUrl(e.target.value)}
                            placeholder="https://fantasmadigital.dev"
                            className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-zinc-300 mb-2">Máximo de URLs</label>
                          <select
                            value={crawlerMaxUrls}
                            onChange={e => setCrawlerMaxUrls(e.target.value)}
                            className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
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
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-50 hover:brightness-110"
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
                    <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2 animate-scaleUp">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#2e2e2e]">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-base text-zinc-100">URLs Detectadas ({discoveredUrls.length} páginas)</h3>
                            <span
                              className="px-2 py-0.5 rounded-md text-xs font-medium border"
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
                            className="px-3 py-1 text-[13px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md font-medium transition-colors"
                          >
                            Seleccionar Todas
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSelectAllUrls(false)}
                            className="px-3 py-1 text-[13px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md font-medium transition-colors"
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
                            className={`flex items-center justify-between px-4 py-3 rounded-md border text-xs cursor-pointer select-none transition-colors ${item.selected ? 'text-zinc-100 font-medium' : 'bg-[#141414] border-[#2e2e2e] text-zinc-400 hover:border-zinc-700'}`}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="text-zinc-500 font-mono text-[11px] w-6 shrink-0">{idx + 1}.</span>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleUrlSelection(item.url)}
                                style={{ accentColor: themeColor }}
                                className="w-4 h-4 rounded-md cursor-pointer shrink-0"
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
                      <div className="pt-2 border-t border-[#2e2e2e] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-zinc-400">Categoría:</label>
                          <input
                            type="text"
                            value={crawlerCategory}
                            onChange={e => setCrawlerCategory(e.target.value)}
                            placeholder="sitio-web"
                            className="px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none w-36"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleBatchIndexUrls}
                          disabled={isBatchIndexing || selectedUrlsCount === 0}
                          style={{ backgroundColor: themeColor }}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-50 hover:brightness-110"
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
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2 animate-scaleUp">
                  <form onSubmit={handleSingleScrape} className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-2">URL del Sitio Web *</label>
                        <input
                          type="url"
                          required
                          value={scrapeUrl}
                          onChange={e => setScrapeUrl(e.target.value)}
                          placeholder="https://tuempresa.com/servicios"
                          className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-2">Categoría</label>
                        <input
                          type="text"
                          value={scrapeCategory}
                          onChange={e => setScrapeCategory(e.target.value)}
                          placeholder="Ej: sitio-web, landing"
                          className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    <div
                      className="p-2 rounded-md text-xs text-zinc-400 leading-relaxed border"
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
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-50 hover:brightness-110"
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
                <h1 className="text-xl font-medium tracking-tight text-zinc-100">Playground de Conversación</h1>
                <p className="text-sm text-zinc-400 mt-1">Interactúa con el asistente para comprobar cómo responde con base en tu nuevo catálogo y políticas.</p>
              </div>

              <div className="flex flex-col h-[580px] bg-[#171717] border border-[#2e2e2e] rounded-md overflow-hidden">
                {/* Chat Top Banner */}
                <div className="px-4 py-3 bg-[#141414] border-b border-[#2e2e2e] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {stats.bot_avatar ? (
                      <img
                        src={stats.bot_avatar}
                        alt="Bot Avatar"
                        className="w-8 h-8 rounded-full object-cover border border-[#2e2e2e] shadow-sm"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shadow-sm"
                        style={{ backgroundColor: themeColor }}
                      >
                        <Bot size={16} />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                        <span>{stats.bot_name || 'Asistente Operativo'}</span>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: themeColor }}></span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate max-w-xs">{stats.company || 'Atención en Línea'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(stats.effective_support_phone || stats.support_phone) && (
                      <span className="hidden sm:inline-flex text-[11px] text-zinc-300 items-center gap-1.5 bg-zinc-900/90 px-2.5 py-1 rounded-md border border-[#2e2e2e]">
                        <PhoneCall size={12} style={{ color: themeColor }} />
                        <span className="text-zinc-500 text-[10px]">Soporte:</span>
                        <span className="font-mono">{stats.effective_support_phone || stats.support_phone}</span>
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await apiFetch(`${API_BASE}/sessions/react-playground-session`, { method: 'DELETE' });
                        } catch (e) {
                          console.warn('Error reiniciando sesión en backend', e);
                        }
                        setMessages([]);
                        showToast('Conversación de prueba reiniciada');
                      }}
                      className="px-3 py-1 bg-zinc-800/60 hover:bg-zinc-800 border border-[#2e2e2e] rounded-md text-[11px] text-zinc-300 transition-colors"
                      title="Reiniciar conversación y memoria de prueba"
                    >
                      Reiniciar
                    </button>
                  </div>
                </div>

                {/* Banner de Silencio de IA / Agente Humano Activo (Playground) */}
                {activeHandoffs.some(h => h.session_id === 'react-playground-session') && (
                  <div className="px-3 py-1.5 bg-amber-950/70 border-b border-amber-800/60 flex items-center justify-between gap-2 text-xs text-amber-200">
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
                      className="px-3 py-1 text-zinc-950 font-medium rounded-md text-[11px] transition-colors shrink-0 shadow hover:brightness-110"
                    >
                      ▶️ Reanudar IA Ahora
                    </button>
                  </div>
                )}

                {/* Messages Box */}
                <div className="flex-1 p-2 overflow-y-auto space-y-2">
                  {messages.length === 0 && (
                    <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                      <div className="w-12 h-12 rounded-full bg-[#181818] border border-[#2e2e2e] flex items-center justify-center mb-3 text-zinc-400">
                        <Bot size={22} style={{ color: themeColor }} />
                      </div>
                      <h4 className="text-sm font-medium text-zinc-300">Playground de Conversación</h4>
                      <p className="text-xs text-zinc-500 max-w-sm mt-1">
                        Escribe un mensaje o envía un audio para probar la atención humana y natural de tu agente.
                      </p>
                    </div>
                  )}
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex items-start gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'assistant' && (
                        stats.bot_avatar ? (
                          <img
                            src={stats.bot_avatar}
                            alt="Avatar"
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#2e2e2e] mt-0.5 shadow-sm"
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
                        className={`max-w-[85%] px-3 py-1.5 rounded-md text-sm leading-relaxed ${m.role === 'user'
                            ? 'text-white rounded-br-none shadow-sm'
                            : 'bg-[#232323] text-zinc-200 border border-[#2e2e2e] rounded-bl-none'
                          }`}
                        style={m.role === 'user' ? { backgroundColor: themeColor } : {}}
                      >
                        {m.imageUrl && (
                          <div className="mb-2 rounded-md overflow-hidden border border-white/20 max-w-xs bg-black/40">
                            <img src={m.imageUrl} alt="Comprobante adjunto" className="max-h-48 w-auto object-cover rounded-md" />
                          </div>
                        )}
                        {m.audioUrl && (
                          <div className="mb-2 flex items-center gap-2 bg-black/30 px-2.5 py-1.5 rounded-md border border-white/10">
                            <span className="text-xs font-semibold">🎙️ Nota de voz</span>
                            <audio src={m.audioUrl} controls className="h-7 w-48" />
                          </div>
                        )}
                        {m.text && <FormattedChatMessage text={m.text} isUser={m.role === 'user'} />}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start items-center gap-2">
                      {stats.bot_avatar ? (
                        <img src={stats.bot_avatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#2e2e2e]" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: themeColor }}>
                          <Bot size={15} />
                        </div>
                      )}
                      <div className="px-3 py-1.5 bg-[#232323] border border-[#2e2e2e] rounded-md text-xs text-zinc-400 flex items-center gap-2">
                        <RefreshCw size={14} className="animate-spin" style={{ color: themeColor }} />
                        <span>Escuchando / Analizando y redactando respuesta...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Banner de archivo adjunto (Audio o Imagen) */}
                {(chatAudioBlobUrl || chatImagePreview) && (
                  <div className="px-3 py-1.5 bg-[#12141c] border-t border-[#2e2e2e] flex items-center justify-between text-xs text-zinc-300">
                    <div className="flex items-center gap-2">
                      {chatImagePreview && (
                        <div className="flex items-center gap-2">
                          <img src={chatImagePreview} alt="Preview" className="w-9 h-9 object-cover rounded-md border border-white/10" />
                          <span>🖼️ Comprobante / Imagen adjunta</span>
                        </div>
                      )}
                      {chatAudioBlobUrl && (
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-semibold">🎙️ Audio preparado</span>
                          <audio src={chatAudioBlobUrl} controls className="h-6 w-36" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setChatAudioBase64(null);
                        setChatAudioBlobUrl(null);
                        setChatImageBase64(null);
                        setChatImagePreview(null);
                      }}
                      className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-rose-400 transition-colors"
                      title="Quitar archivo adjunto"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}

                {/* Hidden File Inputs */}
                <input
                  type="file"
                  ref={chatImageInputRef}
                  onChange={handleImageFileUpload}
                  accept="image/*"
                  className="hidden"
                />
                <input
                  type="file"
                  ref={chatAudioInputRef}
                  onChange={handleAudioFileUpload}
                  accept="audio/*"
                  className="hidden"
                />

                {/* Input Bar */}
                <form onSubmit={handleSendMessage} className="p-4 bg-[#141414] border-t border-[#2e2e2e] flex items-center gap-2">
                  {/* Botón Adjuntar Imagen / Comprobante */}
                  <button
                    type="button"
                    onClick={() => chatImageInputRef.current?.click()}
                    title="Adjuntar comprobante de pago o imagen"
                    className="p-2 bg-[#1c1c1c] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-[#2e2e2e] rounded-md transition-colors shrink-0"
                  >
                    <ImageIcon size={18} />
                  </button>

                  {/* Botón Subir Archivo de Audio */}
                  <button
                    type="button"
                    onClick={() => chatAudioInputRef.current?.click()}
                    title="Subir archivo de audio o nota de voz"
                    className="p-2 bg-[#1c1c1c] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-[#2e2e2e] rounded-md transition-colors shrink-0"
                  >
                    <Paperclip size={18} />
                  </button>

                  {/* Botón Grabar Micrófono */}
                  <button
                    type="button"
                    onClick={isRecording ? stopRecordingAudio : startRecordingAudio}
                    title={isRecording ? 'Detener grabación' : 'Grabar nota de voz con micrófono'}
                    className={`p-2 rounded-md border transition-all shrink-0 flex items-center gap-1.5 text-xs font-semibold ${
                      isRecording
                        ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                        : 'bg-[#1c1c1c] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-[#2e2e2e]'
                    }`}
                  >
                    {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                    {isRecording && <span>Grabando...</span>}
                  </button>

                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder={
                      isRecording
                        ? 'Grabando audio de voz...'
                        : 'Escribe un mensaje, o prueba enviando una nota de voz / comprobante...'
                    }
                    className="flex-1 px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                  />

                  <button
                    type="submit"
                    disabled={isChatLoading || (!chatInput.trim() && !chatAudioBase64 && !chatImageBase64)}
                    style={{ backgroundColor: themeColor }}
                    className="px-3 py-1.5 text-zinc-950 font-medium rounded-md text-[13px] transition-all disabled:opacity-40 flex items-center gap-2 shrink-0 hover:brightness-110"
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
            <div className="space-y-6 animate-fadeIn pb-2">
              {/* Header de Sección */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Conexión WhatsApp Web & Gateway</h1>
                  <p className="text-sm text-zinc-400 mt-1">
                    Vincula tu número de WhatsApp para que el Asistente Operativo IA responda de forma autónoma con Baileys Multi-Device.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="http://localhost:3000/qr"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 rounded-md text-[13px] font-medium border border-[#2e2e2e] transition-all"
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
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#1c1c1c] hover:bg-zinc-800 border border-[#2e2e2e] text-zinc-200 rounded-md text-[13px] font-medium transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={isRefreshingWa ? 'animate-spin' : ''} style={{ color: themeColor }} />
                    <span>Actualizar</span>
                  </button>
                </div>
              </div>

              {/* Selector de canal: Baileys (QR) o Meta Cloud API oficial */}
              <WhatsAppChannelPanel
                themeColor={themeColor}
                showToast={showToast}
                onChannelChange={(channel) => {
                  setWaChannel(channel);
                  fetchWhatsAppStatus();
                }}
              />

              {/* Grid Principal */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">

                {/* Columna Izquierda: Estado de la Vinculación / Código QR (solo canal Baileys) */}
                {waChannel !== 'meta' && (
                <div className="lg:col-span-7 space-y-2">
                  <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
                    {/* Header de la tarjeta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-10 h-10 rounded-md flex items-center justify-center font-medium"
                          style={{
                            backgroundColor: `rgba(${themeRgb}, 0.14)`,
                            color: themeColor,
                            border: `1px solid rgba(${themeRgb}, 0.3)`
                          }}
                        >
                          <Smartphone size={20} />
                        </div>
                        <div>
                          <h2 className="text-base font-medium text-zinc-100">Estado de la Sesión</h2>
                          <p className="text-xs text-zinc-400">Línea de WhatsApp de: <strong className="text-zinc-200">{stats.company || 'Empresa Principal'}</strong></p>
                        </div>
                      </div>

                      {/* Status Pill */}
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold font-mono border ${
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
                      <div className="space-y-2 pt-2">
                        {/* Hero Card Conectado */}
                        <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md text-center space-y-2">
                          <div
                            className="w-16 h-16 rounded-md mx-auto flex items-center justify-center border-2"
                            style={{
                              backgroundColor: `rgba(${themeRgb}, 0.15)`,
                              borderColor: themeColor,
                              color: themeColor
                            }}
                          >
                            <CheckCircle2 size={36} />
                          </div>

                          <div>
                            <h3 className="text-lg font-medium text-white">Dispositivo Vinculado Exitosamente</h3>
                            <p className="text-xs text-zinc-400 mt-1">
                              El bot está activo y procesando mensajes entrantes en tiempo real con IA.
                            </p>
                          </div>

                          {/* Número y Badge */}
                          <div className="inline-flex items-center gap-2 bg-[#141414] border border-[#2e2e2e] px-4 py-3 rounded-md">
                            <span className="text-base">📱</span>
                            <span className="font-mono text-base font-medium text-white tracking-wide">
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
                          <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md flex items-center gap-2">
                            <Bot size={20} style={{ color: themeColor }} className="shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-medium tracking-wider">Motor Activo</span>
                              <span className="text-xs font-medium text-zinc-200 truncate block">
                                {stats.active_provider.toUpperCase()} ({stats.active_model})
                              </span>
                            </div>
                          </div>

                          <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md flex items-center gap-2">
                            <Zap size={20} className="text-amber-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-medium tracking-wider">In-Memory Hot Cache</span>
                              <span className="text-xs font-medium text-zinc-200 block">
                                &lt; 1 ms (Catálogo en RAM)
                              </span>
                            </div>
                          </div>

                          <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md flex items-center gap-2">
                            <ShieldCheck size={20} className="text-sky-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-medium tracking-wider">Reconexión Automática</span>
                              <span className="text-xs font-medium text-zinc-200 block">
                                Infinita con Backoff
                              </span>
                            </div>
                          </div>

                          <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md flex items-center gap-2">
                            <Clock size={20} className="text-purple-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-zinc-400 block uppercase font-medium tracking-wider">Handoff a Humano</span>
                              <span className="text-xs font-medium text-zinc-200 block">
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
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-md font-medium text-[13px] transition-all disabled:opacity-50"
                          >
                            <LogOut size={16} />
                            <span>{isLoggingOutWa ? 'Desvinculando Sesión...' : 'Desvincular Dispositivo de WhatsApp'}</span>
                          </button>
                        </div>
                      </div>
                    ) : waStatus.status === 'WAITING_QR' ? (
                      <div className="space-y-2 pt-2 text-center">
                        {/* Marco del Código QR */}
                        <div className="inline-block p-2 bg-white rounded-md border-2 border-zinc-700/60 mx-auto">
                          {waQrData.qrDataUrl ? (
                            <img
                              src={waQrData.qrDataUrl}
                              alt="Código QR WhatsApp"
                              className="w-60 h-60 block object-contain mx-auto rounded-md"
                            />
                          ) : (
                            <div className="w-60 h-60 flex flex-col items-center justify-center text-zinc-700">
                              <RefreshCw size={28} className="animate-spin mb-2" />
                              <span className="text-xs font-medium">Generando QR seguro...</span>
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-zinc-400 flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                          <span>Sondeo en vivo activo: se conectará automáticamente al escanear</span>
                        </div>

                        {/* Instrucciones de Escaneo */}
                        <div className="p-2 bg-[#232323] border border-[#2e2e2e] rounded-md text-left space-y-2">
                          <span className="text-xs font-medium text-zinc-300 block">
                            ¿Cómo vincular el WhatsApp de {stats.company || 'esta empresa'}?
                          </span>
                          <div className="space-y-2 text-xs text-zinc-300 leading-relaxed">
                            <div className="flex items-start gap-2">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-medium flex items-center justify-center shrink-0 text-[11px]">1</span>
                              <span>Abre <strong>WhatsApp</strong> en tu teléfono móvil.</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-medium flex items-center justify-center shrink-0 text-[11px]">2</span>
                              <span>Ve a <strong>Ajustes</strong> (iPhone) o pulsa <strong>Menú ⋮</strong> (Android) &gt; <strong>Dispositivos vinculados</strong>.</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 font-medium flex items-center justify-center shrink-0 text-[11px]">3</span>
                              <span>Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara al código QR de arriba.</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : waStatus.status === 'UNREACHABLE' || waStatus.status === 'NOT_CONFIGURED' ? (
                      <div className="py-4 text-center space-y-3">
                        <AlertCircle size={38} className="mx-auto text-amber-400" />
                        <div>
                          <h3 className="text-base font-semibold text-zinc-100">
                            Gateway de WhatsApp No Disponible
                          </h3>
                          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                            No se pudo contactar con el microservicio Baileys. Si esta sucursal usa su propio gateway, verifica que su contenedor esté corriendo.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          <button
                            onClick={fetchWhatsAppStatus}
                            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-md border border-[#2e2e2e] transition-all flex items-center gap-1.5"
                          >
                            <RefreshCw size={13} className={isRefreshingWa ? 'animate-spin' : ''} />
                            <span>Reintentar Conexión</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-3 text-center space-y-2">
                        <RefreshCw size={36} className="animate-spin mx-auto text-sky-400" />
                        <div>
                          <h3 className="text-base font-medium text-zinc-100">
                            {waStatus.status === 'CONNECTING' ? 'Estableciendo Conexión...' : 'Reconectando Socket...'}
                          </h3>
                          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                            Inicializando cliente Baileys Multi-Device e intentando enlazar socket seguro de WhatsApp.
                          </p>
                        </div>
                        <button
                          onClick={fetchWhatsAppStatus}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[13px] font-medium rounded-md border border-[#2e2e2e] transition-all"
                        >
                          Verificar Estado Ahora
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* Columna Derecha: Probador de Envíos en Vivo & Arquitectura */}
                <div className={`${waChannel === 'meta' ? 'lg:col-span-12' : 'lg:col-span-5'} space-y-2`}>
                  {/* Tarjeta 1: Enviar Mensaje de Prueba */}
                  <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
                    <div className="flex items-center gap-2">
                      <Send size={18} style={{ color: themeColor }} />
                      <h2 className="text-base font-medium text-zinc-100">Prueba de Envío Directo</h2>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Envía un mensaje de prueba a cualquier número de WhatsApp para comprobar la conexión activa del microservicio.
                    </p>

                    <form onSubmit={handleSendTestWa} className="space-y-2 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                          Número Destinatario (con código de país) *
                        </label>
                        <input
                          type="tel"
                          required
                          value={testWaPhone}
                          onChange={e => setTestWaPhone(e.target.value)}
                          placeholder="Ej: 50371234567 o +503 7123-4567"
                          className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                          Mensaje *
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={testWaMessage}
                          onChange={e => setTestWaMessage(e.target.value)}
                          placeholder="Escribe el mensaje de prueba..."
                          className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] focus:border-[#3ecf8e] rounded-md text-sm text-zinc-200 outline-none resize-none"
                        ></textarea>
                      </div>

                      <button
                        type="submit"
                        disabled={isSendingTestWa || (!waStatus.connected && waStatus.status !== 'CONNECTED')}
                        style={{ backgroundColor: themeColor }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-40 hover:brightness-110"
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
            <div className="space-y-6 animate-fadeIn pb-2">
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

              <div className="!mt-0 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Ajustes de Marca</h1>
                  <p className="text-sm text-zinc-400 mt-1">Configura logotipos, colores, identidad corporativa, números de contacto y claves de IA guardados en la Base de Datos.</p>
                </div>
                <div
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap self-start sm:self-auto border"
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

              {installedModules.includes('restaurant') && (
                <div
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-md border"
                  style={{ backgroundColor: `rgba(${themeRgb}, 0.06)`, borderColor: `rgba(${themeRgb}, 0.25)` }}
                >
                  <div className="flex items-start gap-2">
                    <UtensilsCrossed size={20} style={{ color: themeColor }} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-zinc-100">Módulo Restaurante activo en la IA</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        El asistente conoce tu menú, horarios, zonas y pagos, y registra pedidos en el panel. Configura cómo muestra el menú y toma pedidos.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setRestaurantSubTab('settings'); navigateTo('restaurant'); }}
                    className="px-3 py-1.5 rounded-md text-[13px] font-medium text-black whitespace-nowrap hover:brightness-110"
                    style={{ backgroundColor: themeColor }}
                  >
                    Configurar IA del restaurante
                  </button>
                </div>
              )}

              {installedModules.includes('services') && (
                <div
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-md border"
                  style={{ backgroundColor: `rgba(${themeRgb}, 0.06)`, borderColor: `rgba(${themeRgb}, 0.25)` }}
                >
                  <div className="flex items-start gap-2">
                    <Briefcase size={20} style={{ color: themeColor }} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-zinc-100">Módulo Servicios Profesionales activo en la IA</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        El asistente conoce tu catálogo de servicios, cotizaciones y califica prospectos comerciales.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setServicesSubTab('settings'); navigateTo('services'); }}
                    className="px-3 py-1.5 rounded-md text-[13px] font-medium text-black whitespace-nowrap hover:brightness-110"
                    style={{ backgroundColor: themeColor }}
                  >
                    Configurar IA de servicios
                  </button>
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-2">

                {/* ==========================================
                    SECCIÓN 1: IDENTIDAD VISUAL & LOGOTIPOS
                    ========================================== */}
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
                    <div className="flex items-center gap-2 text-zinc-200 font-medium text-base">
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

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

                    {/* Logo de la Empresa */}
                    <div className="p-4 bg-[#141414] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-2">Logo de la Empresa / Marca</label>
                        <p className="text-xs text-zinc-500 mb-2">Se muestra en el encabezado de la barra lateral y reportes.</p>

                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-20 h-20 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
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
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[13px] font-medium rounded-md border border-zinc-700 transition-colors"
                            >
                              <Upload size={14} />
                              <span>{settingsForm.company_logo ? 'Cambiar Logo' : 'Subir Archivo'}</span>
                            </button>
                            {settingsForm.company_logo && (
                              <button
                                type="button"
                                onClick={() => handleRemoveImage('company_logo')}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[13px] rounded-md border border-rose-500/20 transition-colors"
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
                          className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    {/* Avatar del Asistente */}
                    <div className="p-4 bg-[#141414] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-2">Avatar del Asistente IA</label>
                        <p className="text-xs text-zinc-500 mb-2">Aparece en cada mensaje del asistente en el chat y WhatsApp.</p>

                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="w-20 h-20 rounded-full border-2 flex items-center justify-center overflow-hidden shrink-0"
                            style={{ borderColor: themeColor, backgroundColor: '#232323' }}
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
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[13px] font-medium rounded-md border border-zinc-700 transition-colors"
                            >
                              <Upload size={14} />
                              <span>{settingsForm.bot_avatar ? 'Cambiar Avatar' : 'Subir Archivo'}</span>
                            </button>
                            {settingsForm.bot_avatar && (
                              <button
                                type="button"
                                onClick={() => handleRemoveImage('bot_avatar')}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[13px] rounded-md border border-rose-500/20 transition-colors"
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
                          className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none"
                        />
                      </div>
                    </div>

                    {/* Paleta de Color de la Marca */}
                    <div className="p-4 bg-[#141414] border border-[#2e2e2e] rounded-md flex flex-col justify-between">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-2">Color de Acento de la Marca</label>
                        <p className="text-xs text-zinc-500 mb-2">Define los acentos visuales, botones, badges e indicadores del sistema.</p>

                        <div className="grid grid-cols-4 gap-3 mb-2">
                          {BRAND_COLOR_PRESETS.map(p => (
                            <button
                              key={p.hex}
                              type="button"
                              onClick={() => setSettingsForm(prev => ({ ...prev, primary_color: p.hex }))}
                              className={`h-8 rounded-md flex items-center justify-center transition-transform hover:scale-105 border ${settingsForm.primary_color?.toLowerCase() === p.hex.toLowerCase()
                                  ? 'border-white ring-2 ring-white/40 scale-105'
                                  : 'border-transparent'
                                }`}
                              style={{ backgroundColor: p.hex }}
                              title={p.name}
                            >
                              {settingsForm.primary_color?.toLowerCase() === p.hex.toLowerCase() && (
                                <CheckCircle2 size={14} className="text-zinc-950 font-medium" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[#2e2e2e]">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={settingsForm.primary_color || '#3ecf8e'}
                            onChange={e => setSettingsForm(prev => ({ ...prev, primary_color: e.target.value }))}
                            className="w-9 h-9 rounded-md cursor-pointer bg-transparent border-0"
                            title="Seleccionar color personalizado"
                          />
                          <input
                            type="text"
                            value={settingsForm.primary_color || '#3ecf8e'}
                            onChange={e => setSettingsForm(prev => ({ ...prev, primary_color: e.target.value }))}
                            placeholder="#3ecf8e"
                            className="flex-1 px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-xs font-mono text-zinc-200 outline-none"
                          />
                        </div>
                        <div
                          className="px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center justify-between text-zinc-950"
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
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                  <div className="flex items-center gap-2 text-zinc-200 font-medium text-base pb-2 border-b border-[#2e2e2e]">
                    <Building size={18} style={{ color: themeColor }} />
                    <span>Identidad Corporativa & Canales de Contacto</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Nombre de la Empresa o Marca *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.company_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, company_name: e.target.value }))}
                        placeholder="Ej: Fantasma Digital / Zenith Studio"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Aparece en los saludos del bot, encabezados y firma.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Nombre del Asistente IA *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.bot_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, bot_name: e.target.value }))}
                        placeholder="Ej: Asistente Operativo / GhostBot"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Nombre con el que el bot se presenta a los usuarios.</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-zinc-300">
                          Teléfono / WhatsApp de Soporte Humano
                        </label>
                      </div>

                      <div className="relative">
                        <input
                          type="text"
                          value={settingsForm.support_phone}
                          onChange={e => setSettingsForm(prev => ({ ...prev, support_phone: e.target.value }))}
                          placeholder={settingsForm.detected_whatsapp_phone ? `Automático (${settingsForm.detected_whatsapp_phone})` : 'Dejar vacío para usar el mismo WhatsApp conectado'}
                          className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500 font-mono"
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
                              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md text-[11px] transition-colors border border-zinc-700"
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
                              className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 text-[#3ecf8e] rounded-md text-[11px] transition-colors border border-emerald-800/50"
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
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Sitio Web Oficial / Tienda</label>
                      <input
                        type="url"
                        value={settingsForm.website_url}
                        onChange={e => setSettingsForm(prev => ({ ...prev, website_url: e.target.value }))}
                        placeholder="https://tuempresa.com"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">URL oficial referenciada por el bot en cotizaciones y consultas.</span>
                    </div>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 3: CONTROL DE AGENTES HUMANOS & HANDOFF (INACTIVIDAD)
                    ========================================== */}
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
                    <div className="flex items-center gap-2 text-zinc-200 font-medium text-base">
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

                  <div className="p-4 bg-[#141414] border border-[#2e2e2e] rounded-md space-y-2">
                    <div className="flex items-start gap-2">
                      <div
                        className="p-2 rounded-md shrink-0 mt-0.5"
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

                    <div className="pt-2 border-t border-[#2e2e2e]">
                      <label className="block text-xs font-medium text-zinc-300 mb-2">
                        Tiempo de Inactividad para Reactivar la IA (en Horas)
                      </label>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex items-center gap-2 max-w-xs">
                          <input
                            type="number"
                            min="0.5"
                            max="72"
                            step="0.5"
                            value={settingsForm.handoff_inactivity_hours ?? 6.0}
                            onChange={e => setSettingsForm(prev => ({ ...prev, handoff_inactivity_hours: parseFloat(e.target.value) || 6.0 }))}
                            className="w-28 px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-sm text-zinc-100 font-mono outline-none focus:border-zinc-500"
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
                              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
                                Number(settingsForm.handoff_inactivity_hours) === h
                                  ? 'text-zinc-950 font-medium shadow-sm'
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
                        <div className="mt-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-amber-300">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                            <span>Hay <strong>{activeHandoffs.length}</strong> usuario(s) con la IA pausada actualmente en atención humana.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigateTo('handoffs')}
                            className="text-xs font-medium text-amber-400 hover:text-amber-300 underline underline-offset-2 flex items-center gap-1 shrink-0"
                          >
                            <span>Ver y Despausar en el Panel</span>
                            <ExternalLink size={12} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-[#2e2e2e]">
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Mensaje de Transferencia a Humano</label>
                      <textarea
                        rows={2}
                        value={settingsForm.transfer_message}
                        onChange={e => setSettingsForm(prev => ({ ...prev, transfer_message: e.target.value }))}
                        placeholder="Ej: He notificado a nuestro equipo humano. En unos momentos uno de nuestros especialistas continuará tu atención por este chat."
                        className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none font-sans focus:border-zinc-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Respuesta automática enviada cuando el cliente solicita comunicarse con un asesor real.</span>
                    </div>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 4: PERSONALIDAD COMERCIAL & MÓDULOS
                    ========================================== */}
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                  <div className="flex items-center gap-2 text-zinc-200 font-medium text-base pb-2 border-b border-[#2e2e2e]">
                    <Layers size={18} style={{ color: themeColor }} />
                    <span>Personalidad Comercial & Módulos</span>
                  </div>
                  <div className="p-3 bg-[#141414] border border-[#242424] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      El tono de atención, saludo inicial de ventas, catálogo y directrices comerciales se configuran dentro de tu módulo activo (<strong>Servicios Profesionales</strong>, <strong>Restaurante</strong>, etc.).
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] text-zinc-200 border border-[#3e3e3e] transition-colors shrink-0 flex items-center gap-1.5 self-start sm:self-auto"
                    >
                      <Layers size={13} />
                      <span>Gestionar Módulos</span>
                    </button>
                  </div>
                </div>

                {/* ==========================================
                    SECCIÓN 4: MOTORES DE IA, CLAVES & RED
                    ========================================== */}
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md space-y-2">
                  <div className="flex items-center gap-2 text-zinc-200 font-medium text-base pb-2 border-b border-[#2e2e2e]">
                    <Key size={18} style={{ color: themeColor }} />
                    <span>Motores de IA, Claves API & Red</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Proveedor Principal de IA</label>
                      <select
                        value={settingsForm.ai_provider}
                        onChange={e => setSettingsForm(prev => ({ ...prev, ai_provider: e.target.value }))}
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.ai_provider && <option value="">-- Seleccionar Proveedor --</option>}
                        <option value="gemini">Google Gemini (Recomendado - Ultra Rápido)</option>
                        <option value="openai">OpenAI (GPT-4o Mini / GPT-4o)</option>
                      </select>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Failover automático: si uno falla por cuota o red, el otro responde.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Modelo de Google Gemini</label>
                      <select
                        value={settingsForm.gemini_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, gemini_model: e.target.value }))}
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.gemini_model && <option value="">-- Seleccionar Modelo Gemini --</option>}
                        <option value="gemini-2.5-flash">gemini-2.5-flash (Última generación - Máxima velocidad)</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro (Razonamiento complejo)</option>
                        <option value="gemini-1.5-flash">gemini-1.5-flash (Versión previa)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Google Gemini API Key</label>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={settingsForm.gemini_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, gemini_api_key: e.target.value }))}
                          placeholder="AIzaSy..."
                          className="w-full pl-3 pr-10 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
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
                      <label className="block text-xs font-medium text-zinc-300 mb-2">OpenAI API Key (Respaldo)</label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          value={settingsForm.openai_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, openai_api_key: e.target.value }))}
                          placeholder="sk-proj-..."
                          className="w-full pl-3 pr-10 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
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
                      <label className="block text-xs font-medium text-zinc-300 mb-2">Modelo de OpenAI</label>
                      <select
                        value={settingsForm.openai_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, openai_model: e.target.value }))}
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {!settingsForm.openai_model && <option value="">-- Seleccionar Modelo OpenAI --</option>}
                        <option value="gpt-4o-mini">gpt-4o-mini (Rápido y económico)</option>
                        <option value="gpt-4o">gpt-4o (Modelo insignia)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-2">WhatsApp Gateway URL (Microservicio)</label>
                      <input
                        type="text"
                        value={settingsForm.whatsapp_gateway_url}
                        onChange={e => setSettingsForm(prev => ({ ...prev, whatsapp_gateway_url: e.target.value }))}
                        placeholder="http://localhost:3000 o http://whatsapp-gateway:3000"
                        className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-200 outline-none font-mono focus:border-zinc-500"
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
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-50 hover:brightness-110 hover:"
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
            <div className="space-y-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-xl font-medium tracking-tight text-zinc-100">Usuarios con IA pausada</h1>
                  <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
                    Chats atendidos por un asesor. La IA no responde hasta que la reactives.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={fetchActiveHandoffs}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#121212] hover:bg-zinc-800 border border-[#2e2e2e] rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
                  >
                    <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                    <span>Actualizar</span>
                  </button>

                  <button
                    onClick={() => setShowManualPauseModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#121212] hover:bg-zinc-800 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-md text-[13px] font-medium transition-colors"
                  >
                    <Pause size={14} />
                    <span>+ Pausar IA a un Número</span>
                  </button>

                  <button
                    onClick={handleReleaseAllHandoffs}
                    disabled={activeHandoffs.length === 0 || isReleasingAll}
                    style={activeHandoffs.length > 0 ? { backgroundColor: themeColor } : {}}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-950 font-medium text-[13px] rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-medium text-zinc-500 block mb-1">IA Pausada Activa</span>
                    <span className="text-2xl font-semibold text-amber-400 font-mono">{activeHandoffs.length}</span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">clientes en manos de asesor</span>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <UserX size={20} />
                  </div>
                </div>

                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-medium text-zinc-500 block mb-1">Ventana de Inactividad</span>
                    <span className="text-2xl font-semibold text-zinc-100 font-mono">{stats.handoff_inactivity_hours ?? 6.0}h</span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">reactivación autónoma</span>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-zinc-800/80 border border-[#2e2e2e] flex items-center justify-center text-zinc-400">
                    <Clock size={20} />
                  </div>
                </div>

                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-medium text-zinc-500 block mb-1">Canal WhatsApp</span>
                    <span className="text-base font-medium text-zinc-200 block truncate">
                      {stats.wa_connected || stats.gateway_state === 'CONNECTED' ? 'En Línea & Conectado' : 'Desconectado'}
                    </span>
                    <span className="text-[11px] text-zinc-500 block mt-0.5">
                      {stats.effective_support_phone || 'Línea de soporte'}
                    </span>
                  </div>
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
                    stats.wa_connected || stats.gateway_state === 'CONNECTED'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-850 text-zinc-500 border border-zinc-750'
                  }`}>
                    <MessageCircle size={20} />
                  </div>
                </div>
              </div>

              {/* Filtro / Buscador */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="relative flex-1 max-w-md">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={handoffSearch}
                    onChange={e => setHandoffSearch(e.target.value)}
                    placeholder="Buscar por teléfono, sesión o motivo..."
                    className="w-full pl-10 pr-3 py-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none focus:border-zinc-500 font-sans"
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
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-center space-y-2 shadow-sm">
                  <div
                    className="w-16 h-16 rounded-md mx-auto flex items-center justify-center border border-[#2e2e2e]"
                    style={{ backgroundColor: `rgba(${themeRgb}, 0.1)`, color: themeColor }}
                  >
                    <CheckCircle2 size={32} />
                  </div>
                  <div className="max-w-md mx-auto">
                    <h3 className="text-base font-medium text-zinc-100">Ningún usuario tiene la IA pausada</h3>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      Todas las conversaciones están siendo atendidas de forma 100% automatizada por la IA. En cuanto un cliente solicite un asesor humano o intervengas, aparecerá listado aquí en tiempo real para que puedas despausarlo con un solo clic.
                    </p>
                  </div>
                  <div className="pt-2 flex justify-center gap-2">
                    <button
                      onClick={() => setShowManualPauseModal(true)}
                      className="px-3 py-1.5 rounded-md bg-[#121212] border border-[#2e2e2e] hover:bg-zinc-800 text-[13px] font-medium text-zinc-300 transition-colors"
                    >
                      + Pausar IA a un número de prueba
                    </button>
                    <button
                      onClick={() => navigateTo('chat')}
                      style={{ color: themeColor }}
                      className="px-3 py-1.5 rounded-md bg-[#121212] border border-[#2e2e2e] hover:bg-zinc-800 text-[13px] font-medium transition-colors flex items-center gap-1.5"
                    >
                      <span>Ir al Simulador de Chat</span>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              ) : filteredHandoffs.length === 0 ? (
                <div className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-center text-zinc-400 text-xs">
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
                        className="p-4 bg-[#1c1c1c] border border-[#2e2e2e] hover:border-zinc-700/60 rounded-md transition-all flex flex-col justify-between gap-2 group"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                              <Pause size={18} />
                            </div>

                            <div className="min-w-0 space-y-1.5 flex-1">
                              {/* Teléfono, Badges de Pausa y Tag Directo */}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-medium text-sm text-zinc-100 flex items-center gap-1.5">
                                  {isWhatsAppLid ? sid : (cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`)}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(cleanPhone);
                                    showToast('Número copiado al portapapeles');
                                  }}
                                  className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded-md transition-colors"
                                  title="Copiar identificador"
                                >
                                  <Copy size={13} />
                                </button>
                                <span className="text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  ⏸️ IA Pausada
                                </span>
                                <span className={`text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded-full border ${getTagBadgeStyle(currentTag)}`}>
                                  🏷️ {currentTag}
                                </span>
                              </div>

                              {/* Metadatos: Motivo y Horas Restantes */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
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
                                <div className="mt-2 p-2 rounded-md bg-[#121212] border border-amber-500/20 text-xs text-zinc-200">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[10px] font-medium text-amber-400 flex items-center gap-1.5">
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
                              className="px-3 py-1.5 bg-[#121212] hover:bg-zinc-800 border border-[#2e2e2e] rounded-md text-[13px] text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5"
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
                              className="px-3 py-1.5 bg-[#121212] hover:bg-zinc-800 border border-[#2e2e2e] rounded-md text-[13px] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
                              title="Probar en simulador de chat"
                            >
                              <MessageSquare size={13} />
                              <span>Simulador</span>
                            </button>

                            <button
                              onClick={() => handleReleaseHandoff(sid)}
                              disabled={isReleasing}
                              style={{ backgroundColor: themeColor }}
                              className="inline-flex items-center gap-2 px-3 py-1.5 text-zinc-950 font-medium text-[13px] rounded-md transition-all hover:brightness-110 disabled:opacity-50"
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
            {/* ==============================================================
                TAB: GESTOR DE MÓDULOS (ECOSISTEMA TIPO ODOO)
                ============================================================== */}
            {activeTab === 'tenants' && isSuperadmin() && (
              <TenantsPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                actingTenant={getActingTenant()}
                onOperate={(slug, targetTab) => {
                  const targetSlug = slug === 'default' ? '' : slug;
                  setActingTenant(targetSlug);
                  const tab = ['library', 'whatsapp'].includes(targetTab) ? targetTab : 'restaurant';
                  const path = buildPath(tab, null, targetSlug);
                  window.location.assign(path);
                }}
                onTenantDeleted={(slug) => {
                  // Si se estaba operando la empresa eliminada, volver a la plataforma
                  if (getActingTenant() === slug) {
                    setActingTenant('');
                    window.location.assign('/tenants');
                  }
                }}
                showToast={showToast}
              />
            )}

            {activeTab === 'users' && canManageUsers() && (
              <UsersPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                currentUserId={getCurrentUserId()}
              />
            )}

            {activeTab === 'modules' && !isSuperadmin() && (
              <div className="max-w-xl bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 text-sm text-zinc-300 space-y-1">
                <div className="font-medium text-zinc-100">Módulos gestionados por la plataforma</div>
                <p className="text-zinc-400">Solo el administrador de la plataforma puede agregar o quitar módulos a tu empresa. Contáctalo si necesitas uno nuevo.</p>
              </div>
            )}

            {activeTab === 'modules' && isSuperadmin() && (
              <ModulesPanel
                targetTenant={getActingTenant() || 'default'}
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                themeRgb={themeRgb}
                installedModules={installedModules}
                onModulesChange={fetchInstalledModules}
                navigateTo={navigateTo}
                showToast={showToast}
              />
            )}

            {/* ==============================================================
                TAB: RESTAURANTE & PEDIDOS (MÓDULO OFICIAL - SOLO SI ESTÁ INSTALADO)
                ============================================================== */}
            {activeTab === 'restaurant' && installedModules.includes('restaurant') && restaurantSubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.restaurant} themeColor={themeColor} onOpenSection={setRestaurantSubTab} />
            )}
            {activeTab === 'restaurant' && installedModules.includes('restaurant') && restaurantSubTab !== 'guide' && (
              <RestaurantPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                themeRgb={themeRgb}
                showToast={showToast}
                initialSubTab={restaurantSubTab}
                onSubTabChange={setRestaurantSubTab}
                isInventoryInstalled={installedModules.includes('inventory')}
                isInvoicingInstalled={installedModules.includes('invoicing')}
                isIotInstalled={installedModules.includes('iot_printing')}
                onNavigateToInventory={() => { setInventorySubTab('stock'); navigateTo('inventory'); }}
              />
            )}
            {/* TAB: CAJA & FINANZAS (MÓDULO OFICIAL - SOLO SI ESTÁ INSTALADO) */}
            {activeTab === 'agent' && (
              <AgentPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                subTab={agentSubTab}
                onChanged={fetchPendingApprovals}
                onOpenCustomer={(id) => { setCustomerId(String(id)); navigateTo('customers'); }}
              />
            )}
            {activeTab === 'inbox' && (
              <InboxPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                conversationId={inboxId}
                onSelect={(id) => setInboxId(String(id))}
                onOpenCustomer={(id) => { setCustomerId(String(id)); navigateTo('customers'); }}
              />
            )}
            {activeTab === 'customers' && (
              <CustomersPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                customerId={customerId}
                onOpen={(id) => setCustomerId(id ? String(id) : null)}
              />
            )}
            {activeTab === 'finance' && installedModules.includes('finance') && financeSubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.finance} themeColor={themeColor} onOpenSection={setFinanceSubTab} />
            )}
            {activeTab === 'finance' && installedModules.includes('finance') && financeSubTab !== 'guide' && (
              <FinancePanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                themeRgb={themeRgb}
                showToast={showToast}
                subTab={financeSubTab}
                setSubTab={setFinanceSubTab}
              />
            )}
            {activeTab === 'inventory' && installedModules.includes('inventory') && inventorySubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.inventory} themeColor={themeColor} onOpenSection={setInventorySubTab} />
            )}
            {activeTab === 'inventory' && installedModules.includes('inventory') && inventorySubTab !== 'guide' && (
              <InventoryPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                themeRgb={themeRgb}
                showToast={showToast}
                subTab={inventorySubTab}
                setSubTab={setInventorySubTab}
                navigateTo={navigateTo}
              />
            )}
            {activeTab === 'loyalty' && installedModules.includes('loyalty') && loyaltySubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.loyalty} themeColor={themeColor} onOpenSection={() => setLoyaltySubTab('pos')} />
            )}
            {activeTab === 'loyalty' && installedModules.includes('loyalty') && loyaltySubTab !== 'guide' && (
              <LoyaltyPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                subTab={loyaltySubTab}
                setSubTab={setLoyaltySubTab}
                tenantSlug={getActingTenant() || getStoredAuth().tenant || 'default'}
                companyName={stats.company}
              />
            )}
            {activeTab === 'invoicing' && installedModules.includes('invoicing') && invoicingSubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.invoicing} themeColor={themeColor} onOpenSection={setInvoicingSubTab} />
            )}
            {activeTab === 'invoicing' && installedModules.includes('invoicing') && invoicingSubTab !== 'guide' && (
              <InvoicingPanel
                apiBase={API_BASE}
                themeColor={themeColor}
                subTab={invoicingSubTab}
                setSubTab={setInvoicingSubTab}
                isIotInstalled={installedModules.includes('iot_printing')}
              />
            )}
            {activeTab === 'iot_printing' && installedModules.includes('iot_printing') && iotSubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.iot_printing} themeColor={themeColor} onOpenSection={setIotSubTab} />
            )}
            {activeTab === 'iot_printing' && installedModules.includes('iot_printing') && iotSubTab !== 'guide' && (
              <IotPrintingPanel
                apiBase={API_BASE}
                themeColor={themeColor}
                subTab={iotSubTab}
                setSubTab={setIotSubTab}
              />
            )}
            {activeTab === 'services' && installedModules.includes('services') && servicesSubTab === 'guide' && (
              <ModuleGuide manifest={moduleManifests.services} themeColor={themeColor} onOpenSection={setServicesSubTab} />
            )}
            {activeTab === 'services' && installedModules.includes('services') && servicesSubTab !== 'guide' && (
              <ServicesPanel
                apiFetch={apiFetch}
                apiBase={API_BASE}
                themeColor={themeColor}
                showToast={showToast}
                subTab={servicesSubTab}
                setSubTab={setServicesSubTab}
              />
            )}
        </main>
      </div>

      {/* Modal para pausar manualmente a un usuario */}
      {showManualPauseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2">
          <div className="bg-[#1c1c1c] border border-[#2e2e2e] rounded-md max-w-md w-full animate-scaleUp">
            <div className="p-2 border-b border-[#2e2e2e] flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-medium text-sm">
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
            <form onSubmit={handlePauseHandoffManual} className="p-2 space-y-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Número de Teléfono o ID de Sesión
                </label>
                <input
                  type="text"
                  required
                  value={manualPausePhone}
                  onChange={e => setManualPausePhone(e.target.value)}
                  placeholder="Ej: +50371234567 o 50371234567"
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-sm text-zinc-100 outline-none font-mono focus:border-amber-400/50"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">Número de WhatsApp del cliente con código de país.</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Motivo de la Pausa
                </label>
                <input
                  type="text"
                  value={manualPauseReason}
                  onChange={e => setManualPauseReason(e.target.value)}
                  placeholder="Ej: Atención personalizada con asesor comercial"
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Etiqueta Directa del Chat (Tag)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {HANDOFF_TAG_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setManualPauseTag(t)}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all ${
                        manualPauseTag === t
                          ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                          : 'border-[#2e2e2e] bg-[#141414] text-zinc-400 hover:text-zinc-200'
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
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-100 font-mono outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Nota para el Asesor (Lo que el cliente busca)
                </label>
                <textarea
                  rows={2}
                  value={manualPauseNotes}
                  onChange={e => setManualPauseNotes(e.target.value)}
                  placeholder="Ej: El cliente desea cotización de paquetes empresariales."
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none focus:border-amber-400/50 resize-none font-sans"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualPauseModal(false)}
                  className="px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-[13px] font-medium text-zinc-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPausingManual}
                  className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-[13px] transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2">
          <div className="bg-[#1c1c1c] border border-[#2e2e2e] rounded-md max-w-lg w-full animate-scaleUp">
            <div className="p-2 border-b border-[#2e2e2e] flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-medium text-sm">
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

            <div className="p-2 space-y-2">
              <div className="flex items-center justify-between p-4 rounded-md bg-[#141414] border border-[#2e2e2e]">
                <span className="text-xs text-zinc-400 font-medium">Cliente / Sesión:</span>
                <span className="font-mono text-xs font-medium text-zinc-100">{editingHandoff.session_id}</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">
                  Etiqueta Directa del Chat (Tag)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {HANDOFF_TAG_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEditTag(t)}
                      className={`text-[11px] font-medium px-3 py-1 rounded-md border transition-all ${
                        editTag === t
                          ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                          : 'border-[#2e2e2e] bg-[#141414] text-zinc-400 hover:text-zinc-200'
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
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-100 font-mono outline-none focus:border-amber-400/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center justify-between">
                  <span>Nota Ejecutiva para el Asesor</span>
                  <span className="text-[10px] text-zinc-500 font-normal">¿Qué busca o necesita el cliente?</span>
                </label>
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Escribe el resumen de lo que el cliente requiere para que el asesor lo sepa de inmediato..."
                  className="w-full px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-md text-xs text-zinc-200 outline-none leading-relaxed focus:border-amber-400/50 font-sans resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingHandoff(null)}
                  className="px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-[13px] font-medium text-zinc-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => handleUpdateHandoffMeta(editingHandoff.session_id)}
                  className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-[13px] transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2">
          <div className="bg-[#1c1c1c] border border-[#2e2e2e] rounded-md max-w-2xl w-full max-h-[85vh] flex flex-col animate-scaleUp">
            <div className="p-2 border-b border-[#2e2e2e] flex items-center justify-between">
              <h3 className="font-medium text-base text-zinc-100 truncate pr-2">{selectedDoc.title}</h3>
              <button
                onClick={() => setSelectedDoc(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-2 overflow-y-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed select-text">
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
          className={`fixed bottom-6 right-6 z-50 px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-2 bg-[#1f1f1f] text-white border-l-4 ${toast.isError ? 'border-red-500' : ''}`}
        >
          {toast.isError ? <AlertCircle size={18} className="text-red-400" /> : <CheckCircle2 size={18} style={{ color: themeColor }} />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}

// ==============================================================
// CANAL DE WHATSAPP: BAILEYS (QR) O META CLOUD API OFICIAL
// ==============================================================
const META_FIELDS = [
  'meta_access_token', 'meta_phone_number_id', 'meta_waba_id',
  'meta_verify_token', 'meta_app_secret', 'meta_api_version', 'public_base_url'
];

const CHANNEL_OPTIONS = [
  {
    id: 'baileys',
    title: 'WhatsApp Web (Baileys)',
    badge: 'Económico',
    description: 'Se vincula escaneando un QR. Sin costo por mensaje, pero no es oficial: WhatsApp puede bloquear el número. Usa un número dedicado.',
    icon: QrCode
  },
  {
    id: 'meta',
    title: 'Meta Cloud API (oficial)',
    badge: 'Recomendado para clientes serios',
    description: 'API oficial de WhatsApp Business. Sin riesgo de bloqueo; responder a clientes es gratis y solo se pagan plantillas enviadas por el negocio.',
    icon: ShieldCheck
  }
];

const generateVerifyToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return 'zenith_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

function SecretInput({ value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-zinc-500 rounded-md pl-3 pr-10 py-2 text-sm font-mono outline-none transition-colors"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        aria-label={visible ? 'Ocultar' : 'Mostrar'}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function ChannelField({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

function WhatsAppChannelPanel({ themeColor, showToast, onChannelChange }) {
  const [channel, setChannel] = useState('baileys');
  const [savedChannel, setSavedChannel] = useState('baileys');
  const [form, setForm] = useState(() => Object.fromEntries(META_FIELDS.map(f => [f, ''])));
  const [info, setInfo] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  const loadChannel = async () => {
    try {
      const [settingsRes, infoRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/settings`),
        apiFetch(`${API_BASE}/api/whatsapp/channel`)
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const active = data.whatsapp_channel === 'meta' ? 'meta' : 'baileys';
        setChannel(active);
        setSavedChannel(active);
        setForm(Object.fromEntries(META_FIELDS.map(f => [f, data[f] || ''])));
        onChannelChange(active);
      }
      if (infoRes.ok) setInfo(await infoRes.json());
    } catch (err) {
      console.warn('Error cargando el canal de WhatsApp:', err);
    }
  };

  useEffect(() => {
    loadChannel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const copyValue = async (field, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    } catch {
      showToast('No se pudo copiar al portapapeles.', true);
    }
  };

  const handleSave = async () => {
    if (channel === 'meta' && (!form.meta_access_token || !form.meta_phone_number_id)) {
      showToast('Para activar Meta necesitas al menos el token de acceso y el Phone Number ID.', true);
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp_channel: channel, ...form })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Revisa los datos ingresados.');
      }
      showToast(channel === 'meta'
        ? '✅ Canal Meta Cloud API activado. Baileys deja de responder mensajes.'
        : '✅ Canal WhatsApp Web (Baileys) activado.');
      await loadChannel();
    } catch (err) {
      showToast('Error al guardar el canal: ' + err.message, true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/whatsapp/meta/test`, { method: 'POST' });
      setTestResult(await res.json());
    } catch (err) {
      setTestResult({ connected: false, error: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  const webhookUrl = info?.meta?.webhook_url || '';
  const missing = info?.meta?.missing_fields || [];
  const hasUnsavedChannel = channel !== savedChannel;

  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium text-zinc-100">Canal de WhatsApp</h2>
          <p className="text-xs text-zinc-400">
            Elige cómo se conecta el asistente. Activo ahora:{' '}
            <span className="font-semibold" style={{ color: themeColor }}>
              {savedChannel === 'meta' ? 'Meta Cloud API' : 'WhatsApp Web (Baileys)'}
            </span>
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium text-black disabled:opacity-50 transition-all"
          style={{ backgroundColor: themeColor }}
        >
          {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
          {hasUnsavedChannel ? 'Guardar y cambiar de canal' : 'Guardar configuración'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CHANNEL_OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = channel === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setChannel(option.id)}
              className={`text-left p-2 rounded-md border transition-all ${selected ? 'bg-white/[0.03]' : 'border-[#2e2e2e] hover:border-zinc-600'}`}
              style={selected ? { borderColor: themeColor } : undefined}
              aria-pressed={selected}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon size={18} style={{ color: selected ? themeColor : undefined }} className={selected ? '' : 'text-zinc-400'} />
                  <span className="text-sm font-medium text-zinc-100">{option.title}</span>
                </div>
                {selected ? <CheckCircle2 size={16} style={{ color: themeColor }} /> : <span className="w-4 h-4 rounded-full border border-zinc-600" />}
              </div>
              <span className="inline-block mt-2 text-[10px] font-medium px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300">
                {option.badge}
              </span>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{option.description}</p>
            </button>
          );
        })}
      </div>

      {channel === 'baileys' && (
        <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Baileys no es una API oficial. Usa un número dedicado (no el personal del dueño) y avisa al cliente del riesgo de bloqueo.
            {savedChannel === 'baileys' && ' Vincula el número con el código QR de abajo.'}
          </span>
        </div>
      )}

      {channel === 'meta' && (
        <div className="space-y-2">
          <ol className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-zinc-400">
            {[
              <>En <a className="underline hover:text-zinc-200" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a> crea una app de tipo Business y agrega el producto WhatsApp.</>,
              <>En WhatsApp → Configuración de la API copia el <b className="text-zinc-300">Phone Number ID</b>. Crea un usuario del sistema en Business Manager y genera un <b className="text-zinc-300">token permanente</b>.</>,
              <>En Configuración de la app → Básica copia el <b className="text-zinc-300">App Secret</b> (protege el webhook).</>,
              <>En WhatsApp → Configuración pega la <b className="text-zinc-300">URL del webhook</b> y el <b className="text-zinc-300">token de verificación</b>, y suscríbete al campo <code>messages</code>.</>
            ].map((step, i) => (
              <li key={i} className="flex gap-2 p-2 bg-[#121212] border border-[#2e2e2e] rounded-md">
                <span className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-medium text-black" style={{ backgroundColor: themeColor }}>{i + 1}</span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ChannelField label="Token de acceso permanente" hint="Si ves ••••, ya hay un token guardado. Escribe uno nuevo solo para reemplazarlo.">
              <SecretInput value={form.meta_access_token} onChange={v => setField('meta_access_token', v)} placeholder="EAAG..." />
            </ChannelField>
            <ChannelField label="Phone Number ID">
              <input
                value={form.meta_phone_number_id}
                onChange={e => setField('meta_phone_number_id', e.target.value)}
                placeholder="Ej. 109876543210987"
                className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-zinc-500 rounded-md px-3 py-2 text-sm font-mono outline-none transition-colors"
              />
            </ChannelField>
            <ChannelField label="App Secret" hint="Sin App Secret el backend rechaza todos los mensajes del webhook.">
              <SecretInput value={form.meta_app_secret} onChange={v => setField('meta_app_secret', v)} placeholder="App Secret de la app de Meta" />
            </ChannelField>
            <ChannelField label="WhatsApp Business Account ID (opcional)">
              <input
                value={form.meta_waba_id}
                onChange={e => setField('meta_waba_id', e.target.value)}
                placeholder="Para plantillas y métricas"
                className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-zinc-500 rounded-md px-3 py-2 text-sm font-mono outline-none transition-colors"
              />
            </ChannelField>
            <ChannelField label="URL pública del backend (HTTPS)" hint="Dominio con HTTPS que apunta a este backend (por ejemplo, con Caddy o Cloudflare Tunnel).">
              <input
                value={form.public_base_url}
                onChange={e => setField('public_base_url', e.target.value)}
                placeholder="https://bot.tuempresa.com"
                className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-zinc-500 rounded-md px-3 py-2 text-sm font-mono outline-none transition-colors"
              />
            </ChannelField>
            <ChannelField label="Versión de Graph API">
              <input
                value={form.meta_api_version}
                onChange={e => setField('meta_api_version', e.target.value)}
                placeholder="v21.0"
                className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-zinc-500 rounded-md px-3 py-2 text-sm font-mono outline-none transition-colors"
              />
            </ChannelField>
          </div>

          <div className="p-2 bg-[#121212] border border-[#2e2e2e] rounded-md space-y-2">
            <p className="text-xs font-semibold text-zinc-300">Datos para pegar en Meta (WhatsApp → Configuración → Webhook)</p>
            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-500">URL de devolución de llamada</span>
              <div className="flex gap-2">
                <input readOnly value={webhookUrl} className="flex-1 min-w-0 bg-[#171717] border border-[#2e2e2e] rounded-md px-3 py-2 text-xs font-mono text-zinc-300" />
                <button type="button" onClick={() => copyValue('webhook', webhookUrl)} className="px-3 rounded-md border border-[#2e2e2e] bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300" aria-label="Copiar URL">
                  {copiedField === 'webhook' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              {info && !info.meta?.webhook_is_public_https && (
                <span className="block text-[11px] text-amber-300">Meta solo acepta URLs públicas con HTTPS. Configura la URL pública del backend y guarda.</span>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-500">Token de verificación</span>
              <div className="flex gap-2">
                <input
                  value={form.meta_verify_token}
                  onChange={e => setField('meta_verify_token', e.target.value)}
                  placeholder="Genera uno y pégalo en Meta"
                  className="flex-1 min-w-0 bg-[#171717] border border-[#2e2e2e] focus:border-zinc-500 rounded-md px-3 py-2 text-xs font-mono outline-none"
                />
                <button type="button" onClick={() => setField('meta_verify_token', generateVerifyToken())} className="px-3 rounded-md border border-[#2e2e2e] bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 text-[13px] font-medium" title="Generar token aleatorio">
                  <Zap size={14} />
                </button>
                <button type="button" onClick={() => copyValue('verify', form.meta_verify_token)} disabled={!form.meta_verify_token} className="px-3 rounded-md border border-[#2e2e2e] bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40" aria-label="Copiar token">
                  {copiedField === 'verify' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <span className="block text-[11px] text-zinc-500">Guarda la configuración antes de pulsar "Verificar y guardar" en Meta.</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-[#1c1c1c] hover:bg-zinc-800 border border-[#2e2e2e] text-zinc-200 rounded-md text-[13px] font-medium disabled:opacity-50"
            >
              <RefreshCw size={13} className={isTesting ? 'animate-spin' : ''} />
              Probar conexión con Meta
            </button>
            {missing.length > 0 && (
              <span className="text-[11px] text-zinc-500">Pendiente por guardar: {missing.join(', ')}</span>
            )}
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 text-xs rounded-md px-2.5 py-1.5 border ${testResult.connected ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-200 bg-rose-500/10 border-rose-500/20'}`}>
              {testResult.connected ? <Wifi size={14} className="mt-0.5 shrink-0" /> : <WifiOff size={14} className="mt-0.5 shrink-0" />}
              <span>
                {testResult.connected
                  ? <>Conectado: <b>{testResult.verified_name || 'Número verificado'}</b> {testResult.phone_number} · Calidad: {testResult.quality_rating || 'N/D'}</>
                  : <>No se pudo conectar ({testResult.status || 'ERROR'}). {testResult.error || 'Guarda el token y el Phone Number ID primero.'}</>}
              </span>
            </div>
          )}

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Fuera de la ventana de 24 horas desde el último mensaje del cliente, Meta solo permite enviar plantillas aprobadas; los envíos manuales de texto libre fallarán con un aviso.
          </p>
        </div>
      )}
    </div>
  );
}

// ==============================================================
// PANTALLA DE ACCESO AL PANEL
// ==============================================================
const BRANDING_CACHE_KEY = 'zenith_login_branding';

// Texto negro o blanco según el color de marca, para que el botón siempre se lea bien
const readableTextOn = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000' : '#fff';
};

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  // Correo o teléfono del usuario; vacío = contraseña de la empresa (propietario)
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('zenith_login_username') || ''; } catch { return ''; }
  });
  // Empresa: siempre la de la URL (/:empresa). La raíz no muestra este formulario.
  const [tenant] = useState(() => getAuthSlug().trim().toLowerCase());
  const [notFound, setNotFound] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Acceso con la contraseña de una empresa (propietario, sin usuario personal)
  const [ownerMode, setOwnerMode] = useState(false);
  // Empresas entre las que elegir cuando la cuenta pertenece a varias
  const [choices, setChoices] = useState(null);
  // La marca se guarda en el navegador para que la pantalla aparezca con el logo y color correctos al instante
  const brandKey = `${BRANDING_CACHE_KEY}_${tenant}`;
  const [brand, setBrand] = useState(() => {
    try { return JSON.parse(localStorage.getItem(brandKey) || 'null'); } catch { return null; }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/public/branding?tenant=${encodeURIComponent(tenant)}`)
        .then(res => {
          if (res.status === 404) setNotFound(true);
          return res.ok ? res.json() : null;
        })
        .then(data => {
          if (!data) return;
          setBrand(data);
          try { localStorage.setItem(brandKey, JSON.stringify(data)); } catch { /* sin espacio: no importa */ }
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [tenant]);

  const color = /^#[0-9a-f]{6}$/i.test(brand?.primary_color || '') ? brand.primary_color : '#3ecf8e';
  const rgb = hexToRgb(color);
  const company = brand?.company_name || 'Zenith';
  const botName = brand?.bot_name || 'tu asistente';

  useEffect(() => {
    document.title = `Iniciar sesión · ${company}`;
    // El borde de foco de los campos usa el color de marca
    document.documentElement.style.setProperty('--theme-primary', color);
    document.documentElement.style.setProperty('--theme-primary-rgb', rgb);
  }, [company, color, rgb]);

  const submitLogin = async (chosenTenant = '') => {
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // La empresa se deduce de la cuenta; solo se envía en modo propietario o al elegir entre varias
        body: JSON.stringify({
          password,
          username: ownerMode ? '' : username.trim(),
          // Siempre la empresa de esta página: nadie entra a otra empresa desde aquí
          tenant: chosenTenant || tenant
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.detail?.code === 'choose_tenant') {
        setChoices(data.detail.tenants || []);
        return;
      }
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'No se pudo iniciar sesión.');
        setPassword('');
        setChoices(null);
        return;
      }
      storeToken(data);
      const slug = data.tenant && data.tenant !== 'default' ? data.tenant : '';
      try {
        localStorage.setItem(TENANT_STORAGE_KEY, data.tenant_slug || slug);
        if (!ownerMode) localStorage.setItem('zenith_login_username', username.trim());
        localStorage.removeItem(ACTING_TENANT_KEY);
      } catch { /* ignorar */ }
      // Llevar al usuario a SU empresa (la URL /:empresa/... define la empresa que ve el panel)
      const urlSlug = data.tenant_slug || slug;
      window.history.replaceState(null, '', urlSlug ? `/${urlSlug}/knowledge-base` : '/knowledge-base');
      onLogin();
    } catch {
      setError('No se pudo conectar con el servidor. Revisa que el backend esté encendido.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitLogin('');
  };

  return (
    <div
      className="min-h-screen bg-[#121212] text-zinc-100 font-sans flex flex-col items-center justify-center px-4 py-10"
      style={{ backgroundImage: `radial-gradient(ellipse 60% 45% at 50% 0%, rgba(${rgb}, 0.14), transparent 70%)` }}
    >
      <main className="w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center mb-8">
          {brand?.logo ? (
            <img src={brand.logo} alt={company} className="h-14 w-14 rounded-xl object-contain bg-[#1c1c1c] border border-[#2e2e2e] p-1.5" />
          ) : (
            <div
              className="h-14 w-14 rounded-xl flex items-center justify-center text-2xl font-semibold"
              style={{ backgroundColor: color, color: readableTextOn(color) }}
              aria-hidden="true"
            >
              {company.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="mt-5 text-2xl font-medium tracking-tight">Bienvenido a {company}</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Inicia sesión para administrar a {botName}.</p>
        </div>

        {notFound ? (
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 text-center space-y-3">
            <p className="text-sm text-zinc-200">No encontramos esa empresa. Revisa el enlace que te compartieron.</p>
            <a href="/" className="text-[13px] text-zinc-400 hover:text-white">Ir al inicio</a>
          </div>
        ) : choices ? (
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 space-y-3">
            <p className="text-sm text-zinc-200">Tu cuenta pertenece a varias empresas. ¿A cuál quieres entrar?</p>
            {choices.map(c => (
              <button
                key={c.slug}
                type="button"
                disabled={loading}
                onClick={() => submitLogin(c.slug)}
                className="w-full flex items-center justify-between gap-3 bg-[#121212] border border-[#2e2e2e] hover:border-zinc-500 rounded-md px-3 py-2.5 text-left disabled:opacity-50"
              >
                <span className="text-sm text-zinc-100">{c.name}</span>
                <span className="text-[12px] text-zinc-400">{c.role_label}</span>
              </button>
            ))}
            <button type="button" onClick={() => { setChoices(null); setPassword(''); }} className="text-[13px] text-zinc-400 hover:text-white">
              Volver
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 space-y-4" noValidate>
          {ownerMode ? (
            <div className="space-y-1.5">
              <label htmlFor="login-tenant" className="block text-[13px] text-zinc-300">Identificador de la empresa</label>
              <input
                id="login-tenant"
                type="text"
                value={tenant}
                readOnly
                autoComplete="organization"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="identificador-de-tu-empresa"
                className="w-full h-10 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none transition-colors"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="block text-[13px] text-zinc-300">Correo o WhatsApp</label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); if (error) setError(''); }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="tu@correo.com · admin"
                className="w-full h-10 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none transition-colors"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="admin-password" className="block text-[13px] text-zinc-300">{ownerMode ? 'Contraseña de la empresa' : 'Contraseña'}</label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                onKeyUp={e => setCapsLock(e.getModifierState?.('CapsLock') || false)}
                onKeyDown={e => setCapsLock(e.getModifierState?.('CapsLock') || false)}
                autoFocus={Boolean(username)}
                autoComplete="current-password"
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                placeholder="••••••••"
                className="w-full h-10 bg-[#121212] border border-[#2e2e2e] rounded-md pl-3 pr-10 text-sm outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-500 hover:text-zinc-200"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {capsLock && <p className="text-[12px] text-amber-300">Bloq Mayús está activado.</p>}
          </div>

          {error && (
            <div id="login-error" role="alert" className="flex items-start gap-2 text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full h-10 rounded-md text-sm font-medium transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 flex items-center justify-center gap-2"
            style={{ backgroundColor: color, color: readableTextOn(color) }}
          >
            {loading && <RefreshCw size={14} className="animate-spin" />}
            {loading ? 'Verificando…' : 'Iniciar sesión'}
          </button>

          <button
            type="button"
            onClick={() => { setOwnerMode(v => !v); setError(''); setPassword(''); }}
            className="w-full text-center text-[12px] text-zinc-500 hover:text-zinc-300"
          >
            {ownerMode ? 'Entrar con mi correo o WhatsApp' : 'Entrar con la contraseña de una empresa'}
          </button>
        </form>
        )}

        <p className="mt-6 text-center text-[12px] text-zinc-500">
          La sesión dura 12 horas. Tras varios intentos fallidos el acceso se bloquea por unos minutos.
        </p>
      </main>

      <footer className="mt-10 flex items-center gap-1.5 text-[12px] text-zinc-600">
        <ShieldCheck size={13} /> Panel protegido · Impulsado por Zenith
      </footer>
    </div>
  );
}

// ==============================================================
// ACEPTAR INVITACIÓN (enlace ?invitacion=TOKEN enviado por WhatsApp o correo)
// ==============================================================
const getInviteToken = () => {
  try { return new URLSearchParams(window.location.search).get('invitacion') || ''; } catch { return ''; }
};

function AcceptInviteScreen({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/invitations/${encodeURIComponent(token)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'La invitación no es válida.');
        setInfo(data);
        setName(data.name || '');
      })
      .catch(e => setLoadError(e.message || 'No se pudo conectar con el servidor.'));
  }, [token]);

  const brand = info?.branding || {};
  const color = /^#[0-9a-f]{6}$/i.test(brand.primary_color || '') ? brand.primary_color : '#3ecf8e';
  const rgb = hexToRgb(color);
  const company = info?.tenant_name || brand.company_name || 'Zenith';

  useEffect(() => {
    document.title = `Invitación · ${company}`;
    document.documentElement.style.setProperty('--theme-primary', color);
    document.documentElement.style.setProperty('--theme-primary-rgb', rgb);
  }, [company, color, rgb]);

  const mismatch = confirm && password !== confirm;
  const canSubmit = name.trim() && password.length >= 8 && password === confirm && !saving;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/public/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), password, email: email.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.detail) ? 'Revisa los datos del formulario.' : data.detail;
        setError(detail || 'No se pudo crear tu acceso.');
        return;
      }
      storeToken(data);
      try {
        localStorage.setItem(TENANT_STORAGE_KEY, info.tenant === 'default' ? '' : info.tenant);
        localStorage.setItem('zenith_login_username', info.email || email.trim() || info.phone || '');
        localStorage.removeItem(ACTING_TENANT_KEY);
      } catch { /* ignorar */ }
      window.history.replaceState(null, '', info.tenant && info.tenant !== 'default' ? `/${info.tenant}/knowledge-base` : '/');
      onDone();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full h-10 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none transition-colors';

  return (
    <div
      className="min-h-screen bg-[#121212] text-zinc-100 font-sans flex flex-col items-center justify-center px-4 py-10"
      style={{ backgroundImage: `radial-gradient(ellipse 60% 45% at 50% 0%, rgba(${rgb}, 0.14), transparent 70%)` }}
    >
      <main className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center mb-8">
          {brand.logo ? (
            <img src={brand.logo} alt={company} className="h-14 w-14 rounded-xl object-contain bg-[#1c1c1c] border border-[#2e2e2e] p-1.5" />
          ) : (
            <div className="h-14 w-14 rounded-xl flex items-center justify-center text-2xl font-semibold"
              style={{ backgroundColor: color, color: readableTextOn(color) }} aria-hidden="true">
              {company.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="mt-5 text-2xl font-medium tracking-tight">Únete a {company}</h1>
          {info && (
            <p className="mt-1.5 text-sm text-zinc-400">Te invitaron como <b className="text-zinc-200">{info.role_label}</b>. Crea tu acceso para entrar.</p>
          )}
        </div>

        {loadError ? (
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 space-y-4 text-center">
            <div role="alert" className="flex items-start gap-2 text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2 text-left">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{loadError}</span>
            </div>
            <button onClick={() => { window.history.replaceState(null, '', '/'); onDone(); }} className="text-sm text-zinc-300 hover:underline">
              Ir al inicio de sesión
            </button>
          </div>
        ) : !info ? (
          <div className="flex justify-center text-zinc-500"><RefreshCw size={18} className="animate-spin" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 space-y-4" noValidate>
            <div className="text-[13px] text-zinc-400 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2">
              Entrarás con <b className="text-zinc-200">{info.email || (info.phone ? `+${info.phone}` : '')}</b>
              {info.tenant !== 'default' && <> en la empresa <b className="text-zinc-200">{info.tenant}</b></>}.
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-name" className="block text-[13px] text-zinc-300">Tu nombre</label>
              <input id="inv-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" className={inputCls} autoFocus />
            </div>
            {!info.email && (
              <div className="space-y-1.5">
                <label htmlFor="inv-email" className="block text-[13px] text-zinc-300">Correo <span className="text-zinc-500">(opcional, para entrar también con él)</span></label>
                <input id="inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={inputCls} />
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="inv-password" className="block text-[13px] text-zinc-300">Contraseña <span className="text-zinc-500">(mínimo 8 caracteres)</span></label>
              <div className="relative">
                <input id="inv-password" type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="new-password" className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-500 hover:text-zinc-200"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-confirm" className="block text-[13px] text-zinc-300">Repite la contraseña</label>
              <input id="inv-confirm" type={showPassword ? 'text' : 'password'} value={confirm}
                onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} aria-invalid={!!mismatch} />
              {mismatch && <p className="text-[12px] text-amber-300">Las contraseñas no coinciden.</p>}
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-2 text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={!canSubmit}
              className="w-full h-10 rounded-md text-sm font-medium transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: color, color: readableTextOn(color) }}>
              {saving && <RefreshCw size={14} className="animate-spin" />}
              {saving ? 'Creando acceso…' : 'Crear mi acceso'}
            </button>
          </form>
        )}
      </main>
      <footer className="mt-10 flex items-center gap-1.5 text-[12px] text-zinc-600">
        <ShieldCheck size={13} /> Panel protegido · Impulsado por Zenith
      </footer>
    </div>
  );
}

export default function App() {
  const [publicCard] = useState(getPublicCardParams);
  const [inviteToken, setInviteToken] = useState(getInviteToken);
  const [authenticated, setAuthenticated] = useState(() => Boolean(getStoredToken()));

  useEffect(() => {
    const handleUnauthorized = () => setAuthenticated(false);
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const handleLogout = () => {
    const slug = getTenantFromUrl() || getOwnSlug();
    clearStoredToken();
    window.history.replaceState(null, '', slug ? `/auth/${slug}` : '/');
    setAuthenticated(false);
  };

  if (publicCard) {
    // Enlace de la tarjeta de fidelidad del cliente final: no requiere login
    return publicCard.type === 'stamp'
      ? <PublicStampFlow apiBase={API_BASE} token={publicCard.token} tenant={publicCard.tenant} />
      : <PublicLoyaltyCard apiBase={API_BASE} token={publicCard.token} tenant={publicCard.tenant} />;
  }
  if (inviteToken) {
    return (
      <AcceptInviteScreen
        token={inviteToken}
        onDone={() => { setInviteToken(''); setAuthenticated(Boolean(getStoredToken())); }}
      />
    );
  }
  if (!authenticated) {
    // Sin empresa en la URL (/ o /auth): página comercial, sin formulario de acceso
    const slug = getAuthSlug();
    if (!slug) return <LandingScreen />;
    if (!window.location.pathname.toLowerCase().startsWith('/auth/')) {
      window.history.replaceState(null, '', `/auth/${slug}`);
    }
    return <LoginScreen key={slug} onLogin={() => setAuthenticated(true)} />;
  }
  return <Dashboard onLogout={handleLogout} />;
}
