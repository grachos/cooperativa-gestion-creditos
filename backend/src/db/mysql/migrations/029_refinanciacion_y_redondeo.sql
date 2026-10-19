-- Refinanciación y redondeo de la cuota según la regla confirmada por la cooperativa (2026-10-19,
-- hallazgo H9, docs/escalabilidad.md §3.18). Antes la refinanciación tomaba lo pendiente (capital +
-- interés) como capital nuevo y le cobraba OTRA VEZ la tasa por todo el plazo nuevo, y la cuota no se
-- redondeaba (el crédito real de $4.100.000 tiene cuota $391.800, no $391.777,78).
--
--  redondeo_cuota  -> la cuota se redondea HACIA ARRIBA al múltiplo indicado ($100) y la diferencia queda
--                     como interés. Aplica a los créditos que se desembolsen o refinancien desde ahora; los
--                     cronogramas ya creados no cambian. 0 = sin redondeo.
--  refinanciacion  -> chargeOriginalInterestOnPending: al refinanciar se suma el interés mensual del préstamo
--                     inicial × cuotas pendientes (regla de la hoja de la cooperativa). false lo apaga.
--
-- Solo inserta (INSERT IGNORE): repetible y nunca pisa un valor ya editado en Parámetros.
INSERT IGNORE INTO parameters (`key`, value, description) VALUES
  ('redondeo_cuota',
   '{"multiple":100}',
   'Redondeo de la cuota mensual: se redondea hacia arriba al múltiplo indicado en pesos (100 = $213.333,33 pasa a $213.400) y la diferencia se carga al interés. 0 = sin redondeo. Aplica a créditos nuevos y refinanciaciones; los ya creados no cambian.'),
  ('refinanciacion',
   '{"chargeOriginalInterestOnPending":true}',
   'Refinanciación: el nuevo crédito hereda lo que falta de las cuotas pendientes (capital + interés) y, si chargeOriginalInterestOnPending es verdadero, se suma el interés mensual del préstamo inicial por cada cuota pendiente. No lleva interés propio. El dinero nuevo se presta como un crédito aparte.');
