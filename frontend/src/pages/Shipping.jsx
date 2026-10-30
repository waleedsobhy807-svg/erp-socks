/**
 * Shipping & Tracking page — shipments, packing lists, carriers.
 */
import { useState } from 'react';
import { PlusIcon, XMarkIcon, TruckIcon } from '@heroicons/react/24/outline';
import { useGet, usePost } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatCard from '../components/StatCard';
import api from '../api/client';

const shipStatusColor = { pending:'gray', in_transit:'blue', delivered:'green', returned:'red' };

/* ── Async order search ── */
function OrderSearch({ value, onChange }) {
  const [q, setQ]       = useState('');
  const [res, setRes]   = useState([]);
  const [open, setOpen] = useState(false);

  async function search(val) {
    if (!val || val.length < 2) { setRes([]); return; }
    try {
      const { data } = await api.get('/planning/orders', { params: { search: val, limit: 8 } });
      setRes(data?.data ?? []);
      setOpen(true);
    } catch { setRes([]); }
  }

  return (
    <div className="relative">
      <input value={value?.order_ref ?? q} onChange={e => { setQ(e.target.value); onChange(null); search(e.target.value); }} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search production order…" className="input w-full" />
      {open && res.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
          {res.map(o => (
            <li key={o.id} onMouseDown={() => { onChange(o); setQ(o.order_ref); setOpen(false); }} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
              <span className="font-medium">{o.order_ref}</span>
              <span className="text-gray-400 ml-2">{o.customer_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── New Shipment modal ── */
function NewShipmentModal({ open, onClose, onDone }) {
  const [f, setF] = useState({ packing_list_id:'', carrier_id:'', customer_id:'', ship_date:'', tracking_no:'', service_type:'', freight_cost:'', notes:'' });
  const { data: plData }      = useGet('pl-select', '/shipping/packing-lists', { limit: 50 });
  const { data: carrierData } = useGet('carriers',  '/shipping/carriers');
  const { mutate, isPending } = usePost('/shipping');
  const pls      = plData?.data      ?? plData      ?? [];
  const carriers = carrierData?.data ?? carrierData ?? [];
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  return (
    <Modal open={open} onClose={onClose} title="New Shipment" size="lg">
      <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: () => { onClose(); onDone(); } }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Packing List" required>
            <select required value={f.packing_list_id} onChange={set('packing_list_id')} className="input">
              <option value="">Select packing list…</option>
              {pls.map(p => <option key={p.id} value={p.id}>{p.id?.slice(0,8)} — {p.status}</option>)}
            </select>
          </FormField>
          <FormField label="Carrier" required>
            <select required value={f.carrier_id} onChange={set('carrier_id')} className="input">
              <option value="">Select carrier…</option>
              {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Ship Date" required><input required type="date" value={f.ship_date} onChange={set('ship_date')} className="input" /></FormField>
          <FormField label="Tracking No"><input value={f.tracking_no} onChange={set('tracking_no')} className="input" /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Service Type"><input value={f.service_type} onChange={set('service_type')} className="input" placeholder="e.g. Express, Standard" /></FormField>
          <FormField label="Freight Cost"><input type="number" min={0} value={f.freight_cost} onChange={set('freight_cost')} className="input" /></FormField>
        </div>
        <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} className="input" /></FormField>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Creating…' : 'Create Shipment'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Update shipment status modal ── */
function UpdateStatusModal({ open, onClose, shipmentId, onDone }) {
  const [f, setF] = useState({ status:'in_transit', notes:'', status_date:'' });
  const { mutate, isPending } = usePost(`/shipping/${shipmentId}/status`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title="Update Shipment Status" size="sm">
      <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: () => { onClose(); onDone(); } }); }} className="space-y-4">
        <FormField label="New Status">
          <select value={f.status} onChange={set('status')} className="input">
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="returned">Returned</option>
          </select>
        </FormField>
        <FormField label="Status Date"><input type="date" value={f.status_date} onChange={set('status_date')} className="input" /></FormField>
        <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} className="input" /></FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Updating…' : 'Update'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── New Packing List modal ── */
function NewPLModal({ open, onClose, onDone }) {
  const [order, setOrder]     = useState(null);
  const [notes, setNotes]     = useState('');
  const [items, setItems]     = useState([{ product_id:'', variant_id:'', quantity_pairs:'', box_count:'', weight_kg:'' }]);
  const { data: prodData }    = useGet('prod-select', '/products', { limit: 100 });
  const { mutate, isPending } = usePost('/shipping/packing-lists');
  const products              = prodData?.data ?? [];

  function setItem(i,k) { return e => setItems(its => its.map((it,j) => j===i ? { ...it, [k]: e.target.value } : it)); }

  function submit(e) {
    e.preventDefault();
    if (!order) { alert('Select a production order'); return; }
    mutate({ production_order_id: order.id, notes, items }, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <Modal open={open} onClose={onClose} title="New Packing List" size="xl">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Production Order" required>
          <OrderSearch value={order} onChange={setOrder} />
        </FormField>
        <FormField label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="input" /></FormField>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">Items</h4>
            <button type="button" onClick={() => setItems(its => [...its, { product_id:'', variant_id:'', quantity_pairs:'', box_count:'', weight_kg:'' }])} className="text-xs text-primary-600 hover:underline flex items-center gap-1"><PlusIcon className="h-3 w-3" />Add Item</button>
          </div>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                <select value={item.product_id} onChange={setItem(i,'product_id')} className="input text-xs col-span-2">
                  <option value="">Product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input placeholder="Qty pairs" type="number" min={0} value={item.quantity_pairs} onChange={setItem(i,'quantity_pairs')} className="input text-xs" />
                <input placeholder="Boxes" type="number" min={0} value={item.box_count} onChange={setItem(i,'box_count')} className="input text-xs" />
                <div className="flex gap-1">
                  <input placeholder="kg" type="number" min={0} step={0.1} value={item.weight_kg} onChange={setItem(i,'weight_kg')} className="input text-xs flex-1" />
                  <button type="button" onClick={() => setItems(its => its.filter((_,j) => j!==i))} className="text-red-400 px-1"><XMarkIcon className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Creating…' : 'Create Packing List'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Carrier form ── */
function CarrierForm({ onSubmit, loading }) {
  const [f, setF] = useState({ name:'', code:'', contact_person:'', phone:'', email:'', country:'' });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" required><input required value={f.name} onChange={set('name')} className="input" /></FormField>
        <FormField label="Code" required><input required value={f.code} onChange={set('code')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Contact Person"><input value={f.contact_person} onChange={set('contact_person')} className="input" /></FormField>
        <FormField label="Country"><input value={f.country} onChange={set('country')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone"><input value={f.phone} onChange={set('phone')} className="input" /></FormField>
        <FormField label="Email"><input type="email" value={f.email} onChange={set('email')} className="input" /></FormField>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving…' : 'Save Carrier'}</button>
      </div>
    </form>
  );
}

export default function Shipping() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;

  const [tab, setTab]               = useState('shipments');
  const [page, setPage]             = useState(1);
  const [statusFilter, setStatus]   = useState('');
  const [shipModal, setShipModal]   = useState(false);
  const [plModal, setPlModal]       = useState(false);
  const [carrierModal, setCarrierModal] = useState(false);
  const [updatingShipment, setUpdating] = useState(null);

  const { data: stats }       = useGet('ship-stats', '/shipping/stats', {}, { staleTime: 60_000 });
  const { data: shipData,     isLoading: shipLoading,   refetch: refetchShip    } = useGet(['shipments', statusFilter, page], '/shipping',                      { status: statusFilter || undefined, page, limit: 20 });
  const { data: plData,       isLoading: plLoading,     refetch: refetchPL      } = useGet('packing-lists', '/shipping/packing-lists',                          { limit: 50 });
  const { data: carrierData,  isLoading: carrierLoading,refetch: refetchCarriers} = useGet('carriers-list', '/shipping/carriers');
  const { mutate: createCarrier, isPending: creatingCarrier } = usePost('/shipping/carriers');

  const shipments = shipData?.data    ?? [];
  const pls       = plData?.data      ?? plData      ?? [];
  const carriers  = carrierData?.data ?? carrierData ?? [];
  const onTimePct = stats?.on_time_rate_pct ?? 0;

  const shipColumns = [
    { key:'id',            label:'#',        render: r => <span className="font-mono text-xs">{r.id?.slice(0,8)}</span> },
    { key:'customer_name', label:'Customer' },
    { key:'carrier_name',  label:'Carrier' },
    { key:'status',        label:'Status',   render: r => <Badge label={r.status} color={shipStatusColor[r.status] ?? 'gray'} /> },
    { key:'ship_date',     label:'Ship Date',render: r => r.ship_date ? new Date(r.ship_date).toLocaleDateString() : '—' },
    { key:'tracking_no',   label:'Tracking', render: r => <span className="font-mono text-xs">{r.tracking_no ?? '—'}</span> },
    { key:'freight_cost',  label:'Freight',  render: r => r.freight_cost ? `$${Number(r.freight_cost).toLocaleString()}` : '—' },
    { key:'actions',       label:'',         render: r => canWrite && r.status !== 'delivered' && r.status !== 'returned' ? (
      <button onClick={e => { e.stopPropagation(); setUpdating(r.id); }} className="text-xs text-primary-600 hover:underline">Update Status</button>
    ) : null },
  ];

  const plColumns = [
    { key:'id',          label:'#',     render: r => <span className="font-mono text-xs">{r.id?.slice(0,8)}</span> },
    { key:'order_ref',   label:'Prod Order', render: r => r.production_order_ref ?? '—' },
    { key:'status',      label:'Status',render: r => <Badge label={r.status ?? 'draft'} color={r.status === 'shipped' ? 'green' : 'blue'} /> },
    { key:'created_at',  label:'Created',render: r => r.created_at ? new Date(r.created_at).toLocaleDateString() : '—' },
  ];

  const carrierColumns = [
    { key:'name',           label:'Name' },
    { key:'code',           label:'Code' },
    { key:'contact_person', label:'Contact' },
    { key:'phone',          label:'Phone' },
    { key:'country',        label:'Country' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Shipping & Tracking" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={TruckIcon} label="Shipments (30d)"   value={stats?.total_shipments_30d ?? '—'} changeType="up" />
        <StatCard icon={TruckIcon} label="Avg Freight Cost"  value={stats?.avg_freight_cost ? `$${Number(stats.avg_freight_cost).toFixed(0)}` : '—'} changeType="neutral" />
        <div className="card flex flex-col justify-between">
          <span className="text-sm text-gray-500">On-Time Rate</span>
          <span className="text-2xl font-bold text-gray-900">{onTimePct.toFixed(1)}%</span>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
            <div className={`h-2 rounded-full ${onTimePct >= 90 ? 'bg-green-500' : onTimePct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${onTimePct}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {['shipments','packing-lists','carriers'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${tab===t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>{t.replace('-',' ')}</button>
        ))}
      </div>

      {tab === 'shipments' && (
        <div className="space-y-4">
          <div className="flex justify-between flex-wrap gap-3">
            <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }} className="input w-40">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="returned">Returned</option>
            </select>
            {canWrite && <button onClick={() => setShipModal(true)} className="btn-primary flex items-center gap-1.5"><PlusIcon className="h-4 w-4" />New Shipment</button>}
          </div>
          <Table columns={shipColumns} data={shipments} loading={shipLoading} emptyText="No shipments" page={page} totalPages={Math.ceil((shipData?.total ?? 0)/20)} onPageChange={setPage} />
        </div>
      )}

      {tab === 'packing-lists' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <button onClick={() => setPlModal(true)} className="btn-primary flex items-center gap-1.5"><PlusIcon className="h-4 w-4" />New Packing List</button>}
          </div>
          <Table columns={plColumns} data={pls} loading={plLoading} emptyText="No packing lists" />
        </div>
      )}

      {tab === 'carriers' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <button onClick={() => setCarrierModal(true)} className="btn-primary flex items-center gap-1.5"><PlusIcon className="h-4 w-4" />Add Carrier</button>}
          </div>
          <Table columns={carrierColumns} data={carriers} loading={carrierLoading} emptyText="No carriers" />
        </div>
      )}

      <NewShipmentModal open={shipModal}    onClose={() => setShipModal(false)}    onDone={refetchShip} />
      <NewPLModal        open={plModal}      onClose={() => setPlModal(false)}      onDone={refetchPL} />
      <Modal open={carrierModal} onClose={() => setCarrierModal(false)} title="Add Carrier" size="md">
        <CarrierForm onSubmit={f => createCarrier(f, { onSuccess: () => { setCarrierModal(false); refetchCarriers(); } })} loading={creatingCarrier} />
      </Modal>

      {updatingShipment && (
        <UpdateStatusModal open={!!updatingShipment} onClose={() => setUpdating(null)} shipmentId={updatingShipment} onDone={() => { setUpdating(null); refetchShip(); }} />
      )}
    </div>
  );
}
