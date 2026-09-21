import { Fragment, useState, type FormEvent } from "react";
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

type FieldType = "string" | "number" | "boolean" | "null";
type Shape = "object" | "list-text" | "list-object" | "string" | "number" | "boolean" | "null" | "json";
type CreatableShape = Exclude<Shape, "null" | "json">;

interface Field {
  key: string;
  type: FieldType;
  value: string;
}

interface Column {
  name: string;
  type: FieldType;
}

function fieldTypeOf(v: unknown): FieldType {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

function scalarToField(key: string, v: unknown): Field {
  return { key, type: fieldTypeOf(v), value: v === null || v === undefined ? "" : String(v) };
}

/** Un número vacío se guarda como null (no como 0) para no perder campos que ya eran null. */
function textToTyped(type: FieldType, raw: string): unknown {
  if (type === "number") {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  if (type === "boolean") return raw === "true";
  if (type === "null") return null;
  return raw;
}

function objectToFields(value: Record<string, unknown>): Field[] {
  return Object.entries(value).map(([key, v]) => scalarToField(key, v));
}

function fieldsToObject(fields: Field[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) if (f.key.trim()) obj[f.key.trim()] = textToTyped(f.type, f.value);
  return obj;
}

function detectColumns(rows: Record<string, unknown>[]): Column[] {
  const first = rows[0] ?? {};
  return Object.entries(first).map(([name, v]) => ({ name, type: fieldTypeOf(v) }));
}

function detectRows(rows: Record<string, unknown>[], columns: Column[]): string[][] {
  return rows.map((r) => columns.map((c) => (r[c.name] === null || r[c.name] === undefined ? "" : String(r[c.name]))));
}

function buildListObjectValue(columns: Column[], rows: string[][]): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      if (c.name.trim()) obj[c.name.trim()] = textToTyped(c.type, row[i] ?? "");
    });
    return obj;
  });
}

function detectShape(value: unknown): Shape {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
      return "list-object";
    }
    if (value.every((v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return "list-text";
    }
    return "json";
  }
  if (typeof value === "object") {
    if (Object.values(value).every((v) => v === null || typeof v !== "object")) return "object";
    return "json";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

interface ValueState {
  objectFields: Field[];
  listItems: string[];
  listColumns: Column[];
  listRows: string[][];
  scalarValue: string;
  jsonText: string;
}

function initValueState(shape: Shape, value: unknown): ValueState {
  const columns = shape === "list-object" ? detectColumns(value as Record<string, unknown>[]) : [];
  return {
    objectFields: shape === "object" ? objectToFields(value as Record<string, unknown>) : [],
    listItems: shape === "list-text" ? (value as unknown[]).map((v) => (v === null ? "" : String(v))) : [],
    listColumns: columns,
    listRows: shape === "list-object" ? detectRows(value as Record<string, unknown>[], columns) : [],
    scalarValue:
      shape === "string" || shape === "number" ? String(value ?? "") : shape === "boolean" ? String(Boolean(value)) : "",
    jsonText: JSON.stringify(value, null, 2)
  };
}

function buildValue(shape: Shape, s: ValueState): unknown {
  switch (shape) {
    case "object":
      return fieldsToObject(s.objectFields);
    case "list-text":
      return s.listItems.filter((v) => v.trim() !== "");
    case "list-object":
      return buildListObjectValue(s.listColumns, s.listRows);
    case "number": {
      const n = Number(s.scalarValue);
      return Number.isNaN(n) ? 0 : n;
    }
    case "boolean":
      return s.scalarValue === "true";
    case "null":
      return null;
    default:
      return s.scalarValue;
  }
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: "Texto",
  number: "Número",
  boolean: "Verdadero/Falso",
  null: "Vacío"
};

function ObjectFieldsEditor({ fields, onChange }: { fields: Field[]; onChange: (f: Field[]) => void }) {
  function update(i: number, patch: Partial<Field>) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            placeholder="campo"
            value={f.key}
            onChange={(e) => update(i, { key: e.target.value })}
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <select
            value={f.type}
            onChange={(e) => update(i, { type: e.target.value as FieldType })}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {f.type === "boolean" ? (
            <select
              value={f.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="true">Verdadero</option>
              <option value="false">Falso</option>
            </select>
          ) : f.type === "null" ? (
            <span className="text-xs text-slate-400">— sin valor —</span>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={f.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className="min-w-[8rem] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          )}
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
            className="text-xs text-red-500 hover:underline"
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...fields, { key: "", type: "string", value: "" }])}
        className="text-xs text-emerald-700 hover:underline"
      >
        + Agregar campo
      </button>
    </div>
  );
}

function ListTextEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={it}
            onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="text-xs text-red-500 hover:underline"
          >
            Quitar
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} className="text-xs text-emerald-700 hover:underline">
        + Agregar valor
      </button>
    </div>
  );
}

function ListObjectEditor({
  columns,
  setColumns,
  rows,
  setRows
}: {
  columns: Column[];
  setColumns: (c: Column[]) => void;
  rows: string[][];
  setRows: (r: string[][]) => void;
}) {
  function addColumn() {
    setColumns([...columns, { name: "", type: "string" }]);
    setRows(rows.map((r) => [...r, ""]));
  }
  function removeColumn(i: number) {
    setColumns(columns.filter((_, idx) => idx !== i));
    setRows(rows.map((r) => r.filter((_, idx) => idx !== i)));
  }
  function updateColumn(i: number, patch: Partial<Column>) {
    setColumns(columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function updateCell(r: number, c: number, value: string) {
    setRows(rows.map((row, idx) => (idx === r ? row.map((v, ci) => (ci === c ? value : v)) : row)));
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className="pb-1 pr-2 text-left">
                  <div className="flex items-center gap-1">
                    <input
                      value={c.name}
                      onChange={(e) => updateColumn(i, { name: e.target.value })}
                      placeholder="campo"
                      className="w-20 rounded-md border border-slate-300 px-1 py-0.5"
                    />
                    <select
                      value={c.type}
                      onChange={(e) => updateColumn(i, { type: e.target.value as FieldType })}
                      className="rounded-md border border-slate-300 px-1 py-0.5"
                    >
                      <option value="string">Texto</option>
                      <option value="number">Número</option>
                      <option value="boolean">V/F</option>
                    </select>
                    <button type="button" onClick={() => removeColumn(i)} className="text-red-500">
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((val, c) => (
                  <td key={c} className="pb-1 pr-2">
                    {columns[c]?.type === "boolean" ? (
                      <select
                        value={val || "false"}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        className="rounded-md border border-slate-300 px-1 py-0.5"
                      >
                        <option value="true">Verdadero</option>
                        <option value="false">Falso</option>
                      </select>
                    ) : (
                      <input
                        value={val}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        className="w-20 rounded-md border border-slate-300 px-1 py-0.5"
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== r))}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={addColumn} className="text-xs text-emerald-700 hover:underline">
          + Agregar campo
        </button>
        <button
          type="button"
          onClick={() => setRows([...rows, columns.map(() => "")])}
          className="text-xs text-emerald-700 hover:underline"
        >
          + Agregar fila
        </button>
      </div>
    </div>
  );
}

function ValueEditor({ shape, state, setState }: { shape: Shape; state: ValueState; setState: (s: ValueState) => void }) {
  if (shape === "object") {
    return <ObjectFieldsEditor fields={state.objectFields} onChange={(objectFields) => setState({ ...state, objectFields })} />;
  }
  if (shape === "list-text") {
    return <ListTextEditor items={state.listItems} onChange={(listItems) => setState({ ...state, listItems })} />;
  }
  if (shape === "list-object") {
    return (
      <ListObjectEditor
        columns={state.listColumns}
        setColumns={(listColumns) => setState({ ...state, listColumns })}
        rows={state.listRows}
        setRows={(listRows) => setState({ ...state, listRows })}
      />
    );
  }
  if (shape === "boolean") {
    return (
      <select
        value={state.scalarValue}
        onChange={(e) => setState({ ...state, scalarValue: e.target.value })}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="true">Verdadero</option>
        <option value="false">Falso</option>
      </select>
    );
  }
  if (shape === "null") return <p className="text-xs text-slate-400">Este parámetro no tiene valor (null).</p>;
  if (shape === "json") {
    return (
      <textarea
        rows={6}
        className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
        value={state.jsonText}
        onChange={(e) => setState({ ...state, jsonText: e.target.value })}
      />
    );
  }
  return (
    <input
      type={shape === "number" ? "number" : "text"}
      value={state.scalarValue}
      onChange={(e) => setState({ ...state, scalarValue: e.target.value })}
      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
    />
  );
}

function ReadOnlyValue({ shape, value }: { shape: Shape; value: unknown }) {
  if (shape === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <p className="text-xs text-slate-400">Sin campos.</p>;
    return (
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="font-medium text-slate-500">{k}</dt>
            <dd className="text-slate-700">{v === null ? "—" : String(v)}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }
  if (shape === "list-text") {
    const items = value as unknown[];
    if (items.length === 0) return <p className="text-xs text-slate-400">Sin valores.</p>;
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((v, i) => (
          <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {String(v)}
          </span>
        ))}
      </div>
    );
  }
  if (shape === "list-object") {
    const rows = value as Record<string, unknown>[];
    if (rows.length === 0) return <p className="text-xs text-slate-400">Sin registros.</p>;
    const cols = Object.keys(rows[0] ?? {});
    return (
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="py-1 pr-3 text-left text-slate-400">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {cols.map((c) => (
                  <td key={c} className="py-1 pr-3 text-slate-600">
                    {r[c] === null ? "—" : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (shape === "null") return <p className="text-xs text-slate-400">Sin valor (null).</p>;
  if (shape === "json") {
    return <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="text-xs text-slate-700">{String(value)}</p>;
}

function ParameterCard({ parameter, canWrite }: { parameter: Parameter; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [shape] = useState<Shape>(() => detectShape(parameter.value));
  const [state, setState] = useState<ValueState>(() => initValueState(shape, parameter.value));
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
    if (shape === "json") {
      try {
        JSON.parse(state.jsonText);
      } catch {
        setError("El valor debe ser JSON válido.");
        return;
      }
    }
    const value = shape === "json" ? JSON.parse(state.jsonText) : buildValue(shape, state);
    update.mutate({ value, description: description || undefined, reason: reason || undefined });
  }

  function cancel() {
    setState(initValueState(shape, parameter.value));
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
          <ReadOnlyValue shape={shape} value={parameter.value} />
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
            <input
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Valor</label>
            <ValueEditor shape={shape} state={state} setState={setState} />
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

const SHAPE_LABELS: Record<CreatableShape, string> = {
  object: "Objeto (varios campos)",
  "list-text": "Lista de valores",
  "list-object": "Lista de registros (tabla)",
  string: "Texto",
  number: "Número",
  boolean: "Verdadero/Falso"
};

function emptyValueState(shape: CreatableShape): ValueState {
  return {
    objectFields: shape === "object" ? [{ key: "", type: "string", value: "" }] : [],
    listItems: shape === "list-text" ? [""] : [],
    listColumns: shape === "list-object" ? [{ name: "", type: "string" }] : [],
    listRows: shape === "list-object" ? [[""]] : [],
    scalarValue: shape === "boolean" ? "true" : "",
    jsonText: "{}"
  };
}

function NewParameterForm() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [shape, setShape] = useState<CreatableShape>("object");
  const [state, setState] = useState<ValueState>(() => emptyValueState("object"));
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { key: string; value: unknown; description?: string }) => api.post("/parameters", body),
    onSuccess: () => {
      setKey("");
      setDescription("");
      setShape("object");
      setState(emptyValueState("object"));
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["parameters"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Error al crear el parámetro")
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ key, value: buildValue(shape, state), description: description || undefined });
  }

  function onShapeChange(next: CreatableShape) {
    setShape(next);
    setState(emptyValueState(next));
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
        <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de valor</label>
        <select
          value={shape}
          onChange={(e) => onShapeChange(e.target.value as CreatableShape)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(SHAPE_LABELS) as CreatableShape[]).map((s) => (
            <option key={s} value={s}>
              {SHAPE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Valor</label>
        <ValueEditor shape={shape} state={state} setState={setState} />
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
