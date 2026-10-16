import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, downloadFile } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";
import { Pagination, SearchBox, useDebounced } from "../components/ListControls";

interface AuditRow {
  id: number;
  created_at: string;
  user_name: string | null;
  entity: string;
  entity_id: string;
  action: string;
  reason: string | null;
  summary: string;
  entity_label: string | null;
  link: string | null;
  old_value: unknown;
  new_value: unknown;
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
  APPROVE: "Aprobó solicitud",
  REJECT: "Rechazó solicitud",
  DISBURSE: "Desembolsó",
  REFINANCE: "Refinanció",
  REVERSE: "Reversó pago",
  VERIFY: "Verificó pago",
  UNVERIFY: "Quitó verificación",
  EARLY_PAYOFF: "Canceló por pago anticipado",
  REVIEW_START: "Inició revisión",
  DOCUMENT_REVIEW: "Revisó documento",
  PARTICIPANT_REVIEW: "Revisó participante",
  REFERENCE_CHECK: "Verificó referencia",
  PROMISE_CREATED: "Registró compromiso",
  COLLECTION_ACTION_CREATED: "Registró gestión de cobro",
  COLLECTION_ACTION_COMPLETED: "Completó gestión de cobro",
  DOCUMENT_CHECK: "Marcó documento",
  LEGAL_DOCUMENT_CHECK: "Marcó documento jurídico",
  PERMISSIONS_UPDATE: "Cambió permisos",
  STATUS_CHANGE: "Cambió estado"
};

const ENTITY_LABELS: Record<string, string> = {
  credit_application: "Solicitudes",
  credit: "Créditos",
  payment: "Pagos",
  credit_adjustment: "Ajustes y descuentos",
  associate: "Asociados",
  society: "Sociedades",
  user: "Usuarios",
  parameter: "Parámetros",
  collection_action: "Cobranza"
};

/** Consultas frecuentes: un clic para responder "¿quién aprobó?", "¿quién dio un descuento?"… */
const QUICK_FILTERS: Array<{ label: string; params: Record<string, string> }> = [
  { label: "Quién aprobó o rechazó", params: { action: "APPROVE,REJECT" } },
  { label: "Descuentos y ajustes", params: { entity: "credit_adjustment" } },
  { label: "Desembolsos y refinanciaciones", params: { action: "DISBURSE,REFINANCE" } },
  { label: "Pagos, reversos y cancelaciones", params: { entity: "payment" } },
  { label: "Revisión de documentos", params: { action: "DOCUMENT_REVIEW,PARTICIPANT_REVIEW,REFERENCE_CHECK,REVIEW_START" } },
  { label: "Cambios de permisos", params: { action: "PERMISSIONS_UPDATE" } },
  { label: "Cambios de parámetros", params: { entity: "parameter" } }
];

const pretty = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(v);
  }
};

/**
 * "Actividad por usuario": quién hizo qué y cuándo. Se puede filtrar por persona, acción, módulo, fechas y por
 * crédito/solicitud/asociado, o buscar texto libre. Sirve para saber quién autorizó, aprobó o dio un descuento.
 */
export default function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const [userId, setUserId] = useState(params.get("userId") ?? "");
  const [action, setAction] = useState(params.get("action") ?? "");
  const [entity, setEntity] = useState(params.get("entity") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [credit, setCredit] = useState(params.get("credit") ?? "");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const application = params.get("application") ?? "";
  const associate = params.get("associate") ?? "";
  const q = useDebounced(search.trim());
  const creditTerm = useDebounced(credit.trim());
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  useEffect(() => setPage(1), [userId, action, entity, from, to, creditTerm, q, application, associate]);

  const qs = new URLSearchParams();
  if (userId) qs.set("userId", userId);
  if (action) qs.set("action", action);
  if (entity) qs.set("entity", entity);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (creditTerm) qs.set("credit", creditTerm);
  if (application) qs.set("application", application);
  if (associate) qs.set("associate", associate);
  if (q) qs.set("q", q);

  const { data: filters } = useQuery({ queryKey: ["audit-filters"], queryFn: () => api.get<Filters>("/audit/filters") });
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", qs.toString(), page],
    queryFn: () => api.get<{ data: AuditRow[]; total: number }>(`/audit?${qs}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: (prev) => prev
  });

  const field = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  const hasFilters = Boolean(userId || action || entity || from || to || credit || search || application || associate);

  function applyQuick(p: Record<string, string>) {
    setAction(p.action ?? "");
    setEntity(p.entity ?? "");
  }
  function clearAll() {
    setUserId("");
    setAction("");
    setEntity("");
    setFrom("");
    setTo("");
    setCredit("");
    setSearch("");
    setParams({});
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Actividad por usuario</h1>
      <p className="mb-4 text-sm text-slate-500">Quién hizo qué y cuándo: aprobaciones, descuentos, desembolsos, pagos, cambios de permisos y más.</p>

      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => {
          const active = (f.params.action ?? "") === action && (f.params.entity ?? "") === entity;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => applyQuick(f.params)}
              className={`rounded-full border px-3 py-1 text-xs ${active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder="Buscar por motivo, detalle, nombre de usuario o número de registro" label="Buscar actividad" />

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
          <select className={field} value={action.includes(",") ? "" : action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{action.includes(",") ? "Varias (filtro rápido)" : "Todas"}</option>
            {filters?.actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Módulo
          <select className={field} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todos</option>
            {filters?.entities.map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Crédito (número)
          <input className={`${field} w-40`} placeholder="CR-2026-00001" value={credit} onChange={(e) => setCredit(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Desde
          <input type="date" className={field} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Hasta
          <input type="date" className={field} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" onClick={clearAll} className="text-sm text-slate-500 hover:underline">
            Limpiar filtros
          </button>
        )}
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
      {(application || associate) && (
        <p className="mb-3 text-sm text-slate-600">
          Mostrando el historial de {application ? `la solicitud #${application}` : `el asociado #${associate}`}.{" "}
          <button type="button" onClick={clearAll} className="text-brand-700 hover:underline">
            Ver todo
          </button>
        </p>
      )}
      {exportError && <p className="mb-3 text-xs text-red-600">{exportError}</p>}

      {isLoading && <Loading />}
      {error && <ErrorView message={(error as Error).message} />}
      {data && data.data.length === 0 && <EmptyView message="No hay actividad con estos filtros." />}
      {data && data.data.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">{data.total} registros</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fecha y hora</th>
                  <th className="px-3 py-2">Quién</th>
                  <th className="px-3 py-2">Qué hizo</th>
                  <th className="px-3 py-2">Sobre</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.user_name ?? "Sistema"}</td>
                    <td className="px-3 py-2">
                      <p>{r.summary}</p>
                      {r.reason && <p className="text-xs text-slate-500">Motivo: {r.reason}</p>}
                      {(r.old_value != null || r.new_value != null) && (
                        <button type="button" onClick={() => setOpenRow(openRow === r.id ? null : r.id)} className="text-xs text-brand-700 hover:underline">
                          {openRow === r.id ? "Ocultar detalle" : "Ver detalle"}
                        </button>
                      )}
                      {openRow === r.id && (
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          {r.old_value != null ? (
                            <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">Antes: {pretty(r.old_value)}</pre>
                          ) : null}
                          {r.new_value != null ? (
                            <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">Después: {pretty(r.new_value)}</pre>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.link ? (
                        <Link to={r.link} className="text-brand-700 hover:underline">
                          {r.entity_label}
                        </Link>
                      ) : (
                        r.entity_label ?? `${ENTITY_LABELS[r.entity] ?? r.entity} #${r.entity_id}`
                      )}
                    </td>
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
