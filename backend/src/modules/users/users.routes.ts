import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool, withTransaction } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { createUserSchema } from "../../shared/schemas.js";
import { recordAudit } from "../audit/audit.service.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT id, full_name, email FROM users WHERE status = 'ACTIVO' ORDER BY full_name ASC`
    );
    res.json({ data: rows });
  })
);

// Permite dar de alta usuarios del sistema — necesario para poder asignar un
// nuevo "Gestor de cartera" o "Vendedor" (ambos son usuarios asignables en el
// desembolso: assigned_collector_id/assigned_seller_id). Antes solo existían
// los usuarios creados por el script de seed.
usersRouter.post(
  "/",
  requirePermission("users:write"),
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);

    const [existing] = await pool.query<any[]>(
      `SELECT id FROM users WHERE email = ? OR username = ?`,
      [data.email, data.username]
    );
    if ((existing as any[]).length > 0) {
      throw new HttpError(409, "Ya existe un usuario con ese correo o usuario");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const userId = await withTransaction(async (conn) => {
      const [result] = await conn.query<any>(
        `INSERT INTO users (email, username, password_hash, full_name)
         VALUES (?, ?, ?, ?)`,
        [data.email, data.username, passwordHash, data.fullName]
      );
      const newUserId = result.insertId;

      for (const roleCode of data.roleCodes) {
        const [roleRows] = await conn.query<any[]>(`SELECT id FROM roles WHERE code = ?`, [roleCode]);
        const role = (roleRows as any[])[0];
        if (!role) throw new HttpError(400, `Rol desconocido: ${roleCode}`);
        await conn.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [newUserId, role.id]);
      }

      return newUserId;
    });

    await recordAudit(pool, {
      entity: "user",
      entityId: userId,
      action: "CREATE",
      newValue: { email: data.email, username: data.username, fullName: data.fullName, roleCodes: data.roleCodes },
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(201).json({ id: userId });
  })
);

usersRouter.get(
  "/roles",
  requirePermission("users:write"),
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(`SELECT code, name FROM roles ORDER BY name ASC`);
    res.json({ data: rows });
  })
);
