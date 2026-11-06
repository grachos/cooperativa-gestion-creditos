import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { formatThousands } from "../lib/format";
import { useDefaultMonthlyRate } from "../hooks/useParameterList";
import { SearchCombobox, type ComboOption } from "../components/SearchCombobox";

interface AssociateOption {
  id: number;
  first_name: string;
  last_name: string;
  id_type: string;
  id_number: string;
}

/** Busca asociados activos por nombre, apellido o cédula (varias palabras) en el servidor. */
async function searchAssociates(query: string): Promise<ComboOption[]> {
  const q = query ? `&search=${encodeURIComponent(query)}` : "";
  const res = await api.get<{ data: AssociateOption[] }>(`/associates?pageSize=20&selectable=true${q}`);
  return res.data.map((a) => ({
    id: a.id,
    label: `${a.first_name} ${a.last_name}`,
    detail: `${a.id_type} ${a.id_number}`
  }));
}

export default function NewApplicationPage() {
  const navigate = useNavigate();
  const defaultMonthlyRate = useDefaultMonthlyRate();
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ data: Array<{ id: number; full_name: string }> }>("/users")
  });

  const [form, setForm] = useState({
    titularAssociateId: "",
    coDebtorAssociateIds: [] as string[],
    requestedAmount: "",
    termValue: "12",
    purpose: "",
    assignedSellerId: ""
  });
  const [error, setError] = useState<string | null>(null);
  const { submit, pending: pendingSubmit } = useIdempotentSubmit("application:new");
  // Tras crear la solicitud se navega: el botón sigue deshabilitado hasta entonces.
  const [navigating, setNavigating] = useState(false);
  const submitting = pendingSubmit || navigating;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.titularAssociateId) {
      setError("Seleccione el titular: escriba su nombre o cédula y elíjalo de la lista.");
      return;
    }
    if (!form.requestedAmount || Number(form.requestedAmount) <= 0) {
      setError("Indique un monto solicitado válido.");
      return;
    }
    const payload = {
      titularAssociateId: Number(form.titularAssociateId),
      coDebtorAssociateIds: form.coDebtorAssociateIds.filter(Boolean).map(Number),
      requestedAmount: Number(form.requestedAmount),
      termValue: Number(form.termValue),
      interestRate: defaultMonthlyRate,
      purpose: form.purpose || undefined,
      assignedSellerId: form.assignedSellerId ? Number(form.assignedSellerId) : undefined
    };
    try {
      const out = await submit(payload, (idempotencyKey) =>
        api.post<{ id: number }>("/applications", payload, { idempotencyKey })
      );
      if (!out.ran) return;
      setNavigating(true);
      navigate(`/solicitudes/${out.result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la solicitud");
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Nueva solicitud de crédito</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Titular</label>
          <SearchCombobox
            value={form.titularAssociateId}
            onChange={(id) => setForm({ ...form, titularAssociateId: id })}
            search={searchAssociates}
            placeholder="Escriba para buscar por nombre o cédula"
            ariaLabel="Titular"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700">Codeudores (opcional)</label>
            <button
              type="button"
              onClick={() => setForm({ ...form, coDebtorAssociateIds: [...form.coDebtorAssociateIds, ""] })}
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              + Agregar codeudor
            </button>
          </div>
          <div className="space-y-2">
            {form.coDebtorAssociateIds.map((value, slot) => (
              <div key={slot} className="flex gap-2">
                <div className="w-full">
                  <SearchCombobox
                    value={value}
                    onChange={(id) => {
                      const next = [...form.coDebtorAssociateIds];
                      next[slot] = id;
                      setForm({ ...form, coDebtorAssociateIds: next });
                    }}
                    search={searchAssociates}
                    placeholder="Escriba para buscar un codeudor"
                    ariaLabel={`Codeudor ${slot + 1}`}
                    excludeIds={[form.titularAssociateId, ...form.coDebtorAssociateIds.filter((_, i) => i !== slot)]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      coDebtorAssociateIds: form.coDebtorAssociateIds.filter((_, i) => i !== slot)
                    })
                  }
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
                  aria-label="Quitar codeudor"
                >
                  ✕
                </button>
              </div>
            ))}
            {form.coDebtorAssociateIds.length === 0 && (
              <p className="text-sm text-slate-400">Sin codeudores agregados.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Monto solicitado</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
              <input
                type="text"
                inputMode="numeric"
                required
                className="w-full rounded-md border border-slate-300 py-2 pl-7 pr-3 text-sm"
                value={form.requestedAmount ? formatThousands(Number(form.requestedAmount)) : ""}
                onChange={(e) => setForm({ ...form, requestedAmount: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Plazo (meses)</label>
            <input
              type="number"
              required
              min={1}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.termValue}
              onChange={(e) => setForm({ ...form, termValue: e.target.value })}
            />
          </div>
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-sm font-medium text-slate-700">
            Tasa mensual fija: {defaultMonthlyRate.toFixed(2)}% — interés simple sobre el capital, igual en cada cuota
          </p>
          <p className="text-xs text-slate-400">
            Definida en Parámetros → modelo_interes. Se aplica automáticamente, no es editable aquí.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Destino del crédito</label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Asesor que vendió el crédito</label>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.assignedSellerId}
            onChange={(e) => setForm({ ...form, assignedSellerId: e.target.value })}
          >
            <option value="">Sin asesor</option>
            {users?.data.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? "Guardando..." : "Radicar solicitud"}
        </button>
      </form>
    </div>
  );
}
