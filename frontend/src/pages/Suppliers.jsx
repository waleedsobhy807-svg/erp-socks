import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import Table from "../components/Table";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import FormField from "../components/FormField";
import { useGet, usePost } from "../hooks/useApi";

const COLUMNS = [
  { key: "name",     label: "Supplier" },
  { key: "contact",  label: "Contact" },
  { key: "email",    label: "Email" },
  { key: "country",  label: "Country" },
  { key: "category", label: "Category" },
  { key: "rating",   label: "Rating", render: (v) => {
    if (v >= 4) return <Badge label={`${v}/5`} color="green" />;
    if (v >= 3) return <Badge label={`${v}/5`} color="yellow" />;
    return <Badge label={`${v}/5`} color="red" />;
  }}
];

export default function Suppliers() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", email: "", country: "", category: "" });
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGet(["suppliers", page], "/suppliers", { page });
  const create = usePost("/suppliers");

  const suppliers  = data?.suppliers ?? [];
  const totalPages = data?.totalPages ?? 1;

  function handleChange(e) { setForm((f) => ({ ...f, [e.target.name]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    await create.mutateAsync(form);
    setOpen(false);
    setForm({ name: "", contact: "", email: "", country: "", category: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors">
          <PlusIcon className="h-4 w-4" /> Add Supplier
        </button>
      </div>

      <Table columns={COLUMNS} data={suppliers} loading={isLoading}
        emptyText="No suppliers found" page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal open={open} onClose={() => setOpen(false)} title="Add Supplier">
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { name: "name",     label: "Company Name" },
            { name: "contact",  label: "Contact Person" },
            { name: "email",    label: "Email" },
            { name: "country",  label: "Country" },
            { name: "category", label: "Material Category" }
          ].map(({ name, label }) => (
            <FormField key={name} label={label}>
              <input name={name} value={form[name]} onChange={handleChange}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
            </FormField>
          ))}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={create.isPending}
              className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
              {create.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
