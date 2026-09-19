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
          COALESCE(SUM(principal_balance), 0) as capitalPendiente,
          COUNT(*) as creditosVigentes
         FROM credits WHERE status = 'VIGENTE'`
      ),
      pool.query<any[]>(
        `SELECT COUNT(DISTINCT credit_id) as creditosVencidos
         FROM credit_schedule_installments WHERE status IN ('VENCIDA','EN_MORA')`
      ),
      pool.query<any[]>(
        `SELECT COALESCE(SUM(amount), 0) as pagosPeriodo
         FROM payments WHERE status = 'CONFIRMADO' AND received_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
      ),
      pool.query<any[]>(
        `SELECT COUNT(*) as solicitudesPendientes FROM credit_applications WHERE status IN ('RADICADA','EN_REVISION')`
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
