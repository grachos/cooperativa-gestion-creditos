import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";

interface AssociateDetail {
  id: number;
  first_name: string;
  last_name: string;
  id_type: string;
  id_number: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  municipality: string | null;
  department: string | null;
  income_info: string | null;
  employer_name: string | null;
  employer_address: string | null;
  employer_phone: string | null;
  employer_email: string | null;
  status: string;
  credits: Array<{ id: number; credit_number: string; status: string; principal_balance: string }>;
  activeAlerts: Array<{ id: number; type: string; priority: string; message: string }>;
}

export default function AssociateDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["associate", id],
    queryFn: () => api.get<AssociateDetail>(`/associates/${id}`)
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">
        {data.first_name} {data.last_name}
      </h1>
      <p className="mb-6 text-sm text-slate-400">
        {data.id_type} {data.id_number} · {data.status}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Datos de contacto</h2>
          <p className="text-sm text-slate-600">Teléfono: {data.phone ?? "—"}</p>
          <p className="text-sm text-slate-600">Correo: {data.email ?? "—"}</p>
          <p className="text-sm text-slate-600">Dirección: {data.address ?? "—"}</p>
          <p className="text-sm text-slate-600">
            Ubicación: {data.municipality ?? "—"}, {data.department ?? "—"}
          </p>
          {data.income_info && <p className="text-sm text-slate-600">Ingresos: {data.income_info}</p>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Empresa donde trabaja</h2>
          {data.employer_name || data.employer_address || data.employer_phone || data.employer_email ? (
            <>
              <p className="text-sm text-slate-600">Empresa: {data.employer_name ?? "—"}</p>
              <p className="text-sm text-slate-600">Dirección: {data.employer_address ?? "—"}</p>
              <p className="text-sm text-slate-600">Teléfono: {data.employer_phone ?? "—"}</p>
              <p className="text-sm text-slate-600">Correo: {data.employer_email ?? "—"}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">Sin datos de empresa registrados.</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Alertas activas</h2>
          {data.activeAlerts.length === 0 ? (
            <p className="text-sm text-slate-400">Sin alertas activas.</p>
          ) : (
            <ul className="space-y-1">
              {data.activeAlerts.map((a) => (
                <li key={a.id} className="text-sm text-slate-600">
                  <span className="font-medium">{a.priority}</span> — {a.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Créditos relacionados</h2>
        {data.credits.length === 0 ? (
          <p className="text-sm text-slate-400">Este asociado no tiene créditos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1">Número</th>
                <th className="py-1">Estado</th>
                <th className="py-1">Saldo capital</th>
              </tr>
            </thead>
            <tbody>
              {data.credits.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <Link to={`/creditos/${c.id}`} className="text-emerald-700 hover:underline">
                      {c.credit_number}
                    </Link>
                  </td>
                  <td className="py-1">{c.status}</td>
                  <td className="py-1">{formatCurrency(c.principal_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">Actualizado: {formatDate(new Date().toISOString())}</p>
    </div>
  );
}
