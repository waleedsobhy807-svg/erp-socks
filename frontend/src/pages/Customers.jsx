/**
 * Customer Management page — list, create, edit, delete, contacts, addresses.
 */
import { useState, useEffect, useRef } from 'react';
import { PencilIcon, TrashIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useGet, usePost, usePut, useDelete } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'INR'];
const statusColor = { active: 'green', inactive: 'gray' };

/* ── Debounce hook ── */
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ── Customer form (create + edit) ── */
function CustomerForm({ initial = {}, onSubmit, loading }) {
  const [form, setForm] = useState({
    name: '', code: '', email: '', phone: '', country: '', currency: 'USD',
    payment_terms_days: 30, credit_limit: 0, ...initial,
  });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" required>
          <input required value={form.name} onChange={set('name')} className="input" placeholder="Acme Socks Ltd" />
        </FormField>
        <FormField label="Code" required>
          <input required value={form.code} onChange={set('code')} className="input" placeholder="ACME01" />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email">
          <input type="email" value={form.email} onChange={set('email')} className="input" />
        </FormField>
        <FormField label="Phone">
          <input value={form.phone} onChange={set('phone')} className="input" />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Country">
          <input value={form.country} onChange={set('country')} className="input" placeholder="Egypt" />
        </FormField>
        <FormField label="Currency">
          <select value={form.currency} onChange={set('currency')} className="input">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment Terms (days)">
          <input type="number" min={0} value={form.payment_terms_days} onChange={set('payment_terms_days')} className="input" />
        </FormField>
        <FormField label="Credit Limit">
          <input type="number" min={0} value={form.credit_limit} onChange={set('credit_limit')} className="input" />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Saving…' : 'Save Customer'}
        </button>
      </div>
    </form>
  );
}

/* ── Contact mini-form ── */
function ContactMiniForm({ customerId, onDone }) {
  const [form, setForm] = useState({ full_name: '', job_title: '', email: '', phone: '', is_primary: false });
  const { mutate, isPending } = usePost(`/customers/${customerId}/contacts`);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form, { onSuccess: onDone }); }} className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="grid grid-cols-2 gap-2">
        <input required placeholder="Full name *" value={form.full_name} onChange={set('full_name')} className="input text-sm" />
        <input placeholder="Job title" value={form.job_title} onChange={set('job_title')} className="input text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} className="input text-sm" />
        <input placeholder="Phone" value={form.phone} onChange={set('phone')} className="input text-sm" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={form.is_primary} onChange={set('is_primary')} />
        Primary contact
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost text-sm">Cancel</button>
        <button type="submit" disabled={isPending} className="btn-primary text-sm">{isPending ? 'Adding…' : 'Add Contact'}</button>
      </div>
    </form>
  );
}

/* ── Address mini-form ── */
function AddressMiniForm({ customerId, onDone }) {
  const [form, setForm] = useState({ address_type: 'shipping', line1: '', city: '', country: '', postal_code: '' });
  const { mutate, isPending } = usePost(`/customers/${customerId}/addresses`);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form, { onSuccess: onDone }); }} className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <select value={form.address_type} onChange={set('address_type')} className="input text-sm">
        <option value="billing">Billing</option>
        <option value="shipping">Shipping</option>
      </select>
      <input required placeholder="Address line 1 *" value={form.line1} onChange={set('line1')} className="input text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="City" value={form.city} onChange={set('city')} className="input text-sm" />
        <input placeholder="Postal code" value={form.postal_code} onChange={set('postal_code')} className="input text-sm" />
      </div>
      <input placeholder="Country" value={form.country} onChange={set('country')} className="input text-sm" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost text-sm">Cancel</button>
        <button type="submit" disabled={isPending} className="btn-primary text-sm">{isPending ? 'Adding…' : 'Add Address'}</button>
      </div>
    </form>
  );
}

/* ── Detail slide-over panel ── */
function CustomerPanel({ customer, onClose }) {
  const [tab, setTab] = useState('contacts');
  const [showContactForm, setShowContactForm] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);

  const { data: contactsData } = useGet(['contacts', customer.id], `/customers/${customer.id}/contacts`);
  const { data: addressesData } = useGet(['addresses', customer.id], `/customers/${customer.id}/addresses`);

  const contacts  = contactsData?.data  ?? contactsData  ?? [];
  const addresses = addressesData?.data ?? addressesData ?? [];

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 transform transition-transform">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-900">{customer.name}</h2>
          <p className="text-xs text-gray-500">{customer.code} · {customer.country}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
      </div>

      {/* Info */}
      <div className="p-4 bg-gray-50 text-sm space-y-1 border-b border-gray-200">
        <div className="flex justify-between"><span className="text-gray-500">Currency</span><span>{customer.currency}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Payment Terms</span><span>{customer.payment_terms_days} days</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Credit Limit</span><span>{Number(customer.credit_limit ?? 0).toLocaleString()}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Email</span><span className="text-right truncate ml-4">{customer.email || '—'}</span></div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {['contacts', 'addresses'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tab === 'contacts' && (
          <>
            {contacts.map(c => (
              <div key={c.id} className="p-3 bg-gray-50 rounded-lg text-sm">
                <div className="font-medium text-gray-900">{c.full_name} {c.is_primary && <span className="ml-1 text-xs text-primary-600 font-semibold">Primary</span>}</div>
                <div className="text-gray-500">{c.job_title}</div>
                <div className="text-gray-500">{c.email}</div>
                <div className="text-gray-500">{c.phone}</div>
              </div>
            ))}
            {contacts.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No contacts yet</p>}
            {showContactForm
              ? <ContactMiniForm customerId={customer.id} onDone={() => setShowContactForm(false)} />
              : <button onClick={() => setShowContactForm(true)} className="w-full btn-ghost text-sm flex items-center justify-center gap-1"><PlusIcon className="h-4 w-4" />Add Contact</button>
            }
          </>
        )}
        {tab === 'addresses' && (
          <>
            {addresses.map(a => (
              <div key={a.id} className="p-3 bg-gray-50 rounded-lg text-sm">
                <Badge label={a.address_type} color={a.address_type === 'billing' ? 'blue' : 'green'} />
                <div className="mt-1 text-gray-900">{a.line1}</div>
                <div className="text-gray-500">{a.city} {a.postal_code}, {a.country}</div>
              </div>
            ))}
            {addresses.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No addresses yet</p>}
            {showAddressForm
              ? <AddressMiniForm customerId={customer.id} onDone={() => setShowAddressForm(false)} />
              : <button onClick={() => setShowAddressForm(true)} className="w-full btn-ghost text-sm flex items-center justify-center gap-1"><PlusIcon className="h-4 w-4" />Add Address</button>
            }
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function Customers() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;

  const [search, setSearch]         = useState('');
  const [status, setStatus]         = useState('');
  const [page, setPage]             = useState(1);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState(null);
  const [selected, setSelected]     = useState(null);

  const debouncedSearch = useDebounce(search);

  const { data, isLoading, refetch } = useGet(
    ['customers', debouncedSearch, status, page],
    '/customers',
    { search: debouncedSearch || undefined, status: status || undefined, page, limit: 20 },
  );

  const customers   = data?.data  ?? [];
  const total       = data?.total ?? 0;
  const totalPages  = Math.ceil(total / 20);

  const { mutate: createMutate, isPending: creating } = usePost('/customers');
  const { mutate: updateMutate, isPending: updating } = usePut(editing ? `/customers/${editing.id}` : null);
  const { mutate: deleteMutate }                       = useDelete(null);

  function handleCreate(form) {
    createMutate(form, { onSuccess: () => { setModalOpen(false); refetch(); } });
  }
  function handleUpdate(form) {
    updateMutate(form, { onSuccess: () => { setEditing(null); refetch(); } });
  }
  function handleDelete(id) {
    if (!window.confirm('Soft-delete this customer?')) return;
    deleteMutate({ url: `/customers/${id}` }, { onSuccess: () => { refetch(); setSelected(null); } });
  }

  const columns = [
    { key: 'name',                label: 'Name' },
    { key: 'code',                label: 'Code' },
    { key: 'country',             label: 'Country' },
    { key: 'currency',            label: 'Currency' },
    { key: 'payment_terms_days',  label: 'Terms', render: r => `${r.payment_terms_days}d` },
    { key: 'credit_limit',        label: 'Credit Limit', render: r => Number(r.credit_limit ?? 0).toLocaleString() },
    { key: 'status',              label: 'Status', render: r => <Badge label={r.deleted_at ? 'inactive' : 'active'} color={r.deleted_at ? 'gray' : 'green'} /> },
    {
      key: 'actions', label: '',
      render: r => canWrite && (
        <div className="flex gap-1">
          <button onClick={e => { e.stopPropagation(); setEditing(r); }} className="p-1 hover:bg-gray-100 rounded"><PencilIcon className="h-4 w-4 text-gray-500" /></button>
          <button onClick={e => { e.stopPropagation(); handleDelete(r.id); }} className="p-1 hover:bg-red-50 rounded"><TrashIcon className="h-4 w-4 text-red-400" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        subtitle={`${total} total`}
        actions={canWrite && (
          <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" /> Add Customer
          </button>
        )}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name, email, phone…"
          className="input w-64"
        />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="input w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table — click row to open panel */}
      <div onClick={e => { if (e.target.closest('[data-no-panel]')) return; }}>
        <Table
          columns={columns}
          data={customers}
          loading={isLoading}
          emptyText="No customers found"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onRowClick={row => setSelected(selected?.id === row.id ? null : row)}
        />
      </div>

      {/* Create modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Customer" size="lg">
        <CustomerForm onSubmit={handleCreate} loading={creating} />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Customer" size="lg">
        {editing && <CustomerForm initial={editing} onSubmit={handleUpdate} loading={updating} />}
      </Modal>

      {/* Detail panel */}
      {selected && <CustomerPanel customer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
