/**
 * Descripción legible de cada registro de auditoría ("Aprobó la solicitud…", "Dio un descuento de $…") y
 * resolución de a qué crédito, solicitud o persona se refiere, para el visor de Actividad.
 */
import type { PoolLike } from "../../db/pool.js";

export interface AuditRow {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  [key: string]: unknown;
}

const money = (n: unknown) =>
  typeof n === "number" || (typeof n === "string" && n !== "" && !Number.isNaN(Number(n)))
    ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n))
    : "";

const ADJUSTMENT_TYPES: Record<string, string> = {
  DESCUENTO: "un descuento",
  INTERES_MORA: "cobro de mora",
  GASTO_NOTIFICACION: "un gasto de notificación",
  INTERES_CAMBIO_FECHA: "interés por cambio de fecha",
  OTRO: "un ajuste"
};

const REVIEW_STATUS: Record<string, string> = { APROBADO: "aprobó", RECHAZADO: "rechazó", PENDIENTE: "dejó pendiente" };

function obj(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function short(value: unknown, max = 80): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Texto corto de lo que hizo la persona. `reason` se muestra aparte. */
export function describeAudit(row: AuditRow): string {
  const nv = obj(row.new_value);
  const ov = obj(row.old_value);
  const key = `${row.entity}:${row.action}`;
  switch (key) {
    case "credit_application:CREATE":
      return `Radicó la solicitud${nv.requestedAmount ? ` por ${money(nv.requestedAmount)}` : ""}`;
    case "credit_application:REVIEW_START":
      return "Puso la solicitud en revisión";
    case "credit_application:DOCUMENT_REVIEW":
      return `${cap(REVIEW_STATUS[nv.status] ?? "revisó")} el documento "${nv.documentType ?? "?"}"${nv.notes ? ` (${nv.notes})` : ""}`;
    case "credit_application:PARTICIPANT_REVIEW":
      return `${cap(REVIEW_STATUS[nv.status] ?? "revisó")} al ${nv.role === "TITULAR" ? "titular" : "codeudor"}${nv.notes ? ` (${nv.notes})` : ""}`;
    case "credit_application:REFERENCE_CHECK":
      return `Verificó la referencia ${nv.referenceName ?? ""}: ${nv.contacted ? `contactada, ${String(nv.result ?? "").toLowerCase()}` : "sin contactar"}`;
    case "credit_application:APPROVE": {
      const extra = [nv.approvedAmount && `monto ${money(nv.approvedAmount)}`, nv.approvedTerm && `${nv.approvedTerm} meses`, nv.approvedRate && `tasa ${nv.approvedRate}%`]
        .filter(Boolean)
        .join(", ");
      return `Aprobó la solicitud${extra ? ` (${extra})` : ""}`;
    }
    case "credit_application:REJECT":
      return "Rechazó la solicitud";
    case "credit_application:CANCEL":
      return `Canceló la solicitud${ov.status ? ` (estaba ${String(ov.status).toLowerCase().replace("_", " ")})` : ""}`;
    case "credit:DISBURSE":
      return `Desembolsó el crédito${nv.creditNumber ? ` ${nv.creditNumber}` : ""}`;
    case "credit:REFINANCE":
      return `Refinanció el crédito: nuevo ${nv.creditNumber ?? "crédito"} por ${money(nv.newPrincipal)} a ${nv.termValue ?? "?"} meses (antes quedaban ${money(ov.outstanding)})`;
    case "credit:LEGAL_DOCUMENT_CHECK":
      return `${nv.held ? "Marcó que tiene" : "Marcó que no tiene"} el documento jurídico "${nv.documentType}"`;
    case "payment:CREATE":
      return `Registró un pago de ${money(nv.amount)}`;
    case "payment:EARLY_PAYOFF":
      return `Canceló el crédito por pago anticipado con ${money(nv.amount)}`;
    case "payment:REVERSE":
      return "Reversó un pago";
    case "payment:VERIFY":
      return "Marcó el pago como verificado en el banco";
    case "payment:UNVERIFY":
      return "Quitó la verificación del pago";
    case "credit_adjustment:CREATE": {
      const kind = ADJUSTMENT_TYPES[nv.type] ?? `un ajuste ${nv.type ?? ""}`;
      const sign = nv.type === "DESCUENTO" ? "Dio" : nv.type === "INTERES_MORA" ? "Autorizó el" : "Registró";
      return `${sign} ${kind} de ${money(nv.amount)}${nv.percent ? ` (${nv.percent}% del interés futuro)` : ""}`;
    }
    case "collection_action:PROMISE_CREATED":
      return `Registró un compromiso de pago para el ${nv.promiseDate ?? "?"}`;
    case "collection_action:COLLECTION_ACTION_CREATED":
      return `Registró una gestión de cobro (${String(nv.actionType ?? "").toLowerCase().replace(/_/g, " ")}): ${short(nv.description, 60)}`;
    case "collection_action:COLLECTION_ACTION_COMPLETED":
      return "Marcó la gestión de cobro como completada";
    case "associate:CREATE":
      return "Creó el asociado";
    case "associate:UPDATE":
      return "Modificó los datos del asociado";
    case "associate:STATUS_CHANGE":
      return `Cambió el estado del asociado a ${nv.status ?? "?"}`;
    case "associate:DOCUMENT_CHECK":
      return `${nv.held ? "Marcó que tiene" : "Marcó que no tiene"} el documento "${nv.documentType}"`;
    case "society:CREATE":
      return "Creó la sociedad";
    case "user:CREATE":
      return `Creó el usuario ${nv.username ?? ""}`;
    case "user:UPDATE":
      return "Modificó el usuario";
    case "user:PERMISSIONS_UPDATE": {
      const granted = Array.isArray(nv.granted) && nv.granted.length ? `agregó ${nv.granted.join(", ")}` : "";
      const denied = Array.isArray(nv.denied) && nv.denied.length ? `quitó ${nv.denied.join(", ")}` : "";
      return `Cambió los permisos del usuario${granted || denied ? `: ${[granted, denied].filter(Boolean).join("; ")}` : ""}`;
    }
    case "parameter:UPDATE":
      return `Cambió el parámetro ${row.entity_id}: ${short(row.old_value ?? "—", 60)} → ${short(row.new_value ?? "—", 60)}`;
    case "parameter:CREATE":
      return `Creó el parámetro ${row.entity_id}`;
    case "parameter:DELETE":
      return `Eliminó el parámetro ${row.entity_id}`;
    default:
      return `${row.action} sobre ${row.entity} #${row.entity_id}`;
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface EntityRef {
  label: string;
  link: string | null;
}

/** A qué se refiere cada registro: número de crédito, solicitud con su titular, persona… (consultas por lotes). */
export async function resolveEntities(db: PoolLike, rows: AuditRow[]): Promise<Map<string, EntityRef>> {
  const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity && /^\d+$/.test(r.entity_id)).map((r) => Number(r.entity_id)))];
  const out = new Map<string, EntityRef>();
  const set = (entity: string, id: number | string, ref: EntityRef) => out.set(`${entity}:${id}`, ref);
  const inList = (n: number[]) => (n.length ? n : [0]);

  const creditIds = ids("credit");
  if (creditIds.length) {
    const [r] = await db.query<any[]>(`SELECT id, credit_number FROM credits WHERE id IN (?)`, [creditIds]);
    for (const c of r as any[]) set("credit", c.id, { label: `Crédito ${c.credit_number}`, link: `/creditos/${c.id}` });
  }
  const appIds = ids("credit_application");
  if (appIds.length) {
    const [r] = await db.query<any[]>(
      `SELECT ca.id, a.first_name, a.last_name, s.legal_name FROM credit_applications ca
       LEFT JOIN associates a ON a.id = ca.titular_associate_id LEFT JOIN societies s ON s.id = ca.titular_society_id
       WHERE ca.id IN (?)`,
      [inList(appIds)]
    );
    for (const a of r as any[]) {
      const who = a.first_name ? `${a.first_name} ${a.last_name}` : a.legal_name ?? "";
      set("credit_application", a.id, { label: `Solicitud #${a.id}${who ? ` de ${who}` : ""}`, link: `/solicitudes/${a.id}` });
    }
  }
  const assocIds = ids("associate");
  if (assocIds.length) {
    const [r] = await db.query<any[]>(`SELECT id, first_name, last_name FROM associates WHERE id IN (?)`, [assocIds]);
    for (const a of r as any[]) set("associate", a.id, { label: `Asociado ${a.first_name} ${a.last_name}`, link: `/asociados/${a.id}` });
  }
  const payIds = ids("payment");
  if (payIds.length) {
    const [r] = await db.query<any[]>(
      `SELECT p.id, c.id AS credit_id, c.credit_number FROM payments p JOIN credits c ON c.id = p.credit_id WHERE p.id IN (?)`,
      [payIds]
    );
    for (const p of r as any[]) set("payment", p.id, { label: `Pago #${p.id} del crédito ${p.credit_number}`, link: `/creditos/${p.credit_id}` });
  }
  const adjIds = ids("credit_adjustment");
  if (adjIds.length) {
    const [r] = await db.query<any[]>(
      `SELECT ca.id, c.id AS credit_id, c.credit_number FROM credit_adjustments ca JOIN credits c ON c.id = ca.credit_id WHERE ca.id IN (?)`,
      [adjIds]
    );
    for (const a of r as any[]) set("credit_adjustment", a.id, { label: `Ajuste #${a.id} del crédito ${a.credit_number}`, link: `/creditos/${a.credit_id}` });
  }
  const actIds = ids("collection_action");
  if (actIds.length) {
    const [r] = await db.query<any[]>(
      `SELECT ca.id, c.id AS credit_id, c.credit_number FROM collection_actions ca JOIN credits c ON c.id = ca.credit_id WHERE ca.id IN (?)`,
      [actIds]
    );
    for (const a of r as any[]) set("collection_action", a.id, { label: `Gestión #${a.id} del crédito ${a.credit_number}`, link: `/creditos/${a.credit_id}` });
  }
  const userIds = ids("user");
  if (userIds.length) {
    const [r] = await db.query<any[]>(`SELECT id, full_name FROM users WHERE id IN (?)`, [userIds]);
    for (const u of r as any[]) set("user", u.id, { label: `Usuario ${u.full_name}`, link: null });
  }
  for (const row of rows) {
    if (row.entity === "parameter") set("parameter", row.entity_id, { label: `Parámetro ${row.entity_id}`, link: "/parametros" });
  }
  return out;
}
