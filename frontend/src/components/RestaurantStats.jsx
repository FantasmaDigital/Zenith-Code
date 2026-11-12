import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

const RANGES = [[1, 'Hoy'], [7, '7 días'], [30, '30 días']];
const TYPE_LABELS = { delivery: '🛵 A domicilio', pickup: '🛍️ Para recoger', dine_in: '🍽️ En el local' };
const PAYMENT_LABELS = { cash: '💵 Efectivo', transfer: '🏦 Transferencia', card: '💳 Tarjeta' };

const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;

function Kpi({ label, value, hint, accent }) {
  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md">
      <span className="text-xs text-zinc-400 font-medium">{label}</span>
      <p className={`text-2xl font-medium mt-0.5 ${accent || 'text-zinc-100'}`}>{value}</p>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function Bars({ data, getValue, getLabel, color, format = (v) => v, height = 120 }) {
  const max = Math.max(1, ...data.map(getValue));
  return (
    <div className="flex items-end gap-1" style={{ height }} role="img" aria-label="Gráfico de barras">
      {data.map((d, i) => {
        const value = getValue(d);
        return (
          <div key={i} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${getLabel(d)}: ${format(value)}`}>
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(value ? 4 : 0, (value / max) * 100)}%`, backgroundColor: color, opacity: value ? 1 : 0.15 }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Breakdown({ title, counts, labels }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
      <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
      {total === 0 ? (
        <p className="text-xs text-zinc-500">Sin datos todavía.</p>
      ) : (
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, n]) => (
          <div key={key} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300">{labels[key] || key}</span>
              <span className="font-mono text-zinc-400">{n} · {Math.round((n / total) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(n / total) * 100}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function RestaurantStats({ apiFetch, apiBase, themeColor }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${apiBase}/api/restaurant/stats?days=${days}`);
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.warn('Error cargando estadísticas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (!stats) {
    return (
      <div className="p-4 text-center text-zinc-500 text-sm">
        <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-zinc-400" />
        Calculando estadísticas...
      </div>
    );
  }

  const { range, today, by_day, by_hour, by_type, by_payment, by_status, top_items, low_stock } = stats;
  const topMax = Math.max(1, ...top_items.map(i => i.quantity));
  const botShare = range.orders ? Math.round((range.bot_orders / range.orders) * 100) : 0;
  const busiest = [...by_hour].sort((a, b) => b.orders - a.orders)[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {RANGES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                days === value ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#232323] hover:bg-[#2e2e2e] border border-[#3e3e3e] rounded-md text-[13px] font-medium text-zinc-200">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Ventas" value={money(range.sales)} hint={`Hoy: ${money(today.sales)}`} accent="text-emerald-400" />
        <Kpi label="Pedidos" value={range.orders} hint={`Hoy: ${today.orders} · en curso: ${today.active}`} />
        <Kpi label="Ticket promedio" value={money(range.avg_ticket)} />
        <Kpi label="Tomados por el bot" value={`${botShare}%`} hint={`${range.bot_orders} de ${range.orders}`} accent="text-sky-300" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Cancelados" value={range.cancelled} accent={range.cancelled ? 'text-rose-300' : undefined} />
        <Kpi label="Pagados" value={`${range.paid_orders}/${range.orders}`} hint="Pedidos marcados como cobrados" />
        <Kpi label="Hora pico" value={busiest && busiest.orders ? `${String(busiest.hour).padStart(2, '0')}:00` : '—'} hint={busiest && busiest.orders ? `${busiest.orders} pedidos` : 'Sin datos'} />
        <Kpi label="Estado actual" value={stats.open_now ? 'Abierto' : 'Cerrado'} accent={stats.open_now ? 'text-emerald-400' : 'text-rose-300'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
          <h3 className="text-sm font-medium text-zinc-100">Ventas por día</h3>
          <Bars data={by_day} getValue={d => d.sales} getLabel={d => d.date} color={themeColor} format={money} />
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>{by_day[0]?.date.slice(5)}</span>
            <span>{by_day[by_day.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
          <h3 className="text-sm font-medium text-zinc-100">Pedidos por hora del día</h3>
          <Bars data={by_hour} getValue={d => d.orders} getLabel={d => `${String(d.hour).padStart(2, '0')}:00`} color="#38bdf8" />
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2 lg:col-span-1">
          <h3 className="text-sm font-medium text-zinc-100">Platillos más vendidos</h3>
          {top_items.length === 0 ? (
            <p className="text-xs text-zinc-500">Sin ventas en este periodo.</p>
          ) : (
            top_items.map((item, i) => (
              <div key={item.name} className="space-y-1">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-zinc-300 truncate">{i + 1}. {item.name}</span>
                  <span className="font-mono text-zinc-400 shrink-0">{item.quantity} · {money(item.revenue)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(item.quantity / topMax) * 100}%`, backgroundColor: themeColor }} />
                </div>
              </div>
            ))
          )}
        </div>
        <Breakdown title="Tipo de pedido" counts={by_type} labels={TYPE_LABELS} />
        <Breakdown title="Método de pago" counts={by_payment} labels={PAYMENT_LABELS} />
      </div>

      {(low_stock.length > 0 || Object.keys(by_status).length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="p-4 bg-[#171717] border border-[#2e2e2e] rounded-md space-y-2">
            <h3 className="text-sm font-medium text-zinc-100">Stock bajo</h3>
            {low_stock.length === 0 ? (
              <p className="text-xs text-zinc-500">Todo con stock suficiente.</p>
            ) : (
              low_stock.map(item => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span className="text-zinc-300">{item.name}</span>
                  <span className={`font-mono font-medium ${item.stock === 0 ? 'text-rose-400' : 'text-amber-300'}`}>
                    {item.stock === 0 ? 'Agotado' : `Quedan ${item.stock}`}
                  </span>
                </div>
              ))
            )}
          </div>
          <Breakdown
            title="Pedidos por estado"
            counts={by_status}
            labels={{ pending: 'Pendiente', confirmed: 'Confirmada', preparing: 'En preparación', ready: 'Lista', delivered: 'Entregada', cancelled: 'Cancelada' }}
          />
        </div>
      )}
    </div>
  );
}
