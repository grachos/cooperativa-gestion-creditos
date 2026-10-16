import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";
import { useParameterList } from "../hooks/useParameterList";
import { useIdempotentSubmit } from "../hooks/useIdempotentSubmit";
import { PasswordInput } from "../components/PasswordInput";
import { TabBar, CrossfadePanels } from "../components/Tabs";

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
  permissions: string[];
  id_type: string | null;
  id_number: string | null;
  phone: string | null;
  address: string | null;
}

const DEFAULT_ID_TYPES = ["CC", "CE", "TI", "PA", "NIT"];

interface Role {
  code: string;
  name: string;
}

interface PermissionModule {
  module: string;
  label: string;
  actions: Array<{ code: string; label: string }>;
}

/**
 * Permisos de un usuario, módulo por módulo: una casilla por acción (ver, crear, editar, aprobar…).
 * Parte viene de su rol; lo que se marca o desmarca aquí solo afecta a este usuario.
 */
export function PermissionsPanel({ user, catalog, onSaved }: { user: ManagedUser; catalog: PermissionModule[]; onSaved: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(user.permissions);
  const [error, setError] = useState<string | null>(null);

  // Si los datos del usuario se recargan (por ejemplo, tras guardar), la selección se sincroniza.
  useEffect(() => setSelected(user.permissions), [user.permissions]);

  const save = useMutation({
    mutationFn: () => api.put(`/users/${user.id}/permissions`, { permissions: selected }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onSaved("Permisos guardados. La persona los verá al volver a entrar (o en máximo 15 minutos).");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "No se pudieron guardar los permisos")
  });

  const changed = selected.length !== user.permissions.length || selected.some((p) => !user.permissions.includes(p));
  const toggle = (code: string) => setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  const setModule = (m: PermissionModule, on: boolean) =>
    setSelected((prev) => {
      const without = prev.filter((c) => !m.actions.some((a) => a.code === c));
      return on ? [...without, ...m.actions.map((a) => a.code)] : without;
    });

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
        {open ? "Ocultar permisos" : `Permisos por módulo (${user.permissions.length})`}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-3 text-xs text-slate-500">
            Marque lo que esta persona puede hacer en cada módulo. Parte de los permisos viene de su rol; los cambios que
            haga aquí valen solo para este usuario.
          </p>
          {error && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {catalog.map((m) => {
              const count = m.actions.filter((a) => selected.includes(a.code)).length;
              return (
                <fieldset key={m.module} className="rounded-md border border-slate-200 bg-white p-2">
                  <legend className="px-1 text-xs font-semibold text-slate-700">
                    {m.label} <span className="font-normal text-slate-400">({count}/{m.actions.length})</span>
                  </legend>
                  <div className="mb-1 flex gap-3 text-xs">
                    <button type="button" onClick={() => setModule(m, true)} className="text-brand-700 hover:underline">
                      Todo
                    </button>
                    <button type="button" onClick={() => setModule(m, false)} className="text-slate-500 hover:underline">
                      Ninguno
                    </button>
                  </div>
                  {m.actions.map((a) => (
                    <label key={a.code} className="flex items-start gap-2 py-0.5 text-xs text-slate-700">
                      <input type="checkbox" className="mt-0.5" checked={selected.includes(a.code)} onChange={() => toggle(a.code)} />
                      {a.label}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
            className="mt-3 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {save.isPending ? "Guardando..." : "Guardar permisos"}
          </button>
        </div>
      )}
    </div>
  );
}

function EditUserRow({ user, roles, permissionCatalog }: { user: ManagedUser; roles: Role[]; permissionCatalog: PermissionModule[] }) {
  const idTypes = useParameterList("tipos_identificacion", DEFAULT_ID_TYPES);
  const queryClient = useQueryClient();
  const [roleCodes, setRoleCodes] = useState(user.role_codes);
  const [newPassword, setNewPassword] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowSuccess, setRowSuccess] = useState<string | null>(null);
  const [contact, setContact] = useState({
    fullName: user.full_name ?? "",
    email: user.email ?? "",
    idType: user.id_type ?? "",
    idNumber: user.id_number ?? "",
    phone: user.phone ?? "",
    address: user.address ?? ""
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  function showSuccess(message: string) {
    setRowError(null);
    setRowSuccess(message);
    setTimeout(() => setRowSuccess((current) => (current === message ? null : current)), 3000);
  }

  const patchUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/users/${user.id}`, body),
    onError: (err) => {
      setRowSuccess(null);
      setRowError(err instanceof Error ? err.message : "Error al actualizar el usuario");
    }
  });

  function saveRoles() {
    patchUser.mutate(
      { roleCodes },
      {
        onSuccess: () => {
          invalidate();
          showSuccess("Roles guardados correctamente.");
        }
      }
    );
  }

  function saveContact() {
    patchUser.mutate(
      {
        fullName: contact.fullName.trim() || undefined,
        email: contact.email.trim() || undefined,
        idType: contact.idType || undefined,
        idNumber: contact.idNumber || undefined,
        phone: contact.phone || undefined,
        address: contact.address || undefined
      },
      {
        onSuccess: () => {
          invalidate();
          showSuccess("Datos guardados correctamente.");
        }
      }
    );
  }

  function resetPassword() {
    patchUser.mutate(
      { password: newPassword },
      {
        onSuccess: () => {
          invalidate();
          setNewPassword("");
          showSuccess("Contraseña restablecida correctamente.");
        }
      }
    );
  }

  function toggleStatus() {
    patchUser.mutate(
      { status: user.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" },
      {
        onSuccess: () => {
          invalidate();
          showSuccess(user.status === "ACTIVO" ? "Usuario desactivado." : "Usuario activado.");
        }
      }
    );
  }

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
          onClick={toggleStatus}
          disabled={patchUser.isPending}
          className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50 ${
            user.status === "ACTIVO"
              ? "bg-brand-50 text-brand-700 hover:bg-brand-100"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {user.status === "ACTIVO" ? "Activo" : "Inactivo"}
        </button>
      </div>

      {rowError && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{rowError}</p>}
      {rowSuccess && <p className="mb-2 rounded-md bg-emerald-50 p-2 text-xs text-emerald-700">{rowSuccess}</p>}

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
          onClick={saveRoles}
          disabled={patchUser.isPending}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {patchUser.isPending ? "Guardando..." : "Guardar roles"}
        </button>
      </div>

      <PermissionsPanel user={user} catalog={permissionCatalog} onSaved={showSuccess} />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          placeholder="Nombre completo"
          autoComplete="off"
          value={contact.fullName}
          onChange={(e) => setContact({ ...contact, fullName: e.target.value })}
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <input
          type="email"
          placeholder="Correo"
          autoComplete="off"
          value={contact.email}
          onChange={(e) => setContact({ ...contact, email: e.target.value })}
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={contact.idType}
          onChange={(e) => setContact({ ...contact, idType: e.target.value })}
        >
          <option value="">Tipo ID</option>
          {idTypes.map((t) => (
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
          onClick={saveContact}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {patchUser.isPending ? "Guardando..." : "Guardar datos"}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <PasswordInput
          placeholder="Nueva contraseña (mínimo 8)"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          wrapperClassName="w-56"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={newPassword.length < 8 || patchUser.isPending}
          onClick={resetPassword}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {patchUser.isPending ? "Guardando..." : "Restablecer contraseña"}
        </button>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const idTypes = useParameterList("tipos_identificacion", DEFAULT_ID_TYPES);
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
  const { data: permissionCatalog } = useQuery({
    queryKey: ["users", "permissions"],
    queryFn: () => api.get<{ data: PermissionModule[] }>("/users/permissions"),
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

  const { submit: submitCreate, pending: creating } = useIdempotentSubmit("user:new");
  const createUser = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        idType: form.idType || undefined,
        idNumber: form.idNumber || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined
      };
      return submitCreate(payload, (idempotencyKey) => api.post("/users", payload, { idempotencyKey }));
    },
    onSuccess: (out) => {
      if (!out.ran) return; // envío duplicado ignorado
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
          Un "Gestor de cartera" o "Asesor" asignable a un crédito es un usuario del sistema — créelo aquí para
          poder seleccionarlo luego en el desembolso.
        </p>
      </div>

      {canWrite && (
        <TabBar
          tabs={[
            { key: "manage", label: "Consultar y editar" },
            { key: "create", label: "Crear usuario" }
          ]}
          active={tab}
          onChange={setTab}
        />
      )}

      <CrossfadePanels activeKey={canWrite ? tab : "manage"}>
        {(k) => (
          <>
      {(!canWrite || k === "manage") && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            {canWrite ? "Usuarios (roles, permisos por módulo, contraseña)" : "Usuarios activos"}
          </p>
          {canWrite ? (
            <div className="space-y-2">
              {managed?.data.map((u) => (
                <EditUserRow key={u.id} user={u} roles={roles?.data ?? []} permissionCatalog={permissionCatalog?.data ?? []} />
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

      {canWrite && k === "create" && (
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
                {idTypes.map((t) => (
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
            <PasswordInput
              required
              minLength={8}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Roles (opcional — déjelo vacío si solo será asignado como gestor/asesor, sin acceso al sistema)
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
            disabled={createUser.isPending || creating}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createUser.isPending || creating ? "Guardando..." : "Crear usuario"}
          </button>
        </form>
      )}
          </>
        )}
      </CrossfadePanels>
    </div>
  );
}
