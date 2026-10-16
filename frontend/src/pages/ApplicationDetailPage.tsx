import { useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { formatCurrency, formatDateTime, formatPercent } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { useParameterList } from "../hooks/useParameterList";

interface ReviewItem {
  id: number;
  status: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  notes: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
}

interface ReferenceCheck {
  id: number;
  reference_type: "PERSONAL" | "LABORAL";
  reference_name: string;
  phone: string | null;
  contacted: boolean;
  result: "POSITIVA" | "NEGATIVA" | "SIN_RESPUESTA" | null;
  notes: string | null;
  checked_by_name: string | null;
  checked_at: string;
}

interface ApplicationDocument extends ReviewItem {
  document_type: string;
  // null en solicitudes anteriores: el documento era "de la solicitud", no de un participante.
  credit_participant_id: number | null;
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
  seller_name: string | null;
  assigned_seller_id: number | null;
  created_by_name: string | null;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  references: ReferenceCheck[];
  history: Array<{ from_status: string | null; to_status: string; reason: string | null; created_at: string; user_name: string | null }>;
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
      {item.reviewed_by_name && !editing && (
        <p className="mt-1 text-xs text-slate-400">
          Revisó: {item.reviewed_by_name}
          {item.reviewed_at ? ` · ${formatDateTime(item.reviewed_at)}` : ""}
        </p>
      )}
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
  const [toAccount, setToAccount] = useState("");
  const [fromAccount, setFromAccount] = useState("");
  const [proofFiled, setProofFiled] = useState(false);
  const coopAccounts = useParameterList("cuentas_bancarias_cooperativa", []);
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
      assignedSellerId: assignedSellerId ? Number(assignedSellerId) : undefined,
      disbursementToAccount: toAccount.trim() || undefined,
      disbursementFromAccount: fromAccount.trim() || undefined,
      disbursementProofFiled: proofFiled
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

  const isOpen = ["RADICADA", "EN_REVISION"].includes(data.status);
  const canReview = hasPermission("applications:review") && isOpen;
  const canDecide = hasPermission("applications:approve") && isOpen;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Solicitud #{data.id}</h1>
      <p className="mb-1 text-sm text-slate-400">Estado actual: {data.status}</p>
      <p className="mb-4 text-xs text-slate-400">
        Radicada por {data.created_by_name ?? "—"} · {formatDateTime(data.created_at)}
        {data.decided_by_name && (
          <>
            {" "}
            · Decidida por {data.decided_by_name}
            {data.decided_at ? ` · ${formatDateTime(data.decided_at)}` : ""}
          </>
        )}
      </p>

      {actionError && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{actionError}</p>}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Condiciones solicitadas</h2>
        <p className="text-sm text-slate-600">Monto: {formatCurrency(data.requested_amount)}</p>
        <p className="text-sm text-slate-600">Plazo: {data.term_value} meses</p>
        <p className="text-sm text-slate-600">Tasa mensual: {formatPercent(data.interest_rate)}</p>
        <p className="text-sm text-slate-600">Destino: {data.purpose ?? "—"}</p>
        <p className="text-sm text-slate-600">Asesor: {data.seller_name ?? "Sin asesor"}</p>
      </div>

      {data.participants.map((p) => {
        const docs = data.documents.filter((d) => d.credit_participant_id === p.id);
        return (
          <div key={p.id} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              {p.role === "TITULAR" ? "Titular" : "Codeudor"}: {p.first_name ? `${p.first_name} ${p.last_name}` : "—"}
            </h2>
            <ul className="space-y-2">
              <ReviewRow
                label="Aprobación del participante"
                item={p}
                canReview={canReview}
                onSave={async (status, notes) => {
                  await reviewParticipant.mutateAsync({ participantId: p.id, status, notes });
                }}
              />
            </ul>
            {docs.length > 0 && (
              <>
                <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-400">Documentos requeridos</h3>
                <ul className="space-y-2">
                  {docs.map((d) => (
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
              </>
            )}
          </div>
        );
      })}

      {data.documents.some((d) => d.credit_participant_id === null) && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Documentos de la solicitud</h2>
          <ul className="space-y-2">
            {data.documents
              .filter((d) => d.credit_participant_id === null)
              .map((d) => (
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
      )}

      <ReferenceChecks applicationId={data.id} references={data.references} canEdit={canReview} onChanged={invalidate} />

      {data.rejection_reason && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Motivo de rechazo: {data.rejection_reason}
        </div>
      )}

      {(canReview || canDecide) && (
        <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Decisión</h2>
          {canReview && data.status === "RADICADA" && (
            <button
              onClick={() => void startReview()}
              disabled={deciding}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              {deciding ? "Procesando..." : "Poner en revisión"}
            </button>
          )}
          {!canDecide && (
            <p className="text-xs text-slate-400">Aprobar o rechazar la solicitud lo hace quien tenga ese permiso.</p>
          )}
          {canDecide && (
            <>
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
            </>
          )}
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
              <label className="mb-1 block text-xs text-slate-500">Asesor (por defecto el de la solicitud)</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={assignedSellerId}
                onChange={(e) => setAssignedSellerId(e.target.value)}
              >
                <option value="">{data.seller_name ? `El de la solicitud (${data.seller_name})` : "Sin asesor"}</option>
                {users?.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">Cuenta destino del asociado (banco, tipo y número)</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                maxLength={255}
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">Cuenta de la cooperativa de la que sale el desembolso</label>
              {coopAccounts.length > 0 ? (
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={fromAccount}
                  onChange={(e) => setFromAccount(e.target.value)}
                >
                  <option value="">Sin indicar</option>
                  {coopAccounts.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  maxLength={255}
                  placeholder="Se puede parametrizar la lista en Parámetros › cuentas_bancarias_cooperativa"
                  value={fromAccount}
                  onChange={(e) => setFromAccount(e.target.value)}
                />
              )}
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={proofFiled} onChange={(e) => setProofFiled(e.target.checked)} />
              Soporte del desembolso archivado (pantallazo del banco)
            </label>
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
              {formatDateTime(h.created_at)}: {h.from_status ?? "—"} → {h.to_status} {h.reason ? `(${h.reason})` : ""}
              {h.user_name ? ` · ${h.user_name}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RESULT_LABELS: Record<string, string> = { POSITIVA: "Positiva", NEGATIVA: "Negativa", SIN_RESPUESTA: "Sin respuesta" };
const RESULT_STYLES: Record<string, string> = {
  POSITIVA: "bg-brand-50 text-brand-700",
  NEGATIVA: "bg-red-50 text-red-700",
  SIN_RESPUESTA: "bg-amber-50 text-amber-700"
};

function ReferenceChecks({
  applicationId,
  references,
  canEdit,
  onChanged
}: {
  applicationId: number;
  references: ReferenceCheck[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const empty = { referenceType: "PERSONAL", referenceName: "", phone: "", contacted: false, result: "POSITIVA", notes: "" };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { submit, pending } = useIdempotentSubmit(`reference:${applicationId}`);

  function startEdit(r: ReferenceCheck) {
    setEditingId(r.id);
    setForm({
      referenceType: r.reference_type,
      referenceName: r.reference_name,
      phone: r.phone ?? "",
      contacted: r.contacted,
      result: r.result ?? "POSITIVA",
      notes: r.notes ?? ""
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      referenceType: form.referenceType,
      referenceName: form.referenceName,
      phone: form.phone || undefined,
      contacted: form.contacted,
      result: form.contacted ? form.result : undefined,
      notes: form.notes || undefined
    };
    try {
      const out = await submit(payload, (idempotencyKey) =>
        editingId
          ? api.put(`/applications/${applicationId}/references/${editingId}`, payload)
          : api.post(`/applications/${applicationId}/references`, payload, { idempotencyKey })
      );
      if (!out.ran) return;
      setForm(empty);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la referencia");
    }
  }

  if (references.length === 0 && !canEdit) return null;
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Verificación de referencias</h2>
      {references.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">Aún no se han registrado referencias.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {references.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-100 p-2 text-sm text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {r.reference_type === "PERSONAL" ? "Personal" : "Laboral"}: {r.reference_name}
                  {r.phone ? ` · ${r.phone}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  {r.contacted && r.result ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${RESULT_STYLES[r.result]}`}>{RESULT_LABELS[r.result]}</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">No contactada</span>
                  )}
                  {canEdit && (
                    <button type="button" onClick={() => startEdit(r)} className="text-xs text-brand-700 hover:underline">
                      Editar
                    </button>
                  )}
                </span>
              </div>
              {r.notes && <p className="mt-1 text-xs text-slate-500">{r.notes}</p>}
              <p className="mt-1 text-xs text-slate-400">
                Verificó: {r.checked_by_name ?? "—"} · {formatDateTime(r.checked_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          {error && <p className="w-full rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <select className={input} value={form.referenceType} onChange={(e) => setForm({ ...form, referenceType: e.target.value })}>
            <option value="PERSONAL">Personal</option>
            <option value="LABORAL">Laboral</option>
          </select>
          <input className={`${input} min-w-[10rem] flex-1`} required minLength={2} placeholder="Nombre de la referencia" value={form.referenceName} onChange={(e) => setForm({ ...form, referenceName: e.target.value })} />
          <input className={`${input} w-36`} placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="flex items-center gap-1 text-sm text-slate-700">
            <input type="checkbox" checked={form.contacted} onChange={(e) => setForm({ ...form, contacted: e.target.checked })} />
            Contactada
          </label>
          {form.contacted && (
            <select className={input} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
              <option value="POSITIVA">Positiva</option>
              <option value="NEGATIVA">Negativa</option>
              <option value="SIN_RESPUESTA">Sin respuesta</option>
            </select>
          )}
          <input className={`${input} min-w-[10rem] flex-1`} maxLength={500} placeholder="Observación (opcional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" disabled={pending} className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60">
            {pending ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar referencia"}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="text-sm text-slate-500 hover:underline">
              Cancelar
            </button>
          )}
        </form>
      )}
    </div>
  );
}
