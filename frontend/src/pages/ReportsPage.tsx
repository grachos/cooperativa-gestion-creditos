import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

interface MonthlySummaryRow {
  year: number;
  month: number;
  creditsDisbursedCount: number;
  disbursedAmount: number;
  creditsCancelledCount: number;
  cancelledAmount: number;
  installmentsDueCount: number;
  dueAmount: number;
  installmentsPaidCount: number;
  installmentsPaidPercent: number;
  collectedAmount: number;
  collectedPercent: number;
}

interface DueRow {
  id: number;
  due_date: string;
  total_due: string;
  first_name: string | null;
  last_name: string | null;
  credit_number: string;
}

interface OverdueRow {
  id: number;
  overdue_days: number;
  balance: string;
  first_name: string | null;
  last_name: string | null;
  credit_number: string;
  moraCode: string;
}

interface MoraBucket {
  code: string;
  label: string;
  count: number;
  value: number;
}

export default function ReportsPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState<string>("");

  const dueQuery = useQuery({
    queryKey: ["report-due", date],
    queryFn: () => api.get<{ data: DueRow[] }>(`/reports/due-on-date?date=${date}`)
  });
  const overdueQuery = useQuery({
    queryKey: ["report-overdue"],
    queryFn: () => api.get<{ data: OverdueRow[] }>("/reports/overdue")
  });
  const moraBucketsQuery = useQuery({
    queryKey: ["report-mora-buckets"],
    queryFn: () => api.get<{ data: MoraBucket[] }>("/reports/mora-buckets")
  });
  const monthlyQuery = useQuery({
    queryKey: ["report-monthly-summary", year],
    queryFn: () =>
      api.get<{ data: MonthlySummaryRow[] }>(`/reports/monthly-summary${year ? `?year=${year}` : ""}`)
  });

  const availableYears = useMemo(() => {
    const years = new Set((monthlyQuery.data?.data ?? []).map((r) => r.year));
    return Array.from(years).sort((a, b) => b - a);
  }, [monthlyQuery.data]);

  const totals = useMemo(() => {
    const rows = monthlyQuery.data?.data ?? [];
    return rows.reduce(
      (acc, r) => ({
        creditsDisbursedCount: acc.creditsDisbursedCount + r.creditsDisbursedCount,
        disbursedAmount: acc.disbursedAmount + r.disbursedAmount,
        creditsCancelledCount: acc.creditsCancelledCount + r.creditsCancelledCount,
        cancelledAmount: acc.cancelledAmount + r.cancelledAmount,
        installmentsDueCount: acc.installmentsDueCount + r.installmentsDueCount,
        dueAmount: acc.dueAmount + r.dueAmount,
        installmentsPaidCount: acc.installmentsPaidCount + r.installmentsPaidCount,
        collectedAmount: acc.collectedAmount + r.collectedAmount
      }),
      {
        creditsDisbursedCount: 0,
        disbursedAmount: 0,
        creditsCancelledCount: 0,
        cancelledAmount: 0,
        installmentsDueCount: 0,
        dueAmount: 0,
        installmentsPaidCount: 0,
        collectedAmount: 0
      }
    );
  }, [monthlyQuery.data]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Reportes</h1>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Reporte mensual de cartera</h2>
            <p className="text-xs text-slate-400">
              Desembolsos, cancelaciones, cuotas y recaudo por mes. No incluye mora al cierre por mes histórico: el
              sistema solo guarda la mora actual de cada cuota, no una foto por corte pasado (ver "Mora por bucket"
              abajo para la mora vigente hoy).
            </p>
          </div>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">Todos los años</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {monthlyQuery.isLoading && <Loading />}
        {monthlyQuery.error && <ErrorView message={(monthlyQuery.error as Error).message} />}
        {monthlyQuery.data && monthlyQuery.data.data.length === 0 && (
          <EmptyView message="Sin datos para el filtro seleccionado." />
        )}
        {monthlyQuery.data && monthlyQuery.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Año</th>
                  <th className="py-1 pr-3">Mes</th>
                  <th className="py-1 pr-3">Créditos desembol.</th>
                  <th className="py-1 pr-3">Valor desembolsos</th>
                  <th className="py-1 pr-3">Créditos cancelados</th>
                  <th className="py-1 pr-3">Valor cancelados</th>
                  <th className="py-1 pr-3">Cuotas x recaudo</th>
                  <th className="py-1 pr-3">Valor x recaudo</th>
                  <th className="py-1 pr-3">Cuotas pagas</th>
                  <th className="py-1 pr-3">%</th>
                  <th className="py-1 pr-3">Valor recaudado</th>
                  <th className="py-1 pr-3">%</th>
                </tr>
              </thead>
              <tbody>
                {monthlyQuery.data.data.map((r) => (
                  <tr key={`${r.year}-${r.month}`} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{r.year}</td>
                    <td className="py-1 pr-3">{MONTH_NAMES[r.month - 1]}</td>
                    <td className="py-1 pr-3">{r.creditsDisbursedCount}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.disbursedAmount)}</td>
                    <td className="py-1 pr-3">{r.creditsCancelledCount}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.cancelledAmount)}</td>
                    <td className="py-1 pr-3">{r.installmentsDueCount}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.dueAmount)}</td>
                    <td className="py-1 pr-3">{r.installmentsPaidCount}</td>
                    <td className="py-1 pr-3">{formatPercent(r.installmentsPaidPercent)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.collectedAmount)}</td>
                    <td className="py-1 pr-3">{formatPercent(r.collectedPercent)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
                  <td className="py-1 pr-3" colSpan={2}>
                    Total
                  </td>
                  <td className="py-1 pr-3">{totals.creditsDisbursedCount}</td>
                  <td className="py-1 pr-3">{formatCurrency(totals.disbursedAmount)}</td>
                  <td className="py-1 pr-3">{totals.creditsCancelledCount}</td>
                  <td className="py-1 pr-3">{formatCurrency(totals.cancelledAmount)}</td>
                  <td className="py-1 pr-3">{totals.installmentsDueCount}</td>
                  <td className="py-1 pr-3">{formatCurrency(totals.dueAmount)}</td>
                  <td className="py-1 pr-3">{totals.installmentsPaidCount}</td>
                  <td className="py-1 pr-3">
                    {formatPercent(
                      totals.installmentsDueCount > 0
                        ? (totals.installmentsPaidCount / totals.installmentsDueCount) * 100
                        : 0
                    )}
                  </td>
                  <td className="py-1 pr-3">{formatCurrency(totals.collectedAmount)}</td>
                  <td className="py-1 pr-3">
                    {formatPercent(totals.dueAmount > 0 ? (totals.collectedAmount / totals.dueAmount) * 100 : 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">¿Quién debe pagar en una fecha?</h2>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {dueQuery.isLoading && <Loading />}
        {dueQuery.error && <ErrorView message={(dueQuery.error as Error).message} />}
        {dueQuery.data && dueQuery.data.data.length === 0 && <EmptyView message="Nadie debe pagar en esta fecha." />}
        {dueQuery.data && dueQuery.data.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1">Crédito</th>
                <th className="py-1">Titular</th>
                <th className="py-1">Valor cuota</th>
              </tr>
            </thead>
            <tbody>
              {dueQuery.data.data.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1">{r.credit_number}</td>
                  <td className="py-1">
                    {r.first_name ? `${r.first_name} ${r.last_name}` : "—"}
                  </td>
                  <td className="py-1">{formatCurrency(r.total_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Mora por bucket</h2>
        <p className="mb-3 text-xs text-slate-400">
          Mismos códigos que usa la cooperativa hoy en su Excel (CD001 al día, CM030…CM180 días de atraso).
        </p>
        {moraBucketsQuery.isLoading && <Loading />}
        {moraBucketsQuery.error && <ErrorView message={(moraBucketsQuery.error as Error).message} />}
        {moraBucketsQuery.data && (
          <div className="flex flex-wrap gap-3">
            {moraBucketsQuery.data.data.map((b) => (
              <div key={b.code} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <p className="font-semibold">
                  {b.code} · {b.label}
                </p>
                <p className="text-slate-500">
                  {b.count} cuota{b.count === 1 ? "" : "s"} · {formatCurrency(b.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Cuotas vencidas y días de atraso</h2>
        {overdueQuery.isLoading && <Loading />}
        {overdueQuery.error && <ErrorView message={(overdueQuery.error as Error).message} />}
        {overdueQuery.data && overdueQuery.data.data.length === 0 && (
          <EmptyView message="No hay cuotas vencidas." />
        )}
        {overdueQuery.data && overdueQuery.data.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1">Crédito</th>
                <th className="py-1">Titular</th>
                <th className="py-1">Días de atraso</th>
                <th className="py-1">Mora</th>
                <th className="py-1">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {overdueQuery.data.data.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1">{r.credit_number}</td>
                  <td className="py-1">{r.first_name ? `${r.first_name} ${r.last_name}` : "—"}</td>
                  <td className="py-1">{r.overdue_days}</td>
                  <td className="py-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{r.moraCode}</span>
                  </td>
                  <td className="py-1">{formatCurrency(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <a
        href="/api/v1/reports/payments.csv"
        className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
      >
        Exportar pagos (CSV)
      </a>
      <p className="mt-2 text-xs text-slate-400">Generado: {formatDate(new Date().toISOString())}</p>
    </div>
  );
}
