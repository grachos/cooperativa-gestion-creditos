import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool, withTransaction } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { createUserSchema, updateUserSchema, idParam } from "../../shared/schemas.js";
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
        `INSERT INTO users (email, username, password_hash, full_name, id_type, id_number, phone, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.email,
          data.username,
          passwordHash,
          data.fullName,
          data.idType ?? null,
          data.idNumber ?? null,
          data.phone ?? null,
          data.address ?? null
        ]
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

// Vista de administración: todos los usuarios (activos e inactivos) con sus
// roles, para poder activar/desactivar, reasignar roles o restablecer la
// contraseña de un Gestor/Vendedor u otro usuario del sistema.
usersRouter.get(
  "/manage",
  requirePermission("users:write"),
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.full_name, u.email, u.username, u.status,
              u.id_type, u.id_number, u.phone, u.address,
              COALESCE(
                (SELECT json_agg(r.code ORDER BY r.code)
                 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id),
                '[]'
              ) AS role_codes
       FROM users u ORDER BY u.full_name ASC`
    );
    res.json({ data: rows });
  })
);

usersRouter.patch(
  "/:id",
  requirePermission("users:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = updateUserSchema.parse(req.body);

    const [existing] = await pool.query<any[]>(`SELECT id FROM users WHERE id = ?`, [id]);
    if ((existing as any[]).length === 0) throw new HttpError(404, "Usuario no encontrado");

    await withTransaction(async (conn) => {
      if (data.status) {
        await conn.query(`UPDATE users SET status = ? WHERE id = ?`, [data.status, id]);
      }
      if (data.password) {
        const passwordHash = await bcrypt.hash(data.password, 10);
        await conn.query(`UPDATE users SET password_hash = ?, refresh_token_hash = NULL WHERE id = ?`, [
          passwordHash,
          id
        ]);
      }
      if (data.roleCodes) {
        await conn.query(`DELETE FROM user_roles WHERE user_id = ?`, [id]);
        for (const roleCode of data.roleCodes) {
          const [roleRows] = await conn.query<any[]>(`SELECT id FROM roles WHERE code = ?`, [roleCode]);
          const role = (roleRows as any[])[0];
          if (!role) throw new HttpError(400, `Rol desconocido: ${roleCode}`);
          await conn.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [id, role.id]);
        }
      }
      if (data.idType !== undefined || data.idNumber !== undefined || data.phone !== undefined || data.address !== undefined) {
        await conn.query(
          `UPDATE users SET
             id_type = COALESCE(?, id_type),
             id_number = COALESCE(?, id_number),
             phone = COALESCE(?, phone),
             address = COALESCE(?, address)
           WHERE id = ?`,
          [data.idType ?? null, data.idNumber ?? null, data.phone ?? null, data.address ?? null, id]
        );
      }
    });

    await recordAudit(pool, {
      entity: "user",
      entityId: id,
      action: "UPDATE",
      newValue: {
        status: data.status,
        roleCodes: data.roleCodes,
        passwordChanged: Boolean(data.password),
        idType: data.idType,
        idNumber: data.idNumber,
        phone: data.phone,
        address: data.address
      },
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(204).send();
  })
);
