import { useState } from "react";
import Table from "../components/Table";
import Badge from "../components/Badge";
import { useGet } from "../hooks/useApi";
import { format } from "date-fns";

const statusColor = { pending: "yellow", processing: "blue", shipped: "purple", delivered: "green", cancelled: "red" };

const COLUMNS = [
  { key: "order_no",   label: "Order #" },
  { key: "customer",   label: "Customer" },
  { key: "date",       label: "Date", render: (v) => v ? format(new Date(v), "MMM d, yyyy") : "—" },
  { key: "items",      label: "Items" },
  { key: "total",      label: "Total", render: (v) => v != null ? `$${Number(v).toLocaleString()}` : "—" },
  {
    key: "status",
    label: "Status",
    render: (v) => <Badge label={v ?? "pending"} color={statusColor[v] ?? "gray"} />
  }
];

export default function Orders() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useGet(["orders", page, search], "/orders", { page, q: search });

  const orders     = data?.orders ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <input
          type="search"
          placeholder="Search orders…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
        />
      </div>
      <Table columns={COLUMNS} data={orders} loading={isLoading}
        emptyText="No orders found" page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
