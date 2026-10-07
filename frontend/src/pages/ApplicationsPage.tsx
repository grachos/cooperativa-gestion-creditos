import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { TabBar, CrossfadePanels } from "../components/Tabs";

interface Application {
  id: number;
  requested_amount: string;
  status: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  RADICADA: "Radicada",
  EN_REVISION: "En revisión",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  CANCELADA: "Cancelada",
  DESEMBOLSADA: "Desembolsada"
};

const FILTER_TABS = [
  { key: "TODAS", label: "Todas" },
  ...["RADICADA", "EN_REVISION", "APROBADA", "RECHAZADA", "CANCELADA", "DESEMBOLSADA"].map((key) => ({
    key,
    label: STATUS_LABELS[key] ?? key
  }))
];

export default function ApplicationsPage() {
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState("TODAS");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Solicitudes de crédito</h1>
        {hasPermission("applications:write") && (
          <Link
            to="/solicitudes/nueva"
            className="flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Nueva solicitud
          </Link>
        )}
      </div>

      <TabBar tabs={FILTER_TABS} active={status} onChange={setStatus} className="mb-4" />

      <CrossfadePanels activeKey={status}>{(k) => <ApplicationsList status={k} />}</CrossfadePanels>
    </div>
  );
}

function ApplicationsList({ status }: { status: string }) {
  const filter = status === "TODAS" ? "" : status;
  const { data, isLoading, error } = useQuery({
    queryKey: ["applications", filter],
    queryFn: () => api.get<{ data: Application[] }>(`/applications${filter ? `?status=${filter}` : ""}`)
  });

  return (
    <div>
      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {data && data.data.length === 0 && <EmptyView message="No hay solicitudes con este filtro." />}

      {data && data.data.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {data.data.map((a) => (
              <Link
                key={a.id}
                to={`/solicitudes/${a.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-brand-700">
                    {a.first_name ? `${a.first_name} ${a.last_name}` : a.legal_name}
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABELS[a.status] ?? a.status}</span>
                </div>
                <p className="text-sm text-slate-500">{formatCurrency(a.requested_amount)}</p>
                <p className="text-sm text-slate-400">{formatDate(a.created_at)}</p>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Titular</th>
                  <th className="px-4 py-2">Monto solicitado</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link to={`/solicitudes/${a.id}`} className="font-medium text-brand-700 hover:underline">
                        {a.first_name ? `${a.first_name} ${a.last_name}` : a.legal_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatCurrency(a.requested_amount)}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABELS[a.status] ?? a.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
