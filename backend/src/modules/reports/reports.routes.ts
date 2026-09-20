import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { MORA_BUCKETS, getMoraBucket } from "../delinquency/delinquency.service.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const [[carteraRows], [morosRows], [pagosRows], [solicitudesRows], [alertasRows]] = await Promise.all([
      pool.query<any[]>(
        `SELECT
          COALESCE(SUM(principal_balance), 0) as "capitalPendiente",
          COUNT(*) as "creditosVigentes"
         FROM credits WHERE status = 'VIGENTE'`
      ),
      pool.query<any[]>(
        `SELECT COUNT(DISTINCT credit_id) as "creditosVencidos"
         FROM credit_schedule_installments WHERE status IN ('VENCIDA','EN_MORA')`
      ),
      pool.query<any[]>(
        `SELECT COALESCE(SUM(amount), 0) as "pagosPeriodo"
         FROM payments WHERE status = 'CONFIRMADO' AND received_date >= CURRENT_DATE - INTERVAL '30 days'`
      ),
      pool.query<any[]>(
        `SELECT COUNT(*) as "solicitudesPendientes" FROM credit_applications WHERE status IN ('RADICADA','EN_REVISION')`
      ),
      pool.query<any[]>(
        `SELECT priority, COUNT(*) as total FROM alerts WHERE status = 'ABIERTA' GROUP BY priority`
      )
    ]);

    res.json({
      asOf: new Date().toISOString(),
      capitalPendiente: Number((carteraRows as any[])[0].capitalPendiente),
      creditosVigentes: Number((carteraRows as any[])[0].creditosVigentes),
      creditosVencidos: Number((morosRows as any[])[0].creditosVencidos),
      pagosUltimos30Dias: Number((pagosRows as any[])[0].pagosPeriodo),
      solicitudesPendientes: Number((solicitudesRows as any[])[0].solicitudesPendientes),
      alertasPorPrioridad: alertasRows
    });
  })
);

reportsRouter.get(
  "/due-on-date",
  asyncHandler(async (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query<any[]>(
      `SELECT csi.*, c.credit_number, a.first_name, a.last_name, s.legal_name
       FROM credit_schedule_installments csi
       JOIN credits c ON c.id = csi.credit_id
       LEFT JOIN associates a ON a.id = c.titular_associate_id
       LEFT JOIN societies s ON s.id = c.titular_society_id
       WHERE csi.due_date = ? AND csi.status NOT IN ('PAGADA','ANULADA')`,
      [date]
    );
    res.json({ date, data: rows });
  })
);

reportsRouter.get(
  "/overdue",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT csi.*, c.credit_number, a.first_name, a.last_name
       FROM credit_schedule_installments csi
       JOIN credits c ON c.id = csi.credit_id
       LEFT JOIN associates a ON a.id = c.titular_associate_id
       WHERE csi.status IN ('VENCIDA','EN_MORA') ORDER BY csi.overdue_days DESC`
    );
    const data = (rows as any[]).map((row) => ({ ...row, moraCode: getMoraBucket(row.overdue_days).code }));
    res.json({ data });
  })
);

/**
 * Mora por bucket de días (30/60/90/120/150/180), igual a la clasificación
 * "CÓDIGO DE MORA" del Excel real de la cooperativa. Equivalente a las
 * columnas "Cuotas en mora" / "Mora al cierre del mes" de su informe
 * mensual, calculado aquí en tiempo real en vez de por corte mensual.
 */
reportsRouter.get(
  "/mora-buckets",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT csi.overdue_days, (csi.total_due - csi.principal_paid - csi.interest_paid) AS outstanding
       FROM credit_schedule_installments csi
       JOIN credits c ON c.id = csi.credit_id
       WHERE csi.status NOT IN ('PAGADA','ANULADA') AND c.status NOT IN ('PAGADO','ANULADO') AND csi.overdue_days > 0`
    );

    const summary = MORA_BUCKETS.filter((b) => b.code !== "CD001").map((b) => ({
      code: b.code,
      label: b.label,
      count: 0,
      value: 0
    }));

    for (const row of rows as any[]) {
      const bucket = getMoraBucket(row.overdue_days);
      const entry = summary.find((s) => s.code === bucket.code);
      if (!entry) continue;
      entry.count += 1;
      entry.value += Number(row.outstanding);
    }

    res.json({ data: summary.map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 })) });
  })
);

/**
 * Reporte mensual de cartera, hallazgo directo del informe real de la
 * cooperativa (hoja con columnas Año/Mes/Créditos Desembolsados/Valor
 * Desembolsos/Créditos Cancelados/Valor Cancelados/Cuotas x
 * recaudo/Recaudado/etc.). Se reconstruyen las columnas que se pueden
 * calcular con exactitud a partir del histórico actual:
 *  - Créditos desembolsados y su valor: por `disbursement_date`.
 *  - Créditos cancelados (pagados en su totalidad) y su valor: se usa
 *    `updated_at` del crédito como aproximación del mes en que pasó a
 *    PAGADO (no hay una tabla de historial de estados de crédito; sí existe
 *    para solicitudes, pero no para créditos). El valor es el monto
 *    desembolsado original, no el saldo exacto pagado en la cancelación.
 *  - Cuotas por recaudar (due ese mes) y cuántas quedaron pagadas.
 *  - Valor recaudado: suma de pagos CONFIRMADOs recibidos ese mes (no
 *    necesariamente de cuotas que vencían ese mismo mes — es el efectivo
 *    recaudado en el mes, igual a como lo registra la cooperativa).
 * No se incluyen columnas de "Mora al cierre del mes" por período histórico:
 * el sistema no guarda una foto de la mora al cierre de cada mes pasado
 * (solo el estado/mora actual de cada cuota) — para eso se usa el reporte
 * en tiempo real `/reports/mora-buckets`.
 */
reportsRouter.get(
  "/monthly-summary",
  asyncHandler(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : null;

    const [rows] = await pool.query<any[]>(
      `WITH disb AS (
         SELECT date_trunc('month', disbursement_date)::date AS month,
                COUNT(*) AS credits_disbursed,
                SUM(disbursed_amount) AS disbursed_amount
         FROM credits GROUP BY 1
       ),
       cancel AS (
         SELECT date_trunc('month', updated_at)::date AS month,
                COUNT(*) AS credits_cancelled,
                SUM(disbursed_amount) AS cancelled_amount
         FROM credits WHERE status = 'PAGADO' GROUP BY 1
       ),
       due AS (
         SELECT date_trunc('month', due_date)::date AS month,
                COUNT(*) AS installments_due,
                SUM(total_due) AS due_amount,
                COUNT(*) FILTER (WHERE status = 'PAGADA') AS installments_paid
         FROM credit_schedule_installments WHERE status != 'ANULADA' GROUP BY 1
       ),
       recaudo AS (
         SELECT date_trunc('month', received_date)::date AS month,
                SUM(amount) AS collected_amount
         FROM payments WHERE status = 'CONFIRMADO' GROUP BY 1
       ),
       months AS (
         SELECT month FROM disb
         UNION SELECT month FROM cancel
         UNION SELECT month FROM due
         UNION SELECT month FROM recaudo
       )
       SELECT
         m.month,
         COALESCE(disb.credits_disbursed, 0) AS "creditsDisbursedCount",
         COALESCE(disb.disbursed_amount, 0) AS "disbursedAmount",
         COALESCE(cancel.credits_cancelled, 0) AS "creditsCancelledCount",
         COALESCE(cancel.cancelled_amount, 0) AS "cancelledAmount",
         COALESCE(due.installments_due, 0) AS "installmentsDueCount",
         COALESCE(due.due_amount, 0) AS "dueAmount",
         COALESCE(due.installments_paid, 0) AS "installmentsPaidCount",
         COALESCE(recaudo.collected_amount, 0) AS "collectedAmount"
       FROM months m
       LEFT JOIN disb ON disb.month = m.month
       LEFT JOIN cancel ON cancel.month = m.month
       LEFT JOIN due ON due.month = m.month
       LEFT JOIN recaudo ON recaudo.month = m.month
       ${year ? "WHERE EXTRACT(YEAR FROM m.month) = ?" : ""}
       ORDER BY m.month ASC`,
      year ? [year] : []
    );

    const data = (rows as any[]).map((r) => {
      const dueAmount = Number(r.dueAmount);
      const collectedAmount = Number(r.collectedAmount);
      const installmentsDueCount = Number(r.installmentsDueCount);
      const installmentsPaidCount = Number(r.installmentsPaidCount);
      return {
        year: new Date(r.month).getUTCFullYear(),
        month: new Date(r.month).getUTCMonth() + 1,
        creditsDisbursedCount: Number(r.creditsDisbursedCount),
        disbursedAmount: Number(r.disbursedAmount),
        creditsCancelledCount: Number(r.creditsCancelledCount),
        cancelledAmount: Number(r.cancelledAmount),
        installmentsDueCount,
        dueAmount,
        installmentsPaidCount,
        installmentsPaidPercent: installmentsDueCount > 0 ? (installmentsPaidCount / installmentsDueCount) * 100 : 0,
        collectedAmount,
        collectedPercent: dueAmount > 0 ? (collectedAmount / dueAmount) * 100 : 0
      };
    });

    res.json({ data });
  })
);

reportsRouter.get(
  "/payments.csv",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT p.id, p.credit_id, c.credit_number, p.received_date, p.amount, p.payment_method, p.status
       FROM payments p JOIN credits c ON c.id = p.credit_id ORDER BY p.received_date DESC`
    );
    const header = "id,credit_id,credit_number,received_date,amount,payment_method,status\n";
    const body = (rows as any[])
      .map((r) => `${r.id},${r.credit_id},${r.credit_number},${r.received_date},${r.amount},${r.payment_method},${r.status}`)
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=pagos.csv");
    res.send(header + body);
  })
);
