-- Índices según las consultas reales de la app, medidos con EXPLAIN y tiempos sobre
-- ~1,5 millones de filas (ver docs/escalabilidad.md §6 y backend/scripts/explain-bench.mjs).
--
-- REPETIBLE: cada CREATE/DROP es condicional (information_schema + PREPARE), para que una
-- interrupción a mitad de arranque no deje la migración irrecuperable (ver 021 y CLAUDE.md).
-- Primero se crean los índices nuevos y DESPUÉS se eliminan los que quedaron redundantes
-- (prefijo de uno nuevo): así nunca queda una llave foránea sin índice y se reduce el costo
-- de escritura.

-- audit_logs: listado de auditoría ordenado por fecha (hoy escanea toda la tabla)
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_created_at') = 0,
  'CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- audit_logs: listado filtrado por entidad
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_entity_created') = 0,
  'CREATE INDEX idx_audit_logs_entity_created ON audit_logs (entity, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- alerts: listado de alertas (status + ORDER BY priority, created_at); reemplaza idx_alerts_status
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'idx_alerts_status_priority_created') = 0,
  'CREATE INDEX idx_alerts_status_priority_created ON alerts (status, priority, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credits: listado de cartera por estado; reemplaza idx_credits_status
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_status_created') = 0,
  'CREATE INDEX idx_credits_status_created ON credits (status, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credits: listado de cartera sin filtro
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_created') = 0,
  'CREATE INDEX idx_credits_created ON credits (created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credit_applications: listado de solicitudes por estado; reemplaza idx_applications_status
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_applications' AND INDEX_NAME = 'idx_applications_status_created') = 0,
  'CREATE INDEX idx_applications_status_created ON credit_applications (status, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credit_applications: listado de solicitudes sin filtro
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_applications' AND INDEX_NAME = 'idx_applications_created') = 0,
  'CREATE INDEX idx_applications_created ON credit_applications (created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- associates: listado de asociados
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'associates' AND INDEX_NAME = 'idx_associates_created') = 0,
  'CREATE INDEX idx_associates_created ON associates (created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- associates: selector de asociados activos
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'associates' AND INDEX_NAME = 'idx_associates_status_created') = 0,
  'CREATE INDEX idx_associates_status_created ON associates (status, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- payments: dashboard y reportes por fecha de pago
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_payments_status_received') = 0,
  'CREATE INDEX idx_payments_status_received ON payments (status, received_date)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- payments: detalle del crédito (pagos por fecha); reemplaza idx_payments_credit
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_payments_credit_received') = 0,
  'CREATE INDEX idx_payments_credit_received ON payments (credit_id, received_date)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credit_schedule_installments: cartera vencida ordenada por días de atraso; reemplaza idx_installments_status
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND INDEX_NAME = 'idx_installments_status_overdue') = 0,
  'CREATE INDEX idx_installments_status_overdue ON credit_schedule_installments (status, overdue_days)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- credit_schedule_installments: conteo de créditos vencidos (índice cubriente)
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND INDEX_NAME = 'idx_installments_status_credit') = 0,
  'CREATE INDEX idx_installments_status_credit ON credit_schedule_installments (status, credit_id)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- login_activity: bloqueo por intentos fallidos en cada login
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_activity' AND INDEX_NAME = 'idx_login_activity_user_event_created') = 0,
  'CREATE INDEX idx_login_activity_user_event_created ON login_activity (user_id, event_type, created_at)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- payment_allocations: reportes mensuales: sumas por cuota sin leer la tabla (índice cubriente)
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_allocations' AND INDEX_NAME = 'idx_allocations_installment_payment') = 0,
  'CREATE INDEX idx_allocations_installment_payment ON payment_allocations (installment_id, payment_id, concept, amount)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- payments: exportación CSV por tramos ordenada por fecha de recibido (paginación por llave)
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_payments_received') = 0,
  'CREATE INDEX idx_payments_received ON payments (received_date)', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

-- Índices que quedaron redundantes (son prefijo de uno nuevo)

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'idx_alerts_status') > 0,
  'DROP INDEX idx_alerts_status ON alerts', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_status') > 0,
  'DROP INDEX idx_credits_status ON credits', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_applications' AND INDEX_NAME = 'idx_applications_status') > 0,
  'DROP INDEX idx_applications_status ON credit_applications', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_payments_credit') > 0,
  'DROP INDEX idx_payments_credit ON payments', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_schedule_installments' AND INDEX_NAME = 'idx_installments_status') > 0,
  'DROP INDEX idx_installments_status ON credit_schedule_installments', 'SELECT 1');
PREPARE ddl_stmt FROM @ddl; EXECUTE ddl_stmt; DEALLOCATE PREPARE ddl_stmt;
