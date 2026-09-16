import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface ApplicationDetail {
  id: number;
  requested_amount: string;
  interest_rate: string;
  term_value: number;
  status: string;
  purpose: string | null;
  expected_disbursement_date: string | null;
  rejection_reason: string | null;
  participants: Array<{ role: string; first_name: string | null; last_name: string | null }>;
  history: Array<{ from_status: string | null; to_status: string; reason: string | null; created_at: string }>;
}

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [rejectionReason, setRejectionReason] = useState("");
  const [disbursementDate, setDisbursementDate] = useState(new Date().toISOString().slice(0, 10));
  const [firstInstallmentDate, setFirstInstallmentDate] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["application", id],
    queryFn: () => api.get<ApplicationDetail>(`/applications/${id}`)
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["application", id] });
  }

  async function approve() {
    setActionError(null);
    try {
      await api.post(`/applications/${id}/approve`, {});
      invalidate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al aprobar");
    }
  }

  async function reject() {
    setActionError(null);
    if (!rejectionReason) {
      setActionError("Debe indicar el motivo de rechazo");
      return;
    }
    try {
      await api.post(`/applications/${id}/reject`, { rejectionReason });
      invalidate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al rechazar");
    }
  }

  async function disburse() {
    setActionError(null);
    if (!firstInstallmentDate) {
      setActionError("Debe indicar la fecha de la primera cuota");
      return;
    }
    try {
      const result = await api.post<{ id: number }>(`/credits/applications/${id}/disburse`, {
        disbursementDate,
        firstInstallmentDate
      });
      navigate(`/creditos/${result.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al desembolsar");
    }
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Solicitud #{data.id}</h1>
      <p className="mb-4 text-sm text-slate-400">Estado actual: {data.status}</p>

      {actionError && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{actionError}</p>}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Condiciones solicitadas</h2>
        <p className="text-sm text-slate-600">Monto: {formatCurrency(data.requested_amount)}</p>
        <p className="text-sm text-slate-600">Plazo: {data.term_value} meses</p>
        <p className="text-sm text-slate-600">Tasa mensual: {formatPercent(data.interest_rate)}</p>
        <p className="text-sm text-slate-600">Destino: {data.purpose ?? "—"}</p>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Participantes</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          {data.participants.map((p, idx) => (
            <li key={idx}>
              {p.role}: {p.first_name ? `${p.first_name} ${p.last_name}` : "—"}
            </li>
          ))}
        </ul>
      </div>

      {data.rejection_reason && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Motivo de rechazo: {data.rejection_reason}
        </div>
      )}

      {hasPermission("applications:approve") && ["RADICADA", "EN_REVISION"].includes(data.status) && (
        <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Decisión</h2>
          <button
            onClick={() => void approve()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Aprobar solicitud
          </button>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Motivo de rechazo"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            <button
              onClick={() => void reject()}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Rechazar
            </button>
          </div>
        </div>
      )}

      {hasPermission("disbursements:write") && data.status === "APROBADA" && (
        <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Desembolso</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Fecha de desembolso</label>
              <input
                type="date"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={disbursementDate}
                onChange={(e) => setDisbursementDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Fecha primera cuota</label>
              <input
                type="date"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={firstInstallmentDate}
                onChange={(e) => setFirstInstallmentDate(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={() => void disburse()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Confirmar desembolso
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Historial de estados</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          {data.history.map((h, idx) => (
            <li key={idx}>
              {formatDate(h.created_at)}: {h.from_status ?? "—"} → {h.to_status} {h.reason ? `(${h.reason})` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
