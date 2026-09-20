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

interface Role {
  code: string;
  name: string;
}

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = hasPermission("users:write");

  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ data: UserRow[] }>("/users")
  });
  const { data: roles } = useQuery({
    queryKey: ["users", "roles"],
    queryFn: () => api.get<{ data: Role[] }>("/users/roles"),
    enabled: canWrite
  });

  const [form, setForm] = useState({ fullName: "", email: "", username: "", password: "", roleCodes: [] as string[] });
  const [formError, setFormError] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: () => api.post("/users", form),
    onSuccess: () => {
      setForm({ fullName: "", email: "", username: "", password: "", roleCodes: [] });
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Error al crear el usuario")
  });

  function toggleRole(code: string) {
    setForm((f) => ({
      ...f,
      roleCodes: f.roleCodes.includes(code) ? f.roleCodes.filter((c) => c !== code) : [...f.roleCodes, code]
    }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createUser.mutate();
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold text-slate-800">Usuarios del sistema</h1>
        <p className="text-sm text-slate-400">
          Un "Gestor de cartera" o "Vendedor" asignable a un crédito es un usuario del sistema — créelo aquí para
          poder seleccionarlo luego en el desembolso.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Usuarios activos</p>
        <ul className="divide-y divide-slate-100">
          {data?.data.map((u) => (
            <li key={u.id} className="py-2 text-sm text-slate-600">
              {u.full_name} <span className="text-slate-400">— {u.email}</span>
            </li>
          ))}
        </ul>
      </div>

      {canWrite && (
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
                    onChange={() => toggleRole(r.code)}
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
