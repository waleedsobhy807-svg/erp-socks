import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "@heroicons/react/20/solid";

export default function StatCard({ icon: Icon, label, value, change, changeType = "neutral" }) {
  const changeStyles = {
    up:      { cls: "text-green-600", Arrow: ArrowUpIcon },
    down:    { cls: "text-red-600",   Arrow: ArrowDownIcon },
    neutral: { cls: "text-gray-500",  Arrow: MinusIcon }
  };

  const { cls, Arrow } = changeStyles[changeType] ?? changeStyles.neutral;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-start gap-4">
      {Icon && (
        <div className="flex-shrink-0 p-3 bg-primary-50 rounded-lg">
          <Icon className="h-6 w-6 text-primary-600" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm text-gray-500 truncate">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900 truncate">{value}</p>
        {change && (
          <p className={`mt-1 flex items-center text-sm ${cls}`}>
            <Arrow className="h-4 w-4 mr-0.5 flex-shrink-0" />
            <span>{change}</span>
          </p>
        )}
      </div>
    </div>
  );
}
