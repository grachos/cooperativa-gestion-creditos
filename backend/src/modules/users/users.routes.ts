import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../../utils/password.js";
import { pool, withTransaction } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { createUserSchema, updateUserSchema, idParam } from "../../shared/schemas.js";
import { recordAudit } from "../audit/audit.service.js";
import { idempotent } from "../../middlewares/idempotent.js";

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
  idempotent("users.create"),
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);

    const [existing] = await pool.query<any[]>(
      `SELECT id FROM users WHERE email = ? OR username = ?`,
      [data.email, data.username]
    );
    if ((existing as any[]).length > 0) {
      throw new HttpError(409, "Ya existe un usuario con ese correo o usuario");
    }

    const passwordHash = await hashPassword(data.password);

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

// Catálogo de permisos (para las casillas de la pantalla de Usuarios).
usersRouter.get(
  "/permissions",
  requirePermission("users:write"),
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(`SELECT code, description FROM permissions ORDER BY code ASC`);
    res.json({ data: rows });
  })
);

/** Permisos que dan los roles de un usuario (sin las diferencias por usuario). */
async function rolePermissionCodes(db: { query: typeof pool.query }, userId: number): Promise<Set<string>> {
  const [rows] = await db.query<any[]>(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return new Set((rows as any[]).map((r) => r.code as string));
}

// Vista de administración: todos los usuarios (activos e inactivos) con sus
// roles, para poder activar/desactivar, reasignar roles o restablecer la
// contraseña de un Gestor/Vendedor u otro usuario del sistema.
// Incluye `permissions`: los permisos efectivos de cada usuario (roles + diferencias por usuario).
usersRouter.get(
  "/manage",
  requirePermission("users:write"),
  asyncHandler(async (_req, res) => {
    const [permRows] = await pool.query<any[]>(
      `SELECT ur.user_id, p.code FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id`
    );
    const [overrideRows] = await pool.query<any[]>(
      `SELECT up.user_id, p.code, up.granted FROM user_permissions up JOIN permissions p ON p.id = up.permission_id`
    );
    const effective = new Map<number, Set<string>>();
    for (const r of permRows as any[]) {
      if (!effective.has(r.user_id)) effective.set(r.user_id, new Set());
      effective.get(r.user_id)!.add(r.code);
    }
    for (const o of overrideRows as any[]) {
      if (!effective.has(o.user_id)) effective.set(o.user_id, new Set());
      if (o.granted) effective.get(o.user_id)!.add(o.code);
      else effective.get(o.user_id)!.delete(o.code);
    }
    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.full_name, u.email, u.username, u.status,
              u.id_type, u.id_number, u.phone, u.address,
              (SELECT GROUP_CONCAT(r.code ORDER BY r.code SEPARATOR ',')
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id) AS role_codes
       FROM users u ORDER BY u.full_name ASC`
    );
    res.json({
      data: (rows as any[]).map((r) => ({
        ...r,
        role_codes: r.role_codes ? String(r.role_codes).split(",") : [],
        permissions: [...(effective.get(r.id) ?? [])].sort()
      }))
    });
  })
);

// Casillas de "qué puede hacer cada usuario": recibe la lista final de permisos y guarda solo la
// diferencia contra lo que ya dan sus roles (agregados y quitados). La persona ve el cambio cuando
// su sesión se renueva (hasta 15 min) o vuelve a entrar; por eso se invalida su sesión actual.
const setPermissionsSchema = z.object({ permissions: z.array(z.string().min(1).max(80)).max(100) });

usersRouter.put(
  "/:id/permissions",
  requirePermission("users:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { permissions } = setPermissionsSchema.parse(req.body);
    const desired = new Set(permissions);

    const [userRows] = await pool.query<any[]>(`SELECT id FROM users WHERE id = ?`, [id]);
    if ((userRows as any[]).length === 0) throw new HttpError(404, "Usuario no encontrado");
    // Quitarse a uno mismo la administración de usuarios dejaría el sistema sin quien la restablezca.
    if (id === req.user!.id && !desired.has("users:write")) {
      throw new HttpError(400, "No puede quitarse a sí mismo el permiso de administrar usuarios");
    }

    const result = await withTransaction(async (conn) => {
      const [allRows] = await conn.query<any[]>(`SELECT id, code FROM permissions`);
      const known = new Map((allRows as any[]).map((p) => [p.code as string, p.id as number]));
      const unknown = permissions.filter((p) => !known.has(p));
      if (unknown.length > 0) throw new HttpError(400, `Permisos desconocidos: ${unknown.join(", ")}`);

      const fromRoles = await rolePermissionCodes(conn, id);
      await conn.query(`DELETE FROM user_permissions WHERE user_id = ?`, [id]);
      const granted: string[] = [];
      const denied: string[] = [];
      for (const [code, permissionId] of known) {
        const wants = desired.has(code);
        const has = fromRoles.has(code);
        if (wants === has) continue;
        await conn.query(
          `INSERT INTO user_permissions (user_id, permission_id, granted, updated_by) VALUES (?, ?, ?, ?)`,
          [id, permissionId, wants ? 1 : 0, req.user!.id]
        );
        (wants ? granted : denied).push(code);
      }
      // La sesión vigente se invalida: al renovarse el token se calculan los permisos nuevos.
      await conn.query(`UPDATE users SET refresh_token_hash = NULL WHERE id = ?`, [id]);
      return { granted, denied };
    });

    await recordAudit(pool, {
      entity: "user",
      entityId: id,
      action: "PERMISSIONS_UPDATE",
      newValue: result,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.json({ id, ...result });
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
        // Al desactivar se revoca la sesión: sin esto el refresh token seguía
        // emitiendo access tokens hasta su expiración (7 días).
        await conn.query(
          `UPDATE users SET status = ?, refresh_token_hash = CASE WHEN ? = 'INACTIVO' THEN NULL ELSE refresh_token_hash END WHERE id = ?`,
          [data.status, data.status, id]
        );
      }
      if (data.fullName) {
        await conn.query(`UPDATE users SET full_name = ? WHERE id = ?`, [data.fullName, id]);
      }
      if (data.email) {
        const [dup] = await conn.query<any[]>(`SELECT id FROM users WHERE email = ? AND id <> ?`, [data.email, id]);
        if ((dup as any[]).length > 0) throw new HttpError(409, "Ese correo ya está en uso por otro usuario");
        await conn.query(`UPDATE users SET email = ? WHERE id = ?`, [data.email, id]);
      }
      if (data.password) {
        const passwordHash = await hashPassword(data.password);
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
        fullName: data.fullName,
        email: data.email,
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
