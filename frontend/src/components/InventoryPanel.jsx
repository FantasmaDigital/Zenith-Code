import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes,
  Package,
  Plus,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Layers,
  ChefHat,
  Trash2,
  Edit2,
  ShoppingBag,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  X,
  PlusCircle,
  FileText,
  Sliders,
  UtensilsCrossed,
  ArrowLeftRight,
  HelpCircle,
  Eye,
  Image as ImageIcon
} from 'lucide-react';

const ITEM_TYPES = [
  { id: 'all', label: 'Todos los tipos' },
  { id: 'raw_material', label: 'Insumos / Materias Primas', icon: Layers, badge: 'Insumo', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'product', label: 'Productos de Reventa', icon: Package, badge: 'Reventa', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  { id: 'composite', label: 'Platos / Compuestos', icon: ChefHat, badge: 'Receta', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
];

const COMMON_UNITS = [
  { id: 'pza', label: 'Pieza / Unidad (pza)' },
  { id: 'kg', label: 'Kilogramo (kg)' },
  { id: 'g', label: 'Gramo (g)' },
  { id: 'l', label: 'Litro (l)' },
  { id: 'ml', label: 'Mililitro (ml)' },
  { id: 'caja', label: 'Caja' },
  { id: 'paquete', label: 'Paquete' }
];

const WASTE_REASONS = [
  { id: 'caducidad', label: 'Caducidad / Vencimiento' },
  { id: 'preparacion', label: 'Error de preparación / Cocina' },
  { id: 'danado', label: 'Dañado / Descomposición' },
  { id: 'merma_natural', label: 'Merma natural (limpieza/corte)' },
  { id: 'otro', label: 'Otro motivo' }
];

const SECTION_INFO = {
  stock: {
    title: 'Existencias & Catálogo de Artículos',
    description: 'Control de materias primas, productos de reventa y stocks mínimos con semáforo de existencias.',
    icon: Boxes
  },
  recipes: {
    title: 'Fichas Técnicas & Recetas (BOM)',
    description: 'Composición de materias primas por porción y costeo teórico de platos o productos compuestos.',
    icon: ChefHat
  },
  purchases: {
    title: 'Entradas & Compras a Proveedores',
    description: 'Recepción de mercancía con recálculo de costo promedio y enlace automático con Caja & Finanzas.',
    icon: ShoppingBag
  },
  waste: {
    title: 'Mermas & Bajas de Inventario',
    description: 'Control y justificación de pérdidas por caducidad, preparación o roturas con impacto en costo.',
    icon: Trash2
  },
  kardex: {
    title: 'Kardex / Historial de Movimientos',
    description: 'Auditoría inmutable de cada entrada, venta, merma o ajuste con trazabilidad por orden y fecha.',
    icon: ArrowLeftRight
  }
};

export default function InventoryPanel({
  apiFetch,
  apiBase,
  themeColor,
  themeRgb,
  showToast,
  subTab = 'stock',
  setSubTab
}) {
  const [stats, setStats] = useState({
    total_items: 0,
    raw_materials_count: 0,
    products_count: 0,
    composites_count: 0,
    total_valuation: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    month_waste_total: 0
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Modales
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    sku: '',
    description: '',
    category: 'general',
    item_type: 'raw_material',
    unit: 'kg',
    cost_price: 0,
    selling_price: 0,
    initial_stock: 0,
    min_stock: 5,
    track_stock: true
  });

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustNewStock, setAdjustNewStock] = useState(0);
  const [adjustReason, setAdjustReason] = useState('Conteo físico de inventario');
  const [adjustNotes, setAdjustNotes] = useState('');

  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    item_id: '',
    quantity: 1,
    unit_cost: 0,
    supplier: '',
    invoice_ref: '',
    payment_method: 'cash',
    create_finance_expense: true,
    notes: ''
  });

  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteForm, setWasteForm] = useState({
    item_id: '',
    quantity: 1,
    reason: 'caducidad',
    notes: ''
  });

  // Recetas / Fichas Técnicas
  const [recipes, setRecipes] = useState([]);
  const [activeRecipeComposite, setActiveRecipeComposite] = useState(null);
  const [recipeIngredients, setRecipeIngredients] = useState([]);
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [isCreatingNewPlate, setIsCreatingNewPlate] = useState(false);
  const [recipePlateForm, setRecipePlateForm] = useState({
    name: '',
    category: 'Hamburguesas',
    selling_price: '',
    description: '',
    image_url: ''
  });

  // Kardex
  const [movements, setMovements] = useState([]);
  const [movFilterType, setMovFilterType] = useState('all');
  const [movFilterItem, setMovFilterItem] = useState('');

  const [isSyncingRest, setIsSyncingRest] = useState(false);

  // ------------------------------------------------------------------
  // CARGAS DE DATOS
  // ------------------------------------------------------------------
  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/stats`);
      if (res.ok) setStats(await res.json());
    } catch (e) {
      console.error('Error cargando stats de inventario:', e);
    }
  }, [apiFetch, apiBase]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (selectedType !== 'all') q.set('item_type', selectedType);
      if (selectedCategory !== 'all') q.set('category', selectedCategory);
      if (search.trim()) q.set('search', search.trim());
      if (lowStockOnly) q.set('low_stock_only', 'true');

      const res = await apiFetch(`${apiBase}/api/inventory/items?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (e) {
      if (showToast) showToast('Error cargando catálogo de inventario', true);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, apiBase, selectedType, selectedCategory, search, lowStockOnly]);

  const loadRecipes = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/recipes`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } catch (e) {
      console.error('Error cargando recetas:', e);
    }
  }, [apiFetch, apiBase]);

  const loadMovements = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (movFilterType !== 'all') q.set('movement_type', movFilterType);
      if (movFilterItem) q.set('item_id', movFilterItem);
      q.set('limit', '100');

      const res = await apiFetch(`${apiBase}/api/inventory/movements?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMovements(data.movements || []);
      }
    } catch (e) {
      console.error('Error cargando Kardex:', e);
    }
  }, [apiFetch, apiBase, movFilterType, movFilterItem]);

  // Carga inicial segura (solo al montar)
  useEffect(() => {
    loadStats();
    loadItems();
  }, []);

  // Recarga al cambiar filtros de artículos
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Recarga sub-pantallas bajo demanda
  useEffect(() => {
    if (subTab === 'recipes') {
      loadRecipes();
    } else if (subTab === 'kardex') {
      loadMovements();
    }
  }, [subTab, loadRecipes, loadMovements]);

  // Lista única de categorías
  const categories = useMemo(() => {
    const set = new Set();
    items.forEach(i => { if (i.category) set.add(i.category); });
    return Array.from(set).sort();
  }, [items]);

  // Insumos crudos para usar en selectores de recetas
  const rawMaterialItems = useMemo(() => {
    return items.filter(i => i.item_type === 'raw_material' || i.item_type === 'product');
  }, [items]);

  // Platos o compuestos para recetas
  const compositeItems = useMemo(() => {
    return items.filter(i => i.item_type === 'composite');
  }, [items]);

  // ------------------------------------------------------------------
  // ACCIONES: ARTÍCULO
  // ------------------------------------------------------------------
  const handleOpenNewItem = () => {
    setEditingItem(null);
    setItemForm({
      name: '',
      sku: '',
      description: '',
      category: 'general',
      item_type: 'raw_material',
      unit: 'kg',
      cost_price: 0,
      selling_price: 0,
      initial_stock: 0,
      min_stock: 5,
      track_stock: true,
      image_url: ''
    });
    setShowItemModal(true);
  };

  const handleOpenEditItem = (item) => {
    setEditingItem(item);
    setItemForm({
      name: item.name || '',
      sku: item.sku || '',
      description: item.description || '',
      category: item.category || 'general',
      item_type: item.item_type || 'product',
      unit: item.unit || 'pza',
      cost_price: item.cost_price || 0,
      selling_price: item.selling_price || 0,
      initial_stock: item.current_stock || 0,
      min_stock: item.min_stock || 0,
      track_stock: item.track_stock !== false,
      image_url: item.image_url || ''
    });
    setShowItemModal(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        const res = await apiFetch(`${apiBase}/api/inventory/items/${editingItem.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemForm)
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Artículo actualizado con éxito.');
      } else {
        const res = await apiFetch(`${apiBase}/api/inventory/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemForm)
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Artículo creado con éxito.');
      }
      setShowItemModal(false);
      loadItems();
      loadStats();
    } catch (err) {
      showToast('Error al guardar artículo: ' + err.message, true);
    }
  };

  const handleDeleteItem = async (id, name) => {
    if (!window.confirm(`¿Seguro que deseas eliminar o archivar "${name}"?`)) return;
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/items/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Artículo eliminado/archivado.');
      loadItems();
      loadStats();
    } catch (err) {
      showToast('Error eliminando: ' + err.message, true);
    }
  };

  // ------------------------------------------------------------------
  // ACCIONES: AJUSTE DE STOCK
  // ------------------------------------------------------------------
  const handleOpenAdjust = (item) => {
    setAdjustTarget(item);
    setAdjustNewStock(item.current_stock);
    setAdjustReason('Conteo físico de inventario');
    setAdjustNotes('');
    setShowAdjustModal(true);
  };

  const handleSaveAdjust = async (e) => {
    e.preventDefault();
    if (!adjustTarget) return;
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/items/${adjustTarget.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_stock: parseFloat(adjustNewStock),
          reason: adjustReason,
          notes: adjustNotes
        })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`Stock de "${adjustTarget.name}" ajustado a ${adjustNewStock} ${adjustTarget.unit}.`);
      setShowAdjustModal(false);
      loadItems();
      loadStats();
    } catch (err) {
      showToast('Error al ajustar stock: ' + err.message, true);
    }
  };

  // ------------------------------------------------------------------
  // ACCIONES: ENTRADA / COMPRA
  // ------------------------------------------------------------------
  const handleOpenPurchase = (presetItem = null) => {
    setPurchaseForm({
      item_id: presetItem ? String(presetItem.id) : (items[0] ? String(items[0].id) : ''),
      quantity: 1,
      unit_cost: presetItem ? presetItem.cost_price : 0,
      supplier: '',
      invoice_ref: '',
      payment_method: 'cash',
      create_finance_expense: true,
      notes: ''
    });
    setShowPurchaseModal(true);
  };

  const handleSavePurchase = async (e) => {
    e.preventDefault();
    if (!purchaseForm.item_id) {
      showToast('Selecciona un artículo.', true);
      return;
    }
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: parseInt(purchaseForm.item_id, 10),
          quantity: parseFloat(purchaseForm.quantity),
          unit_cost: parseFloat(purchaseForm.unit_cost),
          supplier: purchaseForm.supplier,
          invoice_ref: purchaseForm.invoice_ref,
          payment_method: purchaseForm.payment_method,
          create_finance_expense: purchaseForm.create_finance_expense,
          notes: purchaseForm.notes
        })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Entrada de compra registrada exitosamente.');
      setShowPurchaseModal(false);
      loadItems();
      loadStats();
      if (subTab === 'kardex') loadMovements();
    } catch (err) {
      showToast('Error registrando compra: ' + err.message, true);
    }
  };

  // ------------------------------------------------------------------
  // ACCIONES: MERMA
  // ------------------------------------------------------------------
  const handleOpenWaste = (presetItem = null) => {
    setWasteForm({
      item_id: presetItem ? String(presetItem.id) : (items[0] ? String(items[0].id) : ''),
      quantity: 1,
      reason: 'caducidad',
      notes: ''
    });
    setShowWasteModal(true);
  };

  const handleSaveWaste = async (e) => {
    e.preventDefault();
    if (!wasteForm.item_id) {
      showToast('Selecciona un artículo.', true);
      return;
    }
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/waste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: parseInt(wasteForm.item_id, 10),
          quantity: parseFloat(wasteForm.quantity),
          reason: wasteForm.reason,
          notes: wasteForm.notes
        })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Merma registrada y stock deducido.');
      setShowWasteModal(false);
      loadItems();
      loadStats();
      if (subTab === 'kardex') loadMovements();
    } catch (err) {
      showToast('Error registrando merma: ' + err.message, true);
    }
  };

  // ------------------------------------------------------------------
  // ACCIONES: RECETAS / PLATOS COMPUESTOS
  // ------------------------------------------------------------------
  const handleSelectRecipeComposite = async (comp) => {
    setIsCreatingNewPlate(false);
    setActiveRecipeComposite(comp);
    setRecipePlateForm({
      name: comp.name || '',
      category: comp.category || 'Hamburguesas',
      selling_price: comp.selling_price ? String(comp.selling_price) : '',
      description: comp.description || '',
      image_url: comp.image_url || ''
    });
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/recipes/${comp.id}`);
      if (res.ok) {
        const data = await res.json();
        setRecipeIngredients(data.ingredients || []);
      }
    } catch (e) {
      showToast('Error cargando ingredientes de la receta', true);
    }
  };

  const handleStartNewPlate = () => {
    setIsCreatingNewPlate(true);
    setActiveRecipeComposite(null);
    setRecipePlateForm({
      name: '',
      category: 'Hamburguesas',
      selling_price: '',
      description: '',
      image_url: ''
    });
    setRecipeIngredients([]);
  };

  const handleAddRecipeIngredient = () => {
    if (rawMaterialItems.length === 0) {
      showToast('Debes crear primero insumos en el catálogo para agregarlos a una receta.', true);
      return;
    }
    const defaultIng = rawMaterialItems[0];
    setRecipeIngredients(prev => [
      ...prev,
      {
        ingredient_item_id: defaultIng.id,
        ingredient_name: defaultIng.name,
        quantity: 0.1,
        unit: defaultIng.unit || 'kg',
        ingredient_cost: defaultIng.cost_price || 0,
        subtotal_cost: (0.1 * (defaultIng.cost_price || 0))
      }
    ]);
  };

  const handleUpdateRecipeRow = (index, field, value) => {
    setRecipeIngredients(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      if (field === 'ingredient_item_id') {
        const selectedIng = rawMaterialItems.find(i => i.id === parseInt(value, 10));
        row.ingredient_item_id = parseInt(value, 10);
        row.ingredient_name = selectedIng ? selectedIng.name : '';
        row.unit = selectedIng ? selectedIng.unit : 'kg';
        row.ingredient_cost = selectedIng ? selectedIng.cost_price : 0;
        row.subtotal_cost = (row.quantity || 0) * row.ingredient_cost;
      } else if (field === 'quantity') {
        row.quantity = parseFloat(value) || 0;
        row.subtotal_cost = row.quantity * (row.ingredient_cost || 0);
      } else if (field === 'unit') {
        row.unit = value;
      }
      next[index] = row;
      return next;
    });
  };

  const handleRemoveRecipeRow = (index) => {
    setRecipeIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveRecipe = async () => {
    const plateName = (recipePlateForm.name || '').trim();
    if (!plateName) {
      showToast('Ingresa el nombre del plato / hamburguesa.', true);
      return;
    }
    const priceNum = parseFloat(recipePlateForm.selling_price);
    if (isNaN(priceNum) || priceNum < 0) {
      showToast('Ingresa un precio de venta válido.', true);
      return;
    }

    setIsSavingRecipe(true);
    try {
      let compId = activeRecipeComposite?.id;

      if (isCreatingNewPlate || !compId) {
        // 1. Crear el plato compuesto en inventario (sincronizará a restaurant_menu)
        const createRes = await apiFetch(`${apiBase}/api/inventory/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: plateName,
            category: (recipePlateForm.category || 'Hamburguesas').trim(),
            item_type: 'composite',
            unit: 'pza',
            selling_price: priceNum,
            description: (recipePlateForm.description || '').trim(),
            image_url: (recipePlateForm.image_url || '').trim(),
            track_stock: true,
            min_stock: 5,
            initial_stock: 0
          })
        });
        if (!createRes.ok) throw new Error(await createRes.text());
        const createdPlate = await createRes.json();
        compId = createdPlate.id;
        setActiveRecipeComposite(createdPlate);
        setIsCreatingNewPlate(false);
      }

      // 2. Guardar escandallo / ingredientes y actualizar metadatos comerciales
      const payload = {
        composite_item_id: compId,
        ingredients: recipeIngredients.map(ing => ({
          ingredient_item_id: ing.ingredient_item_id,
          quantity: ing.quantity,
          unit: ing.unit
        })),
        name: plateName,
        description: (recipePlateForm.description || '').trim(),
        category: (recipePlateForm.category || 'General').trim(),
        selling_price: priceNum,
        image_url: (recipePlateForm.image_url || '').trim()
      };

      const res = await apiFetch(`${apiBase}/api/inventory/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());

      showToast(`Plato "${plateName}" y su receta guardados y sincronizados con el Menú.`);
      await loadRecipes();
      await loadItems();
    } catch (err) {
      showToast('Error guardando receta: ' + err.message, true);
    } finally {
      setIsSavingRecipe(false);
    }
  };

  // ------------------------------------------------------------------
  // SINCRONIZACIÓN AUTOMÁTICA DESDE RESTAURANTE
  // ------------------------------------------------------------------
  const handleSyncFromRestaurant = async () => {
    setIsSyncingRest(true);
    try {
      const res = await apiFetch(`${apiBase}/api/inventory/sync-restaurant`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      showToast(`Sincronización completada: se importaron ${data.imported_count || 0} platos/bebidas.`);
      loadItems();
      loadStats();
    } catch (err) {
      showToast('Error al sincronizar menú de restaurante: ' + err.message, true);
    } finally {
      setIsSyncingRest(false);
    }
  };

  const totalRecipeCost = useMemo(() => {
    return recipeIngredients.reduce((acc, row) => acc + (row.subtotal_cost || 0), 0);
  }, [recipeIngredients]);

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  const currentSection = SECTION_INFO[subTab] || SECTION_INFO.stock;
  const SectionIcon = currentSection.icon;

  return (
    <div className="space-y-6 pb-16 animate-fadeIn">
      {/* Header Contextual por Sub-sección */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold shadow-sm"
              style={{ backgroundColor: `${themeColor}20`, color: themeColor }}
            >
              <SectionIcon size={18} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              {currentSection.title}
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
            {currentSection.description}
          </p>
        </div>

        {/* Acciones contextuales a la sub-sección activa */}
        <div className="flex items-center gap-2 flex-wrap">
          {subTab === 'stock' && (
            <button
              onClick={handleOpenNewItem}
              style={{ backgroundColor: themeColor }}
              className="px-3 py-1.5 rounded-md text-black text-xs font-semibold flex items-center gap-1.5 shadow-sm hover:brightness-110 transition-all"
            >
              <Plus size={14} />
              <span>Nuevo Artículo</span>
            </button>
          )}

          {subTab === 'recipes' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400 bg-[#171717] border border-[#2e2e2e] px-2.5 py-1.5 rounded-md hidden sm:flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Sincronización con Menú activa</span>
              </span>
              <button
                onClick={handleStartNewPlate}
                style={{ backgroundColor: themeColor }}
                className="px-3 py-1.5 rounded-md text-black text-xs font-semibold flex items-center gap-1.5 shadow-sm hover:brightness-110 transition-all"
              >
                <Plus size={14} />
                <span>+ Nuevo Plato / Receta</span>
              </button>
            </div>
          )}

          {subTab === 'purchases' && (
            <button
              onClick={() => handleOpenPurchase()}
              style={{ backgroundColor: themeColor }}
              className="px-3 py-1.5 rounded-md text-black text-xs font-semibold flex items-center gap-1.5 shadow-sm hover:brightness-110 transition-all"
            >
              <ArrowDownRight size={13} />
              <span>Nueva Entrada / Compra</span>
            </button>
          )}

          {subTab === 'waste' && (
            <button
              onClick={() => handleOpenWaste()}
              className="px-3 py-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 size={13} />
              <span>Registrar Merma</span>
            </button>
          )}

          {subTab === 'kardex' && (
            <button
              onClick={loadMovements}
              className="px-3 py-1.5 rounded-md border border-[#2e2e2e] bg-[#171717] hover:bg-zinc-800 text-xs font-medium text-zinc-300 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={13} />
              <span>Actualizar</span>
            </button>
          )}
        </div>
      </div>

      {/* ==============================================================
          SUBTAB 1: EXISTENCIAS Y CATÁLOGO
          ============================================================== */}
      {subTab === 'stock' && (
        <div className="space-y-4">
          {/* Métricas Resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-lg">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Total Artículos</span>
                <Boxes size={14} className="text-zinc-500" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100">{stats.total_items}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {stats.raw_materials_count} insumos • {stats.products_count} reventa • {stats.composites_count} recetas
              </div>
            </div>

            <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-lg">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Valorización del Inventario</span>
                <DollarSign size={14} style={{ color: themeColor }} />
              </div>
              <div className="mt-1 text-2xl font-semibold" style={{ color: themeColor }}>
                ${stats.total_valuation.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Costo total acumulado en almacén</div>
            </div>

            <div className={`p-3.5 bg-[#171717] border rounded-lg ${stats.low_stock_count > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-[#2e2e2e]'}`}>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Alertas de Stock Bajo</span>
                <AlertTriangle size={14} className={stats.low_stock_count > 0 ? 'text-amber-400' : 'text-zinc-500'} />
              </div>
              <div className={`mt-1 text-2xl font-semibold ${stats.low_stock_count > 0 ? 'text-amber-300' : 'text-zinc-100'}`}>
                {stats.low_stock_count}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {stats.out_of_stock_count > 0 ? `${stats.out_of_stock_count} totalmente agotados` : 'Existencias saludables'}
              </div>
            </div>

            <div className="p-3.5 bg-[#171717] border border-[#2e2e2e] rounded-lg">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Mermas del Mes</span>
                <TrendingDown size={14} className="text-rose-400" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-rose-400">
                ${stats.month_waste_total.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Pérdidas registradas por descarte</div>
            </div>
          </div>
          {/* Barra de Filtros */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#171717] p-3 rounded-lg border border-[#2e2e2e]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, SKU o categoría..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-emerald-400 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 outline-none transition-colors"
                />
              </div>

              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-300 outline-none"
              >
                {ITEM_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              {categories.length > 0 && (
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-300 outline-none"
                >
                  <option value="all">Todas las categorías</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(e) => setLowStockOnly(e.target.checked)}
                className="rounded border-[#2e2e2e] bg-zinc-900 text-amber-500 focus:ring-0"
              />
              <span className={lowStockOnly ? 'text-amber-400 font-medium' : ''}>Solo con stock bajo</span>
            </label>
          </div>

          {/* Tabla de Artículos */}
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                  <tr>
                    <th className="px-4 py-3">Artículo</th>
                    <th className="px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Categoría</th>
                    <th className="px-3 py-3">Stock Actual</th>
                    <th className="px-3 py-3">Stock Mínimo</th>
                    <th className="px-3 py-3 text-right">Costo Promedio</th>
                    <th className="px-3 py-3 text-right">Precio Venta</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242424]">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-zinc-500">
                        <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-zinc-400" />
                        Cargando inventario...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-zinc-500">
                        <Boxes size={24} className="mx-auto mb-2 text-zinc-600" />
                        No se encontraron artículos con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    items.map(item => {
                      const typeMeta = ITEM_TYPES.find(t => t.id === item.item_type) || ITEM_TYPES[1];
                      const isLow = item.is_low_stock;
                      const isOut = item.is_out_of_stock;

                      return (
                        <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-zinc-100">
                            <div className="flex items-center gap-2">
                              <span>{item.name}</span>
                              {item.sku && (
                                <span className="text-[10px] text-zinc-500 font-mono">({item.sku})</span>
                              )}
                            </div>
                            {item.description && (
                              <div className="text-[11px] text-zinc-500 line-clamp-1">{item.description}</div>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${typeMeta.color}`}>
                              {typeMeta.badge}
                            </span>
                          </td>
                          <td className="px-3 py-3 capitalize text-zinc-400">
                            {item.category || 'general'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  !item.track_stock
                                    ? 'bg-zinc-600'
                                    : isOut
                                      ? 'bg-rose-500 animate-pulse'
                                      : isLow
                                        ? 'bg-amber-400 animate-pulse'
                                        : 'bg-emerald-400'
                                }`}
                              />
                              <span className={`font-semibold ${isOut ? 'text-rose-400' : isLow ? 'text-amber-300' : 'text-zinc-100'}`}>
                                {item.current_stock}
                              </span>
                              <span className="text-[11px] text-zinc-500">{item.unit}</span>
                              {isOut && (
                                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider bg-rose-500/10 px-1 rounded">Agotado</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-zinc-400">
                            {item.track_stock ? `${item.min_stock} ${item.unit}` : 'No aplica'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-zinc-300">
                            ${item.cost_price.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-medium text-zinc-200">
                            {item.selling_price > 0 ? `$${item.selling_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {item.track_stock && (
                                <button
                                  onClick={() => handleOpenAdjust(item)}
                                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                                  title="Ajuste rápido de existencias"
                                >
                                  <Sliders size={13} />
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenPurchase(item)}
                                className="p-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-colors"
                                title="Registrar compra de este ítem"
                              >
                                <ArrowDownRight size={13} />
                              </button>
                              <button
                                onClick={() => handleOpenEditItem(item)}
                                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                                title="Editar artículo"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id, item.name)}
                                className="p-1 rounded bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors"
                                title="Eliminar / Desactivar"
                              >
                                <Trash2 size={13} />
                              </button>
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

      {/* ==============================================================
          SUBTAB 2: FICHAS TÉCNICAS / RECETAS (BOM)
          ============================================================== */}
      {subTab === 'recipes' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Lista lateral de platos / compuestos */}
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#262626]">
              <div>
                <span className="text-xs font-semibold uppercase text-zinc-300">Platos & Compuestos</span>
                <span className="text-[10px] text-zinc-500 block">{compositeItems.length} platos en catálogo</span>
              </div>
              <button
                onClick={handleStartNewPlate}
                style={{ backgroundColor: `${themeColor}20`, color: themeColor, borderColor: `${themeColor}40` }}
                className="px-2 py-1 rounded text-[11px] font-semibold border flex items-center gap-1 hover:brightness-125 transition-all"
                title="Crear un nuevo plato con receta"
              >
                <Plus size={12} />
                <span>Nuevo</span>
              </button>
            </div>

            {compositeItems.length === 0 ? (
              <div className="text-center py-8 text-xs text-zinc-500">
                <ChefHat size={24} className="mx-auto mb-2 text-zinc-600" />
                No hay platos tipo "Compuesto" aún.
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={handleStartNewPlate}
                    style={{ backgroundColor: themeColor }}
                    className="px-3 py-1.5 rounded text-black font-semibold text-xs mx-auto shadow"
                  >
                    + Crear Primer Plato
                  </button>
                  <button
                    onClick={handleSyncFromRestaurant}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Importar platos del Menú
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[580px] overflow-y-auto pr-0.5">
                {compositeItems.map(comp => {
                  const isSelected = activeRecipeComposite?.id === comp.id && !isCreatingNewPlate;
                  const recipeData = recipes.find(r => r.id === comp.id);
                  const ingCount = recipeData ? recipeData.ingredients.length : 0;

                  return (
                    <button
                      key={comp.id}
                      onClick={() => handleSelectRecipeComposite(comp)}
                      className={`w-full p-2 rounded-lg text-left text-xs transition-all flex items-center gap-2.5 ${
                        isSelected
                          ? 'bg-zinc-800 text-white font-medium border border-emerald-500/40 shadow-sm'
                          : 'hover:bg-zinc-800/60 text-zinc-300 border border-transparent'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-md bg-[#121212] border border-[#2e2e2e] shrink-0 overflow-hidden flex items-center justify-center">
                        {comp.image_url ? (
                          <img
                            src={comp.image_url}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <ChefHat size={16} className="text-zinc-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-zinc-100">{comp.name}</div>
                        <div className="text-[11px] text-zinc-400 font-mono">${(comp.selling_price || 0).toFixed(2)}</div>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                        ingCount > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {ingCount > 0 ? `${ingCount} insumos` : 'Sin receta'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Editor de Receta / Ficha Técnica & Comercial */}
          <div className="md:col-span-2 bg-[#171717] border border-[#2e2e2e] rounded-lg p-5 space-y-4">
            {!activeRecipeComposite && !isCreatingNewPlate ? (
              <div className="text-center py-20 text-zinc-500">
                <ChefHat size={36} className="mx-auto mb-3 text-zinc-600" />
                <div className="text-sm font-medium text-zinc-200">Selecciona o crea un plato para configurar su receta</div>
                <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
                  Define la presentación comercial (nombre, foto, descripción y precio de venta para tus clientes) y los insumos que se descontarán automáticamente de almacén en cada orden.
                </p>
                <div className="mt-4">
                  <button
                    onClick={handleStartNewPlate}
                    style={{ backgroundColor: themeColor }}
                    className="px-4 py-2 rounded-md text-black font-semibold text-xs shadow hover:brightness-110 transition-all inline-flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>+ Crear Nuevo Plato con Receta</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-[#262626]">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-100">
                      {isCreatingNewPlate ? 'Nuevo Plato / Receta Comercial' : `Ficha Técnica: ${recipePlateForm.name || activeRecipeComposite?.name}`}
                    </h2>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      Configuración para clientes (Menú, WhatsApp, Web) y escandallo de almacén.
                    </div>
                  </div>

                  {isCreatingNewPlate && compositeItems.length > 0 && (
                    <button
                      onClick={() => {
                        setIsCreatingNewPlate(false);
                        if (compositeItems.length > 0) handleSelectRecipeComposite(compositeItems[0]);
                      }}
                      className="px-2.5 py-1 rounded border border-[#333] hover:bg-zinc-800 text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {/* 1. SECCIÓN COMERCIAL (Nombre, Foto, Categoría, Precio, Descripción) */}
                <div className="bg-[#141414] border border-[#262626] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <ShoppingBag size={13} />
                      <span>Presentación Comercial (Carta Digital, WhatsApp Bot & Futuro Website)</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">Visible para clientes</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    {/* Thumbnail / Preview de la foto */}
                    <div className="w-24 h-24 rounded-lg bg-[#181818] border border-[#2e2e2e] flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                      {recipePlateForm.image_url ? (
                        <img
                          src={recipePlateForm.image_url}
                          alt="Foto del plato"
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="text-center p-2 text-zinc-600 flex flex-col items-center">
                          <ImageIcon size={22} className="mb-1" />
                          <span className="text-[9px]">Sin foto</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-2.5 w-full">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="sm:col-span-2">
                          <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                            Nombre del Plato / Hamburguesa *
                          </label>
                          <input
                            type="text"
                            required
                            value={recipePlateForm.name}
                            onChange={(e) => setRecipePlateForm({ ...recipePlateForm, name: e.target.value })}
                            placeholder="Ej: Hamburguesa Doble Smash BBQ"
                            className="w-full bg-[#181818] border border-[#2e2e2e] focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                            Precio de Venta ($) *
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            required
                            value={recipePlateForm.selling_price}
                            onChange={(e) => setRecipePlateForm({ ...recipePlateForm, selling_price: e.target.value })}
                            placeholder="Ej: 145.00"
                            className="w-full bg-[#181818] border border-[#2e2e2e] focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-zinc-100 text-right font-mono outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                            Categoría del Menú *
                          </label>
                          <input
                            type="text"
                            value={recipePlateForm.category}
                            onChange={(e) => setRecipePlateForm({ ...recipePlateForm, category: e.target.value })}
                            placeholder="Ej: Hamburguesas, Especialidades"
                            className="w-full bg-[#181818] border border-[#2e2e2e] focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                            URL de la Foto (para catálogo y web)
                          </label>
                          <input
                            type="url"
                            value={recipePlateForm.image_url}
                            onChange={(e) => setRecipePlateForm({ ...recipePlateForm, image_url: e.target.value })}
                            placeholder="https://ejemplo.com/hamburguesa.jpg"
                            className="w-full bg-[#181818] border border-[#2e2e2e] focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                      Descripción para el Menú & Clientes (WhatsApp, Tienda Web, Menú QR)
                    </label>
                    <textarea
                      rows={2}
                      value={recipePlateForm.description}
                      onChange={(e) => setRecipePlateForm({ ...recipePlateForm, description: e.target.value })}
                      placeholder="Ej: 200g de carne angus smash, queso cheddar derretido, cebolla caramelizada y salsa especial en pan brioche artesanal con papas rústicas..."
                      className="w-full bg-[#181818] border border-[#2e2e2e] focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none resize-none"
                    />
                  </div>

                  <div className="text-[11px] text-zinc-500 bg-[#121212] border border-[#222] p-2 rounded flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                    <span>
                      <strong>Privacidad de inventario:</strong> Solo este plato se publica para venta. Las materias primas (carne molida, pan, queso en bloque) se mantienen como insumos internos de cocina.
                    </span>
                  </div>
                </div>

                {/* 2. SECCIÓN DE INSUMOS DE LA RECETA (ESCANDALLO) */}
                <div className="bg-[#141414] border border-[#262626] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                        <Layers size={13} />
                        <span>Escandallo de Insumos (Materias Primas que Descuenta en Cocina)</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 block">
                        Por cada venta de este plato, el sistema descargará estas cantidades de tu almacén.
                      </span>
                    </div>

                    <button
                      onClick={handleAddRecipeIngredient}
                      className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 flex items-center gap-1 transition-colors border border-[#333]"
                    >
                      <Plus size={13} />
                      <span>Agregar Insumo</span>
                    </button>
                  </div>

                  {recipeIngredients.length === 0 ? (
                    <div className="text-center py-6 text-xs text-zinc-500 bg-[#181818] rounded border border-dashed border-[#2e2e2e]">
                      No has agregado insumos a la receta aún (ej: carne molida, pan, queso).
                      <div className="mt-2">
                        <button
                          onClick={handleAddRecipeIngredient}
                          className="text-xs text-emerald-400 font-medium hover:underline"
                        >
                          + Agregar el primer insumo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-zinc-400 px-2 uppercase">
                        <div className="col-span-5">Insumo / Materia Prima</div>
                        <div className="col-span-2">Cantidad</div>
                        <div className="col-span-2">Unidad</div>
                        <div className="col-span-2 text-right">Costo Subtotal</div>
                        <div className="col-span-1 text-right"></div>
                      </div>

                      {recipeIngredients.map((row, index) => (
                        <div key={index} className="grid grid-cols-12 gap-2 items-center bg-[#181818] p-2 rounded border border-[#282828]">
                          <div className="col-span-5">
                            <select
                              value={row.ingredient_item_id}
                              onChange={(e) => handleUpdateRecipeRow(index, 'ingredient_item_id', e.target.value)}
                              className="w-full bg-[#121212] border border-[#333] rounded px-2 py-1 text-xs text-zinc-200 outline-none"
                            >
                              {rawMaterialItems.map(m => (
                                <option key={m.id} value={m.id}>{m.name} (${(m.cost_price || 0).toFixed(2)} / {m.unit})</option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-2">
                            <input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={row.quantity}
                              onChange={(e) => handleUpdateRecipeRow(index, 'quantity', e.target.value)}
                              className="w-full bg-[#121212] border border-[#333] rounded px-2 py-1 text-xs text-zinc-200 text-right outline-none font-mono"
                            />
                          </div>

                          <div className="col-span-2">
                            <select
                              value={row.unit}
                              onChange={(e) => handleUpdateRecipeRow(index, 'unit', e.target.value)}
                              className="w-full bg-[#121212] border border-[#333] rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                            >
                              {COMMON_UNITS.map(u => (
                                <option key={u.id} value={u.id}>{u.id}</option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-2 text-right font-mono text-xs text-zinc-200">
                            ${(row.subtotal_cost || 0).toFixed(2)}
                          </div>

                          <div className="col-span-1 text-right">
                            <button
                              onClick={() => handleRemoveRecipeRow(index)}
                              className="text-zinc-500 hover:text-rose-400 p-1"
                              title="Quitar ingrediente"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. RESUMEN DE COSTO, MARGEN DE GANANCIA & BOTÓN GUARDAR */}
                {(() => {
                  const sellingPriceNum = parseFloat(recipePlateForm.selling_price) || 0;
                  const profit = sellingPriceNum - totalRecipeCost;
                  const marginPct = sellingPriceNum > 0 ? ((profit / sellingPriceNum) * 100).toFixed(1) : '0.0';

                  return (
                    <div className="p-3 bg-[#141414] border border-[#262626] rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div>
                          <span className="text-zinc-500">Costo Insumos:</span>{' '}
                          <strong className="text-zinc-200 font-mono">${totalRecipeCost.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span className="text-zinc-500">Precio Venta:</span>{' '}
                          <strong className="text-zinc-200 font-mono">${sellingPriceNum.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span className="text-zinc-500">Ganancia:</span>{' '}
                          <strong className={`font-mono ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${profit.toFixed(2)}
                          </strong>
                        </div>
                        {sellingPriceNum > 0 && (
                          <div>
                            <span className="text-zinc-500">Margen Bruto:</span>{' '}
                            <span className={`inline-block px-1.5 py-0.5 rounded font-mono font-semibold text-[11px] ${
                              profit >= 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}>
                              {marginPct}%
                            </span>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={handleSaveRecipe}
                        disabled={isSavingRecipe}
                        style={{ backgroundColor: themeColor }}
                        className="px-4 py-2 rounded-md text-black font-semibold text-xs flex items-center gap-1.5 shadow transition-all hover:brightness-110 disabled:opacity-50 shrink-0"
                      >
                        {isSavingRecipe ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        <span>{isCreatingNewPlate ? 'Crear Plato & Guardar Receta' : 'Guardar Ficha Técnica & Menú'}</span>
                      </button>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ==============================================================
          SUBTAB 3: ENTRADAS Y COMPRAS
          ============================================================== */}
      {subTab === 'purchases' && (
        <div className="space-y-4">
          <div className="bg-[#171717] border border-[#2e2e2e] p-4 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Registro de Compras a Proveedores</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Cada entrada incrementa el stock de almacén, recalcula el costo ponderado y opcionalmente registra el egreso en Caja de Finanzas.
              </p>
            </div>

            <button
              onClick={() => handleOpenPurchase()}
              style={{ backgroundColor: themeColor }}
              className="px-3.5 py-1.5 rounded-md text-black font-semibold text-xs flex items-center gap-1.5 shadow transition-all hover:brightness-110 shrink-0"
            >
              <Plus size={14} />
              <span>Registrar Nueva Compra</span>
            </button>
          </div>

          {/* Tabla de movimientos tipo compra */}
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden">
            <div className="p-3 border-b border-[#242424] text-xs font-semibold text-zinc-400 uppercase">
              Últimas Entradas Registradas
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-3 py-3">Artículo</th>
                    <th className="px-3 py-3">Cantidad Recibida</th>
                    <th className="px-3 py-3">Costo Unitario</th>
                    <th className="px-3 py-3 text-right">Total Invertido</th>
                    <th className="px-3 py-3">Detalle / Proveedor</th>
                    <th className="px-4 py-3">Registrado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242424]">
                  {movements.filter(m => m.movement_type === 'purchase').length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-zinc-500">
                        No hay compras registradas recientemente.
                      </td>
                    </tr>
                  ) : (
                    movements.filter(m => m.movement_type === 'purchase').slice(0, 30).map(m => (
                      <tr key={m.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3 text-zinc-400 font-mono text-[11px]">
                          {new Date(m.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-3 font-medium text-zinc-100">{m.item_name}</td>
                        <td className="px-3 py-3 text-sky-400 font-semibold font-mono">
                          +{m.quantity} {m.item_unit}
                        </td>
                        <td className="px-3 py-3 font-mono">${m.unit_cost.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono font-medium text-zinc-100">
                          ${m.total_cost.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-zinc-400">{m.notes || '—'}</td>
                        <td className="px-4 py-3 text-zinc-400">{m.created_by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          SUBTAB 4: MERMAS Y DESPERDICIOS
          ============================================================== */}
      {subTab === 'waste' && (
        <div className="space-y-4">
          <div className="bg-[#171717] border border-[#2e2e2e] p-4 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Control de Mermas y Desperdicio</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Registra pérdidas por caducidad, preparación o merma natural para mantener el stock cuadrado y conocer el costo real de pérdida.
              </p>
            </div>

            <button
              onClick={() => handleOpenWaste()}
              className="px-3.5 py-1.5 rounded-md bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition-all shrink-0"
            >
              <Trash2 size={13} />
              <span>Registrar Desperdicio</span>
            </button>
          </div>

          {/* Tabla de mermas */}
          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden">
            <div className="p-3 border-b border-[#242424] text-xs font-semibold text-zinc-400 uppercase">
              Registro de Mermas
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-3 py-3">Insumo</th>
                    <th className="px-3 py-3">Cantidad Desechada</th>
                    <th className="px-3 py-3 text-right">Pérdida ($)</th>
                    <th className="px-3 py-3">Motivo / Notas</th>
                    <th className="px-4 py-3">Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242424]">
                  {movements.filter(m => m.movement_type === 'waste').length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-zinc-500">
                        No hay registros de merma este mes. ¡Excelente control!
                      </td>
                    </tr>
                  ) : (
                    movements.filter(m => m.movement_type === 'waste').slice(0, 30).map(m => (
                      <tr key={m.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3 text-zinc-400 font-mono text-[11px]">
                          {new Date(m.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-3 font-medium text-zinc-100">{m.item_name}</td>
                        <td className="px-3 py-3 text-rose-400 font-semibold font-mono">
                          {m.quantity} {m.item_unit}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-rose-300 font-semibold">
                          ${m.total_cost.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-zinc-400">{m.notes || '—'}</td>
                        <td className="px-4 py-3 text-zinc-400">{m.created_by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          SUBTAB 5: KARDEX / AUDITORÍA COMPLETA
          ============================================================== */}
      {subTab === 'kardex' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#171717] p-3 rounded-lg border border-[#2e2e2e]">
            <div className="flex items-center gap-2">
              <select
                value={movFilterType}
                onChange={(e) => setMovFilterType(e.target.value)}
                className="bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-300 outline-none"
              >
                <option value="all">Todos los movimientos</option>
                <option value="sale">Ventas automáticas (Restaurante/POS)</option>
                <option value="purchase">Compras / Entradas</option>
                <option value="waste">Mermas / Desperdicio</option>
                <option value="adjustment">Ajustes manuales</option>
                <option value="initial">Stock inicial</option>
              </select>

              <button
                onClick={loadMovements}
                className="p-1.5 rounded border border-[#2e2e2e] bg-[#121212] text-zinc-400 hover:text-white"
                title="Refrescar Kardex"
              >
                <RefreshCw size={13} />
              </button>
            </div>

            <div className="text-xs text-zinc-400">
              Mostrando los últimos {movements.length} movimientos
            </div>
          </div>

          <div className="bg-[#171717] border border-[#2e2e2e] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-[#141414] text-zinc-400 uppercase text-[10px] tracking-wider border-b border-[#242424]">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-3 py-3">Artículo</th>
                    <th className="px-3 py-3">Tipo Movimiento</th>
                    <th className="px-3 py-3 text-right">Variación</th>
                    <th className="px-3 py-3 text-right">Stock Anterior</th>
                    <th className="px-3 py-3 text-right">Stock Final</th>
                    <th className="px-3 py-3">Origen / Ref</th>
                    <th className="px-4 py-3">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242424]">
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-zinc-500">
                        No hay movimientos registrados en el Kardex.
                      </td>
                    </tr>
                  ) : (
                    movements.map(m => {
                      const isPositive = m.quantity > 0;
                      return (
                        <tr key={m.id} className="hover:bg-zinc-800/40">
                          <td className="px-4 py-3 text-zinc-400 font-mono text-[11px] whitespace-nowrap">
                            {new Date(m.created_at).toLocaleString()}
                          </td>
                          <td className="px-3 py-3 font-medium text-zinc-100">{m.item_name}</td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                              m.movement_type === 'sale' ? 'bg-emerald-500/10 text-emerald-400' :
                              m.movement_type === 'purchase' ? 'bg-sky-500/10 text-sky-400' :
                              m.movement_type === 'waste' ? 'bg-rose-500/10 text-rose-400' :
                              'bg-amber-500/10 text-amber-300'
                            }`}>
                              {m.movement_type === 'sale' ? 'Venta' :
                               m.movement_type === 'purchase' ? 'Compra' :
                               m.movement_type === 'waste' ? 'Merma' :
                               m.movement_type === 'adjustment' ? 'Ajuste' : 'Inicial'}
                            </span>
                          </td>
                          <td className={`px-3 py-3 text-right font-mono font-semibold ${isPositive ? 'text-sky-400' : 'text-rose-400'}`}>
                            {isPositive ? `+${m.quantity}` : m.quantity} {m.item_unit}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-zinc-500">{m.stock_before}</td>
                          <td className="px-3 py-3 text-right font-mono font-medium text-zinc-200">{m.stock_after}</td>
                          <td className="px-3 py-3 text-zinc-400 whitespace-nowrap">
                            {m.source_module === 'restaurant' ? (
                              <span className="text-amber-400 font-mono text-[11px]">{m.source_reference_id}</span>
                            ) : (
                              m.source_module
                            )}
                          </td>
                          <td className="px-4 py-3 text-zinc-400 max-w-xs truncate">{m.notes || '—'}</td>
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

      {/* ==============================================================
          MODAL: NUEVO / EDITAR ARTÍCULO
          ============================================================== */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <h3 className="font-semibold text-sm text-zinc-100">
                {editingItem ? 'Editar Artículo' : 'Nuevo Artículo de Inventario'}
              </h3>
              <button onClick={() => setShowItemModal(false)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400">Nombre del Artículo / Insumo *</label>
                <input
                  type="text"
                  required
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="Ej: Carne Molida Angus, Pan Brioche, Coca-Cola 355ml"
                  className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-emerald-400 rounded-md px-3 py-1.5 text-xs text-zinc-100 outline-none mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Tipo de Artículo</label>
                  <select
                    value={itemForm.item_type}
                    onChange={(e) => setItemForm({ ...itemForm, item_type: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                  >
                    <option value="raw_material">Insumo / Materia Prima (para recetas)</option>
                    <option value="product">Producto de Reventa (venta 1 a 1)</option>
                    <option value="composite">Plato / Compuesto (usa receta)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Unidad de Medida</label>
                  <select
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                  >
                    {COMMON_UNITS.map(u => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Categoría</label>
                  <input
                    type="text"
                    value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    placeholder="Ej: Carnes, Lácteos, Bebidas"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 outline-none mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Código / SKU (opcional)</label>
                  <input
                    type="text"
                    value={itemForm.sku}
                    onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })}
                    placeholder="Ej: INS-001"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 outline-none mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Costo Unitario ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.cost_price}
                    onChange={(e) => setItemForm({ ...itemForm, cost_price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 text-right font-mono outline-none mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Precio Venta ($ si aplica)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.selling_price}
                    onChange={(e) => setItemForm({ ...itemForm, selling_price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 text-right font-mono outline-none mt-1"
                  />
                </div>
              </div>

              {!editingItem && (
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Stock Inicial Actual</label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemForm.initial_stock}
                    onChange={(e) => setItemForm({ ...itemForm, initial_stock: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono outline-none mt-1"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 items-center pt-1">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Stock Mínimo (Alerta)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.min_stock}
                    onChange={(e) => setItemForm({ ...itemForm, min_stock: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono outline-none mt-1"
                  />
                </div>

                <div className="pt-4">
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemForm.track_stock}
                      onChange={(e) => setItemForm({ ...itemForm, track_stock: e.target.checked })}
                      className="rounded bg-zinc-900 border-[#2e2e2e]"
                    />
                    <span>Controlar existencias</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">URL de la Foto (opcional)</label>
                <div className="flex gap-2 items-center mt-1">
                  <div className="w-8 h-8 rounded bg-[#121212] border border-[#2e2e2e] flex items-center justify-center shrink-0 overflow-hidden">
                    {itemForm.image_url ? (
                      <img src={itemForm.image_url} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <ImageIcon size={14} className="text-zinc-600" />
                    )}
                  </div>
                  <input
                    type="url"
                    value={itemForm.image_url}
                    onChange={(e) => setItemForm({ ...itemForm, image_url: e.target.value })}
                    placeholder="https://ejemplo.com/foto.jpg"
                    className="flex-1 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Descripción (opcional)</label>
                <textarea
                  rows={2}
                  value={itemForm.description}
                  onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                  placeholder="Detalles del producto o especificaciones de almacén..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 outline-none mt-1 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#242424]">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-3 py-1.5 rounded-md border border-[#2e2e2e] text-xs text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: themeColor }}
                  className="px-4 py-1.5 rounded-md text-black font-semibold text-xs shadow hover:brightness-110"
                >
                  {editingItem ? 'Guardar Cambios' : 'Crear Artículo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: AJUSTE RÁPIDO DE EXISTENCIAS
          ============================================================== */}
      {showAdjustModal && adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <h3 className="font-semibold text-sm text-zinc-100">
                Ajuste de Stock: {adjustTarget.name}
              </h3>
              <button onClick={() => setShowAdjustModal(false)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="space-y-3">
              <div className="text-xs text-zinc-400">
                Stock actual registrado:{' '}
                <strong className="text-zinc-200">{adjustTarget.current_stock} {adjustTarget.unit}</strong>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Nuevo Stock Real *</label>
                <input
                  type="number"
                  step="0.001"
                  required
                  value={adjustNewStock}
                  onChange={(e) => setAdjustNewStock(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] focus:border-emerald-400 rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Motivo del Ajuste</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                >
                  <option value="Conteo físico de inventario">Conteo físico de inventario</option>
                  <option value="Corrección por error de digitación">Corrección por error de digitación</option>
                  <option value="Mercancía encontrada">Mercancía encontrada</option>
                  <option value="Otro">Otro motivo</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Notas adicionales</label>
                <input
                  type="text"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="Detalles sobre el conteo..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 mt-1"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#242424]">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-3 py-1.5 rounded-md border border-[#2e2e2e] text-xs text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: themeColor }}
                  className="px-4 py-1.5 rounded-md text-black font-semibold text-xs shadow hover:brightness-110"
                >
                  Aplicar Ajuste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: REGISTRAR COMPRA / ENTRADA
          ============================================================== */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <h3 className="font-semibold text-sm text-zinc-100">
                Registrar Entrada / Compra de Mercancía
              </h3>
              <button onClick={() => setShowPurchaseModal(false)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSavePurchase} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400">Artículo / Insumo *</label>
                <select
                  required
                  value={purchaseForm.item_id}
                  onChange={(e) => {
                    const sel = items.find(i => String(i.id) === e.target.value);
                    setPurchaseForm({
                      ...purchaseForm,
                      item_id: e.target.value,
                      unit_cost: sel ? sel.cost_price : purchaseForm.unit_cost
                    });
                  }}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                >
                  {items.map(it => (
                    <option key={it.id} value={it.id}>
                      {it.name} (Actual: {it.current_stock} {it.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Cantidad Recibida *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={purchaseForm.quantity}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Costo Unitario ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={purchaseForm.unit_cost}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, unit_cost: e.target.value })}
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Proveedor</label>
                  <input
                    type="text"
                    value={purchaseForm.supplier}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })}
                    placeholder="Ej: Distribuidora Central"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400">N° Factura / Boleta</label>
                  <input
                    type="text"
                    value={purchaseForm.invoice_ref}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, invoice_ref: e.target.value })}
                    placeholder="Ej: FAC-4089"
                    className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 mt-1"
                  />
                </div>
              </div>

              {/* Total Compra */}
              <div className="p-3 bg-[#121212] border border-[#262626] rounded-md flex items-center justify-between text-xs">
                <span className="text-zinc-400">Total a Pagar:</span>
                <strong className="text-base text-zinc-100 font-mono">
                  ${((parseFloat(purchaseForm.quantity) || 0) * (parseFloat(purchaseForm.unit_cost) || 0)).toFixed(2)}
                </strong>
              </div>

              {/* Opción de registrar egreso en Finanzas */}
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-md space-y-2">
                <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={purchaseForm.create_finance_expense}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, create_finance_expense: e.target.checked })}
                    className="rounded bg-zinc-900 border-[#2e2e2e] text-emerald-400"
                  />
                  <span className="font-medium">Registrar egreso automáticamente en Finanzas</span>
                </label>

                {purchaseForm.create_finance_expense && (
                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                    <div>
                      <label className="text-[10px] text-zinc-400">Método de Pago</label>
                      <select
                        value={purchaseForm.payment_method}
                        onChange={(e) => setPurchaseForm({ ...purchaseForm, payment_method: e.target.value })}
                        className="w-full bg-[#171717] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-zinc-300 mt-0.5"
                      >
                        <option value="cash">Efectivo (Caja Chica)</option>
                        <option value="transfer">Transferencia Bancaria</option>
                        <option value="card">Tarjeta de Débito/Crédito</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#242424]">
                <button
                  type="button"
                  onClick={() => setShowPurchaseModal(false)}
                  className="px-3 py-1.5 rounded-md border border-[#2e2e2e] text-xs text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: themeColor }}
                  className="px-4 py-1.5 rounded-md text-black font-semibold text-xs shadow hover:brightness-110"
                >
                  Guardar Compra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: REGISTRAR MERMA
          ============================================================== */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#171717] border border-[#2e2e2e] rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-[#242424]">
              <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-1.5">
                <Trash2 size={15} className="text-rose-400" />
                <span>Registrar Merma / Descarte</span>
              </h3>
              <button onClick={() => setShowWasteModal(false)} className="text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveWaste} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400">Insumo o Artículo *</label>
                <select
                  required
                  value={wasteForm.item_id}
                  onChange={(e) => setWasteForm({ ...wasteForm, item_id: e.target.value })}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                >
                  {items.map(it => (
                    <option key={it.id} value={it.id}>
                      {it.name} (Stock: {it.current_stock} {it.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Cantidad Desechada *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={wasteForm.quantity}
                  onChange={(e) => setWasteForm({ ...wasteForm, quantity: e.target.value })}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Motivo del Descarte</label>
                <select
                  value={wasteForm.reason}
                  onChange={(e) => setWasteForm({ ...wasteForm, reason: e.target.value })}
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 outline-none mt-1"
                >
                  {WASTE_REASONS.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400">Detalles adicionales</label>
                <input
                  type="text"
                  value={wasteForm.notes}
                  onChange={(e) => setWasteForm({ ...wasteForm, notes: e.target.value })}
                  placeholder="Ej: Se dañó por corte de energía..."
                  className="w-full bg-[#121212] border border-[#2e2e2e] rounded-md px-3 py-1.5 text-xs text-zinc-200 mt-1"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#242424]">
                <button
                  type="button"
                  onClick={() => setShowWasteModal(false)}
                  className="px-3 py-1.5 rounded-md border border-[#2e2e2e] text-xs text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-md bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs shadow"
                >
                  Confirmar Merma
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

