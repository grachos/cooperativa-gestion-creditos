import type { PoolLike } from "../db/pool.js";

export interface ChecklistRow {
  document_type: string;
  held: boolean;
  notes: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
}

/**
 * Lista de chequeo "lo tenemos / no lo tenemos": los documentos del parámetro `paramKey` (en su orden)
 * con lo marcado en `table`, más los que alguna vez se marcaron y ya no están en la lista (para no perder
 * el historial si la cooperativa cambia el parámetro). `table` y `ownerColumn` son constantes del código.
 */
export async function loadChecklist(
  db: PoolLike,
  table: "associate_documents" | "credit_legal_documents",
  ownerColumn: "associate_id" | "credit_id",
  ownerId: number,
  paramKey: string
): Promise<ChecklistRow[]> {
  const [paramRows] = await db.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = ?`, [paramKey]);
  const value = (paramRows as any[])[0]?.value;
  const types: string[] = Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : [];

  const [rows] = await db.query<any[]>(
    `SELECT d.document_type, d.held, d.notes, d.checked_at, u.full_name AS checked_by_name
     FROM ${table} d LEFT JOIN users u ON u.id = d.checked_by
     WHERE d.${ownerColumn} = ?`,
    [ownerId]
  );
  const stored = new Map((rows as any[]).map((r) => [r.document_type as string, r]));
  const ordered = [...types, ...[...stored.keys()].filter((k) => !types.includes(k))];
  return ordered.map((type) => {
    const r = stored.get(type);
    return {
      document_type: type,
      held: Boolean(r?.held),
      notes: r?.notes ?? null,
      checked_by_name: r?.checked_by_name ?? null,
      checked_at: r?.checked_at ?? null
    };
  });
}

/** ¿Se puede marcar este documento? Debe estar en la lista vigente o haberse marcado antes. */
export async function isKnownDocument(
  db: PoolLike,
  table: "associate_documents" | "credit_legal_documents",
  ownerColumn: "associate_id" | "credit_id",
  ownerId: number,
  paramKey: string,
  documentType: string
): Promise<boolean> {
  const list = await loadChecklist(db, table, ownerColumn, ownerId, paramKey);
  return list.some((r) => r.document_type === documentType);
}
