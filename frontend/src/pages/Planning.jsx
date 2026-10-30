import { useState, useEffect, useRef } from 'react';
import { PlusIcon, XMarkIcon, TrashIcon, CheckIcon, CalendarIcon, NoSymbolIcon } from '@heroicons/react/24/outline';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useGet } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

const PRIORITY_COLOR = { high: 'red', medium: 'yellow', low: 'blue', urgent: 'red' };
const STATUS_COLOR = { draft: 'gray', confirmed: 'blue', scheduled: 'indigo', in_progress: 'yellow', completed: 'green', cancelled: 'red' };

function useDebounce(value, delay) {
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

function CustomerSearch({ value, onChange }) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const { data } = useGet(debouncedQ.length >= 2 ? `/customers?search=${debouncedQ}&limit=10` : null);
  const customers = data?.items || data || [];
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <input
        className="input"
        placeholder="Search customer…"
        value={value?.name || q}
        onChange={e => { setQ(e.target.value); onChange(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && customers.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-48 overflow-auto">
          {customers.map(c => (
            <li key={c.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm" onMouseDown={() => { onChange(c); setQ(''); setOpen(false); }}>
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineItemRow({ item, index, products, onChange, onRemove }) {
  return (
    <div className="flex gap-2 items-end">
      <FormField label={index === 0 ? 'Product' : undefined} className="flex-1">
        <select className="input" value={item.product_id} onChange={e => onChange(index, 'product_id', e.target.value)}>
          <option value="">-- Product --</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </FormField>
      <FormField label={index === 0 ? 'Qty Pairs' : undefined} className="w-28">
        <input className="input" type="number" min="1" value={item.qty_pairs} onChange={e => onChange(index, 'qty_pairs', e.target.value)} placeholder="Qty" />
      </FormField>
      <button className="btn-ghost p-2 text-red-500 mb-0.5" onClick={() => onRemove(index)}><TrashIcon className="h-4 w-4" /></button>
    </div>
  );
}

export default function Planning() {
  const { user } = useAuth();
  const canWrite = ['admin', 'manager', 'planner'].includes(user?.role);

  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);

  const [showNew, setShowNew] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const emptyOrder = {
    customer_id: null,
    order_ref: '',
    required_by_date: '',
    priority: 'medium',
    notes: '',
    line_items: [{ product_id: '', qty_pairs: '' }],
  };
  const [orderForm, setOrderForm] = useState(emptyOrder);

  const emptySchedule = { start_date: '', end_date: '', machine_ids: [], notes: '' };
  const [scheduleForm, setScheduleForm] = useState(emptySchedule);

  const { data: ordersData, loading, error, refetch } = useGet(
    `/planning/orders?page=${page}&status=${statusFilter}&priority=${priorityFilter}`
  );
  const { data: productsData } = useGet('/products?limit=200');
  const { data: machinesData } = useGet('/machines?limit=200');
  const { data: capacityData } = useGet('/planning/capacity');

  const orders = ordersData?.items || ordersData || [];
  const totalPages = ordersData?.total_pages || 1;
  const products = productsData?.items || productsData || [];
  const machines = machinesData?.items || machinesData || [];
  const capacity = capacityData || [];

  const setOrder = (k, v) => setOrderForm(f => ({ ...f, [k]: v }));

  const addLineItem = () => setOrderForm(f => ({ ...f, line_items: [...f.line_items, { product_id: '', qty_pairs: '' }] }));
  const removeLineItem = (i) => setOrderForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }));
  const updateLineItem = (i, k, v) => setOrderForm(f => ({
    ...f,
    line_items: f.line_items.map((item, idx) => idx === i ? { ...item, [k]: v } : item),
  }));

  const handleCreateOrder = async () => {
    if (!orderForm.customer_id) { toast.error('Customer is required'); return; }
    if (!orderForm.order_ref) { toast.error('Order reference is required'); return; }
    if (orderForm.line_items.some(li => !li.product_id || !li.qty_pairs)) {
      toast.error('All line items need a product and quantity'); return;
    }
    try {
      await api.post('/planning/orders', {
        customer_id: orderForm.customer_id.id,
        order_ref: orderForm.order_ref,
        required_by_date: orderForm.required_by_date,
        priority: orderForm.priority,
        notes: orderForm.notes,
        line_items: orderForm.line_items,
      });
      toast.success('Order created');
      setOrderForm(emptyOrder);
      setShowNew(false);
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to create order');
    }
  };

  const handleConfirm = async (order) => {
    try {
      await api.post(`/planning/orders/${order.id}/confirm`);
      toast.success('Order confirmed');
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to confirm order');
    }
  };

  const handleSchedule = async () => {
    if (!scheduleForm.start_date || !scheduleForm.end_date) { toast.error('Start and end dates required'); return; }
    try {
      await api.post(`/planning/orders/${scheduleTarget.id}/schedule`, scheduleForm);
      toast.success('Order scheduled');
      setScheduleTarget(null);
      setScheduleForm(emptySchedule);
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to schedule order');
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) { toast.error('Cancellation reason required'); return; }
    try {
      await api.post(`/planning/orders/${cancelTarget.id}/cancel`, { reason: cancelReason });
      toast.success('Order cancelled');
      setCancelTarget(null);
      setCancelReason('');
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to cancel order');
    }
  };

  const toggleMachine = (id) => {
    setScheduleForm(f => ({
      ...f,
      machine_ids: f.machine_ids.includes(id) ? f.machine_ids.filter(m => m !== id) : [...f.machine_ids, id],
    }));
  };

  const columns = [
    { key: 'order_ref', header: 'Order Ref', render: r => <span className="font-mono text-sm font-medium">{r.order_ref}</span> },
    { key: 'customer', header: 'Customer', render: r => r.customer?.name || r.customer_name || '—' },
    { key: 'priority', header: 'Priority', render: r => <Badge color={PRIORITY_COLOR[r.priority] || 'gray'}>{r.priority}</Badge> },
    { key: 'status', header: 'Status', render: r => <Badge color={STATUS_COLOR[r.status] || 'gray'}>{r.status}</Badge> },
    { key: 'required_by_date', header: 'Required By', render: r => r.required_by_date ? new Date(r.required_by_date).toLocaleDateString() : '—' },
    {
      key: 'actions', header: 'Actions', render: r => (
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          {r.status === 'draft' && canWrite && (
            <button className="btn-ghost p-1 text-green-600" title="Confirm" onClick={() => handleConfirm(r)}>
              <CheckIcon className="h-4 w-4" />
            </button>
          )}
          {['confirmed', 'draft'].includes(r.status) && canWrite && (
            <button className="btn-ghost p-1 text-indigo-600" title="Schedule" onClick={() => { setScheduleTarget(r); setScheduleForm(emptySchedule); }}>
              <CalendarIcon className="h-4 w-4" />
            </button>
          )}
          {!['cancelled', 'completed'].includes(r.status) && canWrite && (
            <button className="btn-ghost p-1 text-red-500" title="Cancel" onClick={() => { setCancelTarget(r); setCancelReason(''); }}>
              <NoSymbolIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )
    },
  ];

  const utilColor = (pct) => pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';

  return (
    <div className="p-6 overflow-auto">
      <PageHeader title="Production Planning" subtitle="Manage production orders and machine scheduling">
        {canWrite && (
          <button className="btn-primary flex items-center gap-2" onClick={() => { setOrderForm(emptyOrder); setShowNew(true); }}>
            <PlusIcon className="h-4 w-4" /> New Order
          </button>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select className="input w-40" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {['draft', 'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select className="input w-36" value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}>
          <option value="">All Priorities</option>
          {['urgent', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {error && <p className="text-red-600 mb-4">Failed to load orders: {error.message}</p>}

      <Table columns={columns} data={orders} loading={loading} />

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="self-center text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button className="btn-ghost" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {/* Capacity chart */}
      {capacity.length > 0 && (
        <div className="mt-8">
          <h2 className="font-semibold text-gray-800 mb-3">Machine Capacity Utilization</h2>
          <div className="card p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={capacity} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="machine_name" width={75} tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => `${v}%`} />
                <Bar dataKey="utilization_pct" name="Utilization" radius={[0, 4, 4, 0]}>
                  {capacity.map((entry, i) => (
                    <Cell key={i} fill={utilColor(entry.utilization_pct)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* New Order Modal */}
      {showNew && (
        <Modal isOpen onClose={() => setShowNew(false)} title="New Production Order">
          <div className="space-y-4">
            <FormField label="Customer *"><CustomerSearch value={orderForm.customer_id} onChange={c => setOrder('customer_id', c)} /></FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Order Ref *"><input className="input" value={orderForm.order_ref} onChange={e => setOrder('order_ref', e.target.value)} placeholder="PO-2026-001" /></FormField>
              <FormField label="Required By">
                <input className="input" type="date" value={orderForm.required_by_date} onChange={e => setOrder('required_by_date', e.target.value)} />
              </FormField>
              <FormField label="Priority">
                <select className="input" value={orderForm.priority} onChange={e => setOrder('priority', e.target.value)}>
                  {['urgent', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Notes"><textarea className="input" rows={2} value={orderForm.notes} onChange={e => setOrder('notes', e.target.value)} /></FormField>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Line Items</label>
                <button className="btn-ghost text-xs flex items-center gap-1" onClick={addLineItem}><PlusIcon className="h-3 w-3" /> Add Row</button>
              </div>
              <div className="space-y-2">
                {orderForm.line_items.map((item, i) => (
                  <LineItemRow key={i} item={item} index={i} products={products} onChange={updateLineItem} onRemove={removeLineItem} />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateOrder}>Create Order</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Schedule Modal */}
      {scheduleTarget && (
        <Modal isOpen onClose={() => setScheduleTarget(null)} title={`Schedule — ${scheduleTarget.order_ref}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Start Date *"><input className="input" type="date" value={scheduleForm.start_date} onChange={e => setScheduleForm(f => ({ ...f, start_date: e.target.value }))} /></FormField>
              <FormField label="End Date *"><input className="input" type="date" value={scheduleForm.end_date} onChange={e => setScheduleForm(f => ({ ...f, end_date: e.target.value }))} /></FormField>
            </div>
            <FormField label="Machines">
              <div className="max-h-40 overflow-auto border border-gray-200 rounded-md p-2 space-y-1">
                {machines.length === 0 && <p className="text-sm text-gray-400">No machines found.</p>}
                {machines.map(m => (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={scheduleForm.machine_ids.includes(m.id)} onChange={() => toggleMachine(m.id)} />
                    <span>{m.code} — {m.name}</span>
                    <Badge color={STATUS_COLOR[m.status] || 'gray'} className="ml-auto">{m.status}</Badge>
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="Notes"><textarea className="input" rows={2} value={scheduleForm.notes} onChange={e => setScheduleForm(f => ({ ...f, notes: e.target.value }))} /></FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={() => setScheduleTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSchedule}>Schedule</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <Modal isOpen onClose={() => setCancelTarget(null)} title={`Cancel — ${cancelTarget.order_ref}`}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Provide a reason for cancelling this order.</p>
            <FormField label="Reason *">
              <textarea className="input" rows={3} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason for cancellation…" />
            </FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={() => setCancelTarget(null)}>Keep Order</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={handleCancel}>Cancel Order</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
