import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { formatCurrency } from "../lib/format";
import { useParameterList } from "../hooks/useParameterList";

export interface PaymentQuote {
  asOf: string;
  canNegotiate: boolean;
  creditStatus: string;
  mora: {
    mode: "SUGERIDO" | "AUTOMATICO";
    rateOrValue: number;
    rateType: string;
    graceDays: number;
    base: string;
    maxOverdueDays: number;
    items: Array<{ installmentId: number; installmentNumber: number; overdueDays: number; accrued: number; charged: number; pending: number }>;
    suggested: number;
  };
  notification: { enabled: boolean; amount: number; suggested: number };
  payoff: {
    enabled: boolean;
    defaultPercent: number;
    percent: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    futureInterest: number;
    discount: number;
    pendingCharges: number;
    total: number;
  };
}

/** Lo que el sistema sugiere cobrar en un pago a esa fecha (mora, gasto de notificación, cancelación anticipada). */
export function usePaymentQuote(creditId: number, date: string, discountPercent?: number) {
  return useQuery({
    queryKey: ["payment-quote", creditId, date, discountPercent ?? null],
    queryFn: () =>
      api.get<PaymentQuote>(
        `/payments/quote?creditId=${creditId}&date=${date}${discountPercent !== undefined ? `&discountPercent=${discountPercent}` : ""}`
      ),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    retry: false
  });
}

const money = (n: number) => formatCurrency(n);

/**
 * Mora y gasto de notificación sugeridos para el pago. Quien tiene permiso de ajustes decide cuánto cobrar
 * (por defecto lo sugerido; 0 = no cobrarlo); los demás solo ven lo sugerido.
 */
export function ChargesPanel({
  quote,
  mora,
  notification,
  onMora,
  onNotification
}: {
  quote: PaymentQuote;
  mora: string;
  notification: string;
  onMora: (v: string) => void;
  onNotification: (v: string) => void;
}) {
  const showMora = quote.mora.mode === "SUGERIDO" && quote.mora.suggested > 0;
  const showNotification = quote.notification.suggested > 0;
  if (!showMora && !showNotification) return null;
  const rateLabel =
    quote.mora.rateType === "DIARIA" ? `${quote.mora.rateOrValue}% por día de atraso` : `${quote.mora.rateOrValue}% de la cuota`;
  const input = "w-40 rounded-md border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
      <p className="mb-2 font-medium text-amber-800">Cobros sugeridos por atraso</p>
      {showMora && (
        <div className="mb-2">
          <p>
            Mora sugerida: <strong>{money(quote.mora.suggested)}</strong>{" "}
            <span className="text-xs text-slate-500">
              ({rateLabel}
              {quote.mora.graceDays > 0 ? `, después de ${quote.mora.graceDays} días de gracia` : ""})
            </span>
          </p>
          <ul className="ml-4 list-disc text-xs text-slate-500">
            {quote.mora.items.filter((i) => i.pending > 0).map((i) => (
              <li key={i.installmentId}>
                Cuota {i.installmentNumber}: {i.overdueDays} días de atraso → {money(i.pending)}
                {i.charged > 0 ? ` (ya se cobraron ${money(i.charged)})` : ""}
              </li>
            ))}
          </ul>
          {quote.canNegotiate && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              Mora a cobrar
              <input type="number" min={0} max={quote.mora.suggested} step="any" className={input} value={mora} onChange={(e) => onMora(e.target.value)} />
              <span>(0 = no cobrarla)</span>
            </label>
          )}
        </div>
      )}
      {showNotification && (
        <div>
          <p>
            Gasto de notificación sugerido: <strong>{money(quote.notification.suggested)}</strong>
          </p>
          {quote.canNegotiate && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              Gasto a cobrar
              <input type="number" min={0} max={quote.notification.amount} step="any" className={input} value={notification} onChange={(e) => onNotification(e.target.value)} />
              <span>(0 = no cobrarlo)</span>
            </label>
          )}
        </div>
      )}
      {!quote.canNegotiate && (
        <p className="mt-2 text-xs text-slate-500">
          El cobro de mora y gastos lo decide quien tiene el permiso de ajustes; este pago se registra sin ellos.
        </p>
      )}
    </div>
  );
}

/** Cancelación anticipada del crédito: muestra el total con el descuento y lo registra como un solo pago. */
export function EarlyPayoffForm({ creditId, onDone }: { creditId: number; onDone: () => void }) {
  const paymentMethods = useParameterList("metodos_pago", ["EFECTIVO", "TRANSFERENCIA", "CONSIGNACION", "DESCUENTO_NOMINA"]);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("TRANSFERENCIA");
  const [percent, setPercent] = useState<string>("");
  const [mora, setMora] = useState("");
  const [notification, setNotification] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { submit, pending } = useIdempotentSubmit(`payoff:${creditId}`);

  const percentValue = percent === "" ? undefined : Math.min(100, Math.max(0, Number(percent)));
  const { data: quote, isLoading } = usePaymentQuote(creditId, open ? date : "", percentValue);

  // Al cambiar la fecha, lo sugerido cambia: se vuelve a proponer.
  useEffect(() => {
    if (!quote) return;
    setMora(quote.mora.suggested > 0 ? String(quote.mora.suggested) : "");
    setNotification(quote.notification.suggested > 0 ? String(quote.notification.suggested) : "");
    if (percent === "" && quote.canNegotiate) setPercent(String(quote.payoff.defaultPercent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.asOf, quote?.mora.suggested, quote?.notification.suggested]);

  if (!open) {
    return (
      <div className="mb-4">
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          Cancelar el crédito por pago anticipado
        </button>
      </div>
    );
  }

  const moraAmount = quote?.canNegotiate ? Number(mora) || 0 : 0;
  const notificationAmount = quote?.canNegotiate ? Number(notification) || 0 : 0;
  const total = quote ? Math.round((quote.payoff.total + moraAmount + notificationAmount) * 100) / 100 : 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setError(null);
    const payload = {
      creditId,
      receivedDate: date,
      paymentMethod: method,
      verified,
      discountPercent: quote.canNegotiate ? percentValue : undefined,
      moraAmount: moraAmount || undefined,
      notificationAmount: notificationAmount || undefined,
      expectedTotal: total
    };
    try {
      const out = await submit(payload, (idempotencyKey) => api.post("/payments/early-payoff", payload, { idempotencyKey }));
      if (!out.ran) return;
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar el crédito");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Cancelar el crédito por pago anticipado</h2>
      {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
          {paymentMethods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {quote?.canNegotiate && quote.payoff.enabled && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Descuento %
            <input type="number" min={0} max={100} step="any" className="w-24 rounded-md border border-slate-300 px-2 py-2 text-sm" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        )}
      </div>
      {isLoading && <p className="text-sm text-slate-400">Calculando…</p>}
      {quote && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600 sm:max-w-md">
            <dt>Capital pendiente</dt>
            <dd className="text-right">{money(quote.payoff.outstandingPrincipal)}</dd>
            <dt>Interés pendiente</dt>
            <dd className="text-right">{money(quote.payoff.outstandingInterest)}</dd>
            <dt>Descuento por pago anticipado ({quote.payoff.percent}% del interés futuro)</dt>
            <dd className="text-right">−{money(quote.payoff.discount)}</dd>
            {quote.payoff.pendingCharges > 0 && (
              <>
                <dt>Cargos pendientes (mora y gastos ya cobrados)</dt>
                <dd className="text-right">{money(quote.payoff.pendingCharges)}</dd>
              </>
            )}
            {moraAmount > 0 && (
              <>
                <dt>Mora a cobrar</dt>
                <dd className="text-right">{money(moraAmount)}</dd>
              </>
            )}
            {notificationAmount > 0 && (
              <>
                <dt>Gasto de notificación</dt>
                <dd className="text-right">{money(notificationAmount)}</dd>
              </>
            )}
            <dt className="font-semibold text-slate-800">Total para cancelar</dt>
            <dd className="text-right font-semibold text-slate-800">{money(total)}</dd>
          </dl>
          {!quote.canNegotiate && (
            <p className="mt-2 text-xs text-slate-500">
              El descuento y el cobro de mora o gastos los define quien tiene el permiso de ajustes.
            </p>
          )}
          <ChargesPanel quote={quote} mora={mora} notification={notification} onMora={setMora} onNotification={setNotification} />
        </>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        Pago verificado en el banco y soporte archivado
      </label>
      <p className="mt-2 text-xs text-slate-400">Un pago de cancelación anticipada no se puede reversar desde la aplicación.</p>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending || !quote || total <= 0} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {pending ? "Registrando..." : `Confirmar cancelación por ${money(total)}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cerrar
        </button>
      </div>
    </form>
  );
}
