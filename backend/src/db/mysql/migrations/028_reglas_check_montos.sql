-- Reglas CHECK sobre los montos (auditoría de transacciones, docs/escalabilidad.md §3.17).
--
-- Por qué: hasta ahora solo el código impedía pagado > debido, saldos negativos o pagos
-- en cero. Los errores H1–H5 dejaron saldos inconsistentes que nadie detectó hasta la
-- auditoría. Con estas reglas la base RECHAZA la escritura (y la transacción completa se
-- revierte) en lugar de guardar un dato imposible.
--
-- Cuidados (para no tumbar el arranque, ver §3.9):
--  - Solo se agregan si el servidor las hace cumplir: MySQL >= 8.0.16 o MariaDB >= 10.2.1.
--    En versiones anteriores MySQL las acepta pero las ignora: se omiten.
--  - Cada regla se agrega solo si NO existe ya (repetible si se interrumpe) y si NINGUNA
--    fila actual la incumple. Si hay datos que la incumplen, la regla se omite y el
--    arranque lo avisa en el log ("[db] reglas CHECK…", db/migrate.ts) para revisarlo.
SET @coop_v = VERSION();
SET @coop_vn = SUBSTRING_INDEX(@coop_v, '-', 1);
SET @coop_num = CAST(SUBSTRING_INDEX(@coop_vn, '.', 1) AS UNSIGNED) * 10000
  + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(@coop_vn, '.', 2), '.', -1) AS UNSIGNED) * 100
  + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(@coop_vn, '.', 3), '.', -1) AS UNSIGNED);
SET @coop_checks = IF(@coop_v LIKE '%MariaDB%', @coop_num >= 100201, @coop_num >= 80016);

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_paid_nonneg') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (principal_paid >= 0 AND interest_paid >= 0 AND late_fee_paid >= 0 AND other_paid >= 0)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_paid_nonneg CHECK (principal_paid >= 0 AND interest_paid >= 0 AND late_fee_paid >= 0 AND other_paid >= 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_due_nonneg') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (principal_due >= 0 AND interest_due >= 0 AND other_due >= 0)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_due_nonneg CHECK (principal_due >= 0 AND interest_due >= 0 AND other_due >= 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_balance_nonneg') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (balance >= 0)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_balance_nonneg CHECK (balance >= 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_principal_le_due') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (principal_paid <= principal_due)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_principal_le_due CHECK (principal_paid <= principal_due)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_interest_le_due') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (interest_paid <= interest_due)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_interest_le_due CHECK (interest_paid <= interest_due)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND CONSTRAINT_NAME = 'chk_inst_other_le_due') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_schedule_installments WHERE NOT (other_paid <= other_due)),
  'ALTER TABLE credit_schedule_installments ADD CONSTRAINT chk_inst_other_le_due CHECK (other_paid <= other_due)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND CONSTRAINT_NAME = 'chk_credit_balance_nonneg') = 0
  AND NOT EXISTS (SELECT 1 FROM credits WHERE NOT (principal_balance >= 0)),
  'ALTER TABLE credits ADD CONSTRAINT chk_credit_balance_nonneg CHECK (principal_balance >= 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND CONSTRAINT_NAME = 'chk_payment_amount_pos') = 0
  AND NOT EXISTS (SELECT 1 FROM payments WHERE NOT (amount > 0)),
  'ALTER TABLE payments ADD CONSTRAINT chk_payment_amount_pos CHECK (amount > 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_allocations' AND CONSTRAINT_NAME = 'chk_alloc_amount_pos') = 0
  AND NOT EXISTS (SELECT 1 FROM payment_allocations WHERE NOT (amount > 0)),
  'ALTER TABLE payment_allocations ADD CONSTRAINT chk_alloc_amount_pos CHECK (amount > 0)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;

SET @ddl = IF(
  @coop_checks
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_adjustments' AND CONSTRAINT_NAME = 'chk_adj_paid_range') = 0
  AND NOT EXISTS (SELECT 1 FROM credit_adjustments WHERE NOT (paid_amount >= 0 AND paid_amount <= amount)),
  'ALTER TABLE credit_adjustments ADD CONSTRAINT chk_adj_paid_range CHECK (paid_amount >= 0 AND paid_amount <= amount)',
  'SELECT 1');
PREPARE coop_stmt FROM @ddl;
EXECUTE coop_stmt;
DEALLOCATE PREPARE coop_stmt;
