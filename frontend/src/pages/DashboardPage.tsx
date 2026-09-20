import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Landmark, Wallet, FileClock } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell
} from "recharts";
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

interface MonthlySummaryRow {
  year: number;
  month: number;
  disbursedAmount: number;
  collectedAmount: number;
}

interface MoraBucket {
  code: string;
  label: string;
  count: number;
  value: number;
}

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Paleta categórica y de estado del skill de dataviz (validada: separación
// CVD y de contraste suficiente entre pares adyacentes).
const SERIES_DISBURSED = "#2a78d6"; // categórico slot 1 (azul)
const SERIES_COLLECTED = "#1baf7a"; // categórico slot 3 (aqua)
const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

const MORA_SEVERITY: Record<string, string> = {
  CM030: STATUS.warning,
  CM060: STATUS.warning,
  CM090: STATUS.serious,
  CM120: STATUS.serious,
  CM150: STATUS.critical,
  CM180: STATUS.critical
};

const PRIORITY_COLOR: Record<string, string> = {
  BAJA: STATUS.warning,
  MEDIA: STATUS.serious,
  ALTA: STATUS.critical
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-slate-400">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function currencyTick(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/reports/dashboard")
  });
  const monthlyQuery = useQuery({
    queryKey: ["report-monthly-summary", "all"],
    queryFn: () => api.get<{ data: MonthlySummaryRow[] }>("/reports/monthly-summary")
  });
  const moraBucketsQuery = useQuery({
    queryKey: ["report-mora-buckets"],
    queryFn: () => api.get<{ data: MoraBucket[] }>("/reports/mora-buckets")
  });

  const trendData = useMemo(() => {
    const now = new Date();
    const currentKey = now.getFullYear() * 12 + now.getMonth();
    const rows = (monthlyQuery.data?.data ?? []).filter((r) => r.year * 12 + (r.month - 1) <= currentKey);
    return rows.slice(-12).map((r) => ({
      label: `${MONTH_SHORT[r.month - 1]} ${String(r.year).slice(2)}`,
      Desembolsado: r.disbursedAmount,
      Recaudado: r.collectedAmount
    }));
  }, [monthlyQuery.data]);

  const moraChartData = useMemo(
    () => (moraBucketsQuery.data?.data ?? []).filter((b) => b.count > 0 || b.value > 0),
    [moraBucketsQuery.data]
  );

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  const cards = [
    { label: "Capital pendiente", value: formatCurrency(data.capitalPendiente), icon: Wallet },
    { label: "Créditos vigentes", value: data.creditosVigentes, icon: Landmark },
    { label: "Créditos vencidos", value: data.creditosVencidos, icon: AlertTriangle },
    { label: "Solicitudes pendientes", value: data.solicitudesPendientes, icon: FileClock }
  ];

  const totalAlertas = data.alertasPorPrioridad.reduce((sum, a) => sum + a.total, 0);

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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Desembolsos vs. recaudo" subtitle="Últimos 12 meses con actividad">
            {trendData.length === 0 ? (
              <p className="text-sm text-slate-400">Aún no hay suficiente historial para graficar.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis
                    tickFormatter={currencyTick}
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    width={56}
                  />
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="Desembolsado"
                    stroke={SERIES_DISBURSED}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line type="monotone" dataKey="Recaudado" stroke={SERIES_COLLECTED} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title="Pagos recibidos (últimos 30 días)"
          subtitle="Efectivo confirmado, todos los créditos"
        >
          <p className="text-3xl font-semibold text-emerald-700">{formatCurrency(data.pagosUltimos30Dias)}</p>
        </ChartCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Mora por bucket" subtitle="Saldo pendiente en cuotas vencidas, por días de atraso">
          {moraChartData.length === 0 ? (
            <p className="text-sm text-slate-400">No hay cuotas en mora hoy.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={moraChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="code" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} />
                <YAxis
                  tickFormatter={currencyTick}
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  width={56}
                />
                <Tooltip
                  formatter={(v: any, name: any, entry: any) => [
                    formatCurrency(Number(v)),
                    entry?.payload?.label ?? name
                  ]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {moraChartData.map((b) => (
                    <Cell key={b.code} fill={MORA_SEVERITY[b.code] ?? STATUS.serious} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Alertas abiertas por prioridad" subtitle={`${totalAlertas} alerta(s) abierta(s) en total`}>
          {data.alertasPorPrioridad.length === 0 ? (
            <p className="text-sm text-slate-400">Sin alertas abiertas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                layout="vertical"
                data={data.alertasPorPrioridad}
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                <YAxis
                  type="category"
                  dataKey="priority"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  width={56}
                  axisLine={{ stroke: "#e2e8f0" }}
                />
                <Tooltip formatter={(v: any) => [Number(v), "Alertas"]} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {data.alertasPorPrioridad.map((a) => (
                    <Cell key={a.priority} fill={PRIORITY_COLOR[a.priority] ?? STATUS.serious} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
