import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";

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
