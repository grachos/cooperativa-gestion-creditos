-- Mismo caso que tipos_identificacion (014): "tipos_ajuste" en Parámetros
-- era solo de exhibición porque el formulario de ajustes de crédito traía
-- su propia lista fija, y aunque se hubiera leído del parámetro, la tabla
-- credit_adjustments tenía un CHECK que solo permitía los 4 valores
-- originales. Se quita para que el parámetro gobierne la lista de verdad.
-- "metodos_pago" no necesita nada aquí: payments.payment_method nunca tuvo
-- CHECK ni enum de zod, solo el formulario traía la lista fija (se corrige
-- únicamente en el frontend).
ALTER TABLE credit_adjustments DROP CONSTRAINT credit_adjustments_type_check;
