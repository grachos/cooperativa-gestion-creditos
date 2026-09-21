-- Los parámetros se sembraron con llaves en inglés y una descripción
-- genérica de "demostración, pendiente de confirmación". La cooperativa ya
-- confirmó estos valores contra su Excel real (ver comentarios en
-- delinquency.service.ts), así que se renombran a español y se reemplaza
-- la descripción por una que explica cada parámetro en concreto (algunas
-- superan los 255 caracteres originales, de ahí el ALTER).
ALTER TABLE parameters ALTER COLUMN description TYPE VARCHAR(500);

UPDATE parameters SET
  "key" = 'tipos_ajuste',
  description = 'Tipos de ajuste manual que se pueden aplicar a un crédito (cambio de fecha con interés, descuento, gasto de notificación, u otro).'
WHERE "key" = 'adjustment_types';

UPDATE parameters SET
  "key" = 'orden_aplicacion_pago',
  description = 'Orden en que se aplica un pago recibido a un crédito: primero gastos, luego mora, luego interés y por último capital.'
WHERE "key" = 'allocation_order';

UPDATE parameters SET
  "key" = 'politica_mora',
  description = 'Política de mora vigente: hoy la cooperativa no cobra interés de mora automático (confirmado contra el histórico real, sin evidencia de cargos automáticos por mora); solo hace seguimiento por rangos de días de atraso y aplica cargos puntuales manuales cuando corresponde.'
WHERE "key" = 'delinquency_policy';

UPDATE parameters SET
  "key" = 'tipos_identificacion',
  description = 'Tipos de documento de identificación aceptados para asociados y usuarios del sistema.'
WHERE "key" = 'id_types';

UPDATE parameters SET
  "key" = 'modelo_interes',
  description = 'Modelo de interés usado para calcular las cuotas: interés fijo sobre el capital original repartido en partes iguales entre todas las cuotas (no es amortización francesa). Confirmado contra el histórico real de créditos de la cooperativa.'
WHERE "key" = 'interest_model';

UPDATE parameters SET
  "key" = 'rangos_mora',
  description = 'Rangos (buckets) de días de atraso usados para clasificar la mora de cada cuota, con los mismos códigos que usa hoy la cooperativa en su Excel.'
WHERE "key" = 'mora_buckets';

UPDATE parameters SET
  "key" = 'metodos_pago',
  description = 'Métodos de pago aceptados para registrar un abono a un crédito.'
WHERE "key" = 'payment_methods';
