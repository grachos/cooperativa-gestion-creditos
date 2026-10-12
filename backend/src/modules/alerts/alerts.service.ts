import { pool } from "../../db/pool.js";
import { calculateOverdueDays, getMoraBucket, loadDelinquencyPolicy, loadMoraBuckets } from "../delinquency/delinquency.service.js";
import { broadcastEvents } from "./sse.hub.js";
import { invalidateReportCache } from "../reports/reportCache.js";
import { claimDailyRun, releaseDailyRun, withJobLock } from "../../utils/jobLock.js";

const BUCKET_PRIORITY: Record<string, "BAJA" | "MEDIA" | "ALTA"> = {
  CM030: "BAJA",
  CM060: "MEDIA",
  CM090: "MEDIA",
  CM120: "ALTA",
  CM150: "ALTA",
  CM180: "ALTA"
};

/**
 * Recalcula días de atraso y genera alertas de vencimiento y de mora.
 * Las alertas de mora usan los mismos buckets de 30/60/90/120/150/180 días
 * que el Excel real de la cooperativa (código CM030…CM180): se dispara una
 * alerta nueva cada vez que una cuota entra a un bucket distinto, en vez de
 * un umbral arbitrario de "mora inicial/prolongada".
 *
 * Se ejecuta a diario (job interno, ver server.ts) o a pedido ("Recalcular").
 * Solo UNA ejecución a la vez en todo el sistema (candado de base de datos), y
 * trabaja por lotes: antes hacía hasta 3 consultas POR CUOTA (con 50.000 cuotas
 * abiertas, ~150.000 consultas); ahora son unas pocas consultas por lote.
 * El resultado (estados, días de atraso y alertas) es el mismo que el de la
 * versión por cuota; la llave única uq_alerts_open impide alertas abiertas
 * repetidas incluso si dos ejecuciones coincidieran.
 */
export async function recalculateAlerts(asOf: Date = new Date()): Promise<{ created: number; skipped?: boolean }> {
  const locked = await withJobLock("alerts-recalculate", () => recalculateAlertsUnlocked(asOf));
  if (!locked.ran) return { created: 0, skipped: true };
  return locked.result;
}

const CHUNK = 500;
function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface NewAlert {
  creditId: number;
  installmentId: number;
  type: string;
  priority: "BAJA" | "MEDIA" | "ALTA";
  message: string;
}

async function recalculateAlertsUnlocked(asOf: Date): Promise<{ created: number }> {
  const [policy, buckets] = await Promise.all([loadDelinquencyPolicy(pool), loadMoraBuckets(pool)]);
  // Estados abiertos listados explícitamente (en vez de NOT IN) para poder usar el índice de status.
  const [installments] = await pool.query<any[]>(
    `SELECT csi.id, csi.credit_id, csi.installment_number, csi.due_date, csi.status, csi.overdue_days
     FROM credit_schedule_installments csi
     JOIN credits c ON c.id = csi.credit_id
     WHERE csi.status IN ('PENDIENTE','PARCIAL','VENCIDA','EN_MORA') AND c.status NOT IN ('PAGADO','ANULADO')`
  );

  const statusGroups = new Map<string, { overdueDays: number; status: string; ids: number[] }>();
  const candidates: NewAlert[] = [];

  for (const inst of installments as any[]) {
    const dueDate = new Date(inst.due_date);
    const overdueDays = calculateOverdueDays(dueDate, asOf);
    const daysToDue = Math.floor((dueDate.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24));

    // Persiste días de atraso y estado (VENCIDA / EN_MORA) aunque no haya
    // pago de por medio: sin esto, `overdue_days` sólo se actualizaba al
    // registrar un pago y los reportes de cartera vencida quedaban desfasados.
    if (overdueDays !== inst.overdue_days) {
      // PARCIAL ya refleja que hubo un abono: no se pisa con VENCIDA/EN_MORA.
      const newStatus =
        inst.status === "PARCIAL" || overdueDays === 0
          ? inst.status
          : getMoraBucket(overdueDays, buckets).code === "CD001"
          ? "VENCIDA"
          : "EN_MORA";
      const key = `${overdueDays}|${newStatus}`;
      const group = statusGroups.get(key) ?? { overdueDays, status: newStatus, ids: [] as number[] };
      group.ids.push(inst.id);
      statusGroups.set(key, group);
    }

    let type: string | null = null;
    let priority: "BAJA" | "MEDIA" | "ALTA" = "MEDIA";
    let message = "";

    if (daysToDue === policy.earlyAlertDays && daysToDue > 0) {
      type = "PROXIMO_VENCIMIENTO";
      priority = "BAJA";
      message = `Cuota #${inst.installment_number} vence en ${daysToDue} día(s)`;
    } else if (daysToDue === 0) {
      type = "VENCIMIENTO_DEL_DIA";
      priority = "MEDIA";
      message = `Cuota #${inst.installment_number} vence hoy`;
    } else if (overdueDays > 0) {
      const bucket = getMoraBucket(overdueDays, buckets);
      if (bucket.code !== "CD001") {
        type = `MORA_${bucket.code}`;
        priority = BUCKET_PRIORITY[bucket.code] ?? "MEDIA";
        message = `Cuota #${inst.installment_number} entró en ${bucket.label} (${overdueDays} días de atraso)`;
      }
    }

    if (type) candidates.push({ creditId: inst.credit_id, installmentId: inst.id, type, priority, message });
  }

  // 1) Estados y días de atraso: un UPDATE por cada combinación distinta (no por cuota).
  for (const group of statusGroups.values()) {
    for (const ids of chunks(group.ids, 1000)) {
      await pool.query(`UPDATE credit_schedule_installments SET overdue_days = ?, status = ? WHERE id IN (?)`, [
        group.overdueDays,
        group.status,
        ids
      ]);
    }
  }

  // 2) Alertas nuevas: una sola lectura de las abiertas y inserciones por lotes.
  const [openRows] = await pool.query<any[]>(
    `SELECT installment_id, type FROM alerts WHERE status = 'ABIERTA' AND installment_id IS NOT NULL`
  );
  const open = new Set((openRows as any[]).map((r) => `${r.installment_id}|${r.type}`));
  const fresh = candidates.filter((c) => !open.has(`${c.installmentId}|${c.type}`));

  let created = 0;
  const events: { event: string; data: unknown }[] = [];
  for (const batch of chunks(fresh)) {
    // ON DUPLICATE KEY: red de seguridad ante la llave única (cuota, tipo, abierta).
    const [result] = await pool.query<any>(
      `INSERT INTO alerts (credit_id, installment_id, type, priority, message, open_flag) VALUES ?
       ON DUPLICATE KEY UPDATE id = id`,
      [batch.map((a) => [a.creditId, a.installmentId, a.type, a.priority, a.message, 1])]
    );
    created += Number(result.affectedRows ?? 0);
    for (const a of batch) {
      events.push({ event: "alert.created", data: { creditId: a.creditId, type: a.type, priority: a.priority, message: a.message } });
    }
  }
  broadcastEvents(events);

  // Sincroniza el estado del crédito (VIGENTE/EN_MORA) con sus cuotas.
  await pool.query(
    `UPDATE credits c SET status = 'EN_MORA'
     WHERE status = 'VIGENTE' AND EXISTS (
       SELECT 1 FROM credit_schedule_installments csi
       WHERE csi.credit_id = c.id AND csi.status = 'EN_MORA'
     )`
  );
  await pool.query(
    `UPDATE credits c SET status = 'VIGENTE'
     WHERE status = 'EN_MORA' AND NOT EXISTS (
       SELECT 1 FROM credit_schedule_installments csi
       WHERE csi.credit_id = c.id AND csi.status = 'EN_MORA'
     )`
  );

  invalidateReportCache(); // cambiaron días de atraso y estados de cuotas/créditos
  return { created };
}

/**
 * Job diario: lo ejecuta UN solo proceso por día (reserva en job_runs). Si falla,
 * devuelve la reserva para que el siguiente intento (cada 10 min) lo reintente.
 */
export async function runDailyAlertsJob(
  now: Date = new Date(),
  job: (asOf: Date) => Promise<{ created: number; skipped?: boolean }> = recalculateAlerts
): Promise<{ ran: boolean; created?: number }> {
  const day = now.toISOString().slice(0, 10);
  if (!(await claimDailyRun("alerts-daily", day))) return { ran: false };
  try {
    const result = await job(now);
    if (result.skipped) {
      // Otra ejecución (p. ej. el botón "Recalcular") estaba en curso: se cuenta como hecho.
      return { ran: true, created: 0 };
    }
    return { ran: true, created: result.created };
  } catch (err) {
    await releaseDailyRun("alerts-daily", day).catch(() => undefined);
    throw err;
  }
}
