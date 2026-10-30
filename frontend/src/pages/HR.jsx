import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import Table from "../components/Table";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import FormField from "../components/FormField";
import { useGet, usePost } from "../hooks/useApi";

const deptColor = { production: "blue", admin: "purple", logistics: "yellow", quality: "green", sales: "gray" };

const COLUMNS = [
  { key: "employee_id", label: "ID" },
  { key: "name",        label: "Name" },
  { key: "department",  label: "Department", render: (v) => <Badge label={v ?? "—"} color={deptColor[v?.toLowerCase()] ?? "gray"} /> },
  { key: "role",        label: "Role" },
  { key: "shift",       label: "Shift" },
  { key: "start_date",  label: "Start Date" }
];

export default function HR() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", department: "", role: "", shift: "", start_date: "" });
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGet(["hr", page], "/hr/employees", { page });
  const create = usePost("/hr/employees");

  const employees  = data?.employees ?? [];
  const totalPages = data?.totalPages ?? 1;

  function handleChange(e) { setForm((f) => ({ ...f, [e.target.name]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    await create.mutateAsync(form);
    setOpen(false);
    setForm({ name: "", department: "", role: "", shift: "", start_date: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Human Resources</h1>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors">
          <PlusIcon className="h-4 w-4" /> Add Employee
        </button>
      </div>

      <Table columns={COLUMNS} data={employees} loading={isLoading}
        emptyText="No employees found" page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal open={open} onClose={() => setOpen(false)} title="Add Employee">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Full Name" required>
            <input name="name" value={form.name} onChange={handleChange} required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Department">
            <select name="department" value={form.department} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              <option value="">— Select —</option>
              {["Production", "Admin", "Logistics", "Quality", "Sales"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </FormField>
          <FormField label="Role">
            <input name="role" value={form.role} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Shift">
            <select name="shift" value={form.shift} onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              <option value="">— Select —</option>
              {["Morning", "Afternoon", "Night"].map((s) => <option key={s}>{s}</option>)}
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
              {create.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
