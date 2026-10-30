/**
 * Sample Development page — request lifecycle, versions, approvals.
 */
import { useState, useEffect } from 'react';
import { PlusIcon, ArrowLeftIcon, CheckIcon, XMarkIcon, DocumentPlusIcon } from '@heroicons/react/24/outline';
import { useGet, usePost } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import api from '../api/client';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

const STATUS_COLORS = {
  draft: 'gray',
  submitted: 'blue',
  approved: 'green',
  revision_requested: 'yellow',
};

/* ── Async customer search dropdown ── */
function CustomerSearch({ value, onChange }) {
  const [q, setQ]         = useState('');
  const [results, setRes] = useState([]);
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setRes([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/customers', { params: { search: q, limit: 8 } });
        setRes(data?.data ?? []);
        setOpen(true);
      } catch { setRes([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <input
        value={value?.name ?? q}
        onChange={e => { setQ(e.target.value); onChange(null); }}
        onFocus={() => q && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search customer…"
        className="input w-full"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(c => (
            <li
              key={c.id}
              onMouseDown={() => { onChange(c); setQ(c.name); setOpen(false); }}
              className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-gray-400 ml-2">{c.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── New request modal ── */
function NewSampleModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({ customer: null, product_description: '', target_delivery_date: '', specifications: '' });
  const { mutate, isPending } = usePost('/samples');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    if (!form.customer) { alert('Select a customer'); return; }
    mutate(
      { customer_id: form.customer.id, product_description: form.product_description, target_delivery_date: form.target_delivery_date, specifications: form.specifications },
      { onSuccess: () => { onClose(); onCreate(); } },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New Sample Request" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Customer" required>
          <CustomerSearch value={form.customer} onChange={c => setForm(f => ({ ...f, customer: c }))} />
        </FormField>
        <FormField label="Product Description" required>
          <textarea required rows={3} value={form.product_description} onChange={set('product_description')} className="input" placeholder="Describe the socks style, design, etc." />
        </FormField>
        <FormField label="Target Delivery Date">
          <input type="date" value={form.target_delivery_date} onChange={set('target_delivery_date')} className="input" />
        </FormField>
        <FormField label="Specifications">
          <textarea rows={3} value={form.specifications} onChange={set('specifications')} className="input" placeholder="Yarn type, colors, size range, patterns…" />
        </FormField>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Creating…' : 'Create Request'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Add version modal ── */
function AddVersionModal({ open, onClose, sampleId, onDone }) {
  const [form, setForm] = useState({ version_number: '', notes: '', prototype_s3_key: '' });
  const { mutate, isPending } = usePost(`/samples/${sampleId}/versions`);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    mutate(form, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Version" size="md">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Version Number" required>
          <input required value={form.version_number} onChange={set('version_number')} className="input" placeholder="v1.0" />
        </FormField>
        <FormField label="Prototype S3 Key">
          <input value={form.prototype_s3_key} onChange={set('prototype_s3_key')} className="input" placeholder="samples/proto-xyz.jpg" />
        </FormField>
        <FormField label="Notes">
          <textarea rows={3} value={form.notes} onChange={set('notes')} className="input" />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Saving…' : 'Save Version'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Request revision modal ── */
function RejectModal({ open, onClose, sampleId, onDone }) {
  const [comments, setComments] = useState('');
  const { mutate, isPending }   = usePost(`/samples/${sampleId}/reject`);

  function submit(e) {
    e.preventDefault();
    mutate({ comments }, { onSuccess: () => { onClose(); onDone(); } });
  }

  return (
    <Modal open={open} onClose={onClose} title="Request Revision" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Comments" required>
          <textarea required rows={4} value={comments} onChange={e => setComments(e.target.value)} className="input" placeholder="What needs to be revised?" />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Submitting…' : 'Request Revision'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Sample detail view ── */
function SampleDetail({ id, onBack, onRefresh }) {
  const { isAdmin, isManager, user } = useAuth();
  const isSupervisor = user?.roles?.includes('production_supervisor');
  const canApprove   = isAdmin || isManager;
  const canVersion   = canApprove || isSupervisor;

  const [versionModal, setVersionModal] = useState(false);
  const [rejectModal,  setRejectModal]  = useState(false);

  const { data: sample, isLoading, refetch } = useGet(['sample', id], `/samples/${id}`);
  const { mutate: submit,  isPending: submitting  } = usePost(`/samples/${id}/submit`);
  const { mutate: approve, isPending: approving   } = usePost(`/samples/${id}/approve`);

  if (isLoading) return <div className="animate-pulse space-y-4">{[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}</div>;
  if (!sample)   return <div className="text-gray-500">Sample not found.</div>;

  const versions  = sample.versions  ?? [];
  const approvals = sample.approvals ?? [];

  function handleAction(action) {
    action({}, { onSuccess: () => { refetch(); onRefresh(); } });
  }

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100"><ArrowLeftIcon className="h-5 w-5" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900">Sample #{sample.id?.slice(0, 8)}</h2>
            <Badge label={sample.status} color={STATUS_COLORS[sample.status] ?? 'gray'} />
          </div>
          <p className="text-sm text-gray-500">{sample.customer_name} · Created {new Date(sample.created_at).toLocaleDateString()}</p>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          {sample.status === 'draft' && (
            <button disabled={submitting} onClick={() => handleAction(submit)} className="btn-primary text-sm flex items-center gap-1">
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
          {sample.status === 'submitted' && canApprove && (
            <>
              <button disabled={approving} onClick={() => handleAction(approve)} className="btn-success text-sm flex items-center gap-1">
                <CheckIcon className="h-4 w-4" />{approving ? 'Approving…' : 'Approve'}
              </button>
              <button onClick={() => setRejectModal(true)} className="btn-danger text-sm flex items-center gap-1">
                <XMarkIcon className="h-4 w-4" />Request Revision
              </button>
            </>
          )}
          {['approved', 'draft', 'revision_requested'].includes(sample.status) && canVersion && (
            <button onClick={() => setVersionModal(true)} className="btn-ghost text-sm flex items-center gap-1">
              <DocumentPlusIcon className="h-4 w-4" />Add Version
            </button>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 mb-2">Description</h3>
        <p className="text-gray-700">{sample.product_description}</p>
        {sample.target_delivery_date && (
          <p className="text-sm text-gray-500 mt-2">Target delivery: <strong>{new Date(sample.target_delivery_date).toLocaleDateString()}</strong></p>
        )}
        {sample.specifications && (
          <div className="mt-3">
            <h4 className="text-sm font-medium text-gray-700 mb-1">Specifications</h4>
            <pre className="text-xs bg-gray-50 p-3 rounded-lg border border-gray-200 whitespace-pre-wrap">{typeof sample.specifications === 'string' ? sample.specifications : JSON.stringify(sample.specifications, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Versions */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Prototype Versions ({versions.length})</h3>
        {versions.length === 0
          ? <p className="text-sm text-gray-400">No versions yet.</p>
          : (
            <div className="space-y-3">
              {versions.map(v => (
                <div key={v.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-xs font-bold bg-primary-100 text-primary-700 px-2 py-0.5 rounded">{v.version_number}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">{v.notes || '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(v.created_at).toLocaleDateString()}</p>
                    {v.prototype_s3_key && (
                      <a href={`#${v.prototype_s3_key}`} className="text-xs text-primary-600 hover:underline">{v.prototype_s3_key}</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Approval history */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Approval History</h3>
        {approvals.length === 0
          ? <p className="text-sm text-gray-400">No approvals yet.</p>
          : (
            <div className="space-y-2">
              {approvals.map(a => (
                <div key={a.id} className="flex items-start gap-3 text-sm">
                  <CheckIcon className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-gray-900">{a.approved_by_name}</span>
                    <span className="text-gray-500 ml-2">{new Date(a.created_at).toLocaleDateString()}</span>
                    {a.comments && <p className="text-gray-600 mt-0.5">{a.comments}</p>}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Modals */}
      <AddVersionModal open={versionModal} onClose={() => setVersionModal(false)} sampleId={id} onDone={() => { setVersionModal(false); refetch(); }} />
      <RejectModal     open={rejectModal}  onClose={() => setRejectModal(false)}  sampleId={id} onDone={() => { setRejectModal(false); refetch(); onRefresh(); }} />
    </div>
  );
}

/* ── Main list page ── */
export default function Samples() {
  const [status, setStatus]     = useState('');
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [newModal, setNewModal] = useState(false);
  const [selected, setSelected] = useState(null);

  const { data, isLoading, refetch } = useGet(
    ['samples', status, search, page],
    '/samples',
    { status: status || undefined, customer_id: undefined, page, limit: 20 },
  );

  const samples    = data?.data  ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const columns = [
    { key: 'id',                  label: '#',        render: r => <span className="font-mono text-xs">{r.id?.slice(0, 8)}</span> },
    { key: 'customer_name',       label: 'Customer' },
    { key: 'product_description', label: 'Description', render: r => <span title={r.product_description}>{r.product_description?.slice(0, 45)}{r.product_description?.length > 45 ? '…' : ''}</span> },
    { key: 'status',              label: 'Status',   render: r => <Badge label={r.status} color={STATUS_COLORS[r.status] ?? 'gray'} /> },
    { key: 'target_delivery_date',label: 'Target',   render: r => r.target_delivery_date ? new Date(r.target_delivery_date).toLocaleDateString() : '—' },
    { key: 'created_at',          label: 'Created',  render: r => new Date(r.created_at).toLocaleDateString() },
  ];

  if (selected) {
    return <SampleDetail id={selected} onBack={() => setSelected(null)} onRefresh={refetch} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sample Development"
        subtitle={`${total} requests`}
        actions={
          <button onClick={() => setNewModal(true)} className="btn-primary flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" /> New Request
          </button>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="input w-44">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="revision_requested">Revision Requested</option>
        </select>
      </div>

      <Table
        columns={columns}
        data={samples}
        loading={isLoading}
        emptyText="No sample requests found"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onRowClick={row => setSelected(row.id)}
      />

      <NewSampleModal open={newModal} onClose={() => setNewModal(false)} onCreate={refetch} />
    </div>
  );
}
