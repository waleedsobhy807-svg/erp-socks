import { useState } from 'react';
import { PlusIcon, XMarkIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useGet } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatCard from '../components/StatCard';

const YARN_TYPES = ['Cotton', 'Wool', 'Nylon', 'Polyester', 'Acrylic', 'Bamboo', 'Blend', 'Other'];
const UOM_OPTIONS = ['kg', 'g', 'cone', 'spool', 'meter'];
const STATUS_COLOR = { active: 'green', inactive: 'gray', discontinued: 'red' };

function useModal(initial = false) {
  const [open, setOpen] = useState(initial);
  return [open, () => setOpen(true), () => setOpen(false)];
}

export default function Yarn() {
  const { user } = useAuth();
  const canWrite = ['admin', 'manager', 'warehouse'].includes(user?.role);

  // Filters
  const [yarnType, setYarnType] = useState('');
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);

  // Selected row for detail panel
  const [selected, setSelected] = useState(null);

  // Modal visibility
  const [showAdd, openAdd, closeAdd] = useModal();
  const [showReceive, openReceive, closeReceive] = useModal();
  const [showIssue, openIssue, closeIssue] = useModal();
  const [showAdjust, openAdjust, closeAdjust] = useModal();

  // Forms
  const emptyAdd = { name: '', code: '', yarn_type: '', supplier: '', colour: '', lot_number: '', unit_of_measure: 'kg', unit_cost: '', reorder_point: '', reorder_qty: '', location_id: '' };
  const emptyReceive = { yarn_item_id: '', qty: '', unit_cost: '', invoice_no: '', received_by: '', notes: '' };
  const emptyIssue = { yarn_item_id: '', qty: '', work_order_id: '', issued_to: '', notes: '' };
  const emptyAdjust = { yarn_item_id: '', adjustment_qty: '', reason: '', reference_no: '' };

  const [addForm, setAddForm] = useState(emptyAdd);
  const [receiveForm, setReceiveForm] = useState(emptyReceive);
  const [issueForm, setIssueForm] = useState(emptyIssue);
  const [adjustForm, setAdjustForm] = useState(emptyAdjust);

  // Data
  const { data: summaryData } = useGet('/yarn/summary');
  const { data: yarnData, loading, error, refetch } = useGet(
    `/yarn?page=${page}&yarn_type=${yarnType}&search=${search}&low_stock=${lowStock}`
  );
  const { data: locationsData } = useGet('/yarn/locations');
  const { data: receiptsData } = useGet(selected ? `/yarn/${selected.id}/receipts?limit=10` : null);
  const { data: issuesData } = useGet(selected ? `/yarn/${selected.id}/issues?limit=10` : null);

  const summary = summaryData || {};
  const yarns = yarnData?.items || yarnData || [];
  const totalPages = yarnData?.total_pages || 1;
  const locations = locationsData || [];
  const receipts = receiptsData || [];
  const issues = issuesData || [];

  const setAdd = (k, v) => setAddForm(f => ({ ...f, [k]: v }));
  const setReceive = (k, v) => setReceiveForm(f => ({ ...f, [k]: v }));
  const setIssue = (k, v) => setIssueForm(f => ({ ...f, [k]: v }));
  const setAdjust = (k, v) => setAdjustForm(f => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!addForm.name || !addForm.code || !addForm.yarn_type) { toast.error('Name, code and type are required'); return; }
    try {
      await api.post('/yarn', addForm);
      toast.success('Yarn item added');
      setAddForm(emptyAdd);
      closeAdd();
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to add yarn');
    }
  };

  const handleReceive = async () => {
    if (!receiveForm.yarn_item_id || !receiveForm.qty) { toast.error('Yarn item and quantity required'); return; }
    try {
      await api.post('/yarn/receipts', receiveForm);
      toast.success('Yarn received');
      setReceiveForm(emptyReceive);
      closeReceive();
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to receive yarn');
    }
  };

  const handleIssue = async () => {
    if (!issueForm.yarn_item_id || !issueForm.qty) { toast.error('Yarn item and quantity required'); return; }
    try {
      await api.post('/yarn/issues', issueForm);
      toast.success('Yarn issued');
      setIssueForm(emptyIssue);
      closeIssue();
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to issue yarn');
    }
  };

  const handleAdjust = async () => {
    if (!adjustForm.yarn_item_id || adjustForm.adjustment_qty === '') { toast.error('Yarn item and adjustment quantity required'); return; }
    try {
      await api.post('/yarn/adjustments', adjustForm);
      toast.success('Stock adjusted');
      setAdjustForm(emptyAdjust);
      closeAdjust();
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to adjust stock');
    }
  };

  const columns = [
    { key: 'code', header: 'Code', render: r => <span className="font-mono text-sm">{r.code}</span> },
    { key: 'name', header: 'Name' },
    { key: 'yarn_type', header: 'Type', render: r => <Badge color="blue">{r.yarn_type}</Badge> },
    { key: 'supplier', header: 'Supplier', render: r => r.supplier || '—' },
    {
      key: 'stock_qty', header: 'Stock Qty',
      render: r => (
        <span className={r.stock_qty <= r.reorder_point ? 'text-red-600 font-semibold' : ''}>
          {r.stock_qty} {r.unit_of_measure}
        </span>
      )
    },
    { key: 'reorder_point', header: 'Reorder Pt', render: r => r.reorder_point ?? '—' },
    { key: 'unit_cost', header: 'Unit Cost', render: r => r.unit_cost != null ? `$${Number(r.unit_cost).toFixed(2)}` : '—' },
    { key: 'status', header: 'Status', render: r => <Badge color={STATUS_COLOR[r.status] || 'gray'}>{r.status || 'active'}</Badge> },
    {
      key: 'actions', header: '', render: r => (
        <button className="btn-ghost p-1 text-indigo-600" onClick={e => { e.stopPropagation(); setSelected(r); }}>
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      )
    },
  ];

  const receiptColumns = [
    { key: 'received_at', header: 'Date', render: r => r.received_at ? new Date(r.received_at).toLocaleDateString() : '—' },
    { key: 'qty', header: 'Qty' },
    { key: 'unit_cost', header: 'Unit Cost', render: r => r.unit_cost != null ? `$${Number(r.unit_cost).toFixed(2)}` : '—' },
    { key: 'invoice_no', header: 'Invoice', render: r => r.invoice_no || '—' },
    { key: 'received_by', header: 'Received By', render: r => r.received_by || '—' },
  ];

  const issueColumns = [
    { key: 'issued_at', header: 'Date', render: r => r.issued_at ? new Date(r.issued_at).toLocaleDateString() : '—' },
    { key: 'qty', header: 'Qty' },
    { key: 'work_order_id', header: 'Work Order', render: r => r.work_order_id || '—' },
    { key: 'issued_to', header: 'Issued To', render: r => r.issued_to || '—' },
  ];

  const YarnSelect = ({ value, onChange, label = 'Yarn Item *' }) => (
    <FormField label={label}>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">-- Select yarn --</option>
        {yarns.map(y => <option key={y.id} value={y.id}>{y.code} — {y.name}</option>)}
      </select>
    </FormField>
  );

  return (
    <div className="flex h-full">
      <div className={`flex-1 min-w-0 p-6 overflow-auto transition-all ${selected ? 'mr-[480px]' : ''}`}>
        <PageHeader title="Yarn Inventory" subtitle="Track yarn stock, receipts and issues" />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Items" value={summary.total_items ?? '—'} />
          <StatCard label="Low Stock" value={summary.low_stock_count ?? '—'} color="yellow" />
          <StatCard label="Total Value" value={summary.total_value != null ? `$${Number(summary.total_value).toLocaleString()}` : '—'} color="green" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input className="input w-56" placeholder="Search code or name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <select className="input w-40" value={yarnType} onChange={e => { setYarnType(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            {YARN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={lowStock} onChange={e => { setLowStock(e.target.checked); setPage(1); }} />
            Low Stock Only
          </label>
          {canWrite && (
            <div className="ml-auto flex gap-2">
              <button className="btn-primary flex items-center gap-1" onClick={openAdd}><PlusIcon className="h-4 w-4" /> Add Yarn</button>
              <button className="btn-ghost" onClick={openReceive}>Receive Yarn</button>
              <button className="btn-ghost" onClick={openIssue}>Issue Yarn</button>
              <button className="btn-ghost" onClick={openAdjust}>Adjust Stock</button>
            </div>
          )}
        </div>

        {error && <p className="text-red-600 mb-4">Failed to load yarn: {error.message}</p>}

        <Table columns={columns} data={yarns} loading={loading} onRowClick={setSelected} rowClassName={r => selected?.id === r.id ? 'bg-indigo-50' : ''} />

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="self-center text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button className="btn-ghost" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div>
              <h2 className="font-semibold text-gray-900">{selected.name}</h2>
              <p className="text-sm text-gray-500 font-mono">{selected.code}</p>
            </div>
            <button className="btn-ghost p-1" onClick={() => setSelected(null)}><XMarkIcon className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-6">
            <div className="card p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-500">Type</span><span>{selected.yarn_type}</span>
                <span className="text-gray-500">Supplier</span><span>{selected.supplier || '—'}</span>
                <span className="text-gray-500">Colour</span><span>{selected.colour || '—'}</span>
                <span className="text-gray-500">Lot No.</span><span>{selected.lot_number || '—'}</span>
                <span className="text-gray-500">Stock Qty</span>
                <span className={selected.stock_qty <= selected.reorder_point ? 'text-red-600 font-semibold' : ''}>
                  {selected.stock_qty} {selected.unit_of_measure}
                </span>
                <span className="text-gray-500">Reorder Point</span><span>{selected.reorder_point ?? '—'}</span>
                <span className="text-gray-500">Reorder Qty</span><span>{selected.reorder_qty ?? '—'}</span>
                <span className="text-gray-500">Unit Cost</span><span>{selected.unit_cost != null ? `$${Number(selected.unit_cost).toFixed(2)}` : '—'}</span>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-sm text-gray-700 mb-2">Last 10 Receipts</h3>
              {receipts.length === 0 ? <p className="text-sm text-gray-400">No receipts.</p> : <Table columns={receiptColumns} data={receipts} compact />}
            </div>
            <div>
              <h3 className="font-medium text-sm text-gray-700 mb-2">Last 10 Issues</h3>
              {issues.length === 0 ? <p className="text-sm text-gray-400">No issues.</p> : <Table columns={issueColumns} data={issues} compact />}
            </div>
          </div>
        </div>
      )}

      {/* Add Yarn Modal */}
      {showAdd && (
        <Modal isOpen onClose={closeAdd} title="Add Yarn Item">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Name *"><input className="input" value={addForm.name} onChange={e => setAdd('name', e.target.value)} /></FormField>
              <FormField label="Code *"><input className="input" value={addForm.code} onChange={e => setAdd('code', e.target.value)} /></FormField>
            </div>
            <FormField label="Yarn Type *">
              <select className="input" value={addForm.yarn_type} onChange={e => setAdd('yarn_type', e.target.value)}>
                <option value="">-- Select --</option>
                {YARN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Supplier"><input className="input" value={addForm.supplier} onChange={e => setAdd('supplier', e.target.value)} /></FormField>
              <FormField label="Colour"><input className="input" value={addForm.colour} onChange={e => setAdd('colour', e.target.value)} /></FormField>
              <FormField label="Lot Number"><input className="input" value={addForm.lot_number} onChange={e => setAdd('lot_number', e.target.value)} /></FormField>
              <FormField label="Unit of Measure">
                <select className="input" value={addForm.unit_of_measure} onChange={e => setAdd('unit_of_measure', e.target.value)}>
                  {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </FormField>
              <FormField label="Unit Cost"><input className="input" type="number" step="0.01" value={addForm.unit_cost} onChange={e => setAdd('unit_cost', e.target.value)} /></FormField>
              <FormField label="Reorder Point"><input className="input" type="number" value={addForm.reorder_point} onChange={e => setAdd('reorder_point', e.target.value)} /></FormField>
              <FormField label="Reorder Qty"><input className="input" type="number" value={addForm.reorder_qty} onChange={e => setAdd('reorder_qty', e.target.value)} /></FormField>
              <FormField label="Location">
                <select className="input" value={addForm.location_id} onChange={e => setAdd('location_id', e.target.value)}>
                  <option value="">-- None --</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </FormField>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={closeAdd}>Cancel</button>
              <button className="btn-primary" onClick={handleAdd}>Add</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Receive Yarn Modal */}
      {showReceive && (
        <Modal isOpen onClose={closeReceive} title="Receive Yarn">
          <div className="space-y-4">
            <YarnSelect value={receiveForm.yarn_item_id} onChange={v => setReceive('yarn_item_id', v)} />
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Quantity *"><input className="input" type="number" step="0.001" value={receiveForm.qty} onChange={e => setReceive('qty', e.target.value)} /></FormField>
              <FormField label="Unit Cost"><input className="input" type="number" step="0.01" value={receiveForm.unit_cost} onChange={e => setReceive('unit_cost', e.target.value)} /></FormField>
              <FormField label="Invoice No."><input className="input" value={receiveForm.invoice_no} onChange={e => setReceive('invoice_no', e.target.value)} /></FormField>
              <FormField label="Received By"><input className="input" value={receiveForm.received_by} onChange={e => setReceive('received_by', e.target.value)} /></FormField>
            </div>
            <FormField label="Notes"><textarea className="input" rows={2} value={receiveForm.notes} onChange={e => setReceive('notes', e.target.value)} /></FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={closeReceive}>Cancel</button>
              <button className="btn-primary" onClick={handleReceive}>Receive</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Issue Yarn Modal */}
      {showIssue && (
        <Modal isOpen onClose={closeIssue} title="Issue Yarn">
          <div className="space-y-4">
            <YarnSelect value={issueForm.yarn_item_id} onChange={v => setIssue('yarn_item_id', v)} />
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Quantity *"><input className="input" type="number" step="0.001" value={issueForm.qty} onChange={e => setIssue('qty', e.target.value)} /></FormField>
              <FormField label="Work Order (opt.)"><input className="input" value={issueForm.work_order_id} onChange={e => setIssue('work_order_id', e.target.value)} /></FormField>
              <FormField label="Issued To"><input className="input" value={issueForm.issued_to} onChange={e => setIssue('issued_to', e.target.value)} /></FormField>
            </div>
            <FormField label="Notes"><textarea className="input" rows={2} value={issueForm.notes} onChange={e => setIssue('notes', e.target.value)} /></FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={closeIssue}>Cancel</button>
              <button className="btn-primary" onClick={handleIssue}>Issue</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Adjust Stock Modal */}
      {showAdjust && (
        <Modal isOpen onClose={closeAdjust} title="Adjust Stock">
          <div className="space-y-4">
            <YarnSelect value={adjustForm.yarn_item_id} onChange={v => setAdjust('yarn_item_id', v)} />
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Adjustment Qty (signed) *">
                <input className="input" type="number" step="0.001" placeholder="-5 or +10" value={adjustForm.adjustment_qty} onChange={e => setAdjust('adjustment_qty', e.target.value)} />
              </FormField>
              <FormField label="Reference No."><input className="input" value={adjustForm.reference_no} onChange={e => setAdjust('reference_no', e.target.value)} /></FormField>
            </div>
            <FormField label="Reason *"><textarea className="input" rows={2} value={adjustForm.reason} onChange={e => setAdjust('reason', e.target.value)} /></FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={closeAdjust}>Cancel</button>
              <button className="btn-primary" onClick={handleAdjust}>Adjust</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
