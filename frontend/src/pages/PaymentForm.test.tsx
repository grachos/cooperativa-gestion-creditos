import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentForm } from "./CreditDetailPage";
import { idempotencyKeys } from "../lib/idempotency";
import { RETRY_POLICY } from "../lib/api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Pending {
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

let paymentCalls: { key: string | undefined; body: string }[];
let quoteBody: unknown = null; // null = el servidor no responde la sugerencia (404)
let pendingPayments: Pending[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  idempotencyKeys.reset();
  RETRY_POLICY.delaysMs = []; // sin reintentos automáticos: aquí se prueban los reintentos del usuario
  localStorage.setItem("accessToken", "tok");
  paymentCalls = [];
  pendingPayments = [];
  quoteBody = null;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/parameters")) return Promise.resolve(json(200, []));
    if (String(url).includes("/payments/quote")) return Promise.resolve(quoteBody ? json(200, quoteBody) : json(404, { error: "no" }));
    if (String(url).endsWith("/payments")) {
      const headers = init?.headers as Record<string, string>;
      paymentCalls.push({ key: headers["Idempotency-Key"], body: String(init?.body) });
      return new Promise<Response>((resolve, reject) => pendingPayments.push({ resolve, reject }));
    }
    return Promise.resolve(json(404, { error: "no" }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const onRegistered = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PaymentForm creditId={5} onRegistered={onRegistered} />
    </QueryClientProvider>
  );
  return { onRegistered };
}

const button = () => screen.getByRole("button", { name: /Registr/ }) as HTMLButtonElement;
const amountInput = () => screen.getByPlaceholderText("Valor") as HTMLInputElement;
const settle = (i: number, res: Response) => act(async () => pendingPayments[i]!.resolve(res));

describe("PaymentForm: doble envío", () => {
  it("un doble clic dispara una sola petición y el botón muestra el estado de carga", async () => {
    const user = userEvent.setup();
    const { onRegistered } = setup();
    await user.type(amountInput(), "5000");

    await user.dblClick(button());

    expect(paymentCalls).toHaveLength(1);
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(button().textContent).toBe("Registrando...");

    await settle(0, json(201, { paymentId: 1 }));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(button().textContent).toBe("Registrar pago");
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(amountInput().value).toBe(""); // formulario limpio tras el éxito
  });

  it("dos envíos del formulario en el mismo tick (Enter repetido) no dependen del botón deshabilitado", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountInput(), "5000");
    const form = amountInput().closest("form")!;

    // Sin esperar a que React vuelva a renderizar: solo el guard síncrono puede frenar el segundo.
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(paymentCalls).toHaveLength(1);
    await settle(0, json(201, {}));
  });

  it("tras un error el botón se recupera, se muestra el error y el reintento reutiliza la misma clave", async () => {
    const user = userEvent.setup();
    const { onRegistered } = setup();
    await user.type(amountInput(), "5000");

    await user.click(button());
    expect(paymentCalls).toHaveLength(1);
    await act(async () => pendingPayments[0]!.reject(new TypeError("Failed to fetch")));

    await waitFor(() => expect(button().disabled).toBe(false));
    expect(screen.getByText("Failed to fetch")).toBeTruthy();
    expect(onRegistered).not.toHaveBeenCalled();
    expect(amountInput().value).toBe("5000"); // el usuario conserva lo escrito

    await user.click(button());
    expect(paymentCalls).toHaveLength(2);
    expect(paymentCalls[1]!.key).toBe(paymentCalls[0]!.key); // misma operación => misma clave
    expect(paymentCalls[1]!.body).toBe(paymentCalls[0]!.body);
    await settle(1, json(201, {}));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
  });

  it("si el usuario corrige el contenido tras un error, se usa una clave nueva", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountInput(), "5000");
    await user.click(button());
    await act(async () => pendingPayments[0]!.resolve(json(400, { error: "Datos inválidos" })));
    await waitFor(() => expect(button().disabled).toBe(false));

    await user.clear(amountInput());
    await user.type(amountInput(), "6000");
    await user.click(button());

    expect(paymentCalls).toHaveLength(2);
    expect(paymentCalls[1]!.key).not.toBe(paymentCalls[0]!.key);
    await settle(1, json(201, {}));
  });

  it("después de un éxito, un pago nuevo e intencional recibe una clave nueva", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountInput(), "5000");
    await user.click(button());
    await settle(0, json(201, {}));
    await waitFor(() => expect(button().disabled).toBe(false));

    await user.type(amountInput(), "5000"); // mismo valor, pero es otra acción
    await user.click(button());

    expect(paymentCalls).toHaveLength(2);
    expect(paymentCalls[1]!.key).not.toBe(paymentCalls[0]!.key);
    await settle(1, json(201, {}));
  });

  it("recuperar la página con el mismo contenido reutiliza la clave de la operación pendiente", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountInput(), "5000");
    await user.click(button());
    const firstKey = paymentCalls[0]!.key;
    // la página se recarga con la petición sin respuesta: se pierde la memoria, no sessionStorage
    const stored = sessionStorage.getItem("idem:payment:5")!;
    expect(stored).toBeTruthy();
    cleanup();
    idempotencyKeys.reset();
    sessionStorage.setItem("idem:payment:5", stored);

    const user2 = userEvent.setup();
    setup();
    await user2.type(amountInput(), "5000");
    await user2.click(button());
    expect(paymentCalls[1]!.key).toBe(firstKey);
  });
});

describe("PaymentForm: pago verificado", () => {
  it("envía verified=false por defecto y verified=true si se marca la casilla", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountInput(), "1000");
    await user.click(button());
    await waitFor(() => expect(paymentCalls).toHaveLength(1));
    expect(JSON.parse(paymentCalls[0]!.body).verified).toBe(false);
    await settle(0, json(201, { paymentId: 1 }));

    await user.type(amountInput(), "2000");
    await user.click(screen.getByLabelText(/verificado en el banco/i));
    await user.click(button());
    await waitFor(() => expect(paymentCalls).toHaveLength(2));
    expect(JSON.parse(paymentCalls[1]!.body).verified).toBe(true);
  });
});

const quoteWith = (canNegotiate: boolean) => ({
  asOf: new Date().toISOString().slice(0, 10),
  canNegotiate,
  creditStatus: "EN_MORA",
  mora: {
    mode: "SUGERIDO", rateOrValue: 0.05, rateType: "DIARIA", graceDays: 8, base: "CUOTA_VENCIDA", maxOverdueDays: 40,
    items: [{ installmentId: 1, installmentNumber: 1, overdueDays: 40, accrued: 4000, charged: 0, pending: 4000 }],
    suggested: 4000
  },
  notification: { enabled: true, amount: 100000, suggested: 100000 },
  payoff: { enabled: true, defaultPercent: 50, percent: 50, outstandingPrincipal: 0, outstandingInterest: 0, futureInterest: 0, discount: 0, pendingCharges: 0, total: 0 }
});

describe("PaymentForm: mora y gasto de notificación sugeridos", () => {
  it("quien puede negociar ve la mora sugerida, puede bajarla y se envía lo decidido", async () => {
    quoteBody = quoteWith(true);
    const user = userEvent.setup();
    setup();
    await screen.findByText(/Mora sugerida/);
    const moraInput = (await screen.findByLabelText(/Mora a cobrar/)) as HTMLInputElement;
    expect(moraInput.value).toBe("4000");
    await user.clear(moraInput);
    await user.type(moraInput, "2500");
    await user.type(amountInput(), "50000");
    await user.click(button());
    await waitFor(() => expect(paymentCalls).toHaveLength(1));
    const body = JSON.parse(paymentCalls[0]!.body);
    expect(body.moraAmount).toBe(2500);
    expect(body.notificationAmount).toBe(100000);
  });

  it("0 significa no cobrar la mora: no se envía el cargo", async () => {
    quoteBody = quoteWith(true);
    const user = userEvent.setup();
    setup();
    const moraInput = (await screen.findByLabelText(/Mora a cobrar/)) as HTMLInputElement;
    await user.clear(moraInput);
    await user.type(moraInput, "0");
    await user.clear(screen.getByLabelText(/Gasto a cobrar/));
    await user.type(amountInput(), "50000");
    await user.click(button());
    await waitFor(() => expect(paymentCalls).toHaveLength(1));
    const body = JSON.parse(paymentCalls[0]!.body);
    expect(body.moraAmount).toBeUndefined();
    expect(body.notificationAmount).toBeUndefined();
  });

  it("quien no tiene permiso de ajustes la ve pero no la decide, y no se envía ningún cargo", async () => {
    quoteBody = quoteWith(false);
    const user = userEvent.setup();
    setup();
    await screen.findByText(/Mora sugerida/);
    expect(screen.queryByLabelText(/Mora a cobrar/)).toBeNull();
    expect(screen.getByText(/lo decide quien tiene el permiso de ajustes/i)).toBeTruthy();
    await user.type(amountInput(), "50000");
    await user.click(button());
    await waitFor(() => expect(paymentCalls).toHaveLength(1));
    const body = JSON.parse(paymentCalls[0]!.body);
    expect(body.moraAmount).toBeUndefined();
  });
});
