import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Loading, ErrorView } from "../components/StateViews";
import { useAuth } from "../context/AuthContext";

interface Parameter {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

function ParameterCard({ parameter, canWrite }: { parameter: Parameter; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [valueText, setValueText] = useState(() => JSON.stringify(parameter.value, null, 2));
  const [description, setDescription] = useState(parameter.description ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["parameters"] });
  }

  const update = useMutation({
    mutationFn: (body: { value: unknown; description?: string; reason?: string }) =>
      api.put(`/parameters/${parameter.key}`, body),
    onSuccess: () => {
      setError(null);
      setEditing(false);
      setReason("");
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Error al guardar el parámetro")
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/parameters/${parameter.key}`),
    onSuccess: () => invalidate(),
    onError: (err) => setError(err instanceof Error ? err.message : "Error al eliminar el parámetro")
  });

  function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(valueText);
    } catch {
      setError("El valor debe ser JSON válido.");
      return;
    }
    update.mutate({ value: parsed, description: description || undefined, reason: reason || undefined });
  }

  function cancel() {
    setValueText(JSON.stringify(parameter.value, null, 2));
    setDescription(parameter.description ?? "");
    setReason("");
    setError(null);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">{parameter.key}</p>
        {canWrite && !editing && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Eliminar el parámetro "${parameter.key}"?`)) remove.mutate();
              }}
              disabled={remove.isPending}
              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Eliminar
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {!editing ? (
        <>
          {parameter.description && <p className="mb-2 text-xs text-slate-400">{parameter.description}</p>}
          <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600">
            {JSON.stringify(parameter.value, null, 2)}
          </pre>
        </>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
            <input
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Valor (JSON)</label>
            <textarea
              rows={6}
              className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Motivo del cambio (opcional)</label>
            <input
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {update.isPending ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewParameterForm() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [valueText, setValueText] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { key: string; value: unknown; description?: string }) => api.post("/parameters", body),
    onSuccess: () => {
      setKey("");
      setDescription("");
      setValueText("{}");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["parameters"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Error al crear el parámetro")
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(valueText);
    } catch {
      setError("El valor debe ser JSON válido.");
      return;
    }
    create.mutate({ key, value: parsed, description: description || undefined });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-700">Nuevo parámetro</p>
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Llave (minúsculas, números y guiones bajos)
        </label>
        <input
          required
          pattern="[a-z0-9_]+"
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
        <input
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Valor (JSON)</label>
        <textarea
          rows={5}
          className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {create.isPending ? "Creando..." : "Crear parámetro"}
      </button>
    </form>
  );
}

export default function ParametersPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("parameters:write");
  const [tab, setTab] = useState<"list" | "create">("list");

  const { data, isLoading, error } = useQuery({
    queryKey: ["parameters"],
    queryFn: () => api.get<Parameter[]>("/parameters")
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Parámetros del sistema</h1>
      <p className="mb-4 text-sm text-slate-400">
        Valores de configuración usados como referencia por la cooperativa. Los cambios quedan registrados en la
        auditoría.
      </p>

      {canWrite && (
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab("list")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "list" ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Parámetros
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
            Nuevo parámetro
          </button>
        </div>
      )}

      {(!canWrite || tab === "list") && (
        <div className="space-y-3">
          {data?.map((p) => (
            <ParameterCard key={p.key} parameter={p} canWrite={canWrite} />
          ))}
        </div>
      )}

      {canWrite && tab === "create" && <NewParameterForm />}
    </div>
  );
}
