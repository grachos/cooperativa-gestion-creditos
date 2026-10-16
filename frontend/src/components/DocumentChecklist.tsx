import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Loading, ErrorView } from "./StateViews";

interface ChecklistRow {
  document_type: string;
  held: boolean;
  notes: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
}

function Row({ row, canEdit, onSave, saving }: { row: ChecklistRow; canEdit: boolean; onSave: (held: boolean, notes: string) => void; saving: boolean }) {
  const [notes, setNotes] = useState(row.notes ?? "");
  return (
    <li className="rounded-lg border border-slate-100 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={row.held} disabled={!canEdit || saving} onChange={(e) => onSave(e.target.checked, notes)} />
          {row.document_type}
        </label>
        <span className={`rounded-full px-2 py-0.5 text-xs ${row.held ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
          {row.held ? "Lo tenemos" : "No lo tenemos"}
        </span>
      </div>
      {canEdit ? (
        <input
          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          placeholder="Nota (p. ej. dónde está archivado)"
          maxLength={255}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (row.notes ?? "") && onSave(row.held, notes)}
        />
      ) : (
        row.notes && <p className="mt-1 text-xs text-slate-500">{row.notes}</p>
      )}
      {row.checked_by_name && (
        <p className="mt-1 text-xs text-slate-400">
          Marcó: {row.checked_by_name}
          {row.checked_at ? ` · ${formatDateTime(row.checked_at)}` : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Lista de chequeo "lo tenemos / no lo tenemos" de documentos físicos. No sube archivos: solo deja constancia
 * de si el documento está en poder de la cooperativa, quién lo marcó y cuándo. La lista sale de un parámetro.
 */
export function DocumentChecklist({
  title,
  path,
  canEdit,
  hint
}: {
  title: string;
  path: string;
  canEdit: boolean;
  hint?: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["checklist", path];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => api.get<{ data: ChecklistRow[] }>(path) });
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { documentType: string; held: boolean; notes: string }) =>
      api.put(path, { documentType: body.documentType, held: body.held, notes: body.notes || undefined }),
    onSuccess: () => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : "No se pudo guardar")
  });

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">{title}</h2>
      {hint && <p className="mb-2 text-xs text-slate-400">{hint}</p>}
      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {saveError && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{saveError}</p>}
      {data && data.data.length === 0 && <p className="text-sm text-slate-400">No hay documentos en la lista (se configura en Parámetros).</p>}
      {data && data.data.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {data.data.filter((r) => r.held).length} de {data.data.length} documentos en poder de la cooperativa
          </p>
          <ul className="space-y-2">
            {data.data.map((r) => (
              <Row
                key={`${r.document_type}:${r.held}:${r.notes ?? ""}`}
                row={r}
                canEdit={canEdit}
                saving={save.isPending}
                onSave={(held, notes) => save.mutate({ documentType: r.document_type, held, notes })}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
