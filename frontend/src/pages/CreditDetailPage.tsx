import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate, formatPercent } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface Installment {
  id: number;
  installment_number: number;
  due_date: string;
  total_due: string;
  principal_due: string;
  interest_due: string;
  principal_paid: string;
  interest_paid: string;
  late_fee_paid: string;
  balance: string;
  overdue_days: number;
  status: string;
}

interface Payment {
  id: number;
  received_date: string;
  amount: string;
  payment_method: string;
  status: string;
}

interface Adjustment {
  id: number;
  type: string;
  amount: string;
  paid_amount: string;
  reason: string;
  approved_by_name: string | null;
  created_at: string;
}

interface CollectionAction {
  id: number;
  action_type: string;
  description: string | null;
  promise_date: string | null;
  promise_status: string | null;
  status: string;
  created_at: string;
}

interface CreditDetail {
  id: number;
  credit_number: string;
  disbursed_amount: string;
  principal_balance: string;
  interest_rate: string;
  status: string;
  disbursement_date: string;
  moraCode: string | null;
  moraLabel: string | null;
  collector_name: string | null;
  seller_name: string | null;
  refinanced_from_credit_number: string | null;
  refinanced_to_credit_number: string | null;
  schedule: Installment[];
  payments: Payment[];
  alerts: Array<{ id: number; type: string; priority: string; message: string; status: string }>;
  adjustments: Adjustment[];
  collectionActions: CollectionAction[];
}

export default function CreditDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["credit", id],
    queryFn: () => api.get<CreditDetail>(`/credits/${id}`)
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Crédito {data.credit_number}</h1>
      <p className="mb-1 text-sm text-slate-400">
        Estado: {data.status} · Desembolsado: {formatDate(data.disbursement_date)}
        {data.moraCode && (
          <>
            {" "}
            ·{" "}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {data.moraCode} · {data.moraLabel}
            </span>
          </>
        )}
      </p>
      <p className="mb-4 text-sm text-slate-400">
        Gestor: {data.collector_name ?? "Sin asignar"} · Vendedor: {data.seller_name ?? "Sin asignar"}
        {data.refinanced_from_credit_number && <> · Refinanció a {data.refinanced_from_credit_number}</>}
        {data.refinanced_to_credit_number && <> · Refinanciado en {data.refinanced_to_credit_number}</>}
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Monto desembolsado" value={formatCurrency(data.disbursed_amount)} />
        <SummaryCard label="Saldo de capital" value={formatCurrency(data.principal_balance)} />
        <SummaryCard label="Tasa mensual fija" value={formatPercent(data.interest_rate)} />
      </div>

      {hasPermission("payments:write") && data.status !== "PAGADO" && data.status !== "ANULADO" && (
        <PaymentForm creditId={data.id} onRegistered={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })} />
      )}

      {hasPermission("disbursements:write") && ["VIGENTE", "EN_MORA"].includes(data.status) && (
        <RefinanceForm creditId={data.id} />
      )}

      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Cronograma de cuotas</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Vence</th>
              <th className="px-3 py-2">Cuota</th>
              <th className="px-3 py-2">Saldo</th>
              <th className="px-3 py-2">Atraso</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.schedule.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{row.installment_number}</td>
                <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                <td className="px-3 py-2">{formatCurrency(row.total_due)}</td>
                <td className="px-3 py-2">{formatCurrency(row.balance)}</td>
                <td className="px-3 py-2">{row.overdue_days > 0 ? `${row.overdue_days} días` : "—"}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Pagos registrados</h2>
        {data.payments.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Aún no se han registrado pagos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Medio</th>
                <th className="px-3 py-2">Estado</th>
                {hasPermission("payments:write") && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{formatDate(p.received_date)}</td>
                  <td className="px-3 py-2">{formatCurrency(p.amount)}</td>
                  <td className="px-3 py-2">{p.payment_method}</td>
                  <td className="px-3 py-2">{p.status}</td>
                  {hasPermission("payments:write") && (
                    <td className="px-3 py-2">
                      {p.status === "CONFIRMADO" && (
                        <ReverseButton
                          paymentId={p.id}
                          onDone={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Compromisos de pago</h2>
        {data.collectionActions.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400">Sin compromisos registrados.</p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm text-slate-600">
            {data.collectionActions.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span>
                  {formatDate(c.promise_date)}: {c.description ?? "Compromiso de pago"}{" "}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{c.promise_status ?? c.status}</span>
                </span>
                {hasPermission("collections:write") && c.promise_status === "PENDIENTE" && (
                  <ResolvePromiseButtons
                    actionId={c.id}
                    onDone={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {hasPermission("collections:write") && (
          <PromiseForm creditId={data.id} onCreated={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })} />
        )}
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Ajustes del crédito</h2>
        <p className="mb-2 text-xs text-slate-400">
          Intereses por cambio de fecha, descuentos o gastos de notificación, siempre con un responsable que autoriza.
        </p>
        {data.adjustments.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400">Sin ajustes registrados.</p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm text-slate-600">
            {data.adjustments.map((a) => {
              const collectable = a.type === "GASTO_NOTIFICACION" || a.type === "OTRO";
              const outstanding = Number(a.amount) - Number(a.paid_amount);
              return (
                <li key={a.id}>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{a.type}</span>{" "}
                  {formatCurrency(a.amount)} — {a.reason} (autorizó: {a.approved_by_name ?? "—"})
                  {collectable && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${outstanding <= 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {outstanding <= 0 ? "Cobrado" : `Pendiente ${formatCurrency(outstanding)}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hasPermission("adjustments:write") && (
          <AdjustmentForm creditId={data.id} onCreated={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })} />
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Alertas del crédito</h2>
        {data.alerts.length === 0 ? (
          <p className="text-sm text-slate-400">Sin alertas registradas.</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-600">
            {data.alerts.map((a) => (
              <li key={a.id}>
                [{a.status}] {a.priority} — {a.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function PaymentForm({ creditId, onRegistered }: { creditId: number; onRegistered: () => void }) {
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("TRANSFERENCIA");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/payments", {
        creditId,
        receivedDate,
        amount: Number(amount),
        paymentMethod
      });
      setAmount("");
      onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el pago");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Registrar pago o abono</h2>
      {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          type="date"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={receivedDate}
          onChange={(e) => setReceivedDate(e.target.value)}
        />
        <input
          type="number"
          min={1}
          required
          placeholder="Valor"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          {["EFECTIVO", "TRANSFERENCIA", "CONSIGNACION", "DESCUENTO_NOMINA"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {submitting ? "Registrando..." : "Registrar pago"}
      </button>
    </form>
  );
}

function PromiseForm({ creditId, onCreated }: { creditId: number; onCreated: () => void }) {
  const [promiseDate, setPromiseDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!promiseDate) {
      setError("Debe indicar la fecha del compromiso");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/credits/${creditId}/promises`, { promiseDate, description: description || undefined });
      setPromiseDate("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el compromiso");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      {error && <p className="w-full rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <input
        type="date"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={promiseDate}
        onChange={(e) => setPromiseDate(e.target.value)}
      />
      <input
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Nota del compromiso (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        Registrar compromiso
      </button>
    </form>
  );
}

function ResolvePromiseButtons({ actionId, onDone }: { actionId: number; onDone: () => void }) {
  async function resolve(fulfilled: boolean) {
    await api.post(`/credits/promises/${actionId}/resolve`, { fulfilled });
    onDone();
  }
  return (
    <span className="flex gap-2 text-xs">
      <button onClick={() => void resolve(true)} className="text-emerald-700 hover:underline">
        Cumplió
      </button>
      <button onClick={() => void resolve(false)} className="text-red-600 hover:underline">
        Incumplió
      </button>
    </span>
  );
}

function AdjustmentForm({ creditId, onCreated }: { creditId: number; onCreated: () => void }) {
  const [type, setType] = useState("GASTO_NOTIFICACION");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/credits/${creditId}/adjustments`, { type, amount: Number(amount), reason });
      setAmount("");
      setReason("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el ajuste");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      {error && <p className="sm:col-span-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <select
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        {["INTERES_CAMBIO_FECHA", "DESCUENTO", "GASTO_NOTIFICACION", "OTRO"].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        type="number"
        required
        placeholder="Valor"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        required
        placeholder="Motivo / autorización"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-1"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        Registrar ajuste
      </button>
    </form>
  );
}

function RefinanceForm({ creditId }: { creditId: number }) {
  const [open, setOpen] = useState(false);
  const [additionalCapital, setAdditionalCapital] = useState("0");
  const [termValue, setTermValue] = useState("12");
  const [interestRate, setInterestRate] = useState("4");
  const [firstInstallmentDate, setFirstInstallmentDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
        Refinanciar crédito
      </button>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstInstallmentDate || !reason) {
      setError("Debe indicar la fecha de la primera cuota y el motivo de la refinanciación");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<{ id: number }>(`/credits/${creditId}/refinance`, {
        additionalCapital: Number(additionalCapital),
        termValue: Number(termValue),
        interestRate: Number(interestRate),
        firstInstallmentDate,
        reason
      });
      window.location.href = `/creditos/${result.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al refinanciar");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Refinanciar crédito</h2>
      <p className="text-xs text-slate-400">
        El saldo pendiente del crédito actual se traslada al nuevo crédito, sumando el capital adicional que indiques.
      </p>
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Capital adicional</label>
          <input
            type="number"
            min={0}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={additionalCapital}
            onChange={(e) => setAdditionalCapital(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Nuevo plazo (meses)</label>
          <input
            type="number"
            min={1}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={termValue}
            onChange={(e) => setTermValue(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Nueva tasa mensual (%)</label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
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
      <input
        placeholder="Motivo de la refinanciación"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Procesando..." : "Confirmar refinanciación"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ReverseButton({ paymentId, onDone }: { paymentId: number; onDone: () => void }) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  async function reverse() {
    if (!reason) return;
    await api.post(`/payments/${paymentId}/reverse`, { reason });
    onDone();
  }

  if (!showReason) {
    return (
      <button onClick={() => setShowReason(true)} className="text-xs text-red-600 hover:underline">
        Reversar
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
        placeholder="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button onClick={() => void reverse()} className="text-xs text-red-600 hover:underline">
        Confirmar
      </button>
    </div>
  );
}
