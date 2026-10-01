import { Router } from "express";
import { pool } from "../../db/pool.js";
import { associateSchema, associateStatusSchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";
import { isAdult } from "../../utils/age.js";

export const associatesRouter = Router();
associatesRouter.use(requireAuth);

associatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const search = (req.query.search as string | undefined)?.trim();
    // Usado por el selector de titular/codeudor de una solicitud nueva: un
    // asociado inactivo o rechazado como participante no debe poder
    // volver a elegirse.
    const selectable = req.query.selectable === "true";
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const args: unknown[] = [];
    if (search) {
      conditions.push(`(first_name LIKE ? OR last_name LIKE ? OR id_number LIKE ?)`);
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (selectable) {
      conditions.push(`status = 'ACTIVO'`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

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

    if (!isAdult(data.birthDate)) {
      throw new HttpError(400, "El asociado debe ser mayor de edad (18 años o más) para registrarse");
    }
    if (data.isEmployed && (!data.employerName || !data.employerAddress || !data.employerPhone || !data.employerEmail)) {
      throw new HttpError(400, "Debe indicar los datos de la empresa cuando el asociado es empleado");
    }

    const [existing] = await pool.query<any[]>(
      `SELECT id FROM associates WHERE id_type = ? AND id_number = ?`,
      [data.idType, data.idNumber]
    );
    if ((existing as any[]).length > 0) {
      throw new HttpError(409, "Ya existe un asociado con esta identificación");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO associates
        (id_type, id_number, first_name, last_name, birth_date, phone, email, address, municipality, department, country, income_info, is_employed, employer_name, employer_address, employer_phone, employer_email, notes, data_consent, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.idType,
        data.idNumber,
        data.firstName,
        data.lastName,
        data.birthDate,
        data.phone,
        data.email,
        data.address ?? null,
        data.municipality ?? null,
        data.department ?? null,
        data.country ?? "Colombia",
        data.incomeInfo ?? null,
        data.isEmployed,
        data.isEmployed ? data.employerName : null,
        data.isEmployed ? data.employerAddress : null,
        data.isEmployed ? data.employerPhone : null,
        data.isEmployed ? data.employerEmail : null,
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

    if (data.birthDate !== undefined && !isAdult(data.birthDate)) {
      throw new HttpError(400, "El asociado debe ser mayor de edad (18 años o más) para registrarse");
    }

    const effectiveEmployed = data.isEmployed ?? before.is_employed;
    if (effectiveEmployed) {
      const employerName = data.employerName !== undefined ? data.employerName : before.employer_name;
      const employerAddress = data.employerAddress !== undefined ? data.employerAddress : before.employer_address;
      const employerPhone = data.employerPhone !== undefined ? data.employerPhone : before.employer_phone;
      const employerEmail = data.employerEmail !== undefined ? data.employerEmail : before.employer_email;
      if (!employerName || !employerAddress || !employerPhone || !employerEmail) {
        throw new HttpError(400, "Debe indicar los datos de la empresa cuando el asociado es empleado");
      }
    } else if (data.isEmployed === false) {
      data.employerName = null;
      data.employerAddress = null;
      data.employerPhone = null;
      data.employerEmail = null;
    }

    const fields = Object.entries(data).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return res.json({ id });

    const columnMap: Record<string, string> = {
      idType: "id_type",
      idNumber: "id_number",
      firstName: "first_name",
      lastName: "last_name",
      birthDate: "birth_date",
      incomeInfo: "income_info",
      isEmployed: "is_employed",
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
    const { status } = associateStatusSchema.parse(req.body);
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
