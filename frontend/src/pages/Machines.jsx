/**
 * Machine Management page — fleet stats, maintenance logs, downtime tracking.
 */
import { useState } from 'react';
import { PlusIcon, XMarkIcon, WrenchScrewdriverIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useGet, usePost, usePut } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

const MACHINE_TYPES = ['Circular Knitting','Linking','Boarding','Dyeing','Inspection','Packaging','Embroidery','Other'];
const statusColor   = { active:'green', maintenance:'yellow', retired:'gray' };
const mTypeColor    = { preventive:'blue', corrective:'yellow', emergency:'red' };

function MachineForm({ initial={}, onSubmit, loading }) {
  const [f, setF] = useState({ name:'', code:'', machine_type:'Circular Knitting', manufacturer:'', model_no:'', serial_no:'', purchase_date:'', location:'', capacity_pairs_per_hour:'', notes:'', ...initial });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" required><input required value={f.name} onChange={set('name')} className="input" /></FormField>
        <FormField label="Code" required><input required value={f.code} onChange={set('code')} className="input" /></FormField>
      </div>
      <FormField label="Type" required>
        <select value={f.machine_type} onChange={set('machine_type')} className="input">
          {MACHINE_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Manufacturer"><input value={f.manufacturer} onChange={set('manufacturer')} className="input" /></FormField>
        <FormField label="Model No"><input value={f.model_no} onChange={set('model_no')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Serial No"><input value={f.serial_no} onChange={set('serial_no')} className="input" /></FormField>
        <FormField label="Purchase Date"><input type="date" value={f.purchase_date} onChange={set('purchase_date')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Location"><input value={f.location} onChange={set('location')} className="input" /></FormField>
        <FormField label="Capacity (pairs/hr)"><input type="number" min={0} value={f.capacity_pairs_per_hour} onChange={set('capacity_pairs_per_hour')} className="input" /></FormField>
      </div>
      <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} className="input" /></FormField>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving…' : 'Save Machine'}</button>
      </div>
    </form>
  );
}

function MaintenanceForm({ machineId, onDone }) {
  const [f, setF] = useState({ maintenance_type:'preventive', performed_by:'', performed_at:'', duration_hours:'', description:'', parts_replaced:'', cost:'' });
  const { mutate, isPending } = usePost(`/machines/${machineId}/maintenance`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: onDone }); }} className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Type">
          <select value={f.maintenance_type} onChange={set('maintenance_type')} className="input text-sm">
            <option value="preventive">Preventive</option>
            <option value="corrective">Corrective</option>
            <option value="emergency">Emergency</option>
          </select>
        </FormField>
        <FormField label="Performed By"><input required value={f.performed_by} onChange={set('performed_by')} className="input text-sm" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date/Time"><input required type="datetime-local" value={f.performed_at} onChange={set('performed_at')} className="input text-sm" /></FormField>
        <FormField label="Duration (hrs)"><input type="number" min={0} step={0.5} value={f.duration_hours} onChange={set('duration_hours')} className="input text-sm" /></FormField>
      </div>
      <FormField label="Description"><textarea required rows={2} value={f.description} onChange={set('description')} className="input text-sm" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Parts Replaced"><input value={f.parts_replaced} onChange={set('parts_replaced')} className="input text-sm" /></FormField>
        <FormField label="Cost"><input type="number" min={0} value={f.cost} onChange={set('cost')} className="input text-sm" /></FormField>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost text-sm">Cancel</button>
        <button type="submit" disabled={isPending} className="btn-primary text-sm">{isPending ? 'Saving…' : 'Log Maintenance'}</button>
      </div>
    </form>
  );
}

function DowntimeForm({ machineId, onDone }) {
  const [f, setF] = useState({ started_at:'', ended_at:'', reason_code:'', description:'', reported_by:'' });
  const { mutate, isPending } = usePost(`/machines/${machineId}/downtime`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate({ ...f, ended_at: f.ended_at || null }, { onSuccess: onDone }); }} className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Started At"><input required type="datetime-local" value={f.started_at} onChange={set('started_at')} className="input text-sm" /></FormField>
        <FormField label="Ended At (leave blank if ongoing)"><input type="datetime-local" value={f.ended_at} onChange={set('ended_at')} className="input text-sm" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Reason Code"><input value={f.reason_code} onChange={set('reason_code')} className="input text-sm" placeholder="e.g. MECH-FAIL" /></FormField>
        <FormField label="Reported By"><input required value={f.reported_by} onChange={set('reported_by')} className="input text-sm" /></FormField>
      </div>
      <FormField label="Description"><textarea required rows={2} value={f.description} onChange={set('description')} className="input text-sm" /></FormField>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost text-sm">Cancel</button>
        <button type="submit" disabled={isPending} className="btn-primary text-sm">{isPending ? 'Saving…' : 'Log Downtime'}</button>
      </div>
    </form>
  );
}

function CloseDowntimeModal({ open, onClose, machineId, downtimeId, onDone }) {
  const [f, setF] = useState({ ended_at:'', resolution_notes:'' });
  const { mutate, isPending } = usePost(`/machines/${machineId}/downtime/${downtimeId}/close`);
  return (
    <Modal open={open} onClose={onClose} title="Close Downtime" size="sm">
      <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: () => { onClose(); onDone(); } }); }} className="space-y-4">
        <FormField label="Ended At"><input required type="datetime-local" value={f.ended_at} onChange={e => setF(p => ({ ...p, ended_at: e.target.value }))} className="input" /></FormField>
        <FormField label="Resolution Notes"><textarea rows={3} value={f.resolution_notes} onChange={e => setF(p => ({ ...p, resolution_notes: e.target.value }))} className="input" /></FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Closing…' : 'Close Downtime'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MachinePanel({ machine, onClose, onUpdate }) {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;
  const [tab, setTab] = useState('maintenance');
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [showDtForm, setShowDtForm]       = useState(false);
  const [closingDt, setClosingDt]         = useState(null);

  const { data: maintData, refetch: refetchMaint } = useGet(['machine-maint', machine.id], `/machines/${machine.id}/maintenance`, { limit: 10 });
  const { data: dtData,    refetch: refetchDt }    = useGet(['machine-dt',   machine.id], `/machines/${machine.id}/downtime`,    { limit: 10 });
  const { mutate: retire, isPending: retiring }     = usePost(`/machines/${machine.id}/retire`);

  const maintenanceLogs = maintData?.data ?? maintData ?? [];
  const downtimes       = dtData?.data    ?? dtData    ?? [];

  const uptimePct = machine.uptime_pct_30d ?? 100;

  function handleRetire() {
    const reason = window.prompt('Reason for retirement:');
    if (!reason) return;
    const retirement_date = window.prompt('Retirement date (YYYY-MM-DD):') || new Date().toISOString().slice(0,10);
    retire({ reason, retirement_date }, { onSuccess: () => { onClose(); onUpdate(); } });
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[28rem] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-900">{machine.name}</h2>
          <p className="text-xs text-gray-500">{machine.code} · {machine.machine_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && machine.status !== 'retired' && (
            <button onClick={handleRetire} disabled={retiring} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">Retire</button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>
      </div>

      {/* Uptime bar */}
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>30-day uptime</span><span>{uptimePct.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className={`h-2 rounded-full ${uptimePct >= 90 ? 'bg-green-500' : uptimePct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, uptimePct)}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div><div className="font-medium text-gray-900">{machine.manufacturer || '—'}</div><div className="text-gray-500">Maker</div></div>
          <div><div className="font-medium text-gray-900">{machine.capacity_pairs_per_hour || '—'}</div><div className="text-gray-500">Pairs/hr</div></div>
          <div><div className="font-medium text-gray-900"><Badge label={machine.status} color={statusColor[machine.status] ?? 'gray'} /></div><div className="text-gray-500">Status</div></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {['maintenance','downtime'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${tab===t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tab === 'maintenance' && (
          <>
            {maintenanceLogs.map(m => (
              <div key={m.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                <div className="flex items-center gap-2"><Badge label={m.maintenance_type} color={mTypeColor[m.maintenance_type] ?? 'gray'} /><span className="text-gray-500 text-xs">{m.performed_at ? new Date(m.performed_at).toLocaleDateString() : '—'}</span></div>
                <div className="mt-1 text-gray-700">{m.description}</div>
                <div className="text-gray-400 text-xs mt-0.5">By {m.performed_by} · {m.duration_hours}h</div>
              </div>
            ))}
            {maintenanceLogs.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No maintenance logs</p>}
            {canWrite && (showMaintForm
              ? <MaintenanceForm machineId={machine.id} onDone={() => { setShowMaintForm(false); refetchMaint(); }} />
              : <button onClick={() => setShowMaintForm(true)} className="w-full btn-ghost text-sm flex items-center justify-center gap-1"><PlusIcon className="h-4 w-4" />Log Maintenance</button>
            )}
          </>
        )}
        {tab === 'downtime' && (
          <>
            {downtimes.map(d => (
              <div key={d.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-xs">{d.started_at ? new Date(d.started_at).toLocaleString() : '—'}</span>
                  {!d.ended_at && canWrite && (
                    <button onClick={() => setClosingDt(d.id)} className="text-xs text-primary-600 hover:underline">Close</button>
                  )}
                </div>
                <div className="mt-1 text-gray-700">{d.description}</div>
                <div className="text-gray-400 text-xs mt-0.5">{d.reason_code} · {d.ended_at ? `${d.duration_min} min` : <span className="text-yellow-600 font-medium">Ongoing</span>}</div>
              </div>
            ))}
            {downtimes.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No downtime records</p>}
            {canWrite && (showDtForm
              ? <DowntimeForm machineId={machine.id} onDone={() => { setShowDtForm(false); refetchDt(); }} />
              : <button onClick={() => setShowDtForm(true)} className="w-full btn-ghost text-sm flex items-center justify-center gap-1"><PlusIcon className="h-4 w-4" />Log Downtime</button>
            )}
          </>
        )}
      </div>

      {closingDt && (
        <CloseDowntimeModal open={!!closingDt} onClose={() => setClosingDt(null)} machineId={machine.id} downtimeId={closingDt} onDone={() => { setClosingDt(null); refetchDt(); }} />
      )}
    </div>
  );
}

export default function Machines() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;

  const [search, setSearch]       = useState('');
  const [typeFilter, setType]     = useState('');
  const [statusFilter, setStatus] = useState('');
  const [page, setPage]           = useState(1);
  const [modalOpen, setModal]     = useState(false);
  const [selected, setSelected]   = useState(null);

  const { data: statsData } = useGet('machine-stats', '/machines/stats');
  const { data, isLoading, refetch } = useGet(
    ['machines', search, typeFilter, statusFilter, page],
    '/machines',
    { search: search || undefined, machine_type: typeFilter || undefined, status: statusFilter || undefined, page, limit: 20 },
  );

  const { mutate: createMutate, isPending: creating } = usePost('/machines');

  const machines   = data?.data  ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);
  const stats      = statsData ?? {};

  const columns = [
    { key:'code',                     label:'Code' },
    { key:'name',                     label:'Name' },
    { key:'machine_type',             label:'Type' },
    { key:'status',                   label:'Status',   render: r => <Badge label={r.status} color={statusColor[r.status] ?? 'gray'} /> },
    { key:'capacity_pairs_per_hour',  label:'Cap/hr' },
    { key:'last_maintenance_date',    label:'Last Maint', render: r => r.last_maintenance_date ? new Date(r.last_maintenance_date).toLocaleDateString() : '—' },
    { key:'total_downtime_hours_30d', label:'DT 30d (h)', render: r => r.total_downtime_hours_30d ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Machines"
        subtitle={`${total} machines`}
        actions={canWrite && (
          <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />Add Machine
          </button>
        )}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={CheckCircleIcon}       label="Active"      value={stats.by_status?.active ?? '—'}      changeType="up" />
        <StatCard icon={WrenchScrewdriverIcon} label="Maintenance" value={stats.by_status?.maintenance ?? '—'} changeType="neutral" />
        <StatCard icon={ExclamationTriangleIcon} label="Retired"   value={stats.by_status?.retired ?? '—'}     changeType="down" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, code…" className="input w-52" />
        <select value={typeFilter} onChange={e => { setType(e.target.value); setPage(1); }} className="input w-48">
          <option value="">All types</option>
          {MACHINE_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }} className="input w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="maintenance">Maintenance</option>
          <option value="retired">Retired</option>
        </select>
      </div>

      <Table columns={columns} data={machines} loading={isLoading} emptyText="No machines found" page={page} totalPages={totalPages} onPageChange={setPage} onRowClick={setSelected} />

      <Modal open={modalOpen} onClose={() => setModal(false)} title="Add Machine" size="lg">
        <MachineForm onSubmit={f => createMutate(f, { onSuccess: () => { setModal(false); refetch(); } })} loading={creating} />
      </Modal>

      {selected && <MachinePanel machine={selected} onClose={() => setSelected(null)} onUpdate={refetch} />}
    </div>
  );
}
