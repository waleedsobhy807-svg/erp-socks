import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import Table from "../components/Table";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import FormField from "../components/FormField";
import { useGet, usePost } from "../hooks/useApi";
import { format } from "date-fns";

const statusColor = { planned: "blue", running: "yellow", completed: "green", cancelled: "red" };

const COLUMNS = [
  { key: "order_no",   label: "Work Order" },
  { key: "product",    label: "Product" },
  { key: "quantity",   label: "Qty", render: (v) => v?.toLocaleString() },
  { key: "line",       label: "Line" },
  { key: "start_date", label: "Start Date", render: (v) => v ? format(new Date(v), "MMM d, yyyy") : "—" },
  {
    key: "status",
    label: "Status",
    render: (v) => <Badge label={v ?? "planned"} color={statusColor[v] ?? "gray"} />
  }
];

export default function Production() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ product: "", quantity: "", line: "", start_date: "" });
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGet(["production", page], "/production", { page });
  const create = usePost("/production");

  const orders     = data?.orders ?? [];
  const totalPages = data?.totalPages ?? 1;

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await create.mutateAsync({ ...form, quantity: Number(form.quantity), status: "planned" });
    setOpen(false);
    setForm({ product: "", quantity: "", line: "", start_date: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Production</h1>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors">
          <PlusIcon className="h-4 w-4" />
          New Work Order
        </button>
      </div>

      <Table columns={COLUMNS} data={orders} loading={isLoading}
        emptyText="No work orders" page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal open={open} onClose={() => setOpen(false)} title="New Work Order">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Product" required>
            <input name="product" value={form.product} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Quantity (pairs)" required>
            <input name="quantity" type="number" min="1" value={form.quantity} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Production Line">
            <select name="line" value={form.line} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              <option value="">— Select —</option>
              {["Line A", "Line B", "Line C", "Line D"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="Start Date">
            <input name="start_date" type="date" value={form.start_date} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={create.isPending}
              className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
              {create.isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
