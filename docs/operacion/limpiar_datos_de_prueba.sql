-- Borra los DATOS DE PRUEBA (asociados, sociedades, solicitudes, créditos, pagos, alertas, auditoría, sesiones,
-- usuarios de prueba) y deja la aplicación lista para cargar los datos reales.
--
-- CONSERVA: la estructura, los roles y permisos, los parámetros (con su historial de edición) y los usuarios
-- cuyo correo pongas en @conservar. Reinicia la numeración de créditos (el próximo será CR-AAAA-00001).
-- NO se puede deshacer: ANTES exporta la base completa en phpMyAdmin (Exportar → Rápido → SQL).
--
-- Cómo usarlo: phpMyAdmin → base de datos de la cooperativa → pestaña SQL → pegar TODO este archivo,
-- cambiar la línea de @conservar y ejecutar. Todo ocurre en una transacción: si @conservar no coincide con
-- ningún usuario existente (nadie podría entrar después), se revierte y no cambia nada.

SET @conservar = 'admin@coomulnissi.cc';   -- correos separados por coma, sin espacios

SET @conservados = (SELECT COUNT(*) FROM users WHERE FIND_IN_SET(email, @conservar));
SELECT @conservados AS usuarios_que_se_conservan,
       (SELECT COUNT(*) FROM users) AS usuarios_antes,
       (SELECT COUNT(*) FROM associates) AS asociados_antes,
       (SELECT COUNT(*) FROM credits) AS creditos_antes,
       (SELECT COUNT(*) FROM payments) AS pagos_antes;

START TRANSACTION;

-- Orden: primero las tablas que dependen de otras (hijas), al final las de las que dependen. No usa
-- FOREIGN_KEY_CHECKS: phpMyAdmin lo vuelve a activar y el borrado falla si el orden no es el correcto.
DELETE FROM alerts;
DELETE FROM application_disbursements;
DELETE FROM application_reference_checks;
DELETE FROM associate_documents;
DELETE FROM audit_logs;
DELETE FROM collection_actions;
DELETE FROM credit_application_documents;
DELETE FROM credit_application_status_history;
DELETE FROM credit_legal_documents;
DELETE FROM credit_participants;
DELETE FROM delinquency_calculations;
DELETE FROM idempotency_keys;
DELETE FROM integration_attempts;
DELETE FROM job_runs;
DELETE FROM login_activity;
DELETE FROM notifications;
DELETE FROM password_reset_tokens;
DELETE FROM payment_allocations;
DELETE FROM realtime_events;
DELETE FROM sequences;
DELETE FROM credit_adjustments;
DELETE FROM integration_events;
DELETE FROM payments;
DELETE FROM credit_schedule_installments;
-- Un crédito refinanciado apunta a otro crédito: se sueltan esos enlaces antes de borrarlos.
UPDATE credits SET refinanced_from_credit_id = NULL, refinanced_to_credit_id = NULL;
DELETE FROM credits;
DELETE FROM credit_applications;
DELETE FROM societies;
DELETE FROM associates;

DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE NOT FIND_IN_SET(email, @conservar));
DELETE FROM user_roles       WHERE user_id IN (SELECT id FROM users WHERE NOT FIND_IN_SET(email, @conservar));
UPDATE parameters SET updated_by = NULL
  WHERE updated_by IN (SELECT id FROM users WHERE NOT FIND_IN_SET(email, @conservar));
DELETE FROM users WHERE NOT FIND_IN_SET(email, @conservar);
-- Quita las sesiones abiertas de los usuarios que se conservan (tendrán que volver a iniciar sesión).
UPDATE users SET refresh_token_hash = NULL;

-- Si no se conservaba a nadie, se revierte todo; si no, se confirma.
SET @fin = IF(@conservados > 0, 'COMMIT', 'ROLLBACK');
PREPARE fin_stmt FROM @fin;
EXECUTE fin_stmt;
DEALLOCATE PREPARE fin_stmt;

SELECT IF(@conservados > 0, 'LISTO: datos de prueba borrados', 'REVERTIDO: @conservar no coincide con ningún usuario') AS resultado,
       (SELECT COUNT(*) FROM users) AS usuarios_despues,
       (SELECT COUNT(*) FROM associates) AS asociados_despues,
       (SELECT COUNT(*) FROM credits) AS creditos_despues,
       (SELECT COUNT(*) FROM payments) AS pagos_despues,
       (SELECT COUNT(*) FROM parameters) AS parametros,
       (SELECT COUNT(*) FROM roles) AS roles;
