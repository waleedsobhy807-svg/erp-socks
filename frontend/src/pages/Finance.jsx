import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import Table from "../components/Table";
import Badge from "../components/Badge";
import { useGet } from "../hooks/useApi";

const typeColor = { revenue: "green", expense: "red", payroll: "yellow", cogs: "orange" };

const COLUMNS = [
  { key: "date",        label: "Date" },
  { key: "description", label: "Description" },
  { key: "type",        label: "Type", render: (v) => <Badge label={v ?? "—"} color={typeColor[v] ?? "gray"} /> },
  { key: "amount",      label: "Amount", render: (v) => v != null ? `$${Number(v).toLocaleString()}` : "—" },
  { key: "reference",   label: "Reference" }
];

export default function Finance() {
  const [page, setPage] = useState(1);
  const { data: txData, isLoading } = useGet(["finance", page], "/finance/transactions", { page });
  const { data: summaryData }       = useGet("finance-summary", "/finance/summary");

  const transactions = txData?.transactions ?? [];
  const totalPages   = txData?.totalPages ?? 1;
  const chartData    = summaryData?.monthly ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Finance</h1>

      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Revenue vs Expenses</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
              <Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#rev)" strokeWidth={2} name="Revenue" />
              <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#exp)" strokeWidth={2} name="Expenses" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <Table columns={COLUMNS} data={transactions} loading={isLoading}
        emptyText="No transactions found" page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
