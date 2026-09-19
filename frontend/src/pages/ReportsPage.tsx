import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";

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

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Reportes</h1>

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
