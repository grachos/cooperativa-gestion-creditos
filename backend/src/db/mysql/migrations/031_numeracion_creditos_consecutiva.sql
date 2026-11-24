-- Numeración de créditos consecutiva y SIN año (pedido de la cooperativa, 2026-11-24): "CR-2026-00001" pasa a
-- "CR-00001". Son los primeros créditos y el año en que se cargaron no debe aparecer en el número.
--
-- Qué hace (solo cambia la ETIQUETA del crédito; ninguna relación usa el número: pagos, cuotas, ajustes, alertas,
-- participantes y demás apuntan al id del crédito):
--  1. Agrega credits.legacy_credit_number y guarda ahí el número anterior de cada crédito que cambie: es lo que permite
--     seguir buscándolo por su número viejo (listado y actividad) y deshacer el cambio si hiciera falta.
--  2. Renumera TODOS los créditos existentes 1..N en el orden en que se crearon (por id), con 5 dígitos.
--  3. Deja el contador `sequences('credit_number')` en N: el próximo crédito será CR-(N+1). Las filas del contador por
--     año (`credit_number:AAAA`) quedan sin usar; no se borran.
--
-- NO toca: auditoría (conserva lo que se escribió en su momento), eventos de integración ni ningún dato de dinero.
--
-- Repetible: la columna es condicional; el número anterior solo se guarda si aún no hay uno y el actual no tiene ya
-- el formato nuevo; el UPDATE solo cambia lo que no coincide con su posición (una segunda ejecución no cambia nada,
-- también si ya se crearon créditos nuevos con el contador). Es una sola sentencia: se aplica completa o no se aplica.
-- La tabla temporal evita el error 1093 de MySQL (actualizar una tabla leyéndola en la misma sentencia).
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'legacy_credit_number') = 0,
  'ALTER TABLE credits ADD COLUMN legacy_credit_number VARCHAR(30) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_legacy_number') = 0,
  'ALTER TABLE credits ADD KEY idx_credits_legacy_number (legacy_credit_number)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

-- 1. El número anterior, una sola vez (solo si todavía no tiene el formato nuevo).
UPDATE credits SET legacy_credit_number = credit_number
WHERE legacy_credit_number IS NULL AND credit_number NOT REGEXP '^CR-[0-9]{5,}$';

-- 2. Renumerar 1..N por orden de creación.
DROP TEMPORARY TABLE IF EXISTS tmp_credit_rank;
CREATE TEMPORARY TABLE tmp_credit_rank AS
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM credits;
UPDATE credits c
JOIN tmp_credit_rank x ON x.id = c.id
SET c.credit_number = CONCAT('CR-', LPAD(x.rn, 5, '0'))
WHERE c.credit_number <> CONCAT('CR-', LPAD(x.rn, 5, '0'));
DROP TEMPORARY TABLE tmp_credit_rank;

-- 3. El contador continúa desde la cantidad de créditos (nunca retrocede).
INSERT IGNORE INTO sequences (name, value) VALUES ('credit_number', 0);
UPDATE sequences SET value = GREATEST(value, (SELECT COUNT(*) FROM credits)) WHERE name = 'credit_number';
