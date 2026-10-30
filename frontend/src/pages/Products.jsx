import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useGet, usePost, usePut, useDelete } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const STATUS_COLORS = { true: 'green', false: 'gray' };

export default function Products() {
  const { user } = useAuth();
  const canWrite = ['admin', 'manager'].includes(user?.role);

  // Filters & pagination
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isActive, setIsActive] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);

  // Modals / panels
  const [showNewModal, setShowNewModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showAddVariant, setShowAddVariant] = useState(false);

  // New/edit form state
  const emptyForm = { name: '', sku: '', category_id: '', description: '', target_weight_g: '', composition: '', care_instructions: '' };
  const [form, setForm] = useState(emptyForm);

  // Variant form state
  const emptyVariantForm = { size_id: '', colour_id: '', barcode: '', additional_weight_g: '' };
  const [variantForm, setVariantForm] = useState(emptyVariantForm);

  // Data fetching
  const { data: productsData, loading: loadingProducts, error: productsError, refetch: refetchProducts } = useGet(
    `/products?page=${page}&search=${debouncedSearch}&category_id=${categoryId}&is_active=${isActive}`
  );
  const { data: categories } = useGet('/products/categories');
  const { data: detailData, loading: loadingDetail, refetch: refetchDetail } = useGet(
    selectedProduct ? `/products/${selectedProduct.id}` : null
  );
  const { data: variantsData, loading: loadingVariants, refetch: refetchVariants } = useGet(
    selectedProduct ? `/products/${selectedProduct.id}/variants` : null
  );

  const products = productsData?.items || productsData || [];
  const totalPages = productsData?.total_pages || 1;
  const categoryList = categories || [];
  const variants = variantsData || [];
  const detail = detailData || selectedProduct;

  const openNew = () => { setForm(emptyForm); setShowNewModal(true); };
  const openEdit = (p) => { setForm({ name: p.name, sku: p.sku, category_id: p.category_id || '', description: p.description || '', target_weight_g: p.target_weight_g || '', composition: p.composition || '', care_instructions: p.care_instructions || '' }); setEditProduct(p); };

  const handleSave = async () => {
    if (!form.name || !form.sku) { toast.error('Name and SKU are required'); return; }
    try {
      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, form);
        toast.success('Product updated');
        setEditProduct(null);
        if (selectedProduct?.id === editProduct.id) refetchDetail();
      } else {
        await api.post('/products', form);
        toast.success('Product created');
        setShowNewModal(false);
      }
      refetchProducts();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Save failed');
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/products/${deleteTarget.id}`);
      toast.success('Product deactivated');
      setDeleteTarget(null);
      if (selectedProduct?.id === deleteTarget.id) setSelectedProduct(null);
      refetchProducts();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Delete failed');
    }
  };

  const handleAddVariant = async () => {
    if (!variantForm.size_id || !variantForm.colour_id) { toast.error('Size and colour are required'); return; }
    try {
      await api.post(`/products/${selectedProduct.id}/variants`, variantForm);
      toast.success('Variant added');
      setVariantForm(emptyVariantForm);
      setShowAddVariant(false);
      refetchVariants();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to add variant');
    }
  };

  const columns = [
    { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono text-sm">{r.sku}</span> },
    { key: 'name', header: 'Name' },
    { key: 'category', header: 'Category', render: (r) => r.category?.name || r.category_name || '—' },
    { key: 'target_weight_g', header: 'Weight (g)', render: (r) => r.target_weight_g ? `${r.target_weight_g}g` : '—' },
    { key: 'is_active', header: 'Status', render: (r) => <Badge color={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {canWrite && (
            <>
              <button className="btn-ghost p-1" onClick={() => openEdit(r)} title="Edit"><PencilIcon className="h-4 w-4" /></button>
              <button className="btn-ghost p-1 text-red-600" onClick={() => setDeleteTarget(r)} title="Deactivate"><TrashIcon className="h-4 w-4" /></button>
            </>
          )}
          <button className="btn-ghost p-1 text-indigo-600" onClick={() => setSelectedProduct(r)} title="View"><ChevronRightIcon className="h-4 w-4" /></button>
        </div>
      )
    },
  ];

  const variantColumns = [
    { key: 'size', header: 'Size', render: (r) => r.size?.name || r.size_name || r.size_id },
    { key: 'colour', header: 'Colour', render: (r) => r.colour?.name || r.colour_name || r.colour_id },
    { key: 'barcode', header: 'Barcode', render: (r) => <span className="font-mono text-xs">{r.barcode || '—'}</span> },
    { key: 'additional_weight_g', header: '+Weight (g)', render: (r) => r.additional_weight_g ? `+${r.additional_weight_g}g` : '—' },
  ];

  const ProductForm = ({ onSave, onClose, title }) => (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Name *">
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Product name" />
          </FormField>
          <FormField label="SKU *">
            <input className="input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. SOC-001" />
          </FormField>
        </div>
        <FormField label="Category">
          <select className="input" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">-- Select category --</option>
            {categoryList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Description">
          <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </FormField>
        <FormField label="Target Weight (g)">
          <input className="input" type="number" value={form.target_weight_g} onChange={e => setForm(f => ({ ...f, target_weight_g: e.target.value }))} />
        </FormField>
        <FormField label="Composition">
          <textarea className="input" rows={2} value={form.composition} onChange={e => setForm(f => ({ ...f, composition: e.target.value }))} placeholder="e.g. 80% Cotton, 20% Elastane" />
        </FormField>
        <FormField label="Care Instructions">
          <textarea className="input" rows={2} value={form.care_instructions} onChange={e => setForm(f => ({ ...f, care_instructions: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </Modal>
  );

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className={`flex-1 min-w-0 p-6 overflow-auto transition-all ${selectedProduct ? 'mr-[480px]' : ''}`}>
        <PageHeader title="Products" subtitle="Manage sock products, variants and BOMs">
          {canWrite && (
            <button className="btn-primary flex items-center gap-2" onClick={openNew}>
              <PlusIcon className="h-4 w-4" /> New Product
            </button>
          )}
        </PageHeader>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            className="input w-56"
            placeholder="Search name or SKU…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <select className="input w-48" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {categoryList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-36" value={isActive} onChange={e => { setIsActive(e.target.value); setPage(1); }}>
            <option value="">Any Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        {productsError && <p className="text-red-600 mb-4">Failed to load products: {productsError.message}</p>}

        <Table
          columns={columns}
          data={products}
          loading={loadingProducts}
          onRowClick={(r) => setSelectedProduct(r)}
          rowClassName={(r) => selectedProduct?.id === r.id ? 'bg-indigo-50' : ''}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="self-center text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button className="btn-ghost" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>

      {/* Slide-over panel */}
      {selectedProduct && (
        <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div>
              <h2 className="font-semibold text-gray-900">{selectedProduct.name}</h2>
              <p className="text-sm text-gray-500 font-mono">{selectedProduct.sku}</p>
            </div>
            <button className="btn-ghost p-1" onClick={() => setSelectedProduct(null)}><XMarkIcon className="h-5 w-5" /></button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-6">
            {loadingDetail ? (
              <p className="text-gray-500 text-sm">Loading…</p>
            ) : (
              <>
                {/* Product info */}
                <div className="card p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-gray-500">Category</span>
                    <span>{detail?.category?.name || detail?.category_name || '—'}</span>
                    <span className="text-gray-500">Target Weight</span>
                    <span>{detail?.target_weight_g ? `${detail.target_weight_g}g` : '—'}</span>
                    <span className="text-gray-500">Status</span>
                    <span><Badge color={detail?.is_active ? 'green' : 'gray'}>{detail?.is_active ? 'Active' : 'Inactive'}</Badge></span>
                  </div>
                  {detail?.composition && (
                    <div className="text-sm">
                      <p className="text-gray-500 mb-1">Composition</p>
                      <p>{detail.composition}</p>
                    </div>
                  )}
                  {detail?.care_instructions && (
                    <div className="text-sm">
                      <p className="text-gray-500 mb-1">Care Instructions</p>
                      <p>{detail.care_instructions}</p>
                    </div>
                  )}
                </div>

                {/* BOM summary */}
                {detail?.bom && detail.bom.length > 0 && (
                  <div>
                    <h3 className="font-medium text-sm text-gray-700 mb-2">BOM Summary</h3>
                    <div className="card p-3 space-y-1">
                      {detail.bom.map((b, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{b.yarn_name || b.material_name}</span>
                          <span className="text-gray-500">{b.quantity} {b.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Variants */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-sm text-gray-700">Variants ({variants.length})</h3>
                    {canWrite && (
                      <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => setShowAddVariant(v => !v)}>
                        <PlusIcon className="h-3 w-3" /> Add Variant
                      </button>
                    )}
                  </div>

                  {/* Inline add variant form */}
                  {showAddVariant && (
                    <div className="card p-3 mb-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label="Size ID *">
                          <input className="input text-sm" value={variantForm.size_id} onChange={e => setVariantForm(f => ({ ...f, size_id: e.target.value }))} />
                        </FormField>
                        <FormField label="Colour ID *">
                          <input className="input text-sm" value={variantForm.colour_id} onChange={e => setVariantForm(f => ({ ...f, colour_id: e.target.value }))} />
                        </FormField>
                        <FormField label="Barcode">
                          <input className="input text-sm" value={variantForm.barcode} onChange={e => setVariantForm(f => ({ ...f, barcode: e.target.value }))} />
                        </FormField>
                        <FormField label="+Weight (g)">
                          <input className="input text-sm" type="number" value={variantForm.additional_weight_g} onChange={e => setVariantForm(f => ({ ...f, additional_weight_g: e.target.value }))} />
                        </FormField>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost text-sm" onClick={() => setShowAddVariant(false)}>Cancel</button>
                        <button className="btn-primary text-sm" onClick={handleAddVariant}>Add</button>
                      </div>
                    </div>
                  )}

                  {loadingVariants ? (
                    <p className="text-gray-400 text-sm">Loading variants…</p>
                  ) : variants.length === 0 ? (
                    <p className="text-gray-400 text-sm">No variants yet.</p>
                  ) : (
                    <Table columns={variantColumns} data={variants} compact />
                  )}
                </div>
              </>
            )}
          </div>

          {canWrite && (
            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button className="btn-ghost flex items-center gap-1 text-sm" onClick={() => openEdit(selectedProduct)}>
                <PencilIcon className="h-4 w-4" /> Edit
              </button>
              <button className="btn-ghost flex items-center gap-1 text-sm text-red-600" onClick={() => setDeleteTarget(selectedProduct)}>
                <TrashIcon className="h-4 w-4" /> Deactivate
              </button>
            </div>
          )}
        </div>
      )}

      {/* New Product Modal */}
      {showNewModal && (
        <ProductForm title="New Product" onSave={handleSave} onClose={() => setShowNewModal(false)} />
      )}

      {/* Edit Product Modal */}
      {editProduct && (
        <ProductForm title="Edit Product" onSave={handleSave} onClose={() => setEditProduct(null)} />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal isOpen onClose={() => setDeleteTarget(null)} title="Deactivate Product">
          <p className="text-sm text-gray-600 mb-4">
            Are you sure you want to deactivate <strong>{deleteTarget.name}</strong>? This will mark it as inactive.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={handleDelete}>Deactivate</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
