import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface AssociateOption {
  id: number;
  first_name: string;
  last_name: string;
}

export default function NewApplicationPage() {
  const navigate = useNavigate();
  const { data: associates } = useQuery({
    queryKey: ["associates", "picker"],
    queryFn: () => api.get<{ data: AssociateOption[] }>("/associates?pageSize=100")
  });

  const [form, setForm] = useState({
    titularAssociateId: "",
    coDebtorAssociateId: "",
    requestedAmount: "",
    termValue: "12",
    interestRate: "1.8",
    purpose: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ id: number }>("/applications", {
        titularAssociateId: Number(form.titularAssociateId),
        coDebtorAssociateIds: form.coDebtorAssociateId ? [Number(form.coDebtorAssociateId)] : [],
        requestedAmount: Number(form.requestedAmount),
        termValue: Number(form.termValue),
        interestRate: Number(form.interestRate),
        purpose: form.purpose || undefined
      });
      navigate(`/solicitudes/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la solicitud");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Nueva solicitud de crédito</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Titular</label>
          <select
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.titularAssociateId}
            onChange={(e) => setForm({ ...form, titularAssociateId: e.target.value })}
          >
            <option value="">Seleccione un asociado</option>
            {associates?.data.map((a) => (
              <option key={a.id} value={a.id}>
                {a.first_name} {a.last_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Codeudor (opcional)</label>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.coDebtorAssociateId}
            onChange={(e) => setForm({ ...form, coDebtorAssociateId: e.target.value })}
          >
            <option value="">Sin codeudor</option>
            {associates?.data
              .filter((a) => String(a.id) !== form.titularAssociateId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.first_name} {a.last_name}
                </option>
              ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Monto solicitado</label>
            <input
              type="number"
              required
              min={1}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.requestedAmount}
              onChange={(e) => setForm({ ...form, requestedAmount: e.target.value })}
            />
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

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Tasa mensual (%) — demo, pendiente de confirmación definitiva
          </label>
          <input
            type="number"
            step="0.01"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.interestRate}
            onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Destino del crédito</label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Guardando..." : "Radicar solicitud"}
        </button>
      </form>
    </div>
  );
}
