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

interface CreditDetail {
  id: number;
  credit_number: string;
  disbursed_amount: string;
  principal_balance: string;
  interest_rate: string;
  status: string;
  disbursement_date: string;
  schedule: Installment[];
  payments: Payment[];
  alerts: Array<{ id: number; type: string; priority: string; message: string; status: string }>;
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
      <p className="mb-4 text-sm text-slate-400">
        Estado: {data.status} · Desembolsado: {formatDate(data.disbursement_date)}
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Monto desembolsado" value={formatCurrency(data.disbursed_amount)} />
        <SummaryCard label="Saldo de capital" value={formatCurrency(data.principal_balance)} />
        <SummaryCard label="Tasa mensual" value={formatPercent(data.interest_rate)} />
      </div>

      {hasPermission("payments:write") && data.status !== "PAGADO" && data.status !== "ANULADO" && (
        <PaymentForm creditId={data.id} onRegistered={() => void queryClient.invalidateQueries({ queryKey: ["credit", id] })} />
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
