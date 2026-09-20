-- Hallazgo del Excel real: algunos créditos se fondean con capital de un
-- tercero ("tomador") que recibe una tasa distinta (más baja) que la que
-- paga el asociado; la diferencia es el margen de la cooperativa. Patrón
-- verificado como general en el histórico (16 meses consecutivos, 4% al
-- asociado vs 1,9% al tomador, diferencia 2,1% exacta en todos los casos).
-- Se agrega como campos opcionales por crédito: si no aplica (fondeado con
-- capital propio de la cooperativa), quedan NULL.
ALTER TABLE credits
  ADD COLUMN funder_name VARCHAR(255) NULL,
  ADD COLUMN funder_rate_percent DECIMAL(8,4) NULL;
