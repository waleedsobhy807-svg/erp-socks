/**
 * Quality Control page — QC plans, inspections, non-conformances.
 */
import { useState } from 'react';
import { PlusIcon, CheckCircleIcon, XCircleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useGet, usePost } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatCard from '../components/StatCard';
import api from '../api/client';

const ncStatusColor = { open:'red', under_review:'yellow', resolved:'green', closed:'gray' };

/* ── QC Plan form ── */
function QCPlanForm({ onSubmit, loading }) {
  const [f, setF]             = useState({ product_id:'', name:'', description:'' });
  const [checkpoints, setCPs] = useState([{ name:'', check_type:'visual', acceptable_range:'', unit:'' }]);
  const { data: prodData }    = useGet('products-select', '/products', { limit: 100 });
  const products              = prodData?.data ?? [];
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  function setCP(i, k) { return e => setCPs(cps => cps.map((c,j) => j===i ? { ...c, [k]: e.target.value } : c)); }
  function addCP()   { setCPs(cps => [...cps, { name:'', check_type:'visual', acceptable_range:'', unit:'' }]); }
  function removeCP(i) { setCPs(cps => cps.filter((_,j) => j!==i)); }

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...f, checkpoints }); }} className="space-y-4">
      <FormField label="Product" required>
        <select required value={f.product_id} onChange={set('product_id')} className="input">
          <option value="">Select product…</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </select>
      </FormField>
      <FormField label="Plan Name" required><input required value={f.name} onChange={set('name')} className="input" /></FormField>
      <FormField label="Description"><textarea rows={2} value={f.description} onChange={set('description')} className="input" /></FormField>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Checkpoints</h4>
          <button type="button" onClick={addCP} className="text-xs text-primary-600 hover:underline flex items-center gap-1"><PlusIcon className="h-3 w-3" />Add</button>
        </div>
        <div className="space-y-2">
          {checkpoints.map((cp, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 p-2 bg-gray-50 rounded border border-gray-200">
              <input placeholder="Name *" required value={cp.name} onChange={setCP(i,'name')} className="input text-xs col-span-2" />
              <select value={cp.check_type} onChange={setCP(i,'check_type')} className="input text-xs">
                <option value="visual">Visual</option>
                <option value="measurement">Measurement</option>
                <option value="weight">Weight</option>
                <option value="stretch">Stretch</option>
                <option value="color">Color</option>
              </select>
              <div className="flex gap-1">
                <input placeholder="Range" value={cp.acceptable_range} onChange={setCP(i,'acceptable_range')} className="input text-xs flex-1" />
                <button type="button" onClick={() => removeCP(i)} className="text-red-400 hover:text-red-600 px-1"><XCircleIcon className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving…' : 'Create Plan'}</button>
      </div>
    </form>
  );
}

/* ── Run Inspection modal ── */
function InspectionModal({ open, onClose, onDone }) {
  const [planId, setPlanId]     = useState('');
  const [woId, setWoId]         = useState('');
  const [inspector, setInspector] = useState('');
  const [date, setDate]         = useState('');
  const [sampleSize, setSample] = useState('');
  const [results, setResults]   = useState([]);

  const { data: plansData } = useGet('plans-select', '/quality/plans', { limit: 100 });
  const { data: planDetail} = useGet(['plan-detail', planId], `/quality/plans/${planId}`, {}, { enabled: !!planId });
  const { mutate, isPending } = usePost('/quality/inspections');

  const plans      = plansData?.data ?? plansData ?? [];
  const checkpoints = planDetail?.checkpoints ?? [];

  // Sync results array when checkpoints change
  if (planDetail && results.length !== checkpoints.length) {
    setResults(checkpoints.map(cp => ({ checkpoint_id: cp.id, measured_value:'', passed: true, notes:'' })));
  }

  function setResult(i, k) { return e => setResults(rs => rs.map((r,j) => j===i ? { ...r, [k]: k==='passed' ? e.target.checked : e.target.value } : r)); }

  function submit(e) {
    e.preventDefault();
    mutate({ work_order_id: woId, qc_plan_id: planId, inspected_by: inspector, inspection_date: date, sample_size: Number(sampleSize), results }, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <Modal open={open} onClose={onClose} title="Run QC Inspection" size="xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Work Order ID"><input value={woId} onChange={e => setWoId(e.target.value)} className="input" placeholder="Paste WO id…" /></FormField>
          <FormField label="QC Plan" required>
            <select required value={planId} onChange={e => setPlanId(e.target.value)} className="input">
              <option value="">Select plan…</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Inspected By" required><input required value={inspector} onChange={e => setInspector(e.target.value)} className="input" /></FormField>
          <FormField label="Date" required><input required type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></FormField>
          <FormField label="Sample Size" required><input required type="number" min={1} value={sampleSize} onChange={e => setSample(e.target.value)} className="input" /></FormField>
        </div>

        {checkpoints.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Checkpoint Results</h4>
            <div className="space-y-2">
              {checkpoints.map((cp, i) => (
                <div key={cp.id} className="grid grid-cols-4 gap-2 p-2 bg-gray-50 rounded border border-gray-200 items-center">
                  <span className="text-sm text-gray-700 col-span-1">{cp.name}</span>
                  <input placeholder="Measured value" value={results[i]?.measured_value ?? ''} onChange={setResult(i,'measured_value')} className="input text-sm" />
                  <input placeholder="Notes" value={results[i]?.notes ?? ''} onChange={setResult(i,'notes')} className="input text-sm" />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={results[i]?.passed ?? true} onChange={setResult(i,'passed')} className="rounded" />
                    Passed
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Submitting…' : 'Submit Inspection'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Resolve NC modal ── */
function ResolveNCModal({ open, onClose, ncId, onDone }) {
  const [f, setF] = useState({ resolution:'', resolved_by:'', root_cause:'' });
  const { mutate, isPending } = usePost(`/quality/non-conformances/${ncId}/resolve`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title="Resolve Non-Conformance" size="md">
      <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: () => { onClose(); onDone(); } }); }} className="space-y-4">
        <FormField label="Resolution" required><textarea required rows={3} value={f.resolution} onChange={set('resolution')} className="input" /></FormField>
        <FormField label="Resolved By" required><input required value={f.resolved_by} onChange={set('resolved_by')} className="input" /></FormField>
        <FormField label="Root Cause"><textarea rows={2} value={f.root_cause} onChange={set('root_cause')} className="input" /></FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Resolving…' : 'Resolve'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Quality() {
  const [tab, setTab]           = useState('inspections');
  const [page, setPage]         = useState(1);
  const [passedFilter, setPassed] = useState('');
  const [ncStatus, setNcStatus] = useState('open');
  const [planModal, setPlanModal]   = useState(false);
  const [inspModal, setInspModal]   = useState(false);
  const [resolvingNc, setResolvingNc] = useState(null);

  const { data: stats }  = useGet('qc-stats', '/quality/stats', {}, { staleTime: 60_000 });
  const { data: inspData, isLoading: inspLoading, refetch: refetchInsp } = useGet(
    ['qc-inspections', passedFilter, page], '/quality/inspections',
    { passed: passedFilter !== '' ? passedFilter === 'true' : undefined, page, limit: 20 },
  );
  const { data: plansData, isLoading: plansLoading, refetch: refetchPlans } = useGet('qc-plans', '/quality/plans', { limit: 50 });
  const { data: ncData,    isLoading: ncLoading,    refetch: refetchNc    } = useGet(
    ['qc-nc', ncStatus], '/quality/non-conformances',
    { status: ncStatus || undefined, limit: 50 },
  );
  const { mutate: createPlan, isPending: creatingPlan } = usePost('/quality/plans');

  const inspections = inspData?.data  ?? [];
  const plans       = plansData?.data ?? plansData ?? [];
  const ncs         = ncData?.data    ?? ncData    ?? [];
  const passRate    = stats?.pass_rate_pct ?? 0;

  const inspColumns = [
    { key:'id',              label:'#',        render: r => <span className="font-mono text-xs">{r.id?.slice(0,8)}</span> },
    { key:'work_order_id',   label:'Work Order',render: r => <span className="font-mono text-xs">{r.work_order_id?.slice(0,8) ?? '—'}</span> },
    { key:'plan_name',       label:'Plan' },
    { key:'inspected_by',    label:'Inspector' },
    { key:'inspection_date', label:'Date', render: r => r.inspection_date ? new Date(r.inspection_date).toLocaleDateString() : '—' },
    { key:'sample_size',     label:'Sample' },
    { key:'overall_passed',  label:'Result', render: r => r.overall_passed ? <Badge label="Passed" color="green" /> : <Badge label="Failed" color="red" /> },
  ];

  const planColumns = [
    { key:'name',             label:'Plan Name' },
    { key:'product_name',     label:'Product' },
    { key:'checkpoint_count', label:'Checkpoints' },
    { key:'is_active',        label:'Status', render: r => <Badge label={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? 'green' : 'gray'} /> },
  ];

  const ncColumns = [
    { key:'id',          label:'#',        render: r => <span className="font-mono text-xs">{r.id?.slice(0,8)}</span> },
    { key:'product_name',label:'Product' },
    { key:'status',      label:'Status',   render: r => <Badge label={r.status} color={ncStatusColor[r.status] ?? 'gray'} /> },
    { key:'detected_at', label:'Detected', render: r => r.detected_at ? new Date(r.detected_at).toLocaleDateString() : '—' },
    { key:'resolved_at', label:'Resolved', render: r => r.resolved_at ? new Date(r.resolved_at).toLocaleDateString() : '—' },
    { key:'actions',     label:'',         render: r => r.status === 'open' || r.status === 'under_review' ? (
      <button onClick={e => { e.stopPropagation(); setResolvingNc(r.id); }} className="text-xs text-primary-600 hover:underline">Resolve</button>
    ) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Quality Control" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={ShieldCheckIcon}  label="Inspections (30d)"    value={stats?.total_inspections_30d ?? '—'} changeType="up" />
        <StatCard icon={CheckCircleIcon}  label="Open Non-Conformances" value={stats?.open_non_conformances ?? '—'} changeType="neutral" />
        <div className="card flex flex-col justify-between">
          <span className="text-sm text-gray-500">Pass Rate</span>
          <span className="text-2xl font-bold text-gray-900">{passRate.toFixed(1)}%</span>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
            <div className={`h-2 rounded-full ${passRate >= 90 ? 'bg-green-500' : passRate >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${passRate}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {['inspections','plans','non-conformances'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${tab===t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>{t.replace('-',' ')}</button>
        ))}
      </div>

      {tab === 'inspections' && (
        <div className="space-y-4">
          <div className="flex justify-between">
            <select value={passedFilter} onChange={e => setPassed(e.target.value)} className="input w-40">
              <option value="">All results</option>
              <option value="true">Passed</option>
              <option value="false">Failed</option>
            </select>
            <button onClick={() => setInspModal(true)} className="btn-primary flex items-center gap-1.5"><PlusIcon className="h-4 w-4" />Run Inspection</button>
          </div>
          <Table columns={inspColumns} data={inspections} loading={inspLoading} emptyText="No inspections" page={page} totalPages={Math.ceil((inspData?.total ?? 0)/20)} onPageChange={setPage} />
        </div>
      )}

      {tab === 'plans' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setPlanModal(true)} className="btn-primary flex items-center gap-1.5"><PlusIcon className="h-4 w-4" />New QC Plan</button>
          </div>
          <Table columns={planColumns} data={plans} loading={plansLoading} emptyText="No QC plans" />
        </div>
      )}

      {tab === 'non-conformances' && (
        <div className="space-y-4">
          <select value={ncStatus} onChange={e => setNcStatus(e.target.value)} className="input w-44">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under Review</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <Table columns={ncColumns} data={ncs} loading={ncLoading} emptyText="No non-conformances" />
        </div>
      )}

      <Modal open={planModal} onClose={() => setPlanModal(false)} title="New QC Plan" size="xl">
        <QCPlanForm onSubmit={f => createPlan(f, { onSuccess: () => { setPlanModal(false); refetchPlans(); } })} loading={creatingPlan} />
      </Modal>

      <InspectionModal open={inspModal} onClose={() => setInspModal(false)} onDone={refetchInsp} />

      {resolvingNc && (
        <ResolveNCModal open={!!resolvingNc} onClose={() => setResolvingNc(null)} ncId={resolvingNc} onDone={() => { setResolvingNc(null); refetchNc(); }} />
      )}
    </div>
  );
}
