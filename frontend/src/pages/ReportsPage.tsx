import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface AssociateOption {
  id: number;
  first_name: string;
  last_name: string;
}

/**
 * Autocompletado de cliente: busca en /associates (asociados con crédito o
 * no) a medida que se escribe, con un pequeño debounce, y permite elegir
 * uno exacto en vez de depender de un filtro de texto local.
 */
function ClientAutocomplete({
  onSelect,
  onClear
}: {
  onSelect: (associate: { id: number; name: string }) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const searchQuery = useQuery({
    queryKey: ["associates-autocomplete", debouncedQuery],
    queryFn: () =>
      api.get<{ data: AssociateOption[] }>(`/associates?search=${encodeURIComponent(debouncedQuery)}&pageSize=8`),
    enabled: debouncedQuery.trim().length >= 2
  });

  return (
    <div ref={boxRef} className="relative w-52">
      <input
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        placeholder="Buscar cliente..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value === "") onClear();
        }}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
      />
      {open && debouncedQuery.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-md">
          {searchQuery.isLoading && <p className="px-3 py-2 text-xs text-slate-400">Buscando...</p>}
          {searchQuery.data && searchQuery.data.data.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">Sin coincidencias.</p>
          )}
          {searchQuery.data?.data.map((a) => (
            <button
              key={a.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                const name = `${a.first_name} ${a.last_name}`;
                setQuery(name);
                setOpen(false);
                onSelect({ id: a.id, name });
              }}
            >
              {a.first_name} {a.last_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

interface CreditMonthlyDetailRow {
  creditNumber: string;
  associateId: number | null;
  clientName: string;
  paymentDay: number;
  status: string;
  creditValue: number;
  installmentValue: number;
  installmentsCount: number;
  installmentsPaid: number;
  installmentsPending: number;
  paidToDate: number;
  pendingToDate: number;
  collectedMonth: number;
  principalToCollect: number;
  interestToCollect: number;
  principalCollectedMonth: number;
  interestCollectedMonth: number;
}

export default function ReportsPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const today = new Date();
  const [detailYear, setDetailYear] = useState<string>(String(today.getFullYear()));
  const [detailMonth, setDetailMonth] = useState<string>(String(today.getMonth() + 1));
  const [selectedAssociate, setSelectedAssociate] = useState<{ id: number; name: string } | null>(null);

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
  // Sin filtros, solo para poblar el selector de años disponibles — así el
  // selector no se reduce a la sola opción elegida al filtrar la tabla.
  const allMonthsQuery = useQuery({
    queryKey: ["report-monthly-summary", "all"],
    queryFn: () => api.get<{ data: MonthlySummaryRow[] }>("/reports/monthly-summary")
  });
  const monthlyQuery = useQuery({
    queryKey: ["report-monthly-summary", year, month],
    queryFn: () => {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (month) params.set("month", month);
      const qs = params.toString();
      return api.get<{ data: MonthlySummaryRow[] }>(`/reports/monthly-summary${qs ? `?${qs}` : ""}`);
    }
  });

  const availableYears = useMemo(() => {
    const years = new Set((allMonthsQuery.data?.data ?? []).map((r) => r.year));
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [allMonthsQuery.data]);

  const detailQuery = useQuery({
    queryKey: ["report-credits-monthly-detail", detailYear, detailMonth],
    queryFn: () =>
      api.get<{ data: CreditMonthlyDetailRow[] }>(
        `/reports/credits-monthly-detail?year=${detailYear}&month=${detailMonth}`
      )
  });

  const filteredDetailRows = useMemo(() => {
    const rows = detailQuery.data?.data ?? [];
    if (!selectedAssociate) return rows;
    return rows.filter((r) => r.associateId === selectedAssociate.id);
  }, [detailQuery.data, selectedAssociate]);

  const detailTotals = useMemo(() => {
    const rows = filteredDetailRows;
    return rows.reduce(
      (acc, r) => ({
        creditValue: acc.creditValue + r.creditValue,
        installmentsPaid: acc.installmentsPaid + r.installmentsPaid,
        installmentsPending: acc.installmentsPending + r.installmentsPending,
        paidToDate: acc.paidToDate + r.paidToDate,
        pendingToDate: acc.pendingToDate + r.pendingToDate,
        collectedMonth: acc.collectedMonth + r.collectedMonth,
        principalToCollect: acc.principalToCollect + r.principalToCollect,
        interestToCollect: acc.interestToCollect + r.interestToCollect,
        principalCollectedMonth: acc.principalCollectedMonth + r.principalCollectedMonth,
        interestCollectedMonth: acc.interestCollectedMonth + r.interestCollectedMonth
      }),
      {
        creditValue: 0,
        installmentsPaid: 0,
        installmentsPending: 0,
        paidToDate: 0,
        pendingToDate: 0,
        collectedMonth: 0,
        principalToCollect: 0,
        interestToCollect: 0,
        principalCollectedMonth: 0,
        interestCollectedMonth: 0
      }
    );
  }, [filteredDetailRows]);

  function downloadDetailCsv() {
    downloadCsv(
      `detalle-mensual-${detailYear}-${String(detailMonth).padStart(2, "0")}.csv`,
      [
        "Credito",
        "Cliente",
        "Dia pago",
        "Estado",
        "Valor credito",
        "Valor cuota",
        "Cuotas pagas",
        "Cuotas totales",
        "Cuotas pendientes",
        "Valor pagado",
        "Valor pendiente",
        "Recaudo del mes",
        "Capital x recaudar",
        "Interes x recaudar",
        "Capital recaudado",
        "Interes recaudado"
      ],
      filteredDetailRows.map((r) => [
        r.creditNumber,
        r.clientName,
        r.paymentDay,
        r.status,
        r.creditValue,
        r.installmentValue,
        r.installmentsPaid,
        r.installmentsCount,
        r.installmentsPending,
        r.paidToDate,
        r.pendingToDate,
        r.collectedMonth,
        r.principalToCollect,
        r.interestToCollect,
        r.principalCollectedMonth,
        r.interestCollectedMonth
      ])
    );
  }

  function downloadMonthlySummaryCsv() {
    downloadCsv(
      "reporte-mensual-cartera.csv",
      [
        "Año",
        "Mes",
        "Creditos desembolsados",
        "Valor desembolsos",
        "Creditos cancelados",
        "Valor cancelados",
        "Cuotas x recaudo",
        "Valor x recaudo",
        "Cuotas pagas",
        "% cuotas pagas",
        "Valor recaudado",
        "% recaudado"
      ],
      (monthlyQuery.data?.data ?? []).map((r) => [
        r.year,
        MONTH_NAMES[r.month - 1] ?? "",
        r.creditsDisbursedCount,
        r.disbursedAmount,
        r.creditsCancelledCount,
        r.cancelledAmount,
        r.installmentsDueCount,
        r.dueAmount,
        r.installmentsPaidCount,
        r.installmentsPaidPercent.toFixed(2),
        r.collectedAmount,
        r.collectedPercent.toFixed(2)
      ])
    );
  }

  function downloadDueCsv() {
    downloadCsv(
      `pagos-del-${date}.csv`,
      ["Credito", "Titular", "Valor cuota"],
      (dueQuery.data?.data ?? []).map((r) => [
        r.credit_number,
        r.first_name ? `${r.first_name} ${r.last_name}` : "—",
        r.total_due
      ])
    );
  }

  function downloadMoraBucketsCsv() {
    downloadCsv(
      "mora-por-bucket.csv",
      ["Codigo", "Bucket", "Cuotas", "Valor"],
      (moraBucketsQuery.data?.data ?? []).map((b) => [b.code, b.label, b.count, b.value])
    );
  }

  function downloadOverdueCsv() {
    downloadCsv(
      "cuotas-vencidas.csv",
      ["Credito", "Titular", "Dias de atraso", "Mora", "Saldo"],
      (overdueQuery.data?.data ?? []).map((r) => [
        r.credit_number,
        r.first_name ? `${r.first_name} ${r.last_name}` : "—",
        r.overdue_days,
        r.moraCode,
        r.balance
      ])
    );
  }

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700">Reporte mensual de cartera</h2>
            <p className="text-xs text-slate-400">
              Desembolsos, cancelaciones, cuotas y recaudo por mes. No incluye mora al cierre por mes histórico: el
              sistema solo guarda la mora actual de cada cuota, no una foto por corte pasado (ver "Mora por bucket"
              abajo para la mora vigente hoy).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">Todos los meses</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={downloadMonthlySummaryCsv}
              disabled={!monthlyQuery.data?.data.length}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Exportar CSV
            </button>
          </div>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700">Detalle mensual por crédito</h2>
            <p className="text-xs text-slate-400">
              Una fila por crédito abierto ese mes: día de pago, cuotas pagas/pendientes, valor pagado/pendiente
              acumulado y recaudo del mes — reconstruido con los abonos reales registrados hasta el cierre de ese
              mes, no con el estado actual.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ClientAutocomplete onSelect={setSelectedAssociate} onClear={() => setSelectedAssociate(null)} />
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={detailYear}
              onChange={(e) => setDetailYear(e.target.value)}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={detailMonth}
              onChange={(e) => setDetailMonth(e.target.value)}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={downloadDetailCsv}
              disabled={filteredDetailRows.length === 0}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        {detailQuery.isLoading && <Loading />}
        {detailQuery.error && <ErrorView message={(detailQuery.error as Error).message} />}
        {detailQuery.data && filteredDetailRows.length === 0 && (
          <EmptyView
            message={
              selectedAssociate
                ? `${selectedAssociate.name} no tenía créditos abiertos en el mes seleccionado.`
                : "Ningún crédito estaba abierto en el mes seleccionado."
            }
          />
        )}
        {detailQuery.data && filteredDetailRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Crédito</th>
                  <th className="py-1 pr-3">Cliente</th>
                  <th className="py-1 pr-3">Día pago</th>
                  <th className="py-1 pr-3">Estado</th>
                  <th className="py-1 pr-3">Valor crédito</th>
                  <th className="py-1 pr-3">Valor cuota</th>
                  <th className="py-1 pr-3">Cuotas pagas</th>
                  <th className="py-1 pr-3">Cuotas pend.</th>
                  <th className="py-1 pr-3">Valor pagado</th>
                  <th className="py-1 pr-3">Valor pendiente</th>
                  <th className="py-1 pr-3">Recaudo del mes</th>
                  <th className="py-1 pr-3">Capital x recaudar</th>
                  <th className="py-1 pr-3">Interés x recaudar</th>
                  <th className="py-1 pr-3">Capital recaudado</th>
                  <th className="py-1 pr-3">Interés recaudado</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetailRows.map((r) => (
                  <tr key={r.creditNumber} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{r.creditNumber}</td>
                    <td className="py-1 pr-3">{r.clientName}</td>
                    <td className="py-1 pr-3">{r.paymentDay}</td>
                    <td className="py-1 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === "PAGADO"
                            ? "bg-emerald-50 text-emerald-700"
                            : r.status === "EN_MORA"
                              ? "bg-red-50 text-red-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1 pr-3">{formatCurrency(r.creditValue)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.installmentValue)}</td>
                    <td className="py-1 pr-3">
                      {r.installmentsPaid}/{r.installmentsCount}
                    </td>
                    <td className="py-1 pr-3">{r.installmentsPending}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.paidToDate)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.pendingToDate)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.collectedMonth)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.principalToCollect)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.interestToCollect)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.principalCollectedMonth)}</td>
                    <td className="py-1 pr-3">{formatCurrency(r.interestCollectedMonth)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
                  <td className="py-1 pr-3" colSpan={4}>
                    Total
                  </td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.creditValue)}</td>
                  <td className="py-1 pr-3">—</td>
                  <td className="py-1 pr-3">{detailTotals.installmentsPaid}</td>
                  <td className="py-1 pr-3">{detailTotals.installmentsPending}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.paidToDate)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.pendingToDate)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.collectedMonth)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.principalToCollect)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.interestToCollect)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.principalCollectedMonth)}</td>
                  <td className="py-1 pr-3">{formatCurrency(detailTotals.interestCollectedMonth)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">¿Quién debe pagar en una fecha?</h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              onClick={downloadDueCsv}
              disabled={!dueQuery.data?.data.length}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Exportar CSV
            </button>
          </div>
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Mora por bucket</h2>
          <button
            type="button"
            onClick={downloadMoraBucketsCsv}
            disabled={!moraBucketsQuery.data?.data.length}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Exportar CSV
          </button>
        </div>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Cuotas vencidas y días de atraso</h2>
          <button
            type="button"
            onClick={downloadOverdueCsv}
            disabled={!overdueQuery.data?.data.length}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Exportar CSV
          </button>
        </div>
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
