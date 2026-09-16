import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Landmark, Wallet, FileClock } from "lucide-react";
import { api } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";

interface DashboardData {
  asOf: string;
  capitalPendiente: number;
  creditosVigentes: number;
  creditosVencidos: number;
  pagosUltimos30Dias: number;
  solicitudesPendientes: number;
  alertasPorPrioridad: Array<{ priority: string; total: number }>;
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/reports/dashboard")
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  const cards = [
    { label: "Capital pendiente", value: formatCurrency(data.capitalPendiente), icon: Wallet },
    { label: "Créditos vigentes", value: data.creditosVigentes, icon: Landmark },
    { label: "Créditos vencidos", value: data.creditosVencidos, icon: AlertTriangle },
    { label: "Solicitudes pendientes", value: data.solicitudesPendientes, icon: FileClock }
  ];

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Tablero operativo</h1>
      <p className="mb-6 text-sm text-slate-400">
        Corte calculado en tiempo real · {new Date(data.asOf).toLocaleString("es-CO")}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-400">
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-2xl font-semibold text-slate-800">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Pagos recibidos (últimos 30 días)</h2>
        <p className="text-2xl font-semibold text-emerald-700">{formatCurrency(data.pagosUltimos30Dias)}</p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Alertas abiertas por prioridad</h2>
        {data.alertasPorPrioridad.length === 0 ? (
          <p className="text-sm text-slate-400">Sin alertas abiertas.</p>
        ) : (
          <ul className="flex gap-4">
            {data.alertasPorPrioridad.map((a) => (
              <li key={a.priority} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
                <span className="font-semibold">{a.priority}</span>: {a.total}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
