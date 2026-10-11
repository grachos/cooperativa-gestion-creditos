import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface ReviewItem {
  id: number;
  status: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  notes: string | null;
}

interface ApplicationDocument extends ReviewItem {
  document_type: string;
}

interface ApplicationParticipant extends ReviewItem {
  role: string;
  first_name: string | null;
  last_name: string | null;
}

interface ApplicationDetail {
  id: number;
  requested_amount: string;
  interest_rate: string;
  term_value: number;
  status: string;
  purpose: string | null;
  expected_disbursement_date: string | null;
  rejection_reason: string | null;
  participants: ApplicationParticipant[];
  documents: ApplicationDocument[];
  history: Array<{ from_status: string | null; to_status: string; reason: string | null; created_at: string }>;
}

const REVIEW_STATUS_STYLES: Record<string, string> = {
  PENDIENTE: "bg-slate-100 text-slate-500",
  APROBADO: "bg-brand-50 text-brand-700",
  RECHAZADO: "bg-red-50 text-red-700"
};

function ReviewRow({
  label,
  item,
  canReview,
  onSave
}: {
  label: string;
  item: ReviewItem;
  canReview: boolean;
  onSave: (status: "APROBADO" | "RECHAZADO", notes: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save(status: "APROBADO" | "RECHAZADO") {
    setSaving(true);
    try {
      await onSave(status, notes);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-lg border border-slate-100 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${REVIEW_STATUS_STYLES[item.status]}`}>{item.status}</span>
          {canReview && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Revisar
            </button>
          )}
        </div>
      </div>
      {item.notes && !editing && <p className="mt-1 text-xs text-slate-400">Nota: {item.notes}</p>}
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="min-w-[10rem] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
            placeholder="Nota (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void save("APROBADO")}
            className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Aprobar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save("RECHAZADO")}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [rejectionReason, setRejectionReason] = useState("");
  const [disbursementDate, setDisbursementDate] = useState(new Date().toISOString().slice(0, 10));
  const [firstInstallmentDate, setFirstInstallmentDate] = useState("");
  const [assignedCollectorId, setAssignedCollectorId] = useState("");
  const [assignedSellerId, setAssignedSellerId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["application", id],
    queryFn: () => api.get<ApplicationDetail>(`/applications/${id}`)
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ data: Array<{ id: number; full_name: string }> }>("/users")
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["application", id] });
  }

  const reviewDocument = useMutation({
    mutationFn: ({ documentId, status, notes }: { documentId: number; status: string; notes: string }) =>
      api.put(`/applications/${id}/documents/${documentId}`, { status, notes: notes || undefined }),
    onSuccess: invalidate
  });

  const reviewParticipant = useMutation({
    mutationFn: ({ participantId, status, notes }: { participantId: number; status: string; notes: string }) =>
      api.put(`/applications/${id}/participants/${participantId}`, { status, notes: notes || undefined }),
    onSuccess: invalidate
  });

  // Decisiones (revisar / aprobar / rechazar): una sola a la vez. El servidor ya
  // las protege por estado, así que aquí solo se evita el doble envío.
  const { submit: submitDecision, pending: deciding } = useIdempotentSubmit(`application-decision:${id}`);
  // Desembolso: crea un crédito, por eso lleva Idempotency-Key.
  const { submit: submitDisbursement, pending: disbursing } = useIdempotentSubmit(`disbursement:${id}`);

  async function startReview() {
    setActionError(null);
    try {
      const out = await submitDecision({ action: "review" }, () => api.post(`/applications/${id}/review`, {}));
      if (!out.ran) return;
      invalidate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al iniciar la revisión");
    }
  }

  async function approve() {
    setActionError(null);
    try {
      const out = await submitDecision({ action: "approve" }, () => api.post(`/applications/${id}/approve`, {}));
      if (!out.ran) return;
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
      const out = await submitDecision({ action: "reject", rejectionReason }, () =>
        api.post(`/applications/${id}/reject`, { rejectionReason })
      );
      if (!out.ran) return;
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
    const payload = {
      disbursementDate,
      firstInstallmentDate,
      assignedCollectorId: assignedCollectorId ? Number(assignedCollectorId) : undefined,
      assignedSellerId: assignedSellerId ? Number(assignedSellerId) : undefined
    };
    try {
      const out = await submitDisbursement(payload, (idempotencyKey) =>
        api.post<{ id: number }>(`/credits/applications/${id}/disburse`, payload, { idempotencyKey })
      );
      if (!out.ran) return;
      navigate(`/creditos/${out.result.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al desembolsar");
    }
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  const canReview = hasPermission("applications:approve") && ["RADICADA", "EN_REVISION"].includes(data.status);

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
        <ul className="space-y-2">
          {data.participants.map((p) => (
            <ReviewRow
              key={p.id}
              label={`${p.role}: ${p.first_name ? `${p.first_name} ${p.last_name}` : "—"}`}
              item={p}
              canReview={canReview}
              onSave={async (status, notes) => {
                await reviewParticipant.mutateAsync({ participantId: p.id, status, notes });
              }}
            />
          ))}
        </ul>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Documentos requeridos</h2>
        <ul className="space-y-2">
          {data.documents.map((d) => (
            <ReviewRow
              key={d.id}
              label={d.document_type}
              item={d}
              canReview={canReview}
              onSave={async (status, notes) => {
                await reviewDocument.mutateAsync({ documentId: d.id, status, notes });
              }}
            />
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
          {data.status === "RADICADA" && (
            <button
              onClick={() => void startReview()}
              disabled={deciding}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              {deciding ? "Procesando..." : "Poner en revisión"}
            </button>
          )}
          <p className="text-xs text-slate-400">
            Para aprobar, todos los documentos y participantes deben quedar en estado APROBADO.
          </p>
          <button
            onClick={() => void approve()}
            disabled={deciding}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {deciding ? "Procesando..." : "Aprobar solicitud"}
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
              disabled={deciding}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deciding ? "Procesando..." : "Rechazar"}
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
            <div>
              <label className="mb-1 block text-xs text-slate-500">Gestor de cartera asignado</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={assignedCollectorId}
                onChange={(e) => setAssignedCollectorId(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {users?.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Vendedor</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={assignedSellerId}
                onChange={(e) => setAssignedSellerId(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {users?.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => void disburse()}
            disabled={disbursing}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {disbursing ? "Desembolsando..." : "Confirmar desembolso"}
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
