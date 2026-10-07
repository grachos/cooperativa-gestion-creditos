// Une las migraciones numeradas de ./migrations en un solo archivo,
// schema_completo.sql, que se puede importar de una vez (phpMyAdmin en
// Hostinger, o `mysql < schema_completo.sql`). Se regenera con:
//   npm run db:mysql:build
// Después de agregar o cambiar una migración hay que volver a ejecutarlo y
// subir el schema_completo.sql resultante junto con el cambio.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(path.join(dir, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const parts = [
  `-- GENERADO por build-schema.mjs a partir de migrations/*.sql — no editar a mano.
-- Esquema completo de la aplicación para MySQL 8 / MariaDB 10.4+.
-- Ejecutar UNA sola vez sobre una base de datos vacía (no es repetible: las
-- migraciones con ALTER TABLE fallarían la segunda vez).
-- Después ejecutar seed_base.sql. Ver README.md.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
`
];

for (const file of files) {
  parts.push(`-- ============================================================\n-- ${file}\n-- ============================================================\n`);
  parts.push(fs.readFileSync(path.join(dir, "migrations", file), "utf8").trim() + "\n");
}

parts.push(`-- ============================================================
-- Registro de migraciones aplicadas (mismas columnas que usa el runner de
-- Postgres, para poder usar un runner con MySQL más adelante sin repetirlas)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(160) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES
${files.map((f) => `  ('${f}')`).join(",\n")};
`);

fs.writeFileSync(path.join(dir, "schema_completo.sql"), parts.join("\n"));
console.log(`schema_completo.sql generado con ${files.length} migraciones.`);
