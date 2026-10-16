-- Reunión con la cooperativa (2026-10-16), Fase 5: mora, gasto de notificación y descuento por pago
-- anticipado, todo parametrizable (docs/plan-reunion-2026-10-16.md).
--
--  1. payments.early_payoff: marca el pago que canceló el crédito de forma anticipada. Ese pago lleva un
--     descuento sobre intereses futuros que reduce las cuotas, por eso NO se puede reversar (ver
--     payments.routes.ts).
--  2. Parámetros con un VALOR INICIAL propuesto (la cooperativa lo ajusta en Parámetros):
--       politica_mora  -> 0,05 % por día de atraso sobre la cuota vencida, desde el día 9, modo SUGERIDO
--                         (el sistema calcula y sugiere; quien tiene permiso de ajustes decide cuánto cobra).
--                         Solo se reemplaza si sigue siendo el valor original de demostración (sin mora),
--                         nunca si alguien ya lo editó.
--       gasto_notificacion -> $100.000 (valor que aparece en el histórico del Excel) a los 30 días de
--                         mora y de nuevo cada 30 días.
--       descuento_pago_anticipado -> 50 % del interés de las cuotas aún no vencidas.
--  3. tipos_ajuste: se agrega INTERES_MORA (mora cobrada a un crédito).
--
-- Repetible: ver 021_multiprocess_guards.sql.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'early_payoff') = 0,
  'ALTER TABLE payments ADD COLUMN early_payoff TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

UPDATE parameters
SET value = '{"cap":null,"base":"CUOTA_VENCIDA","mode":"SUGERIDO","version":"v3-sugerida","rateType":"DIARIA","graceDays":8,"rateOrValue":0.05,"earlyAlertDays":3}',
    description = 'Interés de mora. rateOrValue = % por día de atraso (rateType DIARIA) sobre la cuota vencida (base CUOTA_VENCIDA) o solo sobre el capital (CAPITAL_VENCIDO); graceDays = días de gracia antes de empezar a contar; cap = tope en pesos (vacío = sin tope). mode SUGERIDO: el sistema calcula la mora y la sugiere al registrar el pago, y quien tiene permiso de ajustes decide cuánto cobrar; AUTOMATICO la cobra siempre.'
WHERE `key` = 'politica_mora'
  AND JSON_UNQUOTE(JSON_EXTRACT(value, '$.version')) = 'demo-v2-real'
  AND JSON_EXTRACT(value, '$.rateOrValue') = 0;

INSERT IGNORE INTO parameters (`key`, value, description) VALUES
  ('gasto_notificacion',
   '{"enabled":true,"amount":100000,"firstAfterOverdueDays":30,"repeatEveryOverdueDays":30}',
   'Gasto de notificación sugerido: valor en pesos, a partir de cuántos días de mora se sugiere por primera vez y cada cuántos días se vuelve a sugerir (0 = una sola vez). enabled en falso lo desactiva.'),
  ('descuento_pago_anticipado',
   '{"enabled":true,"percentOfFutureInterest":50}',
   'Descuento por cancelar el crédito antes de tiempo: porcentaje del interés de las cuotas que aún no han vencido. Es el valor sugerido; quien tiene permiso de ajustes puede cambiarlo al cancelar. enabled en falso lo desactiva.');

UPDATE parameters
SET value = JSON_ARRAY_APPEND(value, '$', 'INTERES_MORA')
WHERE `key` = 'tipos_ajuste' AND JSON_SEARCH(value, 'one', 'INTERES_MORA') IS NULL;
