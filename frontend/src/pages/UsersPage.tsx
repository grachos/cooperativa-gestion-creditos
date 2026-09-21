import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface UserRow {
  id: number;
  full_name: string;
  email: string;
}

interface ManagedUser {
  id: number;
  full_name: string;
  email: string;
  username: string;
  status: "ACTIVO" | "INACTIVO";
  role_codes: string[];
  id_type: string | null;
  id_number: string | null;
  phone: string | null;
  address: string | null;
}

const ID_TYPES = ["CC", "CE", "TI", "PA", "NIT"];

interface Role {
  code: string;
  name: string;
}

function EditUserRow({ user, roles }: { user: ManagedUser; roles: Role[] }) {
  const queryClient = useQueryClient();
  const [roleCodes, setRoleCodes] = useState(user.role_codes);
  const [newPassword, setNewPassword] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [contact, setContact] = useState({
    idType: user.id_type ?? "",
    idNumber: user.id_number ?? "",
    phone: user.phone ?? "",
    address: user.address ?? ""
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const patchUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/users/${user.id}`, body),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (err) => setRowError(err instanceof Error ? err.message : "Error al actualizar el usuario")
  });

  function toggleRole(code: string) {
    setRoleCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">{user.full_name}</p>
          <p className="text-xs text-slate-400">
            {user.email} · {user.username}
          </p>
        </div>
        <button
          type="button"
          onClick={() => patchUser.mutate({ status: user.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" })}
          className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium ${
            user.status === "ACTIVO"
              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {user.status === "ACTIVO" ? "Activo" : "Inactivo"}
        </button>
      </div>

      {rowError && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{rowError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <label key={r.code} className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={roleCodes.includes(r.code)} onChange={() => toggleRole(r.code)} />
              {r.name}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => patchUser.mutate({ roleCodes })}
          disabled={patchUser.isPending}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Guardar roles
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={contact.idType}
          onChange={(e) => setContact({ ...contact, idType: e.target.value })}
        >
          <option value="">Tipo ID</option>
          {ID_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          placeholder="Número de identificación"
          value={contact.idNumber}
          onChange={(e) => setContact({ ...contact, idNumber: e.target.value })}
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          placeholder="Teléfono"
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          placeholder="Dirección"
          value={contact.address}
          onChange={(e) => setContact({ ...contact, address: e.target.value })}
          className="w-48 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={patchUser.isPending}
          onClick={() =>
            patchUser.mutate({
              idType: contact.idType || undefined,
              idNumber: contact.idNumber || undefined,
              phone: contact.phone || undefined,
              address: contact.address || undefined
            })
          }
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Guardar datos
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="password"
          placeholder="Nueva contraseña (mínimo 8)"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={newPassword.length < 8 || patchUser.isPending}
          onClick={() => {
            patchUser.mutate({ password: newPassword });
            setNewPassword("");
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Restablecer contraseña
        </button>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = hasPermission("users:write");

  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ data: UserRow[] }>("/users"),
    enabled: !canWrite
  });
  const { data: managed, isLoading: isLoadingManaged, error: managedError } = useQuery({
    queryKey: ["users", "manage"],
    queryFn: () => api.get<{ data: ManagedUser[] }>("/users/manage"),
    enabled: canWrite
  });
  const { data: roles } = useQuery({
    queryKey: ["users", "roles"],
    queryFn: () => api.get<{ data: Role[] }>("/users/roles"),
    enabled: canWrite
  });

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    username: "",
    password: "",
    idType: "",
    idNumber: "",
    phone: "",
    address: "",
    roleCodes: [] as string[]
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: () =>
      api.post("/users", {
        ...form,
        idType: form.idType || undefined,
        idNumber: form.idNumber || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined
      }),
    onSuccess: () => {
      setForm({
        fullName: "",
        email: "",
        username: "",
        password: "",
        idType: "",
        idNumber: "",
        phone: "",
        address: "",
        roleCodes: []
      });
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Error al crear el usuario")
  });

  function toggleFormRole(code: string) {
    setForm((f) => ({
      ...f,
      roleCodes: f.roleCodes.includes(code) ? f.roleCodes.filter((c) => c !== code) : [...f.roleCodes, code]
    }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createUser.mutate();
  }

  const [tab, setTab] = useState<"manage" | "create">("manage");

  if (isLoading || isLoadingManaged) return <Loading />;
  if (error || managedError) return <ErrorView message={((error ?? managedError) as Error).message} />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold text-slate-800">Usuarios del sistema</h1>
        <p className="text-sm text-slate-400">
          Un "Gestor de cartera" o "Vendedor" asignable a un crédito es un usuario del sistema — créelo aquí para
          poder seleccionarlo luego en el desembolso.
        </p>
      </div>

      {canWrite && (
        <div className="flex gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab("manage")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "manage"
                ? "border-b-2 border-emerald-600 text-emerald-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Consultar y editar
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "create"
                ? "border-b-2 border-emerald-600 text-emerald-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Crear usuario
          </button>
        </div>
      )}

      {(!canWrite || tab === "manage") && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            {canWrite ? "Usuarios (activar/desactivar, roles, contraseña)" : "Usuarios activos"}
          </p>
          {canWrite ? (
            <div className="space-y-2">
              {managed?.data.map((u) => (
                <EditUserRow key={u.id} user={u} roles={roles?.data ?? []} />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data?.data.map((u) => (
                <li key={u.id} className="py-2 text-sm text-slate-600">
                  {u.full_name} <span className="text-slate-400">— {u.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canWrite && tab === "create" && (
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">Nuevo usuario</p>
          {formError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{formError}</p>}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre completo</label>
            <input
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
              <input
                type="email"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Usuario</label>
              <input
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo ID</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.idType}
                onChange={(e) => setForm({ ...form, idType: e.target.value })}
              >
                <option value="">—</option>
                {ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Número de identificación</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.idNumber}
                onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dirección</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña (mínimo 8 caracteres)</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Roles (opcional — déjelo vacío si solo será asignado como gestor/vendedor, sin acceso al sistema)
            </label>
            <div className="flex flex-wrap gap-3">
              {roles?.data.map((r) => (
                <label key={r.code} className="flex items-center gap-1 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.roleCodes.includes(r.code)}
                    onChange={() => toggleFormRole(r.code)}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={createUser.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {createUser.isPending ? "Guardando..." : "Crear usuario"}
          </button>
        </form>
      )}
    </div>
  );
}
