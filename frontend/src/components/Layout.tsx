import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileText,
  Landmark,
  Bell,
  BarChart3,
  Settings,
  UserCog,
  LogOut,
  X
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationsContext";

const NOTIF_BANNER_DISMISSED_KEY = "notif_banner_dismissed";

const NAV_ITEMS = [
  { to: "/", label: "Tablero", icon: LayoutDashboard },
  { to: "/asociados", label: "Asociados", icon: Users },
  { to: "/solicitudes", label: "Solicitudes", icon: FileText },
  { to: "/creditos", label: "Créditos", icon: Landmark },
  { to: "/alertas", label: "Alertas", icon: Bell },
  { to: "/reportes", label: "Reportes", icon: BarChart3 },
  { to: "/parametros", label: "Parámetros", icon: Settings },
  { to: "/usuarios", label: "Usuarios", icon: UserCog }
];

export function Layout() {
  const { user, logout } = useAuth();
  const { permission, requestPermission } = useNotifications();
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(NOTIF_BANNER_DISMISSED_KEY) === "1"
  );

  function dismissBanner() {
    localStorage.setItem(NOTIF_BANNER_DISMISSED_KEY, "1");
    setBannerDismissed(true);
  }

  const showNotificationBanner = permission === "default" && !bannerDismissed;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/logo.jpg" alt="Coomulnissi" className="h-8 w-8 rounded-full object-cover" />
          <span className="text-lg font-semibold text-slate-800">Coomulnissi</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 pt-3">
          <p className="truncate px-2 text-sm font-medium text-slate-700">{user?.fullName}</p>
          <p className="truncate px-2 text-xs text-slate-400">{user?.roles.join(", ")}</p>
          <button
            onClick={() => void logout()}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo.jpg" alt="Coomulnissi" className="h-6 w-6 rounded-full object-cover" />
            <span className="font-semibold text-slate-800">Coomulnissi</span>
          </div>
          <button onClick={() => void logout()} className="text-sm text-slate-600">
            Salir
          </button>
        </header>
        <header className="hidden items-center gap-3 border-b border-slate-200 bg-white px-6 py-4 md:flex">
          <img src="/logo.jpg" alt="Coomulnissi" className="h-12 w-12 rounded-full object-cover shadow-sm" />
          <div>
            <p className="text-lg font-semibold leading-tight text-slate-800">Coomulnissi</p>
            <p className="text-xs leading-tight text-slate-500">Cooperativa Multiactiva Nissi</p>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 pb-20 md:p-6">
          {showNotificationBanner && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-brand-800">
                <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Active las notificaciones para enterarse al instante cuando se genere una alerta.</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={requestPermission}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Activar notificaciones
                </button>
                <button
                  onClick={dismissBanner}
                  aria-label="Cerrar aviso de notificaciones"
                  className="text-brand-700 hover:text-brand-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 flex min-w-0 overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex shrink-0 basis-1/5 flex-col items-center gap-1 py-2 text-[11px] ${
                  isActive ? "text-brand-700" : "text-slate-500"
                }`
              }
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
