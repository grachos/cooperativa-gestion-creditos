import { pool } from "../../db/pool.js";
import { calculateOverdueDays, DEFAULT_DELINQUENCY_POLICY } from "../delinquency/delinquency.service.js";
import { broadcastEvent } from "./sse.hub.js";

/**
 * Recalcula días de atraso y genera alertas tempranas/tardías.
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

    let type: string | null = null;
    let priority: "BAJA" | "MEDIA" | "ALTA" = "MEDIA";
    let message = "";

    if (daysToDue === Math.abs(DEFAULT_DELINQUENCY_POLICY.earlyAlertDays) && daysToDue > 0) {
      type = "PROXIMO_VENCIMIENTO";
      priority = "BAJA";
      message = `Cuota #${inst.installment_number} vence en ${daysToDue} día(s)`;
    } else if (daysToDue === 0) {
      type = "VENCIMIENTO_DEL_DIA";
      priority = "MEDIA";
      message = `Cuota #${inst.installment_number} vence hoy`;
    } else if (overdueDays > 0 && overdueDays <= DEFAULT_DELINQUENCY_POLICY.lateAlertDays) {
      type = "MORA_INICIAL";
      priority = "MEDIA";
      message = `Cuota #${inst.installment_number} en mora hace ${overdueDays} día(s)`;
    } else if (overdueDays > DEFAULT_DELINQUENCY_POLICY.lateAlertDays) {
      type = "MORA_PROLONGADA";
      priority = "ALTA";
      message = `Cuota #${inst.installment_number} en mora prolongada (${overdueDays} días)`;
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

  return { created };
}
