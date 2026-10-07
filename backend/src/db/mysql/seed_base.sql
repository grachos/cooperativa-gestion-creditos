-- Datos base de la aplicación para MySQL: roles, permisos y parámetros.
-- NO incluye usuarios, asociados ni créditos de demostración.
--
-- Valores tomados de la base en producción (Supabase) el 2026-10-07, con los
-- parámetros ya renombrados a español (migración 011) y con los ajustes que
-- la cooperativa hizo desde la pantalla Parámetros (p. ej. tasa mensual por
-- defecto 2 %, tipo de documento OTRO, "Referencias laborales").
--
-- Es seguro ejecutarlo más de una vez: solo inserta lo que falta y nunca
-- pisa un parámetro que ya se haya editado desde la aplicación.
--
-- Ejecutar DESPUÉS de schema_completo.sql. Falta crear el primer usuario
-- administrador: ver README.md, paso 3.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Roles
INSERT INTO roles (code, name) VALUES
  ('ADMIN', 'Administrador'),
  ('OPERADOR', 'Operador de cartera'),
  ('APROBADOR', 'Aprobador'),
  ('CONTADORA', 'Contadora'),
  ('CONSULTA', 'Consulta')
ON DUPLICATE KEY UPDATE code = code;

-- Permisos
INSERT INTO permissions (code, description) VALUES
  ('associates:write', NULL),
  ('applications:write', NULL),
  ('applications:approve', NULL),
  ('disbursements:write', NULL),
  ('payments:write', NULL),
  ('alerts:write', NULL),
  ('parameters:write', NULL),
  ('audit:read', NULL),
  ('integration:write', NULL),
  ('reports:read', NULL),
  ('adjustments:write', NULL),
  ('collections:write', NULL),
  ('users:write', 'Crear y administrar usuarios del sistema')
ON DUPLICATE KEY UPDATE code = code;

-- Permisos por rol
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('adjustments:write', 'alerts:write', 'applications:approve', 'applications:write', 'associates:write', 'audit:read', 'collections:write', 'disbursements:write', 'integration:write', 'parameters:write', 'payments:write', 'reports:read', 'users:write')
WHERE r.code = 'ADMIN';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('adjustments:write', 'applications:approve', 'disbursements:write', 'reports:read')
WHERE r.code = 'APROBADOR';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('reports:read')
WHERE r.code = 'CONSULTA';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('audit:read', 'integration:write', 'reports:read')
WHERE r.code = 'CONTADORA';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('alerts:write', 'applications:write', 'associates:write', 'collections:write', 'payments:write', 'reports:read')
WHERE r.code = 'OPERADOR';

-- Parámetros del sistema
INSERT INTO parameters (`key`, value, description) VALUES
  ('politica_mora', '{"cap":null,"base":"CAPITAL_VENCIDO","version":"demo-v2-real","rateType":"DIARIA","graceDays":0,"rateOrValue":0,"earlyAlertDays":3}', 'Política de mora vigente: hoy la cooperativa no cobra interés de mora automático (confirmado contra el histórico real, sin evidencia de cargos automáticos por mora); solo hace seguimiento por rangos de días de atraso y aplica cargos puntuales manuales cuando corresponde.'),
  ('rangos_mora', '[{"code":"CD001","label":"Al día","maxDays":29,"minDays":0},{"code":"CM030","label":"Mora 30","maxDays":59,"minDays":30},{"code":"CM060","label":"Mora 60","maxDays":89,"minDays":60},{"code":"CM090","label":"Mora 90","maxDays":119,"minDays":90},{"code":"CM120","label":"Mora 120","maxDays":149,"minDays":120},{"code":"CM150","label":"Mora 150","maxDays":179,"minDays":150},{"code":"CM180","label":"Mora 180+","maxDays":null,"minDays":180}]', 'Rangos (buckets) de días de atraso usados para clasificar la mora de cada cuota, con los mismos códigos que usa hoy la cooperativa en su Excel.'),
  ('orden_aplicacion_pago', '["GASTOS","MORA","INTERES","CAPITAL"]', 'Orden en que se aplica un pago recibido a un crédito: primero gastos, luego mora, luego interés y por último capital.'),
  ('metodos_pago', '["EFECTIVO","TRANSFERENCIA","CONSIGNACION","DESCUENTO_NOMINA"]', 'Métodos de pago aceptados para registrar un abono a un crédito.'),
  ('tipos_identificacion', '["CC","CE","TI","PA","NIT","OTRO"]', 'Tipos de documento de identificación aceptados para asociados y usuarios del sistema.'),
  ('modelo_interes', '{"type":"FLAT_SIMPLE","description":"Interés fijo sobre el capital original, repartido en partes iguales entre todas las cuotas. Confirmado contra el histórico real de la cooperativa (créditos a ~4% mensual plano). No es amortización francesa.","defaultMonthlyRatePercent":2}', 'Modelo de interés usado para calcular las cuotas: interés fijo sobre el capital original repartido en partes iguales entre todas las cuotas (no es amortización francesa). Confirmado contra el histórico real de créditos de la cooperativa.'),
  ('tipos_ajuste', '["INTERES_CAMBIO_FECHA","DESCUENTO","GASTO_NOTIFICACION","OTRO"]', 'Tipos de ajuste manual que se pueden aplicar a un crédito (cambio de fecha con interés, descuento, gasto de notificación, u otro).'),
  ('documentos_requeridos', '["Cedula de ciudadania","Certificado laboral o de ingresos","Desprendibles de pago","Extractos bancarios","Referencias personales","Referencias laborales"]', 'Lista de documentos que el revisor debe verificar antes de aprobar una solicitud de crédito.')
ON DUPLICATE KEY UPDATE `key` = `key`;
