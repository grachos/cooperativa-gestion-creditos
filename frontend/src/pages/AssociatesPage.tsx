import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { useParameterList } from "../hooks/useParameterList";
import { phoneError, emailError, birthDateError } from "../lib/validators";

const DEFAULT_ID_TYPES = ["CC", "CE", "TI", "PA", "NIT"];

const STATUS_STYLES: Record<string, string> = {
  ACTIVO: "bg-brand-50 text-brand-700",
  INACTIVO: "bg-slate-100 text-slate-500",
  RECHAZADO: "bg-red-50 text-red-700"
};

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
            className="flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
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
        <>
          {/* Tarjetas en pantallas angostas: la tabla comprimida partía
              "CC" / número de identificación en dos líneas y se veía mal. */}
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {data.data.map((a) => (
              <Link
                key={a.id}
                to={`/asociados/${a.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-brand-700">
                    {a.first_name} {a.last_name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-500"}`}
                  >
                    {a.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  {a.id_type} {a.id_number}
                </p>
                <p className="text-sm text-slate-500">{a.phone ?? a.email ?? "—"}</p>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
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
                      <Link to={`/asociados/${a.id}`} className="font-medium text-brand-700 hover:underline">
                        {a.first_name} {a.last_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {a.id_type} {a.id_number}
                    </td>
                    <td className="px-4 py-2">{a.phone ?? a.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-500"}`}
                      >
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function NewAssociateForm({ onCreated }: { onCreated: () => void }) {
  const idTypes = useParameterList("tipos_identificacion", DEFAULT_ID_TYPES);
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
    isEmployed: false,
    employerName: "",
    employerAddress: "",
    employerPhone: "",
    employerEmail: "",
    dataConsent: false
  });
  const [error, setError] = useState<string | null>(null);
  const { submit, pending: submitting } = useIdempotentSubmit("associate:new");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  function checkPhone(name: "phone" | "employerPhone", value: string) {
    setFieldErrors((prev) => ({ ...prev, [name]: phoneError(value) }));
  }
  function checkEmail(name: "email" | "employerEmail", value: string) {
    setFieldErrors((prev) => ({ ...prev, [name]: emailError(value) }));
  }
  function checkBirthDate(value: string) {
    setFieldErrors((prev) => ({ ...prev, birthDate: birthDateError(value) }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (Object.values(fieldErrors).some(Boolean)) {
      setError("Corrija los campos marcados antes de guardar.");
      return;
    }
    const { address, municipality, department, incomeInfo, employerName, employerAddress, employerPhone, employerEmail, ...rest } =
      form;
    const payload = {
      ...rest,
      address: address || undefined,
      municipality: municipality || undefined,
      department: department || undefined,
      incomeInfo: incomeInfo || undefined,
      employerName: employerName || undefined,
      employerAddress: employerAddress || undefined,
      employerPhone: employerPhone || undefined,
      employerEmail: employerEmail || undefined
    };
    try {
      const out = await submit(payload, (idempotencyKey) => api.post("/associates", payload, { idempotencyKey }));
      if (!out.ran) return;
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear asociado");
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
            {idTypes.map((t) => (
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
              required
              type="date"
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.birthDate ? "border-red-400" : "border-slate-300"
              }`}
              value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              onBlur={(e) => checkBirthDate(e.target.value)}
            />
            {fieldErrors.birthDate && <p className="mt-1 text-xs text-red-600">{fieldErrors.birthDate}</p>}
          </div>
          <div>
            <input
              required
              className={`w-full rounded-md border px-3 py-2 text-sm ${fieldErrors.phone ? "border-red-400" : "border-slate-300"}`}
              placeholder="Teléfono de contacto"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={(e) => checkPhone("phone", e.target.value)}
            />
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
          </div>
          <div>
            <input
              required
              type="email"
              className={`w-full rounded-md border px-3 py-2 text-sm ${fieldErrors.email ? "border-red-400" : "border-slate-300"}`}
              placeholder="Correo"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              onBlur={(e) => checkEmail("email", e.target.value)}
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
          </div>
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
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">¿Es empleado?</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="radio"
              name="isEmployed"
              checked={form.isEmployed}
              onChange={() => setForm({ ...form, isEmployed: true })}
            />
            Sí
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="radio"
              name="isEmployed"
              checked={!form.isEmployed}
              onChange={() => {
                setFieldErrors((prev) => ({ ...prev, employerPhone: null, employerEmail: null }));
                setForm({
                  ...form,
                  isEmployed: false,
                  employerName: "",
                  employerAddress: "",
                  employerPhone: "",
                  employerEmail: ""
                });
              }}
            />
            No
          </label>
        </div>
      </div>

      {form.isEmployed && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Empresa donde trabaja</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Empresa"
              value={form.employerName}
              onChange={(e) => setForm({ ...form, employerName: e.target.value })}
            />
            <input
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Dirección de la empresa"
              value={form.employerAddress}
              onChange={(e) => setForm({ ...form, employerAddress: e.target.value })}
            />
            <div>
              <input
                required
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  fieldErrors.employerPhone ? "border-red-400" : "border-slate-300"
                }`}
                placeholder="Teléfono de la empresa"
                value={form.employerPhone}
                onChange={(e) => setForm({ ...form, employerPhone: e.target.value })}
                onBlur={(e) => checkPhone("employerPhone", e.target.value)}
              />
              {fieldErrors.employerPhone && <p className="mt-1 text-xs text-red-600">{fieldErrors.employerPhone}</p>}
            </div>
            <div>
              <input
                required
                type="email"
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  fieldErrors.employerEmail ? "border-red-400" : "border-slate-300"
                }`}
                placeholder="Correo de la empresa"
                value={form.employerEmail}
                onChange={(e) => setForm({ ...form, employerEmail: e.target.value })}
                onBlur={(e) => checkEmail("employerEmail", e.target.value)}
              />
              {fieldErrors.employerEmail && <p className="mt-1 text-xs text-red-600">{fieldErrors.employerEmail}</p>}
            </div>
          </div>
        </div>
      )}

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
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {submitting ? "Guardando..." : "Guardar asociado"}
      </button>
    </form>
  );
}
