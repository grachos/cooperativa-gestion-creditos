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
let pendingPayments: Pending[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  idempotencyKeys.reset();
  RETRY_POLICY.delaysMs = []; // sin reintentos automáticos: aquí se prueban los reintentos del usuario
  localStorage.setItem("accessToken", "tok");
  paymentCalls = [];
  pendingPayments = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/parameters")) return Promise.resolve(json(200, []));
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
