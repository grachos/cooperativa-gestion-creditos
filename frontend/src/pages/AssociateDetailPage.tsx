import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { useParameterList } from "../hooks/useParameterList";
import { phoneError, emailError, birthDateError } from "../lib/validators";

interface AssociateDetail {
  id: number;
  first_name: string;
  last_name: string;
  id_type: string;
  id_number: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  municipality: string | null;
  department: string | null;
  income_info: string | null;
  is_employed: boolean;
  employer_name: string | null;
  employer_address: string | null;
  employer_phone: string | null;
  employer_email: string | null;
  notes: string | null;
  status: string;
  credits: Array<{ id: number; credit_number: string; status: string; principal_balance: string }>;
  activeAlerts: Array<{ id: number; type: string; priority: string; message: string }>;
}

const DEFAULT_ID_TYPES = ["CC", "CE", "TI", "PA", "NIT"];

const STATUS_STYLES: Record<string, string> = {
  ACTIVO: "bg-emerald-50 text-emerald-700",
  INACTIVO: "bg-slate-100 text-slate-500",
  RECHAZADO: "bg-red-50 text-red-700"
};

function EditAssociateForm({ data, onDone }: { data: AssociateDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const idTypes = useParameterList("tipos_identificacion", DEFAULT_ID_TYPES);
  const [form, setForm] = useState({
    idType: data.id_type,
    idNumber: data.id_number,
    firstName: data.first_name,
    lastName: data.last_name,
    birthDate: data.birth_date ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    address: data.address ?? "",
    municipality: data.municipality ?? "",
    department: data.department ?? "",
    incomeInfo: data.income_info ?? "",
    isEmployed: data.is_employed,
    employerName: data.employer_name ?? "",
    employerAddress: data.employer_address ?? "",
    employerPhone: data.employer_phone ?? "",
    employerEmail: data.employer_email ?? "",
    notes: data.notes ?? ""
  });
  const [error, setError] = useState<string | null>(null);
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

  const update = useMutation({
    mutationFn: () =>
      api.put(`/associates/${data.id}`, {
        ...form,
        birthDate: form.birthDate || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        municipality: form.municipality || undefined,
        department: form.department || undefined,
        incomeInfo: form.incomeInfo || undefined,
        employerName: form.isEmployed ? form.employerName || undefined : null,
        employerAddress: form.isEmployed ? form.employerAddress || undefined : null,
        employerPhone: form.isEmployed ? form.employerPhone || undefined : null,
        employerEmail: form.isEmployed ? form.employerEmail || undefined : null,
        notes: form.notes || undefined
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["associate", String(data.id)] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Error al guardar el asociado")
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.values(fieldErrors).some(Boolean)) {
          setError("Corrija los campos marcados antes de guardar.");
          return;
        }
        update.mutate();
      }}
      className="mb-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
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
            required
            placeholder="Número de identificación"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
          />
          <input
            required
            placeholder="Nombres"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <input
            required
            placeholder="Apellidos"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <div>
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
              placeholder="Teléfono"
              className={`w-full rounded-md border px-3 py-2 text-sm ${fieldErrors.phone ? "border-red-400" : "border-slate-300"}`}
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
              placeholder="Correo"
              className={`w-full rounded-md border px-3 py-2 text-sm ${fieldErrors.email ? "border-red-400" : "border-slate-300"}`}
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
            placeholder="Dirección"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <input
            placeholder="Municipio"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.municipality}
            onChange={(e) => setForm({ ...form, municipality: e.target.value })}
          />
          <input
            placeholder="Departamento"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <input
            placeholder="Ingresos (información libre)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              placeholder="Empresa"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.employerName}
              onChange={(e) => setForm({ ...form, employerName: e.target.value })}
            />
            <input
              required
              placeholder="Dirección de la empresa"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.employerAddress}
              onChange={(e) => setForm({ ...form, employerAddress: e.target.value })}
            />
            <div>
              <input
                required
                placeholder="Teléfono de la empresa"
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  fieldErrors.employerPhone ? "border-red-400" : "border-slate-300"
                }`}
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
                placeholder="Correo de la empresa"
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  fieldErrors.employerEmail ? "border-red-400" : "border-slate-300"
                }`}
                value={form.employerEmail}
                onChange={(e) => setForm({ ...form, employerEmail: e.target.value })}
                onBlur={(e) => checkEmail("employerEmail", e.target.value)}
              />
              {fieldErrors.employerEmail && <p className="mt-1 text-xs text-red-600">{fieldErrors.employerEmail}</p>}
            </div>
          </div>
        </div>
      )}

      <textarea
        placeholder="Notas"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {update.isPending ? "Guardando..." : "Guardar cambios"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function AssociateDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("associates:write");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["associate", id],
    queryFn: () => api.get<AssociateDetail>(`/associates/${id}`)
  });

  const changeStatus = useMutation({
    mutationFn: (status: string) => api.post(`/associates/${id}/status`, { status }),
    onSuccess: () => {
      setStatusError(null);
      void queryClient.invalidateQueries({ queryKey: ["associate", id] });
    },
    onError: (err) => setStatusError(err instanceof Error ? err.message : "Error al cambiar el estado")
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-800">
          {data.first_name} {data.last_name}
        </h1>
        {canWrite && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Editar
          </button>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <span>
          {data.id_type} {data.id_number}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[data.status] ?? "bg-slate-100 text-slate-500"}`}>
          {data.status}
        </span>
        {canWrite && !editing && (
          <div className="flex gap-2">
            {data.status !== "ACTIVO" && (
              <button
                type="button"
                onClick={() => changeStatus.mutate("ACTIVO")}
                className="text-xs text-emerald-700 hover:underline"
              >
                Activar
              </button>
            )}
            {data.status !== "INACTIVO" && (
              <button
                type="button"
                onClick={() => changeStatus.mutate("INACTIVO")}
                className="text-xs text-slate-500 hover:underline"
              >
                Desactivar
              </button>
            )}
          </div>
        )}
      </div>
      {statusError && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{statusError}</p>}
      {data.status === "RECHAZADO" && (
        <p className="mb-4 rounded-md bg-red-50 p-2 text-xs text-red-700">
          Este asociado fue rechazado como participante en una solicitud de crédito y no puede elegirse como titular
          o codeudor en una solicitud nueva mientras conserve este estado.
        </p>
      )}

      {editing && <EditAssociateForm data={data} onDone={() => setEditing(false)} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Datos de contacto</h2>
          <p className="text-sm text-slate-600">Teléfono: {data.phone ?? "—"}</p>
          <p className="text-sm text-slate-600">Correo: {data.email ?? "—"}</p>
          <p className="text-sm text-slate-600">Dirección: {data.address ?? "—"}</p>
          <p className="text-sm text-slate-600">
            Ubicación: {data.municipality ?? "—"}, {data.department ?? "—"}
          </p>
          {data.income_info && <p className="text-sm text-slate-600">Ingresos: {data.income_info}</p>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Empresa donde trabaja</h2>
          {data.is_employed ? (
            <>
              <p className="text-sm text-slate-600">Empresa: {data.employer_name ?? "—"}</p>
              <p className="text-sm text-slate-600">Dirección: {data.employer_address ?? "—"}</p>
              <p className="text-sm text-slate-600">Teléfono: {data.employer_phone ?? "—"}</p>
              <p className="text-sm text-slate-600">Correo: {data.employer_email ?? "—"}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No aplica — el asociado no es empleado.</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Alertas activas</h2>
          {data.activeAlerts.length === 0 ? (
            <p className="text-sm text-slate-400">Sin alertas activas.</p>
          ) : (
            <ul className="space-y-1">
              {data.activeAlerts.map((a) => (
                <li key={a.id} className="text-sm text-slate-600">
                  <span className="font-medium">{a.priority}</span> — {a.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Créditos relacionados</h2>
        {data.credits.length === 0 ? (
          <p className="text-sm text-slate-400">Este asociado no tiene créditos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1">Número</th>
                <th className="py-1">Estado</th>
                <th className="py-1">Saldo capital</th>
              </tr>
            </thead>
            <tbody>
              {data.credits.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <Link to={`/creditos/${c.id}`} className="text-emerald-700 hover:underline">
                      {c.credit_number}
                    </Link>
                  </td>
                  <td className="py-1">{c.status}</td>
                  <td className="py-1">{formatCurrency(c.principal_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">Actualizado: {formatDate(new Date().toISOString())}</p>
    </div>
  );
}
