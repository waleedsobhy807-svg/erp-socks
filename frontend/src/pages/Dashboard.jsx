/**
 * Dashboard page — live KPIs from 4 API endpoints, two charts, two summary tables.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  ArrowPathIcon, WrenchScrewdriverIcon, ArchiveBoxIcon,
  ShieldExclamationIcon, TruckIcon,
} from '@heroicons/react/24/outline';
import { useGet } from '../hooks/useApi';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function SectionSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-100 rounded" />
      ))}
    </div>
  );
}

const statusColor = { pending: 'yellow', open: 'red', under_review: 'blue', resolved: 'green' };
const shipColor   = { pending: 'gray', in_transit: 'blue', delivered: 'green', returned: 'red' };

export default function Dashboard() {
  const qc = useQueryClient();

  const { data: mfg,      isLoading: mfgLoading }  = useGet('mfg-summary',  '/manufacturing/summary', {}, { staleTime: 60_000 });
  const { data: yarn,     isLoading: yarnLoading }  = useGet('yarn-summary', '/yarn/summary',           {}, { staleTime: 60_000 });
  const { data: quality,  isLoading: qcLoading }    = useGet('qc-stats',     '/quality/stats',          {}, { staleTime: 60_000 });
  const { data: shipping, isLoading: shipLoading }  = useGet('ship-stats',   '/shipping/stats',         {}, { staleTime: 60_000 });

  const anyLoading = mfgLoading || yarnLoading || qcLoading || shipLoading;

  function refresh() {
    qc.invalidateQueries({ queryKey: ['mfg-summary'] });
    qc.invalidateQueries({ queryKey: ['yarn-summary'] });
    qc.invalidateQueries({ queryKey: ['qc-stats'] });
    qc.invalidateQueries({ queryKey: ['ship-stats'] });
  }

  const productionByDay = mfg?.production_by_day ?? [];
  const yarnByType      = yarn?.items_by_type    ?? [];
  const recentNCs       = quality?.recent_non_conformances ?? [];
  const recentShipments = shipping?.recent_shipments        ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Live factory overview</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowPathIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={WrenchScrewdriverIcon}
          label="Active Work Orders"
          value={anyLoading ? '…' : (mfg?.active_work_orders ?? 0)}
          change={mfg?.active_work_orders_change}
          changeType="up"
        />
        <StatCard
          icon={ArchiveBoxIcon}
          label="Low Stock Yarns"
          value={anyLoading ? '…' : (yarn?.low_stock_count ?? 0)}
          change={null}
          changeType="down"
        />
        <StatCard
          icon={ShieldExclamationIcon}
          label="Open Non-Conformances"
          value={anyLoading ? '…' : (quality?.open_non_conformances ?? 0)}
          change={null}
          changeType="neutral"
        />
        <StatCard
          icon={TruckIcon}
          label="Shipments This Month"
          value={anyLoading ? '…' : (shipping?.total_shipments_30d ?? 0)}
          change={shipping?.on_time_rate_pct ? `${shipping.on_time_rate_pct}% on time` : null}
          changeType="up"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Production by day */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Production Output — Last 14 Days</h2>
          {mfgLoading ? <SectionSkeleton rows={5} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={productionByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [v.toLocaleString(), 'Pairs']} />
                <Bar dataKey="pairs_produced" fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Yarn by type */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Yarn Stock by Type</h2>
          {yarnLoading ? <SectionSkeleton rows={5} /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={yarnByType} dataKey="total_value" nameKey="yarn_type" cx="50%" cy="50%" outerRadius={80} label={({ yarn_type, percent }) => `${yarn_type} ${(percent * 100).toFixed(0)}%`}>
                  {yarnByType.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={v => [`$${Number(v).toLocaleString()}`, 'Value']} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Non-Conformances */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Recent Non-Conformances</h2>
          {qcLoading ? <SectionSkeleton /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Detected</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentNCs.length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-gray-400">No open issues</td></tr>
                )}
                {recentNCs.slice(0, 5).map(nc => (
                  <tr key={nc.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-900">{nc.product_name ?? '—'}</td>
                    <td className="py-2 text-gray-500">{nc.detected_at ? new Date(nc.detected_at).toLocaleDateString() : '—'}</td>
                    <td className="py-2"><Badge label={nc.status} color={statusColor[nc.status] ?? 'gray'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Shipments */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Recent Shipments</h2>
          {shipLoading ? <SectionSkeleton /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Shipment</th>
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Ship Date</th>
                </tr>
              </thead>
              <tbody>
                {recentShipments.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400">No recent shipments</td></tr>
                )}
                {recentShipments.slice(0, 5).map(s => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-gray-600">{s.id?.slice(0, 8)}</td>
                    <td className="py-2 text-gray-900">{s.customer_name ?? '—'}</td>
                    <td className="py-2"><Badge label={s.status} color={shipColor[s.status] ?? 'gray'} /></td>
                    <td className="py-2 text-gray-500">{s.ship_date ? new Date(s.ship_date).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
