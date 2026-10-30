import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import Table from "../components/Table";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import FormField from "../components/FormField";
import { useGet, usePost } from "../hooks/useApi";
import { format } from "date-fns";

const statusColor = { draft: "gray", submitted: "blue", approved: "green", rejected: "red" };

const COLUMNS = [
  { key: "po_number",  label: "PO #" },
  { key: "supplier",   label: "Supplier" },
  { key: "material",   label: "Material" },
  { key: "quantity",   label: "Quantity", render: (v) => v?.toLocaleString() },
  { key: "total",      label: "Total",    render: (v) => v != null ? `$${Number(v).toLocaleString()}` : "—" },
  { key: "date",       label: "Date",     render: (v) => v ? format(new Date(v), "MMM d, yyyy") : "—" },
  { key: "status",     label: "Status",   render: (v) => <Badge label={v ?? "draft"} color={statusColor[v] ?? "gray"} /> }
];

export default function Procurement() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplier: "", material: "", quantity: "", unit_price: "" });
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGet(["procurement", page], "/procurement", { page });
  const create = usePost("/procurement");

  const orders     = data?.orders ?? [];
  const totalPages = data?.totalPages ?? 1;

  function handleChange(e) { setForm((f) => ({ ...f, [e.target.name]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    const qty   = Number(form.quantity);
    const price = Number(form.unit_price);
    await create.mutateAsync({ ...form, quantity: qty, unit_price: price, total: qty * price, status: "draft" });
    setOpen(false);
    setForm({ supplier: "", material: "", quantity: "", unit_price: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Procurement</h1>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors">
          <PlusIcon className="h-4 w-4" />
          New PO
        </button>
      </div>

      <Table columns={COLUMNS} data={orders} loading={isLoading}
        emptyText="No purchase orders" page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal open={open} onClose={() => setOpen(false)} title="New Purchase Order">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Supplier" required>
            <input name="supplier" value={form.supplier} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Material" required>
            <input name="material" value={form.material} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Quantity" required>
              <input name="quantity" type="number" min="1" value={form.quantity} onChange={handleChange} required
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
            </FormField>
            <FormField label="Unit Price ($)" required>
              <input name="unit_price" type="number" min="0" step="0.01" value={form.unit_price} onChange={handleChange} required
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
            </FormField>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={create.isPending}
              className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
              {create.isPending ? "Saving…" : "Create PO"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
