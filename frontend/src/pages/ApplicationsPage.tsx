import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface Application {
  id: number;
  requested_amount: string;
  status: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
}

const STATUSES = ["RADICADA", "EN_REVISION", "APROBADA", "RECHAZADA", "CANCELADA", "DESEMBOLSADA"];

export default function ApplicationsPage() {
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["applications", status],
    queryFn: () => api.get<{ data: Application[] }>(`/applications${status ? `?status=${status}` : ""}`)
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Solicitudes de crédito</h1>
        {hasPermission("applications:write") && (
          <Link
            to="/solicitudes/nueva"
            className="flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Nueva solicitud
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        <button
          onClick={() => setStatus("")}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
            status === "" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          Todas
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
              status === s ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {data && data.data.length === 0 && <EmptyView message="No hay solicitudes con este filtro." />}

      {data && data.data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                    <Link to={`/solicitudes/${a.id}`} className="font-medium text-emerald-700 hover:underline">
                      {a.first_name ? `${a.first_name} ${a.last_name}` : a.legal_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatCurrency(a.requested_amount)}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{a.status}</span>
                  </td>
                  <td className="px-4 py-2">{formatDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
