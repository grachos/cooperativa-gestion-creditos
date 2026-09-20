import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationsContext";

interface Alert {
  id: number;
  type: string;
  priority: string;
  message: string;
  status: string;
  credit_number: string | null;
}

export default function AlertsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { liveAlertCount } = useNotifications();

  const { data, isLoading, error } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ data: Alert[] }>("/alerts")
  });

  async function resolve(id: number) {
    await api.post(`/alerts/${id}/resolve`, {});
    void queryClient.invalidateQueries({ queryKey: ["alerts"] });
  }

  async function recalculate() {
    await api.post("/alerts/recalculate", {});
    void queryClient.invalidateQueries({ queryKey: ["alerts"] });
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Centro de alertas</h1>
          {liveAlertCount > 0 && (
            <p className="text-xs text-emerald-600">{liveAlertCount} alerta(s) nueva(s) en tiempo real</p>
          )}
        </div>
        {hasPermission("alerts:write") && (
          <button
            onClick={() => void recalculate()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Recalcular alertas (demo)
          </button>
        )}
      </div>

      {data && data.data.length === 0 && <EmptyView message="No hay alertas abiertas." />}

      {data && data.data.length > 0 && (
        <ul className="space-y-2">
          {data.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <span
                  className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                    a.priority === "ALTA"
                      ? "bg-red-100 text-red-700"
                      : a.priority === "MEDIA"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {a.priority}
                </span>
                <span className="text-sm text-slate-700">{a.message}</span>
                {a.credit_number && <span className="ml-2 text-xs text-slate-400">({a.credit_number})</span>}
              </div>
              {hasPermission("alerts:write") && (
                <button onClick={() => void resolve(a.id)} className="text-xs text-emerald-700 hover:underline">
                  Marcar atendida
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
