import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadFile } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { Pagination } from "../components/ListControls";

interface AuditRow {
  id: number;
  created_at: string;
  user_name: string | null;
  entity: string;
  entity_id: string;
  action: string;
  reason: string | null;
}

interface Filters {
  actions: string[];
  entities: string[];
  users: Array<{ id: number; full_name: string }>;
}

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Creó",
  UPDATE: "Modificó",
  DELETE: "Eliminó",
  APPROVE: "Aprobó",
  REJECT: "Rechazó",
  DISBURSE: "Desembolsó",
  REVERSE: "Reversó",
  VERIFY: "Verificó pago",
  UNVERIFY: "Quitó verificación",
  REVIEW_START: "Inició revisión",
  DOCUMENT_REVIEW: "Revisó documento",
  PARTICIPANT_REVIEW: "Revisó participante",
  REFERENCE_CHECK: "Verificó referencia",
  PROMISE_CREATED: "Registró compromiso",
  PERMISSIONS_UPDATE: "Cambió permisos",
  STATUS_CHANGE: "Cambió estado"
};

const ENTITY_LABELS: Record<string, string> = {
  credit_application: "Solicitud",
  credit: "Crédito",
  payment: "Pago",
  associate: "Asociado",
  user: "Usuario",
  parameter: "Parámetro",
  collection_action: "Compromiso"
};

/** "Actividad por usuario": quién hizo qué y cuándo (auditoría), filtrable y exportable. */
export default function ActivityPage() {
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => setPage(1), [userId, action, entity, from, to]);

  const qs = new URLSearchParams();
  if (userId) qs.set("userId", userId);
  if (action) qs.set("action", action);
  if (entity) qs.set("entity", entity);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  const { data: filters } = useQuery({ queryKey: ["audit-filters"], queryFn: () => api.get<Filters>("/audit/filters") });
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", qs.toString(), page],
    queryFn: () => api.get<{ data: AuditRow[]; total: number }>(`/audit?${qs}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: (prev) => prev
  });

  const field = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Actividad por usuario</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="flex flex-col text-xs text-slate-500">
          Usuario
          <select className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos</option>
            {filters?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Acción
          <select className={field} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todas</option>
            {filters?.actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Sobre
          <select className={field} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todo</option>
            {filters?.entities.map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Desde
          <input type="date" className={field} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Hasta
          <input type="date" className={field} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          onClick={async () => {
            setExportError(null);
            try {
              await downloadFile(`/audit/export.csv?${qs}`, "actividad.csv");
            } catch (err) {
              setExportError(err instanceof Error ? err.message : "No se pudo exportar");
            }
          }}
        >
          Exportar CSV
        </button>
      </div>
      {exportError && <p className="mb-3 text-xs text-red-600">{exportError}</p>}

      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {data && data.data.length === 0 && <EmptyView message="No hay actividad con estos filtros." />}
      {data && data.data.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Sobre</th>
                  <th className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2">{r.user_name ?? "Sistema"}</td>
                    <td className="px-3 py-2">{ACTION_LABELS[r.action] ?? r.action}</td>
                    <td className="px-3 py-2">
                      {ENTITY_LABELS[r.entity] ?? r.entity} #{r.entity_id}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
