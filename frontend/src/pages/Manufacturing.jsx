import { useState, useEffect, useCallback } from 'react';
import { useGet, usePost } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatCard from '../components/StatCard';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import {
  WrenchScrewdriverIcon,
  CheckCircleIcon,
  CubeIcon,
  BoltIcon,
  XMarkIcon,
  PlayIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';

const STATUS_COLORS = {
  pending: 'yellow',
  in_progress: 'blue',
  completed: 'green',
  cancelled: 'red',
};

function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-yellow-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {value} / {max} pairs
      </div>
    </div>
  );
}

function LogModal({ workOrder, onClose, onSuccess }) {
  const [form, setForm] = useState({ qty_produced: '', qty_rejected: '', operator_id: '', notes: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/manufacturing/${workOrder.id}/log`, form);
      toast.success('Production logged');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to log production');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Log Production" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Qty Produced" required>
          <input className="input" type="number" min="0" value={form.qty_produced}
            onChange={e => setForm(p => ({ ...p, qty_produced: e.target.value }))} />
        </FormField>
        <FormField label="Qty Rejected">
          <input className="input" type="number" min="0" value={form.qty_rejected}
            onChange={e => setForm(p => ({ ...p, qty_rejected: e.target.value }))} />
        </FormField>
        <FormField label="Operator ID">
          <input className="input" type="text" value={form.operator_id}
            onChange={e => setForm(p => ({ ...p, operator_id: e.target.value }))} />
        </FormField>
        <FormField label="Notes">
          <textarea className="input" rows={3} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Log Production'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteModal({ workOrder, onClose, onSuccess }) {
  const [form, setForm] = useState({ final_qty: '', actual_end: '', notes: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/manufacturing/${workOrder.id}/complete`, form);
      toast.success('Work order completed');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to complete work order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Complete Work Order" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Final Qty (pairs)" required>
          <input className="input" type="number" min="0" value={form.final_qty}
            onChange={e => setForm(p => ({ ...p, final_qty: e.target.value }))} />
        </FormField>
        <FormField label="Actual End Date/Time" required>
          <input className="input" type="datetime-local" value={form.actual_end}
            onChange={e => setForm(p => ({ ...p, actual_end: e.target.value }))} />
        </FormField>
        <FormField label="Notes">
          <textarea className="input" rows={3} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Complete'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewWorkOrderModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    production_order_id: '',
    machine_id: '',
    planned_start: '',
    planned_end: '',
    planned_qty_pairs: '',
    notes: '',
  });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderResults, setOrderResults] = useState([]);
  const [orderSearchLoading, setOrderSearchLoading] = useState(false);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/machines?status=active')
      .then(r => setMachines(r.data?.data || r.data || []))
      .catch(() => setMachines([]));
  }, []);

  useEffect(() => {
    if (!orderSearch.trim()) { setOrderResults([]); return; }
    const t = setTimeout(async () => {
      setOrderSearchLoading(true);
      try {
        const r = await api.get(`/planning/orders?search=${encodeURIComponent(orderSearch)}`);
        setOrderResults(r.data?.data || r.data || []);
      } catch { setOrderResults([]); }
      finally { setOrderSearchLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.production_order_id) { toast.error('Select a production order'); return; }
    if (!form.machine_id) { toast.error('Select a machine'); return; }
    setLoading(true);
    try {
      await api.post('/manufacturing', form);
      toast.success('Work order created');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create work order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="New Work Order" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Production Order" required>
          <input className="input" placeholder="Search production order..."
            value={orderSearch} onChange={e => setOrderSearch(e.target.value)} />
          {orderSearchLoading && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
          {orderResults.length > 0 && (
            <ul className="border border-gray-200 rounded mt-1 max-h-40 overflow-y-auto bg-white shadow z-10">
              {orderResults.map(o => (
                <li key={o.id}
                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  onClick={() => { setForm(p => ({ ...p, production_order_id: o.id })); setOrderSearch(o.ref || o.id); setOrderResults([]); }}>
                  {o.ref || o.id} — {o.product_name || ''}
                </li>
              ))}
            </ul>
          )}
          {form.production_order_id && (
            <p className="text-xs text-green-600 mt-1">Selected: {form.production_order_id}</p>
          )}
        </FormField>
        <FormField label="Machine" required>
          <select className="input" value={form.machine_id}
            onChange={e => setForm(p => ({ ...p, machine_id: e.target.value }))}>
            <option value="">Select machine...</option>
            {machines.map(m => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Planned Start" required>
            <input className="input" type="datetime-local" value={form.planned_start}
              onChange={e => setForm(p => ({ ...p, planned_start: e.target.value }))} />
          </FormField>
          <FormField label="Planned End" required>
            <input className="input" type="datetime-local" value={form.planned_end}
              onChange={e => setForm(p => ({ ...p, planned_end: e.target.value }))} />
          </FormField>
        </div>
        <FormField label="Planned Qty (pairs)" required>
          <input className="input" type="number" min="1" value={form.planned_qty_pairs}
            onChange={e => setForm(p => ({ ...p, planned_qty_pairs: e.target.value }))} />
        </FormField>
        <FormField label="Notes">
          <textarea className="input" rows={3} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Work Order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailPanel({ workOrder, onClose, onRefresh }) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!workOrder?.id) return;
    setLogsLoading(true);
    try {
      const r = await api.get(`/manufacturing/${workOrder.id}/logs`);
      setLogs(r.data?.data || r.data || []);
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  }, [workOrder?.id]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await api.post(`/manufacturing/${workOrder.id}/start`);
      toast.success('Work order started');
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to start');
    } finally { setActionLoading(false); }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this work order?')) return;
    setActionLoading(true);
    try {
      await api.post(`/manufacturing/${workOrder.id}/cancel`);
      toast.success('Work order cancelled');
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to cancel');
    } finally { setActionLoading(false); }
  };

  const efficiency = workOrder.planned_qty_pairs > 0
    ? Math.round((workOrder.produced_qty / workOrder.planned_qty_pairs) * 100)
    : 0;

  return (
    <div className="w-96 border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">
          WO #{workOrder.id?.slice(-8)}
        </h3>
        <button onClick={onClose} className="btn-ghost p-1">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="card space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Status</span>
            <Badge color={STATUS_COLORS[workOrder.status] || 'gray'} label={workOrder.status} />
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Prod Order Ref</span>
            <span className="font-medium">{workOrder.production_order_ref || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Machine</span>
            <span className="font-medium">{workOrder.machine_name || workOrder.machine_id || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Planned Start</span>
            <span>{workOrder.planned_start ? new Date(workOrder.planned_start).toLocaleString() : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Planned End</span>
            <span>{workOrder.planned_end ? new Date(workOrder.planned_end).toLocaleString() : '—'}</span>
          </div>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-gray-700 mb-2">Production Progress</p>
          <ProgressBar
            value={workOrder.produced_qty || 0}
            max={workOrder.planned_qty_pairs || 0}
            label={`Efficiency: ${efficiency}%`}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {workOrder.status === 'pending' && (
            <button className="btn-primary flex items-center gap-1 text-sm" onClick={handleStart} disabled={actionLoading}>
              <PlayIcon className="w-4 h-4" /> Start
            </button>
          )}
          {workOrder.status === 'in_progress' && (
            <>
              <button className="btn-primary flex items-center gap-1 text-sm" onClick={() => setShowLogModal(true)}>
                <ClipboardDocumentListIcon className="w-4 h-4" /> Log
              </button>
              <button className="btn-primary flex items-center gap-1 text-sm bg-green-600 hover:bg-green-700"
                onClick={() => setShowCompleteModal(true)}>
                <CheckCircleIcon className="w-4 h-4" /> Complete
              </button>
            </>
          )}
          {['pending', 'in_progress'].includes(workOrder.status) && (
            <button className="btn-ghost text-red-600 text-sm flex items-center gap-1"
              onClick={handleCancel} disabled={actionLoading}>
              <XMarkIcon className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>

        {workOrder.notes && (
          <div className="card text-sm text-gray-600">
            <p className="font-medium text-gray-700 mb-1">Notes</p>
            <p>{workOrder.notes}</p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Production Logs</p>
          {logsLoading ? (
            <p className="text-sm text-gray-400">Loading logs...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-400">No logs yet.</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log, i) => (
                <li key={log.id || i} className="card text-xs space-y-1">
                  <div className="flex justify-between text-gray-500">
                    <span>{log.logged_at ? new Date(log.logged_at).toLocaleString() : '—'}</span>
                    <span>Op: {log.operator_id || '—'}</span>
                  </div>
                  <div className="flex gap-4">
                    <span>Produced: <strong>{log.qty_produced}</strong></span>
                    <span>Rejected: <strong>{log.qty_rejected}</strong></span>
                  </div>
                  {log.notes && <p className="text-gray-500">{log.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showLogModal && (
        <LogModal workOrder={workOrder} onClose={() => setShowLogModal(false)}
          onSuccess={() => { fetchLogs(); onRefresh(); }} />
      )}
      {showCompleteModal && (
        <CompleteModal workOrder={workOrder} onClose={() => setShowCompleteModal(false)}
          onSuccess={() => { fetchLogs(); onRefresh(); }} />
      )}
    </div>
  );
}

export default function Manufacturing() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', date_from: '', date_to: '' });
  const [appliedFilters, setAppliedFilters] = useState({});
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedWO, setSelectedWO] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: summaryData, loading: summaryLoading } = useGet('/manufacturing/summary', {}, [refreshKey]);
  const { data: woData, loading: woLoading, error: woError } = useGet(
    '/manufacturing',
    { page, ...appliedFilters },
    [page, appliedFilters, refreshKey]
  );

  const summary = summaryData || {};
  const workOrders = woData?.data || woData || [];
  const pagination = woData?.pagination || {};

  const handleRefresh = () => setRefreshKey(k => k + 1);

  const applyFilters = () => { setAppliedFilters({ ...filters }); setPage(1); };
  const clearFilters = () => { setFilters({ status: '', date_from: '', date_to: '' }); setAppliedFilters({}); setPage(1); };

  const columns = [
    { key: 'id', header: 'WO #', render: r => <span className="font-mono text-xs">{r.id?.slice(-8)}</span> },
    { key: 'production_order_ref', header: 'Prod Order Ref' },
    { key: 'machine_name', header: 'Machine', render: r => r.machine_name || r.machine_id || '—' },
    {
      key: 'status', header: 'Status',
      render: r => <Badge color={STATUS_COLORS[r.status] || 'gray'} label={r.status} />
    },
    { key: 'planned_qty_pairs', header: 'Planned Qty' },
    { key: 'produced_qty', header: 'Produced Qty', render: r => r.produced_qty ?? 0 },
    {
      key: 'efficiency', header: 'Efficiency %',
      render: r => {
        const pct = r.planned_qty_pairs > 0 ? Math.round(((r.produced_qty || 0) / r.planned_qty_pairs) * 100) : 0;
        return <span className={pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600'}>{pct}%</span>;
      }
    },
    {
      key: 'actions', header: 'Actions',
      render: r => (
        <button className="btn-ghost text-sm text-blue-600"
          onClick={e => { e.stopPropagation(); setSelectedWO(r); }}>
          View
        </button>
      )
    },
  ];

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <PageHeader
          title="Manufacturing"
          subtitle="Work order management and production tracking"
          actions={
            <button className="btn-primary flex items-center gap-2"
              onClick={() => setShowNewModal(true)}>
              + New Work Order
            </button>
          }
        />

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Work Orders"
            value={summaryLoading ? '...' : summary.active_work_orders ?? 0}
            icon={<WrenchScrewdriverIcon className="w-6 h-6" />}
            color="blue"
          />
          <StatCard
            title="Completed Today"
            value={summaryLoading ? '...' : summary.completed_today ?? 0}
            icon={<CheckCircleIcon className="w-6 h-6" />}
            color="green"
          />
          <StatCard
            title="Total Pairs Today"
            value={summaryLoading ? '...' : summary.total_pairs_today ?? 0}
            icon={<CubeIcon className="w-6 h-6" />}
            color="purple"
          />
          <StatCard
            title="Avg Efficiency"
            value={summaryLoading ? '...' : `${summary.avg_efficiency_pct ?? 0}%`}
            icon={<BoltIcon className="w-6 h-6" />}
            color="yellow"
          />
        </div>

        {/* Filters */}
        <div className="card flex flex-wrap gap-4 items-end">
          <FormField label="Status" className="w-40">
            <select className="input" value={filters.status}
              onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </FormField>
          <FormField label="Date From" className="w-44">
            <input className="input" type="date" value={filters.date_from}
              onChange={e => setFilters(p => ({ ...p, date_from: e.target.value }))} />
          </FormField>
          <FormField label="Date To" className="w-44">
            <input className="input" type="date" value={filters.date_to}
              onChange={e => setFilters(p => ({ ...p, date_to: e.target.value }))} />
          </FormField>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={applyFilters}>Apply</button>
            <button className="btn-ghost" onClick={clearFilters}>Clear</button>
          </div>
        </div>

        {/* Table */}
        {woError ? (
          <div className="card text-red-500 text-sm">Failed to load work orders: {woError}</div>
        ) : (
          <>
            <Table
              columns={columns}
              data={workOrders}
              loading={woLoading}
              onRowClick={row => setSelectedWO(row)}
              rowClassName={row => selectedWO?.id === row.id ? 'bg-blue-50' : ''}
            />
            {pagination.total_pages > 1 && (
              <div className="flex justify-center gap-2">
                <button className="btn-ghost text-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span className="text-sm text-gray-500 self-center">Page {page} of {pagination.total_pages}</span>
                <button className="btn-ghost text-sm" disabled={page >= pagination.total_pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedWO && (
        <DetailPanel
          workOrder={selectedWO}
          onClose={() => setSelectedWO(null)}
          onRefresh={() => { handleRefresh(); setSelectedWO(null); }}
        />
      )}

      {showNewModal && (
        <NewWorkOrderModal
          onClose={() => setShowNewModal(false)}
          onSuccess={handleRefresh}
        />
      )}
    </div>
  );
}
