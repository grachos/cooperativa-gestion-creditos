import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Conexión propia con multipleStatements: cada migración trae varias
// sentencias. El pool de la app NO lo habilita (evita consultas apiladas).
export async function runMigrations() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: "utf8mb4",
    multipleStatements: true
  });

  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(160) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Misma ruta tanto con tsx (src/db) como compilado (dist/db): los .sql
  // viven en src y tsc no los copia.
  const mysqlDir = path.resolve(__dirname, "../../src/db/mysql");
  const dir = path.join(mysqlDir, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const [appliedRows] = await conn.query("SELECT name FROM schema_migrations");
  const applied = new Set((appliedRows as any[]).map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    await conn.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    console.log(`Aplicada migración: ${file}`);
  }

  // Datos mínimos (roles, permisos, parámetros). Repetible: nunca pisa
  // parámetros ya editados.
  await conn.query(fs.readFileSync(path.join(mysqlDir, "seed_base.sql"), "utf8"));

  // Primer administrador: solo si aún no hay usuarios y se entregó el hash
  // de la contraseña (ADMIN_PASSWORD_HASH) por variable de entorno.
  if (env.ADMIN_PASSWORD_HASH) {
    const [users] = await conn.query("SELECT COUNT(*) AS total FROM users");
    if (Number((users as any[])[0].total) === 0) {
      const email = env.ADMIN_EMAIL ?? "admin@coomulnissi.cc";
      await conn.query("INSERT INTO users (email, username, password_hash, full_name) VALUES (?, 'admin', ?, 'Administrador')", [
        email,
        env.ADMIN_PASSWORD_HASH
      ]);
      await conn.query(
        "INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'admin' AND r.code = 'ADMIN'"
      );
      console.log(`Administrador inicial creado: ${email}`);
    }
  }

  console.log("Migraciones completadas.");
  await conn.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch((err) => {
    console.error("Error ejecutando migraciones", err);
    process.exit(1);
  });
}
