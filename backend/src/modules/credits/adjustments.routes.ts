import { Router } from "express";
import { pool } from "../../db/pool.js";
import { adjustmentSchema, idParam } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";

/**
 * Ajustes manuales por crédito: interés por cambio de fecha, descuentos
 * autorizados, gastos de notificación. En el Excel de la cooperativa estos
 * aparecían como columnas sueltas ("VALOR INTERES POR CAMBIO DE FECHA",
 * "VALOR DESCONTADO DE J.J") sin trazabilidad de quién los autorizó; aquí
 * quedan como movimientos auditables con un aprobador obligatorio.
 */
export const adjustmentsRouter = Router();
adjustmentsRouter.use(requireAuth);

adjustmentsRouter.post(
  "/:id/adjustments",
  requirePermission("adjustments:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = adjustmentSchema.parse(req.body);

    const [creditRows] = await pool.query<any[]>(`SELECT id FROM credits WHERE id = ?`, [id]);
    if ((creditRows as any[]).length === 0) throw new HttpError(404, "Crédito no encontrado");

    if (data.installmentId) {
      const [instRows] = await pool.query<any[]>(
        `SELECT id FROM credit_schedule_installments WHERE id = ? AND credit_id = ?`,
        [data.installmentId, id]
      );
      if ((instRows as any[]).length === 0) throw new HttpError(400, "La cuota indicada no pertenece a este crédito");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO credit_adjustments (credit_id, installment_id, type, amount, reason, approved_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.installmentId ?? null, data.type, data.amount, data.reason, req.user!.id]
    );

    await recordAudit(pool, {
      entity: "credit_adjustment",
      entityId: result.insertId,
      action: "CREATE",
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip,
      reason: data.reason
    });

    res.status(201).json({ id: result.insertId });
  })
);
