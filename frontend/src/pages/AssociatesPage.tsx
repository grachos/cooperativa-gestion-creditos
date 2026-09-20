import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface Associate {
  id: number;
  first_name: string;
  last_name: string;
  id_type: string;
  id_number: string;
  status: string;
  phone: string | null;
  email: string | null;
}

export default function AssociatesPage() {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["associates", search],
    queryFn: () => api.get<{ data: Associate[] }>(`/associates?search=${encodeURIComponent(search)}`)
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Asociados</h1>
        {hasPermission("associates:write") && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo asociado
          </button>
        )}
      </div>

      {showForm && (
        <NewAssociateForm
          onCreated={() => {
            setShowForm(false);
            void queryClient.invalidateQueries({ queryKey: ["associates"] });
          }}
        />
      )}

      <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <input
          className="w-full text-sm focus:outline-none"
          placeholder="Buscar por nombre o identificación"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar asociados"
        />
      </div>

      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {data && data.data.length === 0 && <EmptyView message="No se encontraron asociados." />}

      {data && data.data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Identificación</th>
                <th className="px-4 py-2">Contacto</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/asociados/${a.id}`} className="font-medium text-emerald-700 hover:underline">
                      {a.first_name} {a.last_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {a.id_type} {a.id_number}
                  </td>
                  <td className="px-4 py-2">{a.phone ?? a.email ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.status === "ACTIVO" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewAssociateForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    idType: "CC",
    idNumber: "",
    firstName: "",
    lastName: "",
    birthDate: "",
    phone: "",
    email: "",
    address: "",
    municipality: "",
    department: "",
    incomeInfo: "",
    employerName: "",
    employerAddress: "",
    employerPhone: "",
    employerEmail: "",
    dataConsent: false
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { birthDate, phone, email, address, municipality, department, incomeInfo, employerEmail, ...rest } = form;
      await api.post("/associates", {
        ...rest,
        birthDate: birthDate || undefined,
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        municipality: municipality || undefined,
        department: department || undefined,
        incomeInfo: incomeInfo || undefined,
        employerEmail: employerEmail || undefined
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear asociado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Datos personales</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.idType}
            onChange={(e) => setForm({ ...form, idType: e.target.value })}
          >
            {["CC", "CE", "TI", "PA", "NIT"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Número de identificación (cédula)"
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Nombres"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Apellidos"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            required
          />
          <div>
            <label className="mb-1 block text-xs text-slate-500">Fecha de nacimiento</label>
            <input
              type="date"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
            />
          </div>
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Teléfono de contacto"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Correo"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Domicilio</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
            placeholder="Dirección"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Municipio"
            value={form.municipality}
            onChange={(e) => setForm({ ...form, municipality: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Departamento"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Ingresos (información libre)"
            value={form.incomeInfo}
            onChange={(e) => setForm({ ...form, incomeInfo: e.target.value })}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Empresa donde trabaja</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Empresa"
            value={form.employerName}
            onChange={(e) => setForm({ ...form, employerName: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Dirección de la empresa"
            value={form.employerAddress}
            onChange={(e) => setForm({ ...form, employerAddress: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Teléfono de la empresa"
            value={form.employerPhone}
            onChange={(e) => setForm({ ...form, employerPhone: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Correo de la empresa"
            value={form.employerEmail}
            onChange={(e) => setForm({ ...form, employerEmail: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={form.dataConsent}
          onChange={(e) => setForm({ ...form, dataConsent: e.target.checked })}
        />
        El asociado autorizó el tratamiento de sus datos personales
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {submitting ? "Guardando..." : "Guardar asociado"}
      </button>
    </form>
  );
}
