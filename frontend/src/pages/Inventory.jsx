import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import Table from "../components/Table";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import FormField from "../components/FormField";
import { useGet, usePost } from "../hooks/useApi";

const COLUMNS = [
  { key: "sku",      label: "SKU" },
  { key: "name",     label: "Product Name" },
  { key: "category", label: "Category" },
  { key: "stock",    label: "On Hand", render: (v) => v?.toLocaleString() },
  {
    key: "status",
    label: "Status",
    render: (_, row) => {
      if (row.stock <= 0)    return <Badge label="Out of Stock" color="red" />;
      if (row.stock < 500)   return <Badge label="Low Stock"    color="yellow" />;
      return                        <Badge label="In Stock"     color="green" />;
    }
  }
];

export default function Inventory() {
  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState({ sku: "", name: "", category: "", stock: "" });
  const [page, setPage]   = useState(1);

  const { data, isLoading } = useGet(["inventory", page], "/inventory", { page });
  const addItem = usePost("/inventory");

  const items      = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await addItem.mutateAsync({ ...form, stock: Number(form.stock) });
    setOpen(false);
    setForm({ sku: "", name: "", category: "", stock: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          Add Item
        </button>
      </div>

      <Table
        columns={COLUMNS}
        data={items}
        loading={isLoading}
        emptyText="No inventory items found"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Add Inventory Item">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="SKU" required>
            <input name="sku" value={form.sku} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Product Name" required>
            <input name="name" value={form.name} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Category">
            <select name="category" value={form.category} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              <option value="">— Select —</option>
              <option>Ankle Socks</option>
              <option>Crew Socks</option>
              <option>Knee-High</option>
              <option>No-Show</option>
              <option>Compression</option>
            </select>
          </FormField>
          <FormField label="Initial Stock" required>
            <input name="stock" type="number" min="0" value={form.stock} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={addItem.isPending}
              className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
              {addItem.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
