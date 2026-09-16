import { Router } from "express";
import { pool } from "../../db/pool.js";
import { societySchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";

export const societiesRouter = Router();
societiesRouter.use(requireAuth);

societiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const search = (req.query.search as string | undefined)?.trim();
    const offset = (page - 1) * pageSize;
    const where = search ? `WHERE legal_name LIKE ? OR tax_id_number LIKE ?` : "";
    const args = search ? [`%${search}%`, `%${search}%`] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM societies ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM societies ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

societiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT * FROM societies WHERE id = ?`, [id]);
    const society = (rows as any[])[0];
    if (!society) throw new HttpError(404, "Sociedad no encontrada");
    res.json(society);
  })
);

societiesRouter.post(
  "/",
  requirePermission("associates:write"),
  asyncHandler(async (req, res) => {
    const data = societySchema.parse(req.body);
    const [existing] = await pool.query<any[]>(
      `SELECT id FROM societies WHERE tax_id_type = ? AND tax_id_number = ?`,
      [data.taxIdType, data.taxIdNumber]
    );
    if ((existing as any[]).length > 0) {
      throw new HttpError(409, "Ya existe una sociedad con este NIT");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO societies
        (tax_id_type, tax_id_number, legal_name, trade_name, legal_representative_associate_id, phone, email, address, economic_activity, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.taxIdType,
        data.taxIdNumber,
        data.legalName,
        data.tradeName ?? null,
        data.legalRepresentativeAssociateId ?? null,
        data.phone ?? null,
        data.email ?? null,
        data.address ?? null,
        data.economicActivity ?? null,
        data.notes ?? null,
        req.user!.id
      ]
    );

    await recordAudit(pool, {
      entity: "society",
      entityId: result.insertId,
      action: "CREATE",
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(201).json({ id: result.insertId });
  })
);
