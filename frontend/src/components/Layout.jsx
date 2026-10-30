import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChartBarIcon,
  UsersIcon,
  BeakerIcon,
  CubeIcon,
  ArchiveBoxIcon,
  CalendarIcon,
  CogIcon,
  WrenchScrewdriverIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  TruckIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../hooks/useAuth';

const NAV_ITEMS = [
  { to: '/',              label: 'Dashboard',         Icon: ChartBarIcon },
  { to: '/customers',     label: 'Customers',         Icon: UsersIcon },
  { to: '/samples',       label: 'Sample Dev',        Icon: BeakerIcon },
  { to: '/products',      label: 'Products & BOM',    Icon: CubeIcon },
  { to: '/yarn',          label: 'Yarn Warehouse',    Icon: ArchiveBoxIcon },
  { to: '/planning',      label: 'Planning',          Icon: CalendarIcon },
  { to: '/machines',      label: 'Machines',          Icon: CogIcon },
  { to: '/manufacturing', label: 'Manufacturing',     Icon: WrenchScrewdriverIcon },
  { to: '/employees',     label: 'Employees & KPIs',  Icon: UserGroupIcon },
  { to: '/quality',       label: 'Quality Control',   Icon: ShieldCheckIcon },
  { to: '/shipping',      label: 'Shipping',          Icon: TruckIcon },
];

function SidebarContent({ collapsed, onClose }) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-4 border-b border-primary-700">
        {!collapsed && (
          <span className="text-white font-bold text-lg tracking-tight">🧦 SockERP</span>
        )}
        {collapsed && (
          <span className="text-white font-bold text-xl mx-auto">🧦</span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-primary-200 hover:text-white transition-colors lg:hidden"
            aria-label="Close sidebar"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-600 text-white"
                  : "text-primary-100 hover:bg-primary-700 hover:text-white"
              }`
            }
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user, roles = [], signOut } = useAuth();
  const navigate = useNavigate();

  const primaryRole = roles[0] ?? "staff";

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-primary-800 transition-all duration-200 ${
          collapsed ? "w-16" : "w-64"
        } flex-shrink-0`}
      >
        <SidebarContent collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center py-3 border-t border-primary-700 text-primary-300 hover:text-white hover:bg-primary-700 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronDoubleRightIcon className="h-4 w-4" />
          ) : (
            <ChevronDoubleLeftIcon className="h-4 w-4" />
          )}
        </button>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex flex-col w-64 h-full bg-primary-800 z-50">
            <SidebarContent collapsed={false} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 ml-auto">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900 leading-none">
                {user?.signInDetails?.loginId ?? user?.username ?? "User"}
              </p>
              <p className="text-xs text-gray-500 capitalize mt-0.5">{primaryRole}</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 capitalize hidden sm:inline-flex">
              {primaryRole}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              aria-label="Sign out"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
