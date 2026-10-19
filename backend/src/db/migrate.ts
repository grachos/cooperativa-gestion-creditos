import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reglas CHECK de la migración 028 (docs/escalabilidad.md §3.17).
const EXPECTED_CHECKS = [
  "chk_inst_paid_nonneg",
  "chk_inst_due_nonneg",
  "chk_inst_balance_nonneg",
  "chk_inst_principal_le_due",
  "chk_inst_interest_le_due",
  "chk_inst_other_le_due",
  "chk_credit_balance_nonneg",
  "chk_payment_amount_pos",
  "chk_alloc_amount_pos",
  "chk_adj_paid_range"
];

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

  // Un solo proceso migra a la vez. Hostinger puede arrancar dos procesos casi juntos (o
  // reiniciar uno a mitad de arranque): sin este candado ambos intentaban aplicar la misma
  // migración y el segundo fallaba. GET_LOCK espera (hasta 120 s) y, al obtenerlo, vuelve a
  // leer qué migraciones ya están aplicadas.
  const [lockRows] = await conn.query("SELECT GET_LOCK('coop:migrations', 120) AS got");
  if (Number((lockRows as any[])[0].got) !== 1) {
    throw new Error("No se pudo obtener el candado de migraciones (otro proceso está migrando)");
  }

  try {
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

  await reportChecks(conn);
  console.log("Migraciones completadas.");
  } finally {
    await conn.query("SELECT RELEASE_LOCK('coop:migrations')").catch(() => undefined);
    await conn.end();
  }
}

/**
 * La 028 omite una regla CHECK si el servidor no las hace cumplir o si hay datos que la
 * incumplen (para no tumbar el arranque). Aquí se deja constancia en el log para revisarlo.
 */
async function reportChecks(conn: mysql.Connection) {
  try {
    const [[ver]] = (await conn.query("SELECT VERSION() AS v")) as any;
    const [rows] = await conn.query(
      `SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND CONSTRAINT_NAME IN (?)`,
      [EXPECTED_CHECKS]
    );
    const active = new Set((rows as any[]).map((r) => r.name));
    const missing = EXPECTED_CHECKS.filter((n) => !active.has(n));
    const msg = `[db] ${ver.v}; reglas CHECK activas ${active.size}/${EXPECTED_CHECKS.length}`;
    if (missing.length) console.warn(`${msg}. Faltan (versión sin soporte o datos que las incumplen): ${missing.join(", ")}`);
    else console.log(msg);
  } catch (err) {
    console.warn("[db] no se pudo revisar las reglas CHECK", err);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch((err) => {
    console.error("Error ejecutando migraciones", err);
    process.exit(1);
  });
}
