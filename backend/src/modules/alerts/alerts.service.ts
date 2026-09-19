import { pool } from "../../db/pool.js";
import { calculateOverdueDays, getMoraBucket, DEFAULT_DELINQUENCY_POLICY } from "../delinquency/delinquency.service.js";
import { broadcastEvent } from "./sse.hub.js";

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
 * En esta demo se ejecuta on-demand vía endpoint; en producción debería
 * programarse como job diario.
 */
export async function recalculateAlerts(asOf: Date = new Date()) {
  const [installments] = await pool.query<any[]>(
    `SELECT csi.*, c.id as credit_id_ref FROM credit_schedule_installments csi
     JOIN credits c ON c.id = csi.credit_id
     WHERE csi.status NOT IN ('PAGADA','ANULADA') AND c.status NOT IN ('PAGADO','ANULADO')`
  );

  let created = 0;

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
          : getMoraBucket(overdueDays).code === "CD001"
          ? "VENCIDA"
          : "EN_MORA";
      await pool.query(`UPDATE credit_schedule_installments SET overdue_days = ?, status = ? WHERE id = ?`, [
        overdueDays,
        newStatus,
        inst.id
      ]);
      inst.status = newStatus;
    }

    let type: string | null = null;
    let priority: "BAJA" | "MEDIA" | "ALTA" = "MEDIA";
    let message = "";

    if (daysToDue === DEFAULT_DELINQUENCY_POLICY.earlyAlertDays && daysToDue > 0) {
      type = "PROXIMO_VENCIMIENTO";
      priority = "BAJA";
      message = `Cuota #${inst.installment_number} vence en ${daysToDue} día(s)`;
    } else if (daysToDue === 0) {
      type = "VENCIMIENTO_DEL_DIA";
      priority = "MEDIA";
      message = `Cuota #${inst.installment_number} vence hoy`;
    } else if (overdueDays > 0) {
      const bucket = getMoraBucket(overdueDays);
      if (bucket.code !== "CD001") {
        type = `MORA_${bucket.code}`;
        priority = BUCKET_PRIORITY[bucket.code] ?? "MEDIA";
        message = `Cuota #${inst.installment_number} entró en ${bucket.label} (${overdueDays} días de atraso)`;
      }
    }

    if (!type) continue;

    const [existing] = await pool.query<any[]>(
      `SELECT id FROM alerts WHERE installment_id = ? AND type = ? AND status = 'ABIERTA'`,
      [inst.id, type]
    );
    if ((existing as any[]).length > 0) continue;

    await pool.query(
      `INSERT INTO alerts (credit_id, installment_id, type, priority, message) VALUES (?, ?, ?, ?, ?)`,
      [inst.credit_id, inst.id, type, priority, message]
    );
    created++;
    broadcastEvent("alert.created", { creditId: inst.credit_id, type, priority, message });
  }

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

  return { created };
}
