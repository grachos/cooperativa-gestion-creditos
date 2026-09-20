import { Router } from "express";
import { pool } from "../../db/pool.js";
import { associateSchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";

export const associatesRouter = Router();
associatesRouter.use(requireAuth);

associatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const search = (req.query.search as string | undefined)?.trim();
    const offset = (page - 1) * pageSize;

    const where = search
      ? `WHERE first_name LIKE ? OR last_name LIKE ? OR id_number LIKE ?`
      : "";
    const args = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM associates ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM associates ${where}`,
      args
    );
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

associatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT * FROM associates WHERE id = ?`, [id]);
    const associate = (rows as any[])[0];
    if (!associate) throw new HttpError(404, "Asociado no encontrado");

    const [credits] = await pool.query<any[]>(
      `SELECT c.* FROM credits c
       JOIN credit_participants cp ON cp.credit_id = c.id
       WHERE cp.associate_id = ? GROUP BY c.id`,
      [id]
    );
    const [alerts] = await pool.query<any[]>(
      `SELECT a.* FROM alerts a
       JOIN credits c ON c.id = a.credit_id
       JOIN credit_participants cp ON cp.credit_id = c.id
       WHERE cp.associate_id = ? AND a.status = 'ABIERTA'`,
      [id]
    );

    res.json({ ...associate, credits, activeAlerts: alerts });
  })
);

associatesRouter.post(
  "/",
  requirePermission("associates:write"),
  asyncHandler(async (req, res) => {
    const data = associateSchema.parse(req.body);

    const [existing] = await pool.query<any[]>(
      `SELECT id FROM associates WHERE id_type = ? AND id_number = ?`,
      [data.idType, data.idNumber]
    );
    if ((existing as any[]).length > 0) {
      throw new HttpError(409, "Ya existe un asociado con esta identificación");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO associates
        (id_type, id_number, first_name, last_name, birth_date, phone, email, address, municipality, department, country, income_info, employer_name, employer_address, employer_phone, employer_email, notes, data_consent, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.idType,
        data.idNumber,
        data.firstName,
        data.lastName,
        data.birthDate ?? null,
        data.phone ?? null,
        data.email ?? null,
        data.address ?? null,
        data.municipality ?? null,
        data.department ?? null,
        data.country ?? "Colombia",
        data.incomeInfo ?? null,
        data.employerName ?? null,
        data.employerAddress ?? null,
        data.employerPhone ?? null,
        data.employerEmail ?? null,
        data.notes ?? null,
        data.dataConsent ?? false,
        req.user!.id
      ]
    );

    await recordAudit(pool, {
      entity: "associate",
      entityId: result.insertId,
      action: "CREATE",
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(201).json({ id: result.insertId });
  })
);

associatesRouter.put(
  "/:id",
  requirePermission("associates:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = associateSchema.partial().parse(req.body);

    const [rows] = await pool.query<any[]>(`SELECT * FROM associates WHERE id = ?`, [id]);
    const before = (rows as any[])[0];
    if (!before) throw new HttpError(404, "Asociado no encontrado");

    const fields = Object.entries(data).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return res.json({ id });

    const columnMap: Record<string, string> = {
      idType: "id_type",
      idNumber: "id_number",
      firstName: "first_name",
      lastName: "last_name",
      birthDate: "birth_date",
      incomeInfo: "income_info",
      employerName: "employer_name",
      employerAddress: "employer_address",
      employerPhone: "employer_phone",
      employerEmail: "employer_email",
      dataConsent: "data_consent"
    };
    const setClause = fields.map(([k]) => `${columnMap[k] ?? k} = ?`).join(", ");
    const values = fields.map(([, v]) => v);

    await pool.query(`UPDATE associates SET ${setClause} WHERE id = ?`, [...values, id]);

    await recordAudit(pool, {
      entity: "associate",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.json({ id });
  })
);

associatesRouter.post(
  "/:id/status",
  requirePermission("associates:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const status = req.body?.status === "INACTIVO" ? "INACTIVO" : "ACTIVO";
    await pool.query(`UPDATE associates SET status = ? WHERE id = ?`, [status, id]);
    await recordAudit(pool, {
      entity: "associate",
      entityId: id,
      action: "STATUS_CHANGE",
      newValue: { status },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id, status });
  })
);
