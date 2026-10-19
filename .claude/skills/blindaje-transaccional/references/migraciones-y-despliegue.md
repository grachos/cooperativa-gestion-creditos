# Migraciones y despliegue

## El incidente que lo explica todo

Una migración con `ALTER TABLE ADD COLUMN` se interrumpió porque el hosting reinició el proceso a mitad
de arranque. En MySQL el DDL **no es transaccional**: la columna quedó creada pero la migración no quedó
registrada. Cada arranque posterior intentaba repetirla, fallaba con "Duplicate column name" y el sitio
quedó caído. Las pruebas de despliegue solo habían cubierto base vacía y base con datos, no "a medias".

## Reglas

1. **Toda migración es repetible** (se puede ejecutar N veces sobre una base a medias o completa):
   - `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE` / `ON CONFLICT DO NOTHING` para datos semilla.
   - `ALTER` condicionales consultando `information_schema`:

     ```sql
     SET @ddl = IF(
       (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'early_payoff') = 0,
       'ALTER TABLE payments ADD COLUMN early_payoff TINYINT(1) NOT NULL DEFAULT 0',
       'SELECT 1');
     PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
     ```
     (mismo patrón con `STATISTICS` para índices y `TABLE_CONSTRAINTS` para llaves y CHECK).
   - `UPDATE` de reparación que dé el mismo resultado si se repite (recalcular, no sumar).
2. **Un solo proceso migra a la vez:** `SELECT GET_LOCK('app:migrations', 120)` (Postgres:
   `pg_advisory_lock`). Al obtenerlo, vuelve a leer qué migraciones están aplicadas.
3. **Prueba siempre tres casos** antes de subir: (A) base con la migración anterior y esta a medias;
   (B) ejecutarla dos veces seguidas; (C) dos procesos migrando a la vez sobre base vacía.
4. **Comentario de porqué** al inicio de cada migración: qué problema resuelve y por qué así.
5. **Esquema consolidado regenerado** (`schema_completo.sql` o equivalente) en el mismo commit.
6. **Nada de editar una migración ya desplegada**: se corrige con otra nueva.

## Restricciones nuevas (CHECK, UNIQUE) sobre datos existentes

Agregar una regla que los datos actuales incumplen hace fallar el ALTER → arranque caído. Por cada regla:

- agrégala solo si el motor la hace cumplir (MySQL ≥ 8.0.16, MariaDB ≥ 10.2.1; MySQL anterior las
  acepta y las ignora), detectándolo con `VERSION()`;
- solo si no existe ya (repetible);
- solo si **ninguna fila actual la incumple** (`NOT EXISTS (SELECT 1 FROM t WHERE NOT (expr))`);
- al arrancar, registra en el log la versión de la base y cuántas reglas quedaron activas y cuáles faltan
  (`[db] 11.8.9-MariaDB; reglas CHECK activas 10/10`). Así una regla omitida no pasa en silencio, y de
  paso se conoce la versión real del hosting (que en el caso de origen nadie sabía).
- Prueba también (D): base con un dato que incumple → se omite solo esa regla y el arranque sigue.

## Despliegue

- **Rama de despliegue explícita** en el `CLAUDE.md` (qué rama compila el hosting).
- **Verifica los logs de arranque** después de cada despliegue: migración aplicada, sin errores, proceso
  escuchando. Si el hosting tiene API o conector, úsalo; si no, pide al usuario que confirme.
- **Variables de entorno documentadas** en `.env.example` con su valor por defecto y el porqué.
- **Cambiar una duración de sesión o un secreto** afecta a usuarios conectados: avisa del efecto (p. ej.
  bajar el TTL del refresh token cierra sesiones viejas).

## Portabilidad

- **Postgres** tiene DDL transaccional: una migración interrumpida se revierte sola. Aun así usa
  `IF NOT EXISTS` y advisory lock (dos procesos), y nota que `CREATE INDEX CONCURRENTLY` no puede ir en
  transacción.
- **SQLite:** `ALTER` muy limitado; patrón de tabla nueva + copia + renombre dentro de transacción.
