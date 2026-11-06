import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  UtensilsCrossed,
  PlusCircle,
  RefreshCw,
  Trash2,
  Edit3,
  DollarSign,
  Phone,
  User,
  ShoppingBag,
  X,
  ChefHat,
  Search,
  ToggleLeft,
  ToggleRight,
  Flame,
  ArrowRight,
  Settings,
  ClipboardList,
  Kanban,
  Calendar,
  Filter,
  Download,
  Printer,
  Clock,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  MapPin,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  GripVertical
} from 'lucide-react';
import RestaurantSettings from './RestaurantSettings';
import RestaurantStats from './RestaurantStats';

const STATUS_CONFIG = {
  pending: {
    label: 'Pendiente',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
    colorHex: '#f59e0b',
    nextStatus: 'confirmed',
    nextLabel: 'Confirmar'
  },
  confirmed: {
    label: 'Confirmada',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    dot: 'bg-blue-400',
    colorHex: '#3b82f6',
    nextStatus: 'preparing',
    nextLabel: 'A Cocina'
  },
  preparing: {
    label: 'En Cocina',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    dot: 'bg-orange-400 animate-pulse',
    colorHex: '#f97316',
    nextStatus: 'ready',
    nextLabel: 'Lista'
  },
  ready: {
    label: 'Lista',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
    colorHex: '#10b981',
    nextStatus: 'delivered',
    nextLabel: 'Entregar'
  },
  delivered: {
    label: 'Entregada',
    badge: 'bg-zinc-800 text-zinc-400 border-zinc-700/60',
    dot: 'bg-zinc-500',
    colorHex: '#71717a',
    nextStatus: null,
    nextLabel: null
  },
  cancelled: {
    label: 'Cancelada',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dot: 'bg-rose-500',
    colorHex: '#ef4444',
    nextStatus: null,
    nextLabel: null
  }
};

const KANBAN_COLUMNS = [
  { id: 'pending', label: 'Pendientes', icon: Clock, accent: 'border-amber-500/40' },
  { id: 'confirmed', label: 'Confirmadas', icon: CheckCircle2, accent: 'border-blue-500/40' },
  { id: 'preparing', label: 'En Cocina', icon: Flame, accent: 'border-orange-500/40' },
  { id: 'ready', label: 'Listas / En camino', icon: ChefHat, accent: 'border-emerald-500/40' },
  { id: 'delivered', label: 'Entregadas', icon: ShoppingBag, accent: 'border-zinc-600/40' }
];

const READY_LABEL = { delivery: 'En camino', pickup: 'Lista p/ recoger', dine_in: 'Lista p/ servir' };
const TYPE_LABEL = { delivery: '🛵 Domicilio', pickup: '🛍️ Recoger', dine_in: '🍽️ Local' };
const PAYMENT_LABEL = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta' };

const inputClass =
  'w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500';

const EMPTY_ITEM = { name: '', description: '', price: '', category: 'Platos Fuertes', available: true, stock: '' };
const EMPTY_ORDER = {
  session_id: '', customer_name: '', notes: '', items: [],
  order_type: 'pickup', delivery_address: '', delivery_zone: '', payment_method: 'cash'
};

const parseTs = (value) => {
  if (!value) return null;
  let text = String(value).replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(text)) text += 'Z';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const money = (v) => `$${(parseFloat(v) || 0).toFixed(2)}`;

const formatElapsed = (date) => {
  if (!date) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
};

const playBeep = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Silencio si no hay interacción previa
  }
};

const parseBulkMenu = (text) => {
  const items = [];
  const errors = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const [name, price, category, ...rest] = line.split('|').map(p => p.trim());
    const value = parseFloat(String(price || '').replace(',', '.').replace('$', ''));
    if (!name || Number.isNaN(value) || value < 0) {
      errors.push(`Línea ${index + 1}: «${line.slice(0, 40)}» necesita nombre y precio`);
      return;
    }
    items.push({ name, price: value, category: category || 'General', description: rest.join(' | '), available: true });
  });
  return { items, errors };
};

export default function RestaurantPanel({
  apiFetch,
  apiBase,
  themeColor,
  showToast,
  initialSubTab = 'kanban',
  onSubTabChange
}) {
  const [subTab, setSubTabState] = useState(initialSubTab); // 'kanban' | 'orders' | 'menu' | 'stats' | 'settings'
  
  useEffect(() => {
    setSubTabState(initialSubTab);
  }, [initialSubTab]);

  const setSubTab = (id) => {
    setSubTabState(id);
    onSubTabChange?.(id);
  };

  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const [config, setConfig] = useState(null);
  const [openNow, setOpenNow] = useState(false);
  const [todayStats, setTodayStats] = useState({ orders: 0, sales: 0, active: 0 });
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(true);

  // Drag and Drop State
  const [draggingOrderId, setDraggingOrderId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Cards expandidas (para ver detalles sin saturar por defecto)
  const [expandedCards, setExpandedCards] = useState({});
  const toggleExpandCard = (id, e) => {
    e?.stopPropagation();
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtros Historial ('orders')
  const [datePreset, setDatePreset] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  // Filtro de temporalidad Kanban ('kanban')
  const [kanbanDateFilter, setKanbanDateFilter] = useState('all');

  // Filtros Menú
  const [menuSearch, setMenuSearch] = useState('');
  const [menuCategory, setMenuCategory] = useState('all');

  // Modales
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotify, setCancelNotify] = useState(true);
  const [ticket, setTicket] = useState(null);
  const [bulkText, setBulkText] = useState('');

  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [orderForm, setOrderForm] = useState(EMPTY_ORDER);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const pollingRef = useRef(null);
  const knownOrderIds = useRef(null);

  const toast = (message, isError = false) => showToast?.(message, isError);

  const fetchOrders = async (silent = false) => {
    if (!silent) setLoadingOrders(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/orders`);
      if (res.ok) {
        const data = await res.json();
        const list = data.orders || [];
        if (knownOrderIds.current) {
          const fresh = list.filter(o => !knownOrderIds.current.has(o.id) && o.status === 'pending');
          if (fresh.length > 0) {
            playBeep();
            toast(`🔔 ${fresh.length === 1 ? `Nuevo pedido #${fresh[0].id}` : `${fresh.length} pedidos nuevos`}${fresh[0].source === 'bot' ? ' (vía WhatsApp)' : ''}`);
          }
        }
        knownOrderIds.current = new Set(list.map(o => o.id));
        setOrders(list);
      }
    } catch (err) {
      console.warn('Error fetching orders:', err);
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  };

  const fetchMenu = async () => {
    setLoadingMenu(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/menu`);
      if (res.ok) setMenu((await res.json()).items || []);
    } catch (err) {
      console.warn('Error fetching menu:', err);
    } finally {
      setLoadingMenu(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setOpenNow(data.open_now);
      }
    } catch (err) {
      console.warn('Error fetching config:', err);
    }
  };

  const fetchTodayStats = async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/stats?days=1`);
      if (res.ok) {
        const data = await res.json();
        setTodayStats(data.today);
        setOpenNow(data.open_now);
      }
    } catch (err) {
      console.warn('Error fetching stats:', err);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchMenu();
    fetchConfig();
    fetchTodayStats();

    pollingRef.current = setInterval(() => {
      fetchOrders(true);
      fetchTodayStats();
    }, 12000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const apiError = async (res, fallback) => {
    const data = await res.json().catch(() => ({}));
    return typeof data.detail === 'string' ? data.detail : fallback;
  };

  // Acciones sobre pedidos
  const handleUpdateStatus = async (orderId, newStatus, reason = '', notify = true) => {
    // Actualización optimista inmediata en UI
    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status: newStatus } : o)));

    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, cancel_reason: reason, notify_customer: notify })
      });
      if (res.ok) {
        const data = await res.json();
        const label = STATUS_CONFIG[newStatus]?.label || newStatus;
        toast(`Pedido #${orderId} ➔ ${label}${data.customer_notified ? ' (cliente notificado por WhatsApp)' : ''}`);
        fetchOrders(true);
        fetchMenu();
        fetchTodayStats();
      } else {
        toast(await apiError(res, 'No se pudo cambiar el estado'), true);
        fetchOrders(true);
      }
    } catch {
      toast('Error al actualizar estado', true);
      fetchOrders(true);
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e, orderId) => {
    e.dataTransfer.setData('text/plain', String(orderId));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingOrderId(orderId);
  };

  const handleDragEnd = () => {
    setDraggingOrderId(null);
    setDragOverCol(null);
  };

  const handleColDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== colId) {
      setDragOverCol(colId);
    }
  };

  const handleColDragLeave = (e, colId) => {
    // Solo limpiar si realmente salimos de la columna
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dragOverCol === colId) {
      setDragOverCol(null);
    }
  };

  const handleColDrop = (e, colId) => {
    e.preventDefault();
    const rawId = e.dataTransfer.getData('text/plain');
    const orderId = parseInt(rawId, 10);
    if (orderId) {
      const targetOrder = orders.find(o => o.id === orderId);
      if (targetOrder && targetOrder.status !== colId) {
        handleUpdateStatus(orderId, colId);
      }
    }
    setDraggingOrderId(null);
    setDragOverCol(null);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    await handleUpdateStatus(cancelTarget.id, 'cancelled', cancelReason.trim(), cancelNotify);
    setCancelTarget(null);
    setCancelReason('');
  };

  const handleTogglePaid = async (order, e) => {
    e?.stopPropagation();
    const next = order.payment_status === 'paid' ? 'pending' : 'paid';
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/orders/${order.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: next })
      });
      if (res.ok) {
        setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, payment_status: next } : o)));
        toast(next === 'paid' ? `Pedido #${order.id} marcado como pagado` : `Pedido #${order.id} vuelve a pago pendiente`);
      }
    } catch {
      toast('Error al actualizar el pago', true);
    }
  };

  const handleOpenTicket = async (order, e) => {
    e?.stopPropagation();
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/orders/${order.id}/ticket`);
      if (res.ok) setTicket({ id: order.id, text: await res.text() });
    } catch {
      toast('No se pudo generar el ticket', true);
    }
  };

  const handlePrintTicket = () => {
    const win = window.open('', '_blank', 'width=380,height=600');
    if (!win) {
      toast('Tu navegador bloqueó la ventana de impresión', true);
      return;
    }
    const escaped = ticket.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    win.document.write(`<pre style="font:13px monospace;white-space:pre-wrap">${escaped}</pre>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const handleCopyTicket = async () => {
    try {
      await navigator.clipboard.writeText(ticket.text);
      toast('Ticket copiado');
    } catch {
      toast('No se pudo copiar', true);
    }
  };

  const handleToggleAccepting = async () => {
    if (!config) return;
    const next = !config.accepting_orders;
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepting_orders: next })
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setOpenNow(data.open_now);
        toast(next ? '🟢 Recibiendo pedidos' : '🔴 Pedidos pausados: el bot no tomará más pedidos');
      }
    } catch {
      toast('No se pudo cambiar el estado del local', true);
    }
  };

  // Menú
  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name || itemForm.price === '') {
      toast('Por favor completa nombre y precio', true);
      return;
    }
    setIsSavingItem(true);
    try {
      const stockText = String(itemForm.stock).trim();
      const payload = {
        name: itemForm.name.trim(),
        description: itemForm.description.trim(),
        price: parseFloat(itemForm.price),
        category: itemForm.category.trim() || 'General',
        available: Boolean(itemForm.available),
        stock: stockText === '' ? null : parseInt(stockText, 10)
      };
      const res = await apiFetch(
        editingItem ? `${apiBase}/api/restaurant/menu/${editingItem.id}` : `${apiBase}/api/restaurant/menu`,
        {
          method: editingItem ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (res.ok) {
        toast(editingItem ? 'Platillo actualizado' : 'Platillo agregado al menú');
        setShowItemModal(false);
        setEditingItem(null);
        setItemForm(EMPTY_ITEM);
        fetchMenu();
      } else {
        toast(await apiError(res, 'Error al guardar platillo'), true);
      }
    } catch (err) {
      toast(`Error: ${err.message}`, true);
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleToggleAvailable = async (item) => {
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/menu/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: !item.available })
      });
      if (res.ok) {
        setMenu(prev => prev.map(m => (m.id === item.id ? { ...m, available: !m.available } : m)));
        toast(`«${item.name}» marcado como ${!item.available ? 'disponible' : 'agotado'}`);
      }
    } catch {
      toast('Error al actualizar disponibilidad', true);
    }
  };

  const handleDeleteItem = async (itemId, itemName) => {
    if (!window.confirm(`¿Seguro que deseas eliminar «${itemName}» del menú?`)) return;
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/menu/${itemId}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Platillo eliminado');
        fetchMenu();
      }
    } catch {
      toast('Error al eliminar platillo', true);
    }
  };

  const handleImportBulk = async () => {
    const { items, errors } = parseBulkMenu(bulkText);
    if (items.length === 0) {
      toast(errors[0] || 'No se encontraron platillos con formato «Nombre | precio»', true);
      return;
    }
    setIsImporting(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/menu/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, replace_all: false })
      });
      if (res.ok) {
        const data = await res.json();
        toast(`Importados ${data.count} platillos`);
        setShowBulkModal(false);
        setBulkText('');
        fetchMenu();
      } else {
        toast(await apiError(res, 'Error en la importación'), true);
      }
    } catch (err) {
      toast(`Error: ${err.message}`, true);
    } finally {
      setIsImporting(false);
    }
  };

  // Orden manual
  const enabledTypes = config?.order_types && config.order_types.length ? config.order_types : ['delivery', 'pickup', 'dine_in'];
  const enabledPayments = config?.payment_methods && config.payment_methods.length ? config.payment_methods : ['cash', 'transfer'];
  const zones = config?.delivery_zones || [];

  const openNewOrder = () => {
    setOrderForm({
      session_id: '',
      customer_name: '',
      notes: '',
      items: [],
      order_type: enabledTypes[0] || 'pickup',
      delivery_address: '',
      delivery_zone: zones[0]?.name || '',
      payment_method: enabledPayments[0] || 'cash'
    });
    setShowNewOrderModal(true);
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    if (!orderForm.session_id || orderForm.items.length === 0) {
      toast('Indica el WhatsApp/Teléfono y al menos 1 producto', true);
      return;
    }
    if (orderForm.order_type === 'delivery' && !orderForm.delivery_address.trim()) {
      toast('Escribe la dirección de entrega', true);
      return;
    }
    setIsCreatingOrder(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: orderForm.session_id.trim(),
          customer_name: orderForm.customer_name.trim() || 'Cliente en Restaurante',
          notes: orderForm.notes.trim(),
          items: orderForm.items,
          order_type: orderForm.order_type,
          delivery_address: orderForm.delivery_address.trim(),
          delivery_zone: orderForm.delivery_zone,
          payment_method: orderForm.payment_method
        })
      });
      if (res.ok) {
        toast('✅ Orden creada y enviada a cocina');
        setShowNewOrderModal(false);
        setOrderForm(EMPTY_ORDER);
        fetchOrders(true);
        fetchMenu();
        fetchTodayStats();
      } else {
        toast(`Error: ${await apiError(res, 'No se pudo crear la orden')}`, true);
      }
    } catch (err) {
      toast(`Error: ${err.message}`, true);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // Filtrado de fechas
  const filterByDate = (date, preset, customFrom, customTo) => {
    if (!date) return preset === 'all';
    const orderTime = date.getTime();
    const now = new Date();
    
    if (preset === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
      return orderTime >= startOfDay && orderTime <= endOfDay;
    }
    if (preset === 'yesterday') {
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      const endOfYesterday = startOfYesterday + 24 * 60 * 60 * 1000 - 1;
      return orderTime >= startOfYesterday && orderTime <= endOfYesterday;
    }
    if (preset === 'last7days') {
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
      return orderTime >= sevenDaysAgo;
    }
    if (preset === 'thismonth') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return orderTime >= startOfMonth;
    }
    if (preset === 'custom') {
      if (customFrom) {
        const fromTime = new Date(customFrom + 'T00:00:00').getTime();
        if (orderTime < fromTime) return false;
      }
      if (customTo) {
        const toTime = new Date(customTo + 'T23:59:59').getTime();
        if (orderTime > toTime) return false;
      }
      return true;
    }
    return true;
  };

  // Pedidos filtrados para Historial ('orders')
  const historyFilteredOrders = useMemo(() => {
    return orders.filter(o => {
      const createdDate = parseTs(o.created_at);
      if (!filterByDate(createdDate, datePreset, dateFrom, dateTo)) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (typeFilter !== 'all' && o.order_type !== typeFilter) return false;
      if (paymentFilter !== 'all') {
        const isPaid = o.payment_status === 'paid';
        if (paymentFilter === 'paid' && !isPaid) return false;
        if (paymentFilter === 'pending' && isPaid) return false;
      }
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const haystack = [
          o.customer_name,
          String(o.id),
          o.session_id,
          o.customer_phone,
          o.notes,
          o.delivery_address,
          o.items_json
        ].map(v => (v || '').toLowerCase());
        if (!haystack.some(v => v.includes(q))) return false;
      }
      return true;
    });
  }, [orders, datePreset, dateFrom, dateTo, statusFilter, typeFilter, paymentFilter, searchFilter]);

  // Pedidos filtrados para Kanban ('kanban')
  const kanbanFilteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (typeFilter !== 'all' && o.order_type !== typeFilter) return false;

      // Filtro de temporalidad / ámbito para el Kanban
      if (kanbanDateFilter !== 'all') {
        const created = parseTs(o.created_at);
        if (created) {
          const now = new Date();
          if (kanbanDateFilter === 'today') {
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (created < startOfToday) return false;
          } else if (kanbanDateFilter === 'last3days') {
            const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
            if (created < cutoff) return false;
          } else if (kanbanDateFilter === 'last7days') {
            const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (created < cutoff) return false;
          } else if (kanbanDateFilter === 'active') {
            if (o.status === 'delivered' || o.status === 'cancelled') return false;
          }
        }
      }

      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const haystack = [
          o.customer_name,
          String(o.id),
          o.session_id,
          o.customer_phone,
          o.notes,
          o.delivery_address,
          o.items_json
        ].map(v => (v || '').toLowerCase());
        if (!haystack.some(v => v.includes(q))) return false;
      }
      return true;
    });
  }, [orders, typeFilter, searchFilter, kanbanDateFilter]);

  // Métricas de Historial
  const historyStats = useMemo(() => {
    const totalCount = historyFilteredOrders.length;
    const validOrders = historyFilteredOrders.filter(o => o.status !== 'cancelled');
    const totalSales = validOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    const avgTicket = validOrders.length > 0 ? totalSales / validOrders.length : 0;
    const deliveredCount = historyFilteredOrders.filter(o => o.status === 'delivered').length;
    const cancelledCount = historyFilteredOrders.filter(o => o.status === 'cancelled').length;
    return {
      count: totalCount,
      sales: totalSales,
      avg: avgTicket,
      delivered: deliveredCount,
      cancelled: cancelledCount
    };
  }, [historyFilteredOrders]);

  const handleExportCSV = () => {
    if (historyFilteredOrders.length === 0) {
      toast('No hay pedidos para exportar con los filtros actuales', true);
      return;
    }
    const headers = ['ID', 'Fecha', 'Hora', 'Cliente', 'Telefono', 'Modalidad', 'Estado', 'Pago', 'Total', 'Platillos', 'Notas', 'Direccion'];
    const rows = historyFilteredOrders.map(o => {
      const d = parseTs(o.created_at);
      const dateStr = d ? d.toLocaleDateString() : '';
      const timeStr = d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join('; ');
      return [
        o.id,
        `"${dateStr}"`,
        `"${timeStr}"`,
        `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        `"${o.customer_phone || o.session_id || ''}"`,
        `"${TYPE_LABEL[o.order_type] || o.order_type || ''}"`,
        `"${STATUS_CONFIG[o.status]?.label || o.status}"`,
        `"${o.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}"`,
        (parseFloat(o.total) || 0).toFixed(2),
        `"${itemsSummary.replace(/"/g, '""')}"`,
        `"${(o.notes || '').replace(/"/g, '""')}"`,
        `"${(o.delivery_address || '').replace(/"/g, '""')}"`
      ].join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `pedidos_restaurante_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('✅ Archivo CSV descargado');
  };

  const categories = [...new Set(menu.map(m => m.category || 'General'))];
  const filteredMenu = menu.filter(m => {
    if (menuCategory !== 'all' && (m.category || 'General') !== menuCategory) return false;
    const q = menuSearch.trim().toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
  });

  const SECTION_INFO = {
    kanban: { title: 'Tablero Kanban', description: 'Arrastra y suelta comandas entre columnas para cambiar de estado al instante.' },
    orders: { title: 'Historial & Filtros', description: 'Consulta y audita pedidos por rango de fechas, estados y modalidades.' },
    menu: { title: 'Menú & Platillos', description: 'Catálogo de platillos con disponibilidad automática en WhatsApp.' },
    stats: { title: 'Estadísticas', description: 'Ventas, pedidos y productos más vendidos.' },
    settings: { title: 'Configuración', description: 'Horarios, entregas, pagos y cómo atiende la IA.' }
  };

  // ==============================================================
  // RENDER: TARJETA KANBAN ULTRA-LIMPIA (NO SATURADA + DRAG & DROP)
  // ==============================================================
  const renderKanbanCard = (order) => {
    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const items = order.items || [];
    const created = parseTs(order.created_at);
    const isOpenOrder = order.status !== 'cancelled' && order.status !== 'delivered';
    const isLate = order.status === 'preparing' && created && (Date.now() - created.getTime() > 20 * 60 * 1000);
    const isDragging = draggingOrderId === order.id;
    const isExpanded = Boolean(expandedCards[order.id]);

    return (
      <div
        key={order.id}
        draggable={isOpenOrder}
        onDragStart={(e) => handleDragStart(e, order.id)}
        onDragEnd={handleDragEnd}
        className={`group relative p-3 rounded-md border transition-all select-none overflow-hidden ${
          isDragging
            ? 'opacity-30 scale-95 border-dashed border-zinc-500 bg-[#141414]'
            : isLate
              ? 'bg-[#18120e] border-orange-500/40 hover:border-orange-500/80 shadow-sm'
              : 'bg-[#181818] border-[#292929] hover:border-[#3d3d3d] hover:bg-[#1a1a1a] shadow-sm'
        } ${isOpenOrder ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      >
        {/* Fila 1: ID, Cliente, Modalidad e Indicadores */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono font-bold text-xs text-zinc-100 shrink-0">
              #{String(order.id).padStart(3, '0')}
            </span>
            <span className="font-semibold text-xs text-zinc-200 truncate" title={order.customer_name}>
              {order.customer_name || 'Cliente'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {order.source === 'bot' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">
                BOT
              </span>
            )}
            <span className="text-[10px] text-zinc-400 font-medium bg-[#202020] px-1.5 py-0.5 rounded border border-[#2d2d2d]">
              {TYPE_LABEL[order.order_type] || order.order_type}
            </span>
          </div>
        </div>

        {/* Fila 2: Resumen limpio de Platillos (1 o 2 líneas máximo) */}
        <div className="space-y-1 my-2">
          {items.slice(0, isExpanded ? items.length : 2).map((it, idx) => (
            <div key={idx} className="flex items-baseline justify-between text-xs leading-tight">
              <span className="text-zinc-300 truncate pr-2">
                <strong className="text-zinc-100 font-bold">{it.quantity}x</strong> {it.name}
                {isExpanded && it.notes && (
                  <span className="block text-[10px] text-zinc-500 italic ml-4">↳ {it.notes}</span>
                )}
              </span>
              <span className="text-[11px] font-mono text-zinc-400 shrink-0">
                {money(it.price * it.quantity)}
              </span>
            </div>
          ))}

          {items.length > 2 && (
            <button
              onClick={(e) => toggleExpandCard(order.id, e)}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 font-medium pt-0.5 inline-flex items-center gap-1"
            >
              <span>{isExpanded ? 'Ver menos' : `+${items.length - 2} platillo(s) más`}</span>
              {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}
        </div>

        {/* Fila 3: Píldora de Mesa o Dirección (si existe) */}
        {(order.notes || order.delivery_address) && (
          <div className="my-2 pt-1 text-[11px] flex items-center gap-1 text-zinc-400">
            {order.notes ? (
              <span className="text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-medium truncate max-w-full">
                📌 {order.notes}
              </span>
            ) : (
              <span className="text-zinc-400 bg-zinc-800/60 border border-zinc-700/50 px-2 py-0.5 rounded text-[10px] truncate max-w-full" title={order.delivery_address}>
                📍 {order.delivery_address}
              </span>
            )}
          </div>
        )}

        {/* Fila 4: Total, Pago, Tiempo e Iconos de Acción */}
        <div className="pt-2 border-t border-[#262626] flex items-center justify-between gap-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-emerald-400 text-sm">
              {money(order.total)}
            </span>
            <button
              onClick={(e) => handleTogglePaid(order, e)}
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
                order.payment_status === 'paid'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-zinc-800 text-amber-300 border-zinc-700 hover:bg-zinc-700'
              }`}
              title="Click para alternar estado de pago"
            >
              {order.payment_status === 'paid' ? 'Pagado' : 'Cobrar'}
            </button>
          </div>

          <div className="flex items-center gap-1 text-zinc-400">
            <span className={`text-[10px] font-mono mr-1 ${isLate ? 'text-orange-400 font-bold animate-pulse' : 'text-zinc-500'}`}>
              {created ? formatElapsed(created) : ''}
            </span>

            {/* Ticket Rápido */}
            <button
              onClick={(e) => handleOpenTicket(order, e)}
              className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-[#252525] rounded transition-colors"
              title="Imprimir ticket / comanda"
            >
              <Printer size={13} />
            </button>

            {/* Cancelar Rápido */}
            {isOpenOrder && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCancelTarget(order);
                  setCancelReason('');
                  setCancelNotify(Boolean(order.customer_phone));
                }}
                className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                title="Cancelar comanda"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Fila 5: Botón de Siguiente Estado (Ancho completo y limpio, sin desbordamiento) */}
        {cfg.nextStatus && (
          <div className="pt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUpdateStatus(order.id, cfg.nextStatus);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-semibold text-black hover:brightness-110 active:scale-[0.99] transition-all shadow-sm"
              style={{ backgroundColor: cfg.colorHex || themeColor }}
              title={`Mover comanda a ${STATUS_CONFIG[cfg.nextStatus]?.label}`}
            >
              <span>{cfg.nextLabel}</span>
              <ArrowRight size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-full mx-auto space-y-4 animate-fadeIn pb-6">
      {/* Encabezado General */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">
            {SECTION_INFO[subTab]?.title || 'Restaurante'}
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5 max-w-2xl">
            {SECTION_INFO[subTab]?.description || 'Módulo oficial de pedidos y menú.'}
          </p>
        </div>

        {/* Acciones principales y switch de vistas */}
        {(subTab === 'kanban' || subTab === 'orders') && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Switch de Vistas: Kanban vs Historial con Filtros */}
            <div className="flex items-center p-0.5 bg-[#171717] border border-[#2e2e2e] rounded-md shadow-sm">
              <button
                onClick={() => setSubTab('kanban')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  subTab === 'kanban'
                    ? 'bg-[#262626] text-zinc-100 border border-[#3e3e3e] shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Tablero Kanban con arrastrar y soltar"
              >
                <Kanban size={13} style={{ color: subTab === 'kanban' ? themeColor : undefined }} />
                <span>Tablero Kanban</span>
              </button>
              <button
                onClick={() => setSubTab('orders')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  subTab === 'orders'
                    ? 'bg-[#262626] text-zinc-100 border border-[#3e3e3e] shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Historial de pedidos con filtros por fechas"
              >
                <Calendar size={13} style={{ color: subTab === 'orders' ? themeColor : undefined }} />
                <span>Historial & Filtros</span>
              </button>
            </div>

            <button
              onClick={handleToggleAccepting}
              disabled={!config}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                openNow
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25'
              }`}
              title={config?.accepting_orders ? 'Pausar pedidos del bot' : 'Reanudar pedidos del bot'}
            >
              <span className={`w-2 h-2 rounded-full ${openNow ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span>{openNow ? 'Abierto' : config?.accepting_orders === false ? 'Pausado' : 'Cerrado'}</span>
            </button>

            <button
              onClick={() => { fetchOrders(); fetchMenu(); fetchTodayStats(); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#232323] hover:bg-[#2e2e2e] border border-[#3e3e3e] rounded-md text-xs font-medium text-zinc-200 transition-all"
              title="Refrescar pedidos"
            >
              <RefreshCw size={12} className={loadingOrders ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refrescar</span>
            </button>

            <button
              onClick={openNewOrder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 transition-all shadow-sm"
              style={{ backgroundColor: themeColor }}
            >
              <PlusCircle size={14} />
              <span>Nueva orden</span>
            </button>
          </div>
        )}

        {subTab === 'menu' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200"
            >
              <ClipboardList size={13} />
              <span>Carga rápida</span>
            </button>
            <button
              onClick={() => { setEditingItem(null); setItemForm(EMPTY_ITEM); setShowItemModal(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 transition-all"
              style={{ backgroundColor: themeColor }}
            >
              <PlusCircle size={14} />
              <span>Nuevo platillo</span>
            </button>
          </div>
        )}
      </div>

      {/* ==============================================================
          VISTA 1: TABLERO KANBAN CON DRAG AND DROP
          ============================================================== */}
      {subTab === 'kanban' && (
        <div className="space-y-3">
          {/* Barra superior compacta del Kanban */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Buscar por cliente, #ID, platillo o mesa..."
                className="w-full bg-[#121212] border border-[#2e2e2e] rounded pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="text-[11px] text-zinc-500 hidden xl:inline">Arrastra tarjetas entre columnas para cambiar estado</span>
              <span className="w-px h-3 bg-zinc-700 hidden xl:inline" />

              {/* Selector de periodo para el Kanban */}
              <div className="flex items-center gap-1.5">
                <Calendar size={13} className="text-zinc-400 shrink-0" />
                <select
                  value={kanbanDateFilter}
                  onChange={e => setKanbanDateFilter(e.target.value)}
                  className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                  title="Periodo de comandas visibles en el tablero"
                >
                  <option value="today">📅 Solo Hoy</option>
                  <option value="active">⚡ Activos (En proceso)</option>
                  <option value="last3days">📅 Últimos 3 días</option>
                  <option value="last7days">📅 Últimos 7 días</option>
                  <option value="all">🌐 Todos los pedidos</option>
                </select>
              </div>

              {/* Filtro de Modalidad */}
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value="all">Todas las modalidades</option>
                {Object.entries(TYPE_LABEL).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Columnas Kanban con Drag and Drop y Scroll Horizontal + Vertical */}
          {loadingOrders && orders.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando tablero...
            </div>
          ) : (
            <div className="overflow-x-auto pb-4 pt-1">
              <div className="flex gap-3 items-start min-w-[1450px] 2xl:min-w-full">
                {KANBAN_COLUMNS.map(col => {
                  const colOrders = kanbanFilteredOrders.filter(o => o.status === col.id);
                  const cfg = STATUS_CONFIG[col.id] || STATUS_CONFIG.pending;
                  const isOver = dragOverCol === col.id;

                  return (
                    <div
                      key={col.id}
                      onDragOver={(e) => handleColDragOver(e, col.id)}
                      onDragLeave={(e) => handleColDragLeave(e, col.id)}
                      onDrop={(e) => handleColDrop(e, col.id)}
                      className={`flex-1 min-w-[285px] bg-[#121212] border rounded-md flex flex-col min-h-[480px] max-h-[82vh] transition-all shadow-sm ${
                        isOver
                          ? 'border-emerald-500/70 bg-emerald-500/[0.04] ring-1 ring-emerald-500/40 shadow-md'
                          : 'border-[#262626]'
                      }`}
                    >
                      {/* Header Columna */}
                      <div className="p-2.5 border-b border-[#242424] flex items-center justify-between sticky top-0 bg-[#121212] rounded-t-md z-10 shadow-sm">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                          <span className="text-xs font-semibold text-zinc-200">{col.label}</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#1c1c1c] text-zinc-400 font-bold border border-[#2e2e2e]">
                          {colOrders.length}
                        </span>
                      </div>

                      {/* Zona Drop / Tarjetas con scroll vertical */}
                      <div className="p-2 space-y-2 overflow-y-auto max-h-[calc(82vh-45px)] flex-1">
                        {colOrders.length === 0 ? (
                          <div
                            className={`p-6 text-center text-xs rounded border border-dashed my-2 transition-colors ${
                              isOver
                                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                                : 'border-[#202020] text-zinc-600'
                            }`}
                          >
                            {isOver ? 'Soltar aquí para mover' : 'Sin pedidos'}
                          </div>
                        ) : (
                          colOrders.map(order => renderKanbanCard(order))
                        )}

                        {/* Dropzone al final de la columna cuando se arrastra */}
                        {isOver && colOrders.length > 0 && (
                          <div className="p-2 text-center text-[11px] font-semibold text-emerald-400 border border-dashed border-emerald-500/50 bg-emerald-500/10 rounded animate-pulse">
                            Soltar para mover a {col.label}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==============================================================
          VISTA 2: HISTORIAL Y FILTROS AVANZADOS DE PEDIDOS
          ============================================================== */}
      {subTab === 'orders' && (
        <div className="space-y-3">
          {/* Panel de Filtros */}
          <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2.5">
            {/* Presets de Fechas */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-2.5 border-b border-[#262626]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 shrink-0 mr-1">
                  <Calendar size={13} className="text-zinc-400" />
                  <span>Periodo:</span>
                </span>

                {[
                  { id: 'today', label: 'Hoy' },
                  { id: 'yesterday', label: 'Ayer' },
                  { id: 'last7days', label: 'Últimos 7 días' },
                  { id: 'thismonth', label: 'Este mes' },
                  { id: 'all', label: 'Todos' },
                  { id: 'custom', label: 'Personalizado' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setDatePreset(p.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      datePreset === p.id
                        ? 'bg-[#2e2e2e] text-zinc-100 border border-[#444] shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#202020]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-[#232323] hover:bg-[#2a2a2a] border border-[#3e3e3e] text-zinc-200 transition-all shrink-0"
                title="Descargar pedidos filtrados en formato CSV"
              >
                <Download size={12} />
                <span>Exportar CSV</span>
              </button>
            </div>

            {/* Inputs Rango Personalizado */}
            {datePreset === 'custom' && (
              <div className="flex items-center gap-3 p-2 bg-[#121212] border border-[#262626] rounded-md text-xs animate-fadeIn">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">Desde:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-2 py-0.5 text-xs text-zinc-200 outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">Hasta:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-2 py-0.5 text-xs text-zinc-200 outline-none"
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
                  >
                    Limpiar fechas
                  </button>
                )}
              </div>
            )}

            {/* Filtros Dropdown & Buscador */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-0.5">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  placeholder="Buscar cliente, tel, #ID..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded pl-8 pr-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-2.5 py-1 text-xs text-zinc-200 outline-none"
                >
                  <option value="all">Todos los estados</option>
                  <option value="pending">🟡 Pendientes</option>
                  <option value="confirmed">🔵 Confirmadas</option>
                  <option value="preparing">🟠 En Cocina</option>
                  <option value="ready">🟢 Listas / En camino</option>
                  <option value="delivered">🟣 Entregadas</option>
                  <option value="cancelled">🔴 Canceladas</option>
                </select>
              </div>

              <div>
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-2.5 py-1 text-xs text-zinc-200 outline-none"
                >
                  <option value="all">Todas las modalidades</option>
                  <option value="delivery">🛵 Domicilio</option>
                  <option value="pickup">🛍️ Recoger</option>
                  <option value="dine_in">🍽️ Local</option>
                </select>
              </div>

              <div>
                <select
                  value={paymentFilter}
                  onChange={e => setPaymentFilter(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded px-2.5 py-1 text-xs text-zinc-200 outline-none"
                >
                  <option value="all">Todos los pagos</option>
                  <option value="paid">✓ Pagado</option>
                  <option value="pending">⏳ Pendiente de pago</option>
                </select>
              </div>
            </div>
          </div>

          {/* Métricas del Rango */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
                Pedidos Filtrados
              </span>
              <p className="text-xl font-bold text-zinc-100 font-mono mt-0.5">{historyStats.count}</p>
            </div>

            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
                Facturación Total
              </span>
              <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{money(historyStats.sales)}</p>
            </div>

            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
                Ticket Promedio
              </span>
              <p className="text-xl font-bold text-zinc-100 font-mono mt-0.5">{money(historyStats.avg)}</p>
            </div>

            <div className="p-3 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">
                Entregadas / Canceladas
              </span>
              <p className="text-sm font-bold text-zinc-200 font-mono mt-1">
                <span className="text-emerald-400">{historyStats.delivered}</span> / <span className="text-rose-400">{historyStats.cancelled}</span>
              </p>
            </div>
          </div>

          {/* Tabla de Historial */}
          {loadingOrders && orders.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando historial...
            </div>
          ) : historyFilteredOrders.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
              <Search size={28} className="mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">No se encontraron pedidos con estos filtros</p>
              <button
                onClick={() => { setDatePreset('all'); setStatusFilter('all'); setTypeFilter('all'); setPaymentFilter('all'); setSearchFilter(''); }}
                className="text-xs font-semibold px-2.5 py-1 rounded bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300 border border-[#3e3e3e]"
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-md overflow-hidden bg-[#171717] shadow-sm">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] min-h-[320px]">
                <table className="w-full text-left border-collapse text-xs min-w-[960px]">
                  <thead className="sticky top-0 bg-[#141414] z-10 border-b border-[#2e2e2e] shadow-sm">
                    <tr className="text-zinc-400 font-medium">
                      <th className="py-2.5 px-3">#ID</th>
                      <th className="py-2.5 px-3">Fecha y Hora</th>
                      <th className="py-2.5 px-3">Cliente</th>
                      <th className="py-2.5 px-3">Modalidad</th>
                      <th className="py-2.5 px-3">Platillos</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-center">Pago</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424]">
                    {historyFilteredOrders.map(order => {
                      const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                      const statusLabel = order.status === 'ready' ? READY_LABEL[order.order_type] || cfg.label : cfg.label;
                      const items = order.items || [];
                      const created = parseTs(order.created_at);

                      return (
                        <tr key={order.id} className="hover:bg-[#1a1a1a] transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-zinc-200">
                            #{String(order.id).padStart(3, '0')}
                          </td>

                          <td className="py-2.5 px-3 text-zinc-300 font-mono text-[11px]">
                            {created ? (
                              <>
                                <div>{created.toLocaleDateString()}</div>
                                <div className="text-zinc-500">{created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </>
                            ) : '-'}
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-200">{order.customer_name || 'Cliente'}</div>
                            <div className="text-[11px] text-zinc-400 font-mono">{order.customer_phone || order.session_id}</div>
                            {order.notes && (
                              <div className="text-[10px] text-amber-300/80 truncate max-w-[180px]">📌 {order.notes}</div>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-zinc-300">
                            <span className="font-medium">{TYPE_LABEL[order.order_type] || order.order_type}</span>
                            {order.delivery_address && (
                              <div className="text-[10px] text-zinc-500 truncate max-w-[160px]">{order.delivery_address}</div>
                            )}
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="space-y-0.5 max-w-[220px]">
                              {items.slice(0, 2).map((it, idx) => (
                                <div key={idx} className="text-zinc-300 truncate text-[11px]">
                                  <span className="font-bold text-zinc-200">{it.quantity}x</span> {it.name}
                                </div>
                              ))}
                              {items.length > 2 && (
                                <span className="text-[10px] text-zinc-500 font-semibold">
                                  +{items.length - 2} platillo(s) más
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 text-sm">
                            {money(order.total)}
                          </td>

                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={(e) => handleTogglePaid(order, e)}
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all ${
                                order.payment_status === 'paid'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                              }`}
                            >
                              {order.payment_status === 'paid' ? '✓ Pagado' : 'Pendiente'}
                            </button>
                          </td>

                          <td className="py-2.5 px-3 text-center">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {statusLabel}
                            </span>
                          </td>

                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {cfg.nextStatus && (
                                <button
                                  onClick={() => handleUpdateStatus(order.id, cfg.nextStatus)}
                                  className="px-2 py-0.5 rounded text-[11px] font-semibold text-black hover:brightness-110 transition-all shadow-sm"
                                  style={{ backgroundColor: cfg.colorHex || themeColor }}
                                >
                                  {cfg.nextLabel}
                                </button>
                              )}

                              <button
                                onClick={(e) => handleOpenTicket(order, e)}
                                className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                                title="Ver / Imprimir ticket"
                              >
                                <Printer size={13} />
                              </button>

                              {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCancelTarget(order);
                                    setCancelReason('');
                                    setCancelNotify(Boolean(order.customer_phone));
                                  }}
                                  className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                  title="Cancelar comanda"
                                >
                                  <X size={13} />
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
          SUBTAB: MENÚ
          ============================================================== */}
      {subTab === 'menu' && (
        <div className="space-y-2">
          {menu.length > 0 && (
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-md">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                  placeholder="Buscar en el menú..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {['all', ...categories].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setMenuCategory(cat)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      menuCategory === cat ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    {cat === 'all' ? 'Todas' : cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loadingMenu && menu.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
              Cargando catálogo...
            </div>
          ) : menu.length === 0 ? (
            <div className="p-8 text-center bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
              <UtensilsCrossed size={36} className="mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">El menú está vacío</p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Agrega tu primer platillo o usa «Carga rápida» para pegar todo el menú de una vez.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {filteredMenu.map(item => {
                const hasStock = item.stock !== null && item.stock !== undefined;
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-md border transition-all flex flex-col justify-between ${
                      item.available ? 'bg-[#171717] border-[#2e2e2e]' : 'bg-[#0e0f14] border-zinc-800/60 opacity-60'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <span className="text-[10px] uppercase font-medium tracking-wider px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                            {item.category || 'General'}
                          </span>
                          <h3 className="text-sm font-medium text-zinc-100 mt-1">{item.name}</h3>
                        </div>
                        <span className="text-base font-medium text-emerald-400 font-mono">{money(item.price)}</span>
                      </div>
                      {item.description && <p className="text-xs text-zinc-400 leading-relaxed mb-2">{item.description}</p>}
                      {hasStock && (
                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 ${
                          item.stock === 0
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : item.stock <= 5
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}>
                          {item.stock === 0 ? 'Sin stock' : `Stock: ${item.stock}`}
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#2e2e2e] flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleToggleAvailable(item)}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border transition-all ${
                          item.available ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {item.available ? <ToggleRight size={15} className="text-emerald-400" /> : <ToggleLeft size={15} />}
                        <span>{item.available ? 'Disponible' : 'Agotado'}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setItemForm({
                              name: item.name,
                              description: item.description || '',
                              price: String(item.price),
                              category: item.category || 'General',
                              available: Boolean(item.available),
                              stock: hasStock ? String(item.stock) : ''
                            });
                            setShowItemModal(true);
                          }}
                          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
                          title="Editar platillo"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id, item.name)}
                          className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                          title="Eliminar platillo"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredMenu.length === 0 && (
                <p className="col-span-full text-center text-xs text-zinc-500 py-3">Ningún platillo coincide con la búsqueda.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB: ESTADÍSTICAS */}
      {subTab === 'stats' && <RestaurantStats apiFetch={apiFetch} apiBase={apiBase} themeColor={themeColor} />}

      {/* SUBTAB: CONFIGURACIÓN */}
      {subTab === 'settings' && (
        <RestaurantSettings
          apiFetch={apiFetch}
          apiBase={apiBase}
          themeColor={themeColor}
          showToast={showToast}
          onSaved={() => { fetchConfig(); fetchTodayStats(); }}
        />
      )}

      {/* ==============================================================
          MODALES
          ============================================================== */}

      {/* MODAL: CREAR/EDITAR PLATILLO */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-[#171717] border border-[#2e2e2e] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h3 className="text-base font-medium text-zinc-100 flex items-center gap-2">
                <UtensilsCrossed size={18} style={{ color: themeColor }} />
                <span>{editingItem ? 'Editar Platillo' : 'Nuevo Platillo del Menú'}</span>
              </h3>
              <button onClick={() => { setShowItemModal(false); setEditingItem(null); }} className="text-zinc-400 hover:text-zinc-200 p-1">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Nombre del Platillo</label>
                <input type="text" required value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Ej: Pupusa revuelta" className={inputClass} />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Precio ($)</label>
                  <input type="number" step="0.01" min="0" required value={itemForm.price} onChange={e => setItemForm({ ...itemForm, price: e.target.value })} placeholder="1.50" className={`${inputClass} font-mono`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Stock</label>
                  <input type="number" min="0" step="1" value={itemForm.stock} onChange={e => setItemForm({ ...itemForm, stock: e.target.value })} placeholder="Sin límite" className={`${inputClass} font-mono`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Categoría</label>
                  <input type="text" list="menu-categories" value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} placeholder="Bebidas" className={inputClass} />
                  <datalist id="menu-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Descripción / Ingredientes</label>
                <textarea rows={3} value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })} placeholder="Chicharrón, frijoles y queso" className={`${inputClass} leading-relaxed`} />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id="itemAvailable" checked={itemForm.available} onChange={e => setItemForm({ ...itemForm, available: e.target.checked })} className="w-4 h-4 rounded-md bg-[#121212] border-[#2e2e2e]" />
                <label htmlFor="itemAvailable" className="text-xs text-zinc-300 cursor-pointer">Disponible de inmediato para pedidos</label>
              </div>

              <div className="pt-2 border-t border-[#2e2e2e] flex items-center justify-end gap-2">
                <button type="button" onClick={() => { setShowItemModal(false); setEditingItem(null); }} className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200">
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingItem} className="px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: themeColor }}>
                  {isSavingItem ? 'Guardando...' : (editingItem ? 'Guardar Cambios' : 'Agregar Platillo')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CARGA RÁPIDA DE MENÚ */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-[#171717] border border-[#2e2e2e] rounded-md p-4 space-y-2 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h3 className="text-base font-medium text-zinc-100">📋 Carga rápida del menú</h3>
              <button onClick={() => setShowBulkModal(false)} className="text-zinc-400 hover:text-zinc-200 p-1"><X size={18} /></button>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Pega un platillo por línea con el formato:<br />
              <code className="text-emerald-400 font-mono">Nombre | precio | categoría | descripción</code>
            </p>
            <textarea
              rows={8}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder="Pupusa de queso | 1.25 | Pupusas | Queso con curtido y salsa&#10;Limonada con menta | 2.50 | Bebidas | Natural frappé"
              className={`${inputClass} font-mono leading-relaxed`}
            />
            <div className="pt-2 border-t border-[#2e2e2e] flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowBulkModal(false)} className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200">
                Cancelar
              </button>
              <button type="button" onClick={handleImportBulk} disabled={isImporting || !bulkText.trim()} className="px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: themeColor }}>
                {isImporting ? 'Importando...' : 'Importar platillos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TICKET DE COCINA */}
      {ticket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm bg-[#171717] border border-[#2e2e2e] rounded-md p-4 space-y-2 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h3 className="text-sm font-semibold text-zinc-100">Ticket de cocina #{ticket.id}</h3>
              <button onClick={() => setTicket(null)} className="text-zinc-400 hover:text-zinc-200 p-1"><X size={16} /></button>
            </div>
            <pre className="p-3 bg-black/40 border border-[#262626] rounded-md text-[11px] font-mono text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
              {ticket.text}
            </pre>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
              <button onClick={handleCopyTicket} className="px-3 py-1.5 rounded-md text-xs font-medium border border-[#3e3e3e] bg-[#232323] hover:bg-[#2e2e2e] text-zinc-300">
                Copiar
              </button>
              <button onClick={handlePrintTicket} className="px-3 py-1.5 rounded-md text-xs font-semibold text-black hover:brightness-110" style={{ backgroundColor: themeColor }}>
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CANCELAR ORDEN */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-[#171717] border border-[#2e2e2e] rounded-md p-4 space-y-2 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-1.5">
                <AlertCircle size={16} />
                <span>Cancelar pedido #{cancelTarget.id}</span>
              </h3>
              <button onClick={() => setCancelTarget(null)} className="text-zinc-400 hover:text-zinc-200 p-1"><X size={16} /></button>
            </div>
            <p className="text-xs text-zinc-300">
              Cliente: <b className="text-zinc-100">{cancelTarget.customer_name}</b> ({cancelTarget.customer_phone || cancelTarget.session_id})
            </p>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Motivo de cancelación</label>
              <input
                type="text"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Ej: Producto agotado / Cliente no respondió"
                className={inputClass}
                autoFocus
              />
            </div>
            {cancelTarget.customer_phone && (
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={cancelNotify}
                  onChange={e => setCancelNotify(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#121212] border-[#2e2e2e]"
                />
                <span>Avisar al cliente por WhatsApp con el motivo</span>
              </label>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2e2e2e]">
              <button onClick={() => setCancelTarget(null)} className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200">
                Volver
              </button>
              <button onClick={handleConfirmCancel} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-colors">
                Confirmar cancelación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TOMAR ORDEN MANUAL */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-[#171717] border border-[#2e2e2e] rounded-md p-4 space-y-2 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#2e2e2e]">
              <h3 className="text-base font-medium text-zinc-100 flex items-center gap-2">
                <ShoppingBag size={18} style={{ color: themeColor }} />
                <span>Tomar Orden Manual</span>
              </h3>
              <button onClick={() => setShowNewOrderModal(false)} className="text-zinc-400 hover:text-zinc-200 p-1"><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">WhatsApp o Teléfono *</label>
                  <input type="text" required value={orderForm.session_id} onChange={e => setOrderForm({ ...orderForm, session_id: e.target.value })} placeholder="Ej: 50371234567" className={`${inputClass} font-mono`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Nombre del Cliente</label>
                  <input type="text" value={orderForm.customer_name} onChange={e => setOrderForm({ ...orderForm, customer_name: e.target.value })} placeholder="Ej: Daniel Hernández" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Tipo de pedido</label>
                  <select value={orderForm.order_type} onChange={e => setOrderForm({ ...orderForm, order_type: e.target.value })} className={inputClass}>
                    {enabledTypes.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Método de pago</label>
                  <select value={orderForm.payment_method} onChange={e => setOrderForm({ ...orderForm, payment_method: e.target.value })} className={inputClass}>
                    {enabledPayments.map(p => <option key={p} value={p}>{PAYMENT_LABEL[p]}</option>)}
                  </select>
                </div>
              </div>

              {orderForm.order_type === 'delivery' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className={zones.length ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">Dirección de entrega *</label>
                    <input type="text" required value={orderForm.delivery_address} onChange={e => setOrderForm({ ...orderForm, delivery_address: e.target.value })} placeholder="Colonia, calle, casa y referencia" className={inputClass} />
                  </div>
                  {zones.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">Zona *</label>
                      <select value={orderForm.delivery_zone} onChange={e => setOrderForm({ ...orderForm, delivery_zone: e.target.value })} className={inputClass}>
                        {zones.map(z => <option key={z.name} value={z.name}>{z.name} · envío {money(z.fee)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Notas / Mesa / Instrucciones</label>
                <input type="text" value={orderForm.notes} onChange={e => setOrderForm({ ...orderForm, notes: e.target.value })} placeholder="Ej: Mesa 4 / Sin picante" className={inputClass} />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-300">Seleccionar Platillos del Menú</label>
                <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-[#121212] border border-[#2e2e2e] rounded-md">
                  {menu.filter(m => m.available).map(m => {
                    const existing = orderForm.items.find(i => i.menu_item_id === m.id);
                    const qty = existing ? existing.quantity : 0;
                    const atLimit = m.stock !== null && m.stock !== undefined && qty >= m.stock;
                    return (
                      <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-[#171717] border border-[#262626] text-xs">
                        <div>
                          <span className="font-semibold text-zinc-200">{m.name}</span>
                          <span className="text-emerald-400 font-mono ml-2">{money(m.price)}</span>
                          {m.stock !== null && m.stock !== undefined && (
                            <span className="text-[10px] text-zinc-500 ml-1.5">(disp: {m.stock})</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {qty > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = orderForm.items
                                  .map(i => (i.menu_item_id === m.id ? { ...i, quantity: i.quantity - 1 } : i))
                                  .filter(i => i.quantity > 0);
                                setOrderForm({ ...orderForm, items: next });
                              }}
                              className="w-5 h-5 rounded bg-[#232323] hover:bg-[#2e2e2e] text-zinc-200 flex items-center justify-center font-bold text-xs"
                            >
                              -
                            </button>
                          )}
                          <span className="w-4 text-center font-mono font-bold text-zinc-100 text-xs">{qty}</span>
                          <button
                            type="button"
                            disabled={atLimit}
                            onClick={() => {
                              const exists = orderForm.items.find(i => i.menu_item_id === m.id);
                              let next;
                              if (exists) {
                                next = orderForm.items.map(i => (i.menu_item_id === m.id ? { ...i, quantity: i.quantity + 1 } : i));
                              } else {
                                next = [...orderForm.items, { menu_item_id: m.id, quantity: 1, notes: '' }];
                              }
                              setOrderForm({ ...orderForm, items: next });
                            }}
                            className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 flex items-center justify-center font-bold text-xs disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Total Comanda */}
              <div className="p-2.5 bg-[#121212] border border-[#2e2e2e] rounded-md flex items-center justify-between text-xs">
                <span className="text-zinc-400">Total Comanda:</span>
                <span className="text-sm font-bold text-emerald-400 font-mono">
                  {money(orderForm.items.reduce((sum, it) => {
                    const menuItem = menu.find(m => m.id === it.menu_item_id);
                    return sum + ((menuItem?.price || 0) * it.quantity);
                  }, 0))}
                </span>
              </div>

              <div className="pt-2 border-t border-[#2e2e2e] flex items-center justify-end gap-2">
                <button type="button" onClick={() => setShowNewOrderModal(false)} className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200">
                  Cancelar
                </button>
                <button type="submit" disabled={isCreatingOrder || orderForm.items.length === 0} className="px-3 py-1.5 rounded-md text-xs font-medium text-black hover:brightness-110 disabled:opacity-50" style={{ backgroundColor: themeColor }}>
                  {isCreatingOrder ? 'Creando...' : 'Enviar Orden a Cocina'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
