import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Conexión propia con multipleStatements: cada migración trae varias
// sentencias. El pool de la app NO lo habilita (evita consultas apiladas).
async function run() {
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

  const dir = path.join(__dirname, "mysql", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const [appliedRows] = await conn.query("SELECT name FROM schema_migrations");
  const applied = new Set((appliedRows as any[]).map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    await conn.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    console.log(`Aplicada migración: ${file}`);
  }

  console.log("Migraciones completadas.");
  await conn.end();
}

run().catch((err) => {
  console.error("Error ejecutando migraciones", err);
  process.exit(1);
});
