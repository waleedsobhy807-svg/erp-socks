import { useState } from "react";
import FormField from "../components/FormField";
import useAuth from "../hooks/useAuth";
import toast from "react-hot-toast";

export default function Settings() {
  const { user, roles } = useAuth();

  const [companyName, setCompanyName] = useState("SockFactory Ltd.");
  const [currency,    setCurrency]    = useState("USD");
  const [timezone,    setTimezone]    = useState("UTC");
  const [saving,      setSaving]      = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    toast.success("Settings saved");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-1">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Account</h2>
        <p className="text-sm text-gray-600">
          <span className="font-medium">User:</span>{" "}
          {user?.signInDetails?.loginId ?? user?.username ?? "—"}
        </p>
        <p className="text-sm text-gray-600">
          <span className="font-medium">Roles:</span>{" "}
          {roles.length > 0 ? roles.join(", ") : "staff"}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Company Settings</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <FormField label="Company Name" required>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none" />
          </FormField>
          <FormField label="Default Currency">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              {["USD", "EUR", "GBP", "TRY", "CNY"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Timezone">
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none">
              {["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Istanbul", "Asia/Shanghai"].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </FormField>
          <div className="pt-2">
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
