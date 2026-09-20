import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
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
    const month = req.query.month ? Number(req.query.month) : null;

    const conditions: string[] = [];
    if (year) conditions.push("EXTRACT(YEAR FROM m.month) = ?");
    if (month) conditions.push("EXTRACT(MONTH FROM m.month) = ?");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const args = [year, month].filter((v): v is number => v !== null);

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
       ${where}
       ORDER BY m.month ASC`,
      args
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

/**
 * Detalle mensual por crédito, hallazgo directo de la hoja mensual real de
 * la cooperativa (una fila por crédito abierto ese mes: día de pago, valor
 * del crédito, valor de la cuota, cuotas pagas/pendientes, valor pagado/
 * pendiente, recaudo del mes, capital/interés por recaudar y recaudado).
 * A diferencia de la mora (que no tiene historial), esto SÍ se puede
 * reconstruir con exactitud histórica porque `payment_allocations` guarda
 * cada abono por concepto, con la fecha del pago (`payments.received_date`):
 * sumando solo los abonos con fecha <= fin de mes se obtiene el estado real
 * del crédito en ese corte, no el estado actual.
 * "Créditos cancelados antes/durante el mes" usa la misma aproximación que
 * el reporte mensual agregado (`status='PAGADO'` + `updated_at`), documentada
 * ahí, por no existir historial de estados de crédito.
 */
reportsRouter.get(
  "/credits-monthly-detail",
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month || month < 1 || month > 12) {
      throw new HttpError(400, "year y month son requeridos (month entre 1 y 12)");
    }
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

    const [rows] = await pool.query<any[]>(
      `WITH bounds AS (
         SELECT ?::date AS month_start,
                (?::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS month_end
       ),
       open_credits AS (
         SELECT c.id, c.credit_number, c.disbursed_amount, c.term_value,
                c.first_installment_date, c.titular_associate_id, c.titular_society_id
         FROM credits c, bounds b
         WHERE c.disbursement_date <= b.month_end
           AND NOT (c.status = 'PAGADO' AND c.updated_at::date <= b.month_start - INTERVAL '1 day')
       ),
       schedule_totals AS (
         SELECT credit_id,
                COUNT(*) AS n_installments,
                SUM(principal_due) AS total_principal,
                SUM(interest_due) AS total_interest,
                SUM(total_due) AS total_due,
                MIN(total_due) FILTER (WHERE installment_number = 1) AS installment_value
         FROM credit_schedule_installments
         WHERE status != 'ANULADA'
         GROUP BY credit_id
       ),
       per_installment_paid AS (
         SELECT csi.id, csi.credit_id, csi.total_due,
                COALESCE(SUM(pa.amount) FILTER (
                  WHERE pa.concept IN ('CAPITAL','INTERES') AND p.status = 'CONFIRMADO' AND p.received_date <= (SELECT month_end FROM bounds)
                ), 0) AS paid_to_date,
                (csi.due_date <= (SELECT month_end FROM bounds)) AS was_due
         FROM credit_schedule_installments csi
         LEFT JOIN payment_allocations pa ON pa.installment_id = csi.id
         LEFT JOIN payments p ON p.id = pa.payment_id
         WHERE csi.status != 'ANULADA'
         GROUP BY csi.id, csi.credit_id, csi.total_due, csi.due_date
       ),
       installments_agg AS (
         SELECT credit_id,
                COUNT(*) FILTER (WHERE paid_to_date >= total_due - 0.01) AS installments_paid,
                COUNT(*) FILTER (WHERE was_due AND paid_to_date < total_due - 0.01) AS installments_overdue
         FROM per_installment_paid
         GROUP BY credit_id
       ),
       paid_to_date AS (
         SELECT csi.credit_id,
                COALESCE(SUM(pa.amount) FILTER (WHERE pa.concept = 'CAPITAL'), 0) AS capital_paid_to_date,
                COALESCE(SUM(pa.amount) FILTER (WHERE pa.concept = 'INTERES'), 0) AS interest_paid_to_date
         FROM credit_schedule_installments csi
         JOIN payment_allocations pa ON pa.installment_id = csi.id
         JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMADO'
         WHERE p.received_date <= (SELECT month_end FROM bounds)
         GROUP BY csi.credit_id
       ),
       collected_this_month AS (
         SELECT csi.credit_id,
                COALESCE(SUM(pa.amount) FILTER (WHERE pa.concept = 'CAPITAL'), 0) AS capital_collected_month,
                COALESCE(SUM(pa.amount) FILTER (WHERE pa.concept = 'INTERES'), 0) AS interest_collected_month,
                COALESCE(SUM(pa.amount), 0) AS total_collected_month
         FROM credit_schedule_installments csi
         JOIN payment_allocations pa ON pa.installment_id = csi.id
         JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMADO'
         WHERE p.received_date BETWEEN (SELECT month_start FROM bounds) AND (SELECT month_end FROM bounds)
         GROUP BY csi.credit_id
       )
       SELECT
         oc.credit_number,
         COALESCE(a.first_name || ' ' || a.last_name, s.legal_name) AS client_name,
         EXTRACT(DAY FROM oc.first_installment_date) AS payment_day,
         oc.disbursed_amount,
         st.installment_value,
         st.n_installments,
         COALESCE(ia.installments_paid, 0) AS installments_paid,
         st.n_installments - COALESCE(ia.installments_paid, 0) AS installments_pending,
         COALESCE(ia.installments_overdue, 0) AS installments_overdue,
         COALESCE(ptd.capital_paid_to_date, 0) + COALESCE(ptd.interest_paid_to_date, 0) AS paid_to_date,
         st.total_due - (COALESCE(ptd.capital_paid_to_date, 0) + COALESCE(ptd.interest_paid_to_date, 0)) AS pending_to_date,
         COALESCE(ctm.total_collected_month, 0) AS collected_month,
         st.total_principal - COALESCE(ptd.capital_paid_to_date, 0) AS principal_to_collect,
         st.total_interest - COALESCE(ptd.interest_paid_to_date, 0) AS interest_to_collect,
         COALESCE(ctm.capital_collected_month, 0) AS principal_collected_month,
         COALESCE(ctm.interest_collected_month, 0) AS interest_collected_month
       FROM open_credits oc
       JOIN schedule_totals st ON st.credit_id = oc.id
       LEFT JOIN installments_agg ia ON ia.credit_id = oc.id
       LEFT JOIN paid_to_date ptd ON ptd.credit_id = oc.id
       LEFT JOIN collected_this_month ctm ON ctm.credit_id = oc.id
       LEFT JOIN associates a ON a.id = oc.titular_associate_id
       LEFT JOIN societies s ON s.id = oc.titular_society_id
       ORDER BY oc.credit_number ASC`,
      [monthStart, monthStart]
    );

    const data = (rows as any[]).map((r) => {
      const installmentsPaid = Number(r.installments_paid);
      const nInstallments = Number(r.n_installments);
      const status =
        installmentsPaid >= nInstallments
          ? "PAGADO"
          : Number(r.installments_overdue) > 0
            ? "EN_MORA"
            : "VIGENTE";
      return {
        creditNumber: r.credit_number,
        clientName: r.client_name ?? "—",
        paymentDay: Number(r.payment_day),
        status,
        creditValue: Number(r.disbursed_amount),
        installmentValue: Number(r.installment_value),
        installmentsCount: nInstallments,
        installmentsPaid,
        installmentsPending: Number(r.installments_pending),
        paidToDate: Number(r.paid_to_date),
        pendingToDate: Number(r.pending_to_date),
        collectedMonth: Number(r.collected_month),
        principalToCollect: Number(r.principal_to_collect),
        interestToCollect: Number(r.interest_to_collect),
        principalCollectedMonth: Number(r.principal_collected_month),
        interestCollectedMonth: Number(r.interest_collected_month)
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
