import React, { useState, useEffect } from 'react';
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
  ListFilter
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

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

export default function App() {
  const [activeTab, setActiveTab] = useState('library');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Datos globales del sistema
  const [stats, setStats] = useState({
    database_type: 'PostgreSQL',
    total_db_items: 0,
    cached: true,
    active_provider: 'gemini',
    active_model: 'gemini-2.5-flash',
    company: 'Zenith Solutions',
    wa_connected: true
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

  // Formulario Settings
  const [settingsForm, setSettingsForm] = useState({
    company_name: '',
    bot_name: '',
    bot_tone: '',
    brand_instructions: '',
    ai_provider: 'gemini',
    gemini_api_key: '',
    gemini_model: 'gemini-2.5-flash',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini'
  });
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Playground Chat
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '¡Hola! Soy tu Asistente Operativo. Pregúntame sobre los servicios, garantías, precios o cualquier dato indexado en la base de datos.'
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

  // Carga inicial
  useEffect(() => {
    fetchStats();
    fetchKnowledge();
    fetchSettings();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const [resKb, resRoot] = await Promise.all([
        fetch(`${API_BASE}/api/knowledge/stats`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/`).then(r => r.json()).catch(() => ({}))
      ]);

      setStats({
        database_type: resKb.database_type || 'PostgreSQL',
        total_db_items: resKb.total_db_items ?? 0,
        cached: resKb.cached ?? true,
        active_provider: resRoot.active_provider || 'gemini',
        active_model: resRoot.active_model || 'gemini-2.5-flash',
        company: resRoot.company || 'Zenith Solutions',
        wa_connected: resRoot.gateway_integration?.connected ?? false
      });
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
        bot_tone: data.bot_tone || '',
        brand_instructions: data.brand_instructions || '',
        ai_provider: data.ai_provider || 'gemini',
        gemini_api_key: data.gemini_api_key || '',
        gemini_model: data.gemini_model || 'gemini-2.5-flash',
        openai_api_key: data.openai_api_key || '',
        openai_model: data.openai_model || 'gpt-4o-mini'
      });
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

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

      showToast('✨ Configuración de marca y claves de IA guardada');
      fetchStats();
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
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);
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

  return (
    <div className="flex min-h-screen bg-[#0c0d12] text-zinc-100 font-sans selection:bg-[#3ecf8e]/30 selection:text-white">

      {/* ==============================================================
          SIDEBAR (ESTILO SUPABASE STUDIO)
          ============================================================== */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#111218] border-r border-[#1f2330] flex flex-col transition-transform duration-200 md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-[#1f2330] flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center font-extrabold text-white text-lg shadow-lg shadow-emerald-900/30 shrink-0">
              {companyInitial}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-zinc-100 truncate">{stats.company}</span>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-[#3ecf8e] animate-pulse"></span>
                <span>Asistente Operativo</span>
              </div>
            </div>
          </div>
          <button className="md:hidden text-zinc-400 hover:text-white p-1" onClick={() => setMobileMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-3 py-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Conocimiento & Datos
          </div>

          <button
            onClick={() => { setActiveTab('library'); setMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'library' ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
          >
            <BookOpen size={18} className={activeTab === 'library' ? 'text-[#3ecf8e]' : 'text-zinc-400'} />
            <span>Base de Conocimiento</span>
          </button>

          <button
            onClick={() => { setActiveTab('add-text'); setMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'add-text' ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
          >
            <PlusCircle size={18} className={activeTab === 'add-text' ? 'text-[#3ecf8e]' : 'text-zinc-400'} />
            <span>Nuevo Documento</span>
          </button>

          <button
            onClick={() => { setActiveTab('scrape'); setMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'scrape' ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
          >
            <Globe size={18} className={activeTab === 'scrape' ? 'text-[#3ecf8e]' : 'text-zinc-400'} />
            <span>Web Scraper</span>
          </button>

          <div className="pt-4 px-3 py-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Pruebas & Control
          </div>

          <button
            onClick={() => { setActiveTab('chat'); setMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'chat' ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
          >
            <MessageSquare size={18} className={activeTab === 'chat' ? 'text-[#3ecf8e]' : 'text-zinc-400'} />
            <span>Playground</span>
          </button>

          <div className="pt-4 px-3 py-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Sistema
          </div>

          <button
            onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'settings' ? 'bg-[#3ecf8e]/10 text-[#3ecf8e] font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
          >
            <Settings size={18} className={activeTab === 'settings' ? 'text-[#3ecf8e]' : 'text-zinc-400'} />
            <span>Ajustes de Marca</span>
          </button>
        </nav>

        {/* Footer Sidebar */}
        <div className="p-4 border-t border-[#1f2330] bg-black/20 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 bg-[#0c0d12] border border-[#1f2330] rounded-lg text-xs">
            <span className="text-zinc-400">WhatsApp Gateway</span>
            <span className={`font-semibold ${stats.wa_connected ? 'text-[#3ecf8e]' : 'text-amber-400'}`}>
              {stats.wa_connected ? 'CONNECTED' : 'WAITING_QR'}
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
              <span className="text-zinc-500 font-medium">{stats.company}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-200 font-bold capitalize">
                {activeTab === 'library' && 'Base de Conocimiento'}
                {activeTab === 'add-text' && 'Nuevo Documento'}
                {activeTab === 'scrape' && 'Web Scraper Multi-URL'}
                {activeTab === 'chat' && 'Playground / Chat'}
                {activeTab === 'settings' && 'Marca & Claves IA'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <div className="px-3 py-1 bg-[#151720] border border-[#1f2330] rounded-full text-xs font-medium text-zinc-400">
                BD: <strong className="text-zinc-200">{stats.database_type}</strong>
              </div>
              <div className="px-3 py-1 bg-[#151720] border border-[#1f2330] rounded-full text-xs font-medium text-zinc-400">
                Latencia: <strong className="text-[#3ecf8e]">&lt; 1 ms</strong>
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
              <RefreshCw size={14} className={isSyncing ? 'animate-spin text-[#3ecf8e]' : ''} />
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
                  <div className="mt-2 text-2xl font-extrabold text-[#3ecf8e]">0.00 ms</div>
                  <span className="text-xs text-zinc-400 mt-1">Recuperación instantánea</span>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Motor Activo</span>
                  <div className="mt-2 text-2xl font-extrabold text-zinc-100 uppercase">{stats.active_provider}</div>
                  <span className="text-xs text-zinc-400 mt-1">{stats.active_model}</span>
                </div>

                <div className="p-4 bg-[#151720] border border-[#1f2330] rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">WhatsApp Gateway</span>
                  <div className={`mt-2 text-2xl font-extrabold ${stats.wa_connected ? 'text-[#3ecf8e]' : 'text-amber-400'}`}>
                    {stats.wa_connected ? 'ONLINE' : 'OFFLINE'}
                  </div>
                  <span className="text-xs text-zinc-400 mt-1">Microservicio Baileys</span>
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
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all shrink-0"
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
                  <button onClick={() => setActiveTab('add-text')} className="text-xs font-semibold text-[#3ecf8e] hover:underline">
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
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded tracking-wide shrink-0 ${item.source_type === 'url' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-emerald-500/10 text-[#3ecf8e] border border-emerald-500/20'}`}>
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
                      className="inline-flex items-center gap-2 px-5 py-2 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
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
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scraperMode === 'crawler' ? 'bg-[#3ecf8e] text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    <Layers size={14} />
                    <span>Mapear Sitio Completo</span>
                  </button>
                  <button
                    onClick={() => setScraperMode('single')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scraperMode === 'single' ? 'bg-[#3ecf8e] text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
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
                      <Compass size={17} className="text-[#3ecf8e]" />
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
                          className="inline-flex items-center gap-2 px-5 py-2 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
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
                            <span className="px-2 py-0.5 bg-[#3ecf8e]/10 text-[#3ecf8e] border border-[#3ecf8e]/20 rounded text-xs font-bold">
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
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${item.selected ? 'bg-[#3ecf8e]/10 border-[#3ecf8e]/40 text-zinc-100 font-medium' : 'bg-[#0e1017] border-[#1f2330] text-zinc-400 hover:border-zinc-700'}`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="text-zinc-500 font-mono text-[11px] w-6 shrink-0">{idx + 1}.</span>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleUrlSelection(item.url)}
                                className="accent-[#3ecf8e] w-4 h-4 rounded cursor-pointer shrink-0"
                              />
                              <span className="font-mono text-zinc-200 font-medium truncate">{item.path}</span>
                            </div>

                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-zinc-400 hover:text-emerald-400 shrink-0 p-1 transition-colors"
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
                          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
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

                    <div className="p-4 bg-[#3ecf8e]/5 border border-[#3ecf8e]/20 rounded-lg text-xs text-zinc-400 leading-relaxed">
                      <strong className="text-[#3ecf8e] block mb-1">⚡ Detección Inteligente de Codificación:</strong>
                      El scraper analiza los bytes brutos y convierte el HTML a UTF-8 puro, eliminando caracteres corruptos (mojibake) y actualizando el In-Memory Hot Cache en menos de 30 milisegundos.
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={isScraping}
                        className="inline-flex items-center gap-2 px-5 py-2 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
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

              <div className="flex flex-col h-[560px] bg-[#111218] border border-[#1f2330] rounded-xl overflow-hidden shadow-2xl">
                {/* Messages Box */}
                <div className="flex-1 p-6 overflow-y-auto space-y-4">
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-[#14532d] text-white border border-emerald-600 rounded-br-none shadow-sm' : 'bg-[#181a24] text-zinc-200 border border-[#1f2330] rounded-bl-none shadow-md'}`}>
                        <FormattedChatMessage text={m.text} isUser={m.role === 'user'} />
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="px-4 py-3 bg-[#181a24] border border-[#1f2330] rounded-xl text-xs text-zinc-400 flex items-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-[#3ecf8e]" />
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
                    className="flex-1 px-4 py-2.5 bg-[#151720] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading}
                    className="px-4 py-2.5 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
                  >
                    <span>Enviar</span>
                    <Send size={15} />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ==============================================================
              TAB 5: MARCA & CLAVES IA (SETTINGS)
              ============================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-6 animate-fadeIn">
              <div>
                <h1 className="text-xl font-bold text-zinc-100">Personalización de Marca & Motores de IA</h1>
                <p className="text-sm text-zinc-400 mt-1">Configura el nombre de tu empresa, el comportamiento del asistente y las credenciales de API sin reiniciar el contenedor.</p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Columna 1: Marca & Identidad */}
                  <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                    <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base pb-2 border-b border-[#1f2330]">
                      <Building size={18} className="text-[#3ecf8e]" />
                      <span>Identidad Corporativa</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Nombre de la Empresa o Marca *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.company_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, company_name: e.target.value }))}
                        placeholder="Ej: Fantasma Digital / Zenith Solutions"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Se actualizará en los saludos del bot y encabezados.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Nombre del Asistente IA *</label>
                      <input
                        type="text"
                        required
                        value={settingsForm.bot_name}
                        onChange={e => setSettingsForm(prev => ({ ...prev, bot_name: e.target.value }))}
                        placeholder="Ej: Asistente Operativo / GhostBot"
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Cómo se presentará el bot al iniciar la conversación.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Tono y Personalidad</label>
                      <textarea
                        rows={3}
                        value={settingsForm.bot_tone}
                        onChange={e => setSettingsForm(prev => ({ ...prev, bot_tone: e.target.value }))}
                        placeholder="Ej: Profesional, directo, resolutivo y empático. Adaptado al español de El Salvador."
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-xs text-zinc-200 outline-none font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Directrices Especiales de la Marca</label>
                      <textarea
                        rows={4}
                        value={settingsForm.brand_instructions}
                        onChange={e => setSettingsForm(prev => ({ ...prev, brand_instructions: e.target.value }))}
                        placeholder="Ej: Resaltar nuestra garantía de 12 meses. Si preguntan por proyectos a medida, solicitar su WhatsApp o correo..."
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-xs text-zinc-200 outline-none font-sans"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">Instrucciones inyectadas directamente en el System Prompt.</span>
                    </div>
                  </div>

                  {/* Columna 2: Claves de IA & Modelos */}
                  <div className="p-6 bg-[#151720] border border-[#1f2330] rounded-xl space-y-4">
                    <div className="flex items-center gap-2.5 text-zinc-200 font-bold text-base pb-2 border-b border-[#1f2330]">
                      <Key size={18} className="text-[#3ecf8e]" />
                      <span>Motores & Claves API</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Proveedor Principal de IA</label>
                      <select
                        value={settingsForm.ai_provider}
                        onChange={e => setSettingsForm(prev => ({ ...prev, ai_provider: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      >
                        <option value="gemini">Google Gemini (Recomendado - Ultra Rápido)</option>
                        <option value="openai">OpenAI (GPT-4o Mini / GPT-4o)</option>
                      </select>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Failover automático: si uno falla por cuota o red, el otro responde.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Google Gemini API Key</label>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={settingsForm.gemini_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, gemini_api_key: e.target.value }))}
                          placeholder="AIzaSy..."
                          className="w-full pl-3.5 pr-10 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey(!showGeminiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                        >
                          {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Empieza con AIzaSy... de Google AI Studio.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Modelo de Google Gemini</label>
                      <select
                        value={settingsForm.gemini_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, gemini_model: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      >
                        <option value="gemini-2.5-flash">gemini-2.5-flash (Última generación - Máxima velocidad)</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro (Razonamiento complejo)</option>
                        <option value="gemini-1.5-flash">gemini-1.5-flash (Versión previa)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">OpenAI API Key (Respaldo)</label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          value={settingsForm.openai_api_key}
                          onChange={e => setSettingsForm(prev => ({ ...prev, openai_api_key: e.target.value }))}
                          placeholder="sk-proj-..."
                          className="w-full pl-3.5 pr-10 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                        >
                          {showOpenaiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-1 block">Empieza con sk-... Opcional para contingencias.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Modelo de OpenAI</label>
                      <select
                        value={settingsForm.openai_model}
                        onChange={e => setSettingsForm(prev => ({ ...prev, openai_model: e.target.value }))}
                        className="w-full px-3.5 py-2.5 bg-[#0e1017] border border-[#1f2330] focus:border-[#3ecf8e] rounded-lg text-sm text-zinc-200 outline-none"
                      >
                        <option value="gpt-4o-mini">gpt-4o-mini (Rápido y económico)</option>
                        <option value="gpt-4o">gpt-4o (Modelo insignia)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#3ecf8e] hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-lg shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
                  >
                    {isSavingSettings ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Aplicando en Caliente...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} />
                        <span>Guardar Configuración y Aplicar</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

        </main>
      </div>

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
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-2xl text-sm font-semibold flex items-center gap-2.5 bg-[#161a24] text-white border-l-4 ${toast.isError ? 'border-red-500' : 'border-[#3ecf8e]'}`}>
          {toast.isError ? <AlertCircle size={18} className="text-red-400" /> : <CheckCircle2 size={18} className="text-[#3ecf8e]" />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
