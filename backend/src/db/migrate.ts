import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(160) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const [appliedRows] = await pool.query<any[]>("SELECT name FROM schema_migrations");
  const applied = new Set((appliedRows as any[]).map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const conn = await pool.getConnection();
    try {
      // Se ejecuta el archivo completo en una sola sentencia: Postgres
      // soporta múltiples statements separados por ";" en una sola consulta
      // (protocolo simple), y así no se rompen los cuerpos de función
      // delimitados con $$ ... $$ que sí contienen punto y coma.
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      console.log(`Aplicada migración: ${file}`);
    } finally {
      conn.release();
    }
  }

  console.log("Migraciones completadas.");
  await pool.end();
}

run().catch((err) => {
  console.error("Error ejecutando migraciones", err);
  process.exit(1);
});
