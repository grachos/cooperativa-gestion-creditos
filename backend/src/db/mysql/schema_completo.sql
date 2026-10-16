-- GENERADO por build-schema.mjs a partir de migrations/*.sql — no editar a mano.
-- Esquema completo de la aplicación para MySQL 8 / MariaDB 10.4+.
-- Ejecutar UNA sola vez sobre una base de datos vacía (no es repetible: las
-- migraciones con ALTER TABLE fallarían la segunda vez).
-- Después ejecutar seed_base.sql. Ver README.md.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- 001_init.sql
-- ============================================================

-- Núcleo de usuarios, roles y permisos

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  status ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  refresh_token_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  event_type ENUM('LOGIN','LOGOUT','LOGIN_FAILED') NOT NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 002_associates.sql
-- ============================================================

-- Asociados (personas naturales), sociedades y participantes de crédito

CREATE TABLE IF NOT EXISTS associates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_type VARCHAR(20) NOT NULL,
  id_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  birth_date DATE NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  municipality VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'Colombia',
  income_info VARCHAR(255) NULL,
  status ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  notes TEXT NULL,
  data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_associate_identification (id_type, id_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS societies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tax_id_type VARCHAR(20) NOT NULL,
  tax_id_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  trade_name VARCHAR(160) NULL,
  legal_representative_associate_id INT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  economic_activity VARCHAR(160) NULL,
  status ENUM('ACTIVA','INACTIVA') NOT NULL DEFAULT 'ACTIVA',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_society_tax_id (tax_id_type, tax_id_number),
  FOREIGN KEY (legal_representative_associate_id) REFERENCES associates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relación genérica de participantes de un crédito: titular, codeudor, avalista
CREATE TABLE IF NOT EXISTS credit_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NULL,
  credit_id INT NULL,
  associate_id INT NULL,
  society_id INT NULL,
  role ENUM('TITULAR','CODEUDOR','AVALISTA') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (associate_id) REFERENCES associates(id),
  FOREIGN KEY (society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_associates_names ON associates (last_name, first_name);
CREATE INDEX idx_credit_participants_app ON credit_participants (credit_application_id);
CREATE INDEX idx_credit_participants_credit ON credit_participants (credit_id);

-- ============================================================
-- 003_credit_lifecycle.sql
-- ============================================================

-- Solicitudes, aprobación, desembolso, créditos y cronograma

CREATE TABLE IF NOT EXISTS credit_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  requested_amount DECIMAL(16,2) NOT NULL,
  term_value INT NOT NULL,
  term_unit ENUM('MESES') NOT NULL DEFAULT 'MESES',
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL DEFAULT 'NOMINAL_MENSUAL',
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  expected_disbursement_date DATE NULL,
  due_day_rule VARCHAR(60) NULL,
  purpose VARCHAR(255) NULL,
  notes TEXT NULL,
  status ENUM('BORRADOR','RADICADA','EN_REVISION','APROBADA','RECHAZADA','CANCELADA','DESEMBOLSADA') NOT NULL DEFAULT 'BORRADOR',
  rejection_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  decided_by INT NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_application_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_number VARCHAR(30) NOT NULL UNIQUE,
  credit_application_id INT NOT NULL,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  disbursed_amount DECIMAL(16,2) NOT NULL,
  principal_balance DECIMAL(16,2) NOT NULL,
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL,
  term_value INT NOT NULL,
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  disbursement_date DATE NOT NULL,
  first_installment_date DATE NOT NULL,
  status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO') NOT NULL DEFAULT 'VIGENTE',
  delinquency_policy_snapshot JSON NULL,
  parameters_snapshot JSON NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id),
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_schedule_installments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due DECIMAL(16,2) NOT NULL,
  interest_due DECIMAL(16,2) NOT NULL,
  other_due DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_due DECIMAL(16,2) NOT NULL,
  principal_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  interest_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  late_fee_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  other_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  balance DECIMAL(16,2) NOT NULL,
  overdue_days INT NOT NULL DEFAULT 0,
  status ENUM('PENDIENTE','PAGADA','PARCIAL','VENCIDA','EN_MORA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  UNIQUE KEY uq_credit_installment (credit_id, installment_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_installments_due_date ON credit_schedule_installments (due_date);
CREATE INDEX idx_installments_status ON credit_schedule_installments (status);
CREATE INDEX idx_credits_status ON credits (status);
CREATE INDEX idx_applications_status ON credit_applications (status);

-- ============================================================
-- 004_payments_delinquency.sql
-- ============================================================

-- Pagos, imputación, mora, alertas, parámetros, auditoría e integración contable

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  received_date DATE NOT NULL,
  effective_date DATE NULL,
  amount DECIMAL(16,2) NOT NULL,
  payment_method VARCHAR(60) NOT NULL,
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  status ENUM('CONFIRMADO','REVERSADO') NOT NULL DEFAULT 'CONFIRMADO',
  reversal_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  installment_id INT NOT NULL,
  concept ENUM('GASTOS','MORA','INTERES','CAPITAL') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delinquency_calculations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NOT NULL,
  calculation_date DATE NOT NULL,
  overdue_days INT NOT NULL,
  base_amount DECIMAL(16,2) NOT NULL,
  rate_or_value DECIMAL(10,4) NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  result_amount DECIMAL(16,2) NOT NULL,
  generated_by VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  action_type ENUM('NOTIFICACION','GESTION_COBRO','PREPARACION_JURIDICA') NOT NULL,
  description VARCHAR(255) NULL,
  status ENUM('PENDIENTE','EN_PROCESO','COMPLETADA') NOT NULL DEFAULT 'PENDIENTE',
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NULL,
  installment_id INT NULL,
  type VARCHAR(60) NOT NULL,
  priority ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
  message VARCHAR(255) NOT NULL,
  status ENUM('ABIERTA','ATENDIDA','DESCARTADA') NOT NULL DEFAULT 'ABIERTA',
  assigned_to INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parameters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(80) NOT NULL UNIQUE,
  value JSON NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  user_id INT NULL,
  ip_address VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  payload JSON NOT NULL,
  status ENUM('PENDIENTE','ENVIADO','CONFIRMADO','FALLIDO','REINTENTANDO') NOT NULL DEFAULT 'PENDIENTE',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  integration_event_id INT NOT NULL,
  attempt_number INT NOT NULL,
  response_summary VARCHAR(500) NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_event_id) REFERENCES integration_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_payments_credit ON payments (credit_id);
CREATE INDEX idx_alerts_status ON alerts (status, priority);
CREATE INDEX idx_integration_events_status ON integration_events (status);

-- ============================================================
-- 005_collections_and_refinancing.sql
-- ============================================================

-- Hallazgos de la revisión del Excel real de la cooperativa (COOMULNISSI):
-- gestor/vendedor asignado por crédito, compromisos de pago, ajustes
-- (interés por cambio de fecha, descuentos autorizados) y refinanciación.

ALTER TABLE credits
  ADD COLUMN assigned_collector_id INT NULL AFTER titular_society_id,
  ADD COLUMN assigned_seller_id INT NULL AFTER assigned_collector_id,
  ADD COLUMN refinanced_from_credit_id INT NULL AFTER assigned_seller_id,
  ADD COLUMN refinanced_to_credit_id INT NULL AFTER refinanced_from_credit_id,
  ADD CONSTRAINT fk_credits_collector FOREIGN KEY (assigned_collector_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_seller FOREIGN KEY (assigned_seller_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_refinanced_from FOREIGN KEY (refinanced_from_credit_id) REFERENCES credits(id),
  ADD CONSTRAINT fk_credits_refinanced_to FOREIGN KEY (refinanced_to_credit_id) REFERENCES credits(id);

ALTER TABLE credits
  MODIFY COLUMN status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO','REFINANCIADO') NOT NULL DEFAULT 'VIGENTE';

-- Compromisos de pago (FECHAS DE COMPROMISOS en el Excel original)
ALTER TABLE collection_actions
  ADD COLUMN promise_date DATE NULL AFTER description,
  ADD COLUMN promise_status ENUM('PENDIENTE','CUMPLIDA','INCUMPLIDA') NULL AFTER promise_date;

-- Ajustes manuales por crédito: interés por cambio de fecha, descuentos, etc.
-- (VALOR INTERES POR CAMBIO DE FECHA / VALOR DESCONTADO en el Excel original)
CREATE TABLE IF NOT EXISTS credit_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NULL,
  type ENUM('INTERES_CAMBIO_FECHA','DESCUENTO','GASTO_NOTIFICACION','OTRO') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approved_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_credits_collector ON credits (assigned_collector_id);
CREATE INDEX idx_collection_actions_promise ON collection_actions (promise_date);

-- ============================================================
-- 006_gastos_imputation.sql
-- ============================================================

-- Orden de imputación real, según el histórico de observaciones de pago del
-- Excel de la cooperativa: los gastos puntuales (p. ej. "GASTOS DE
-- NOTIFICACIÓN") se cobran junto con o antes de completar la cuota
-- ("SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE NOTIFICACIÓN"), no después
-- del capital. El esquema ya tenía el concepto GASTOS en payment_allocations
-- pero nunca se usaba porque no había manera de saber cuánto de un ajuste
-- (credit_adjustments) seguía pendiente de cobro.
--
-- MySQL: el REFERENCES en línea de una columna se ignora en silencio, por eso
-- la llave foránea se declara aparte con ADD CONSTRAINT.

ALTER TABLE credit_adjustments
  ADD COLUMN paid_amount DECIMAL(16,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_allocations
  MODIFY COLUMN installment_id INT NULL,
  ADD COLUMN adjustment_id INT NULL,
  ADD CONSTRAINT fk_payment_allocations_adjustment FOREIGN KEY (adjustment_id) REFERENCES credit_adjustments(id);

-- ============================================================
-- 007_funder_rate.sql
-- ============================================================

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

-- ============================================================
-- 008_users_write_permission.sql
-- ============================================================

-- Permite crear usuarios del sistema desde la UI (necesario para dar de alta
-- un nuevo "Gestor de cartera" o "Vendedor": ambos son usuarios del sistema
-- asignables en el desembolso, `assigned_collector_id`/`assigned_seller_id`,
-- y hasta ahora solo se podían crear vía seed, sin endpoint ni UI).
--
-- MySQL: ON CONFLICT DO NOTHING de Postgres se traduce a INSERT IGNORE; los
-- dos INSERT chocan con la llave única (code) y la llave primaria
-- (role_id, permission_id), así que repetirlos no duplica nada.
INSERT IGNORE INTO permissions (code, description)
VALUES ('users:write', 'Crear y administrar usuarios del sistema');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code = 'users:write';

-- ============================================================
-- 009_associate_employer_fields.sql
-- ============================================================

-- Hallazgo del Excel real: el formulario de asociado no tenía dónde
-- registrar el empleador ("EMPRESA", "DIRECCION EMPRESA", "TELEFONOS
-- EMPRESA", "CORREO EMPRESA TIT"), usado para contactar al titular en su
-- trabajo durante la gestión de cobranza.
ALTER TABLE associates
  ADD COLUMN employer_name VARCHAR(160) NULL,
  ADD COLUMN employer_address VARCHAR(255) NULL,
  ADD COLUMN employer_phone VARCHAR(40) NULL,
  ADD COLUMN employer_email VARCHAR(160) NULL;

-- ============================================================
-- 010_user_contact_fields.sql
-- ============================================================

-- Un usuario del sistema puede ser un Gestor de cartera o Vendedor asignado
-- a créditos (no solo alguien con acceso administrativo); para eso hacen
-- falta datos de identificación y contacto que no existían en `users`.
--
-- Diferencia con Postgres: allá esta migración creaba id_type con un CHECK
-- (CC, CE, TI, PA, NIT) y la 014 lo quitaba. Aquí se crea directamente sin
-- CHECK: la lista válida la gobierna el parámetro `tipos_identificacion`, y
-- quitar un CHECK tiene sintaxis distinta en MySQL (DROP CHECK) y MariaDB
-- (DROP CONSTRAINT), así que se evita crearlo.
ALTER TABLE users
  ADD COLUMN id_type VARCHAR(20) NULL,
  ADD COLUMN id_number VARCHAR(40) NULL,
  ADD COLUMN phone VARCHAR(40) NULL,
  ADD COLUMN address VARCHAR(255) NULL;

-- ============================================================
-- 011_spanish_parameter_names.sql
-- ============================================================

-- Los parámetros se sembraron con llaves en inglés y una descripción
-- genérica de "demostración, pendiente de confirmación". La cooperativa ya
-- confirmó estos valores contra su Excel real (ver comentarios en
-- delinquency.service.ts), así que se renombran a español y se reemplaza
-- la descripción por una que explica cada parámetro en concreto (algunas
-- superan los 255 caracteres originales, de ahí el MODIFY).
--
-- MySQL: `key` es palabra reservada y va entre comillas invertidas.
ALTER TABLE parameters MODIFY COLUMN description VARCHAR(500) NULL;
UPDATE parameters SET
  `key` = 'tipos_ajuste',
  description = 'Tipos de ajuste manual que se pueden aplicar a un crédito (cambio de fecha con interés, descuento, gasto de notificación, u otro).'
WHERE `key` = 'adjustment_types';

UPDATE parameters SET
  `key` = 'orden_aplicacion_pago',
  description = 'Orden en que se aplica un pago recibido a un crédito: primero gastos, luego mora, luego interés y por último capital.'
WHERE `key` = 'allocation_order';

UPDATE parameters SET
  `key` = 'politica_mora',
  description = 'Política de mora vigente: hoy la cooperativa no cobra interés de mora automático (confirmado contra el histórico real, sin evidencia de cargos automáticos por mora); solo hace seguimiento por rangos de días de atraso y aplica cargos puntuales manuales cuando corresponde.'
WHERE `key` = 'delinquency_policy';

UPDATE parameters SET
  `key` = 'tipos_identificacion',
  description = 'Tipos de documento de identificación aceptados para asociados y usuarios del sistema.'
WHERE `key` = 'id_types';

UPDATE parameters SET
  `key` = 'modelo_interes',
  description = 'Modelo de interés usado para calcular las cuotas: interés fijo sobre el capital original repartido en partes iguales entre todas las cuotas (no es amortización francesa). Confirmado contra el histórico real de créditos de la cooperativa.'
WHERE `key` = 'interest_model';

UPDATE parameters SET
  `key` = 'rangos_mora',
  description = 'Rangos (buckets) de días de atraso usados para clasificar la mora de cada cuota, con los mismos códigos que usa hoy la cooperativa en su Excel.'
WHERE `key` = 'mora_buckets';

UPDATE parameters SET
  `key` = 'metodos_pago',
  description = 'Métodos de pago aceptados para registrar un abono a un crédito.'
WHERE `key` = 'payment_methods';

-- ============================================================
-- 012_enable_rls_and_fix_search_path.sql
-- ============================================================

-- SIN CAMBIOS PARA MYSQL.
--
-- En Postgres/Supabase esta migración activaba Row Level Security en las 25
-- tablas y fijaba el search_path de la función set_updated_at(), porque
-- Supabase expone un API REST público (PostgREST) sobre la base de datos.
--
-- MySQL no tiene Row Level Security ni ese API: el único acceso a la base es
-- el usuario con el que se conecta el backend. La protección equivalente es
-- de configuración, no de esquema:
--   * crear un usuario MySQL exclusivo para la app, con permisos solo sobre
--     esta base de datos (SELECT, INSERT, UPDATE, DELETE), sin GRANT ni DROP;
--   * no habilitar "Remote MySQL" en hPanel salvo que haga falta, y si se
--     habilita, limitarlo a las IP necesarias.
-- Tampoco hace falta la función set_updated_at(): las columnas updated_at ya
-- usan ON UPDATE CURRENT_TIMESTAMP.
--
-- La sentencia es un no-op para que el número de migración exista y quede
-- registrado igual que en Postgres.
DO 0;

-- ============================================================
-- 013_application_review.sql
-- ============================================================

-- Convierte "Solicitudes de crédito" en una pantalla de revisión funcional:
-- el revisor debe poder confirmar los documentos requeridos y a cada
-- codeudor/titular antes de aprobar la solicitud (antes solo existía un
-- botón "Aprobar" sin ninguna verificación real).
--
-- MySQL: las llaves foráneas van declaradas aparte (el REFERENCES en línea se
-- ignora) y el índice por solicitud lo cubre la llave única, por eso no se
-- repite el idx_application_documents_app de Postgres.

CREATE TABLE IF NOT EXISTS credit_application_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  notes VARCHAR(255) NULL,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_document (credit_application_id, document_type),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE credit_participants
  ADD COLUMN status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN notes VARCHAR(255) NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL,
  ADD CONSTRAINT fk_credit_participants_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id);

INSERT INTO parameters (`key`, value, description) VALUES (
  'documentos_requeridos',
  '["Cedula de ciudadania", "Certificado laboral o de ingresos", "Desprendibles de pago", "Extractos bancarios", "Referencias personales"]',
  'Lista de documentos que el revisor debe verificar antes de aprobar una solicitud de crédito.'
) ON DUPLICATE KEY UPDATE `key` = `key`;

-- ============================================================
-- 014_dynamic_id_types.sql
-- ============================================================

-- SIN CAMBIOS PARA MYSQL.
--
-- En Postgres esta migración quitaba el CHECK de users.id_type (solo permitía
-- CC, CE, TI, PA, NIT) para que la lista de tipos de documento la gobierne
-- únicamente el parámetro `tipos_identificacion`. En MySQL la columna
-- users.id_type ya se crea sin ese CHECK (ver 010), y associates.id_type
-- nunca lo tuvo, así que no hay nada que quitar.
--
-- La sentencia es un no-op para que el número de migración exista y quede
-- registrado igual que en Postgres.
DO 0;

-- ============================================================
-- 015_dynamic_payment_and_adjustment_types.sql
-- ============================================================

-- Mismo caso que tipos_identificacion (014): "tipos_ajuste" en Parámetros
-- era solo de exhibición porque el formulario de ajustes de crédito traía
-- su propia lista fija, y aunque se hubiera leído del parámetro, la tabla
-- credit_adjustments solo permitía los 4 valores originales. Se abre para
-- que el parámetro gobierne la lista de verdad.
-- "metodos_pago" no necesita nada aquí: payments.payment_method nunca tuvo
-- restricción, solo el formulario traía la lista fija.
--
-- MySQL: en 005 la columna `type` se creó como ENUM (equivalente al CHECK de
-- Postgres); se convierte a VARCHAR conservando los valores ya guardados.
ALTER TABLE credit_adjustments MODIFY COLUMN type VARCHAR(30) NOT NULL;

-- ============================================================
-- 016_associate_rejected_status.sql
-- ============================================================

-- Un asociado que es rechazado como participante (titular o codeudor) al
-- revisar una solicitud de crédito debe quedar marcado como tal a nivel
-- global, para no poder volver a seleccionarlo como codeudor en una
-- solicitud nueva. El status de associates solo admitía ACTIVO/INACTIVO.
--
-- MySQL: la columna es un ENUM (ver 002), así que se amplía con MODIFY en vez
-- de reemplazar un CHECK como en Postgres.
ALTER TABLE associates
  MODIFY COLUMN status ENUM('ACTIVO','INACTIVO','RECHAZADO') NOT NULL DEFAULT 'ACTIVO';

-- ============================================================
-- 017_associate_employment_flag.sql
-- ============================================================

-- El formulario de Asociados necesita un campo explícito "¿Es empleado?"
-- (sí/no) que determine si los datos de la empresa son obligatorios, en vez
-- de inferirlo de si employer_name viene vacío o no.
ALTER TABLE associates ADD COLUMN is_employed BOOLEAN NOT NULL DEFAULT FALSE;

-- Asociados existentes que ya tenían datos de empresa cargados se marcan
-- como empleados para no perder esa información de vista.
UPDATE associates SET is_employed = TRUE WHERE employer_name IS NOT NULL AND employer_name <> '';

-- ============================================================
-- 018_password_reset_tokens.sql
-- ============================================================

-- Tokens de un solo uso para "¿Olvidaste tu contraseña?". Solo se guarda el
-- hash del token; el enlace con el token real viaja por correo.
--
-- MySQL: expires_at lleva DEFAULT explícito aunque el backend siempre lo
-- fija. Sin él, MariaDB (explicit_defaults_for_timestamp apagado) le asigna
-- en silencio DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, y el
-- vencimiento del token se reiniciaría al marcarlo como usado.
-- No lleva RLS (ver nota de la 012).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_password_reset_tokens_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 019_idempotency_keys.sql
-- ============================================================

-- Claves de idempotencia (header `Idempotency-Key`): evitan que un reintento de
-- red, un doble clic o un reenvío repita el efecto de una operación de
-- escritura (registrar un pago, crear un crédito, etc.).
--
-- Una fila = una operación lógica de un usuario. La llave única
-- (user_id, operation, idempotency_key) es lo que serializa las peticiones
-- simultáneas: solo un INSERT gana y ejecuta el efecto.
--
--  - request_hash: SHA-256 de método + URL + cuerpo. Se guarda el hash, no el
--    cuerpo (puede traer datos personales). Misma clave con otro hash => 409.
--  - state IN_PROGRESS: la operación se está ejecutando o quedó en estado
--    incierto (p. ej. el proceso murió a mitad). Mientras no venza, NO se
--    vuelve a ejecutar.
--  - state COMPLETED: se guardan status y cuerpo de la respuesta para
--    reproducirla tal cual en los reintentos.
--  - expires_at: ver IDEMPOTENCY_TTL_HOURS. DATETIME (no TIMESTAMP) para no
--    depender de explicit_defaults_for_timestamp; el backend fija la sesión
--    en UTC.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  operation VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  response_status SMALLINT NULL,
  response_body MEDIUMTEXT NULL,
  response_content_type VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL DEFAULT NULL,
  expires_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idempotency_scope (user_id, operation, idempotency_key),
  KEY idx_idempotency_expires_at (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 020_concurrency_guards.sql
-- ============================================================

-- Protecciones de concurrencia (ver docs/escalabilidad.md, hallazgos P0/P1):
--
--  1. sequences: contador atómico por nombre. Reemplaza el `COUNT(*)+1` del
--     número de crédito, que con dos desembolsos simultáneos generaba el mismo
--     número (uno fallaba) y se repetía si se borraba un crédito. La fila del
--     contador se bloquea dentro de la transacción del desembolso, así que los
--     números salen consecutivos y sin duplicados; si la transacción falla,
--     no se consume el número.
--  2. application_disbursements: una fila por solicitud desembolsada. Su llave
--     primaria es la red de seguridad de la base de datos para que una misma
--     solicitud no genere dos créditos (la refinanciación reutiliza el
--     credit_application_id del crédito original, por eso no se puede poner un
--     UNIQUE directamente sobre credits.credit_application_id).
CREATE TABLE IF NOT EXISTS sequences (
  name VARCHAR(60) NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Continúa la numeración existente (CR-AAAA-NNNNN): el contador de cada año
-- arranca en el mayor número ya usado.
INSERT INTO sequences (name, value)
SELECT CONCAT('credit_number:', SUBSTRING(credit_number, 4, 4)),
       MAX(CAST(SUBSTRING(credit_number, 9) AS UNSIGNED))
FROM credits
WHERE credit_number REGEXP '^CR-[0-9]{4}-[0-9]+$'
GROUP BY SUBSTRING(credit_number, 4, 4)
ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value));

CREATE TABLE IF NOT EXISTS application_disbursements (
  credit_application_id INT NOT NULL PRIMARY KEY,
  credit_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_disbursements_credit (credit_id),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id),
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Créditos ya desembolsados (los que no vienen de una refinanciación). Si hubo
-- duplicados históricos, se conserva el más antiguo.
INSERT IGNORE INTO application_disbursements (credit_application_id, credit_id)
SELECT c.credit_application_id, MIN(c.id)
FROM credits c
WHERE c.refinanced_from_credit_id IS NULL AND c.credit_application_id IS NOT NULL
GROUP BY c.credit_application_id;

-- ============================================================
-- 021_multiprocess_guards.sql
-- ============================================================

-- Protecciones para varios procesos Node y para el job de alertas
-- (ver docs/escalabilidad.md, hallazgos #7, #9 y #10):
--
--  1. job_runs: una fila por (trabajo, día). Quien la inserta primero ejecuta el
--     job diario; los demás procesos ven la fila y no lo repiten. Antes cada
--     proceso Node tenía su propio reloj y el job corría una vez POR proceso.
--  2. realtime_events: buzón de eventos para las alertas en vivo (SSE). Cada
--     proceso solo conoce las conexiones SSE que él mismo tiene abiertas; los
--     eventos se publican aquí y los demás procesos los reenvían a sus clientes.
--     Filas de corta vida (se purgan solas a los pocos minutos).
--  3. alerts.open_flag + llave única: impide dos alertas ABIERTAS iguales para la
--     misma cuota y tipo aunque dos ejecuciones del job coincidan (antes: SELECT
--     y luego INSERT sin protección). open_flag vale 1 mientras la alerta está
--     ABIERTA y NULL en cuanto se atiende o descarta (los NULL no chocan en la
--     llave única, así que el historial se conserva). Se mantiene desde el código
--     en lugar de una columna generada para no depender de la versión de MySQL.
CREATE TABLE IF NOT EXISTS job_runs (
  job_name VARCHAR(60) NOT NULL,
  run_date DATE NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_name, run_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS realtime_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  origin VARCHAR(40) NOT NULL,
  event VARCHAR(60) NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_realtime_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los ALTER son condicionales: si esta migración se interrumpió a medias (p. ej. el
-- proceso se reinició durante el arranque), volver a ejecutarla no falla con
-- "Duplicate column name" ni "Duplicate key name".
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND COLUMN_NAME = 'open_flag') = 0,
  'ALTER TABLE alerts ADD COLUMN open_flag TINYINT NULL DEFAULT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

UPDATE alerts SET open_flag = 1 WHERE status = 'ABIERTA';

-- Si ya hubiera alertas abiertas duplicadas, se conserva la más antigua y las
-- demás se descartan (así la llave única puede crearse sin error).
UPDATE alerts a
JOIN (
  SELECT installment_id, type, MIN(id) AS keep_id
  FROM alerts
  WHERE open_flag = 1 AND installment_id IS NOT NULL
  GROUP BY installment_id, type
  HAVING COUNT(*) > 1
) d ON d.installment_id = a.installment_id AND d.type = a.type
SET a.open_flag = NULL, a.status = 'DESCARTADA', a.resolved_at = NOW()
WHERE a.open_flag = 1 AND a.id <> d.keep_id;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'uq_alerts_open') = 0,
  'ALTER TABLE alerts ADD UNIQUE KEY uq_alerts_open (installment_id, type, open_flag)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

-- ============================================================
-- 022_query_indexes.sql
-- ============================================================

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

-- ============================================================
-- 023_reunion_fase1.sql
-- ============================================================

-- Reunión con la cooperativa (2026-10-16), Fase 1 (docs/plan-reunion-2026-10-16.md).
--
--  1. collection_actions.observation: segunda nota del compromiso de pago (p. ej.
--     "el titular se retiró de la empresa, pasa a PU"), distinta de la nota del compromiso.
--  2. payments.verified*: el pago se carga SOLO después de verificarlo en el banco y archivar el
--     soporte; la casilla deja constancia de quién y cuándo (los pagos anteriores quedan sin marcar).
--  3. credits.disbursement_*: cuenta destino del asociado, cuenta de la cooperativa de la que salió
--     el desembolso y si el soporte quedó archivado (el archivo NO se sube al servidor: costo de espacio).
--  4. credit_application_documents.credit_participant_id: los documentos se revisan por participante
--     (titular y cada codeudor). Las filas anteriores quedan con NULL (documentos "de la solicitud").
--     La llave única pasa a (solicitud, participante, documento); la nueva se crea ANTES de borrar la
--     vieja porque la llave foránea necesita un índice que empiece por credit_application_id.
--  5. Parámetros: listas de documentos para titular y codeudor (se copian de documentos_requeridos)
--     y lista de cuentas bancarias de la cooperativa.
--
-- Repetible: ver 021_multiprocess_guards.sql.

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_actions' AND COLUMN_NAME = 'observation') = 0,
  'ALTER TABLE collection_actions ADD COLUMN observation VARCHAR(500) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified') = 0,
  'ALTER TABLE payments ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified_by') = 0,
  'ALTER TABLE payments ADD COLUMN verified_by INT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified_at') = 0,
  'ALTER TABLE payments ADD COLUMN verified_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_to_account') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_to_account VARCHAR(255) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_from_account') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_from_account VARCHAR(255) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_proof_filed') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_proof_filed TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND COLUMN_NAME = 'credit_participant_id') = 0,
  'ALTER TABLE credit_application_documents ADD COLUMN credit_participant_id INT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND INDEX_NAME = 'uq_application_participant_document') = 0,
  'ALTER TABLE credit_application_documents ADD UNIQUE KEY uq_application_participant_document (credit_application_id, credit_participant_id, document_type)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND INDEX_NAME = 'uq_application_document') > 0,
  'ALTER TABLE credit_application_documents DROP INDEX uq_application_document',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

INSERT IGNORE INTO parameters (`key`, value, description)
SELECT 'documentos_requeridos_titular', value,
  'Documentos que se revisan al titular de una solicitud de crédito (se aprueban uno por uno antes de aprobar la solicitud).'
FROM parameters WHERE `key` = 'documentos_requeridos';

INSERT IGNORE INTO parameters (`key`, value, description)
SELECT 'documentos_requeridos_codeudor', value,
  'Documentos que se revisan a cada codeudor de una solicitud de crédito (se aprueban uno por uno antes de aprobar la solicitud).'
FROM parameters WHERE `key` = 'documentos_requeridos';

INSERT INTO parameters (`key`, value, description) VALUES (
  'cuentas_bancarias_cooperativa',
  '[]',
  'Cuentas bancarias de la cooperativa desde las que se hacen los desembolsos (una por línea, p. ej. "Bancolombia ahorros 123-456").'
) ON DUPLICATE KEY UPDATE `key` = `key`;

-- La lista única queda solo como respaldo si faltaran las listas por participante.
UPDATE parameters
SET description = 'Lista antigua (una sola para toda la solicitud). Ya no se usa si existen documentos_requeridos_titular y documentos_requeridos_codeudor: edite esas dos.'
WHERE `key` = 'documentos_requeridos';

-- ============================================================
-- 024_reunion_fase2.sql
-- ============================================================

-- Reunión con la cooperativa (2026-10-16), Fase 2 (docs/plan-reunion-2026-10-16.md).
--
--  1. user_permissions: permisos por usuario encima de los de sus roles. granted = 1 agrega un
--     permiso que el rol no da; granted = 0 quita uno que el rol sí da. Se guardan SOLO las
--     diferencias contra los roles, así un cambio posterior en un rol sigue aplicando. Es lo que
--     permite la pantalla de casillas ("qué puede hacer cada usuario").
--  2. application_reference_checks: verificación de referencias de una solicitud (quién llamó,
--     si contestaron y si fueron positivas o negativas).
--  El permiso nuevo `applications:review` (separa "revisar" de "aprobar/rechazar") se crea en
--  seed_base.sql, que corre en cada arranque.
--
-- Repetible (CREATE TABLE IF NOT EXISTS): ver 021_multiprocess_guards.sql.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT NOT NULL,
  permission_id INT NOT NULL,
  granted TINYINT(1) NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_reference_checks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  reference_type ENUM('PERSONAL','LABORAL') NOT NULL,
  reference_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NULL,
  contacted TINYINT(1) NOT NULL DEFAULT 0,
  result ENUM('POSITIVA','NEGATIVA','SIN_RESPUESTA') NULL,
  notes VARCHAR(500) NULL,
  checked_by INT NOT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_reference_checks_application (credit_application_id),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El reporte "Actividad por usuario" filtra audit_logs por usuario y fechas.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_user_created') = 0,
  'ALTER TABLE audit_logs ADD KEY idx_audit_logs_user_created (user_id, created_at)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

-- ============================================================
-- 025_reunion_fase3_4.sql
-- ============================================================

-- Reunión con la cooperativa (2026-10-16), Fases 3 y 4 (docs/plan-reunion-2026-10-16.md).
--
--  Fase 3 (asesores externos que venden el crédito; no entran al sistema):
--   1. credit_applications.assigned_seller_id: el asesor se registra al radicar la solicitud (antes solo
--      se podía al desembolsar). Al desembolsar se copia al crédito (credits.assigned_seller_id ya existía).
--   2. Índice en credits.assigned_seller_id para filtrar y reportar créditos por asesor.
--  Fase 4 (documentos físicos y cobro jurídico):
--   3. associate_documents: lista de chequeo "lo tenemos en físico: sí/no" por asociado.
--   4. credit_legal_documents: lo mismo para los documentos del cobro jurídico de un crédito.
--   5. Parámetros con las listas de documentos (editables en Parámetros).
--  Los archivos NO se suben al servidor (costo de espacio, decisión de la reunión): solo se marca si el
--  documento está en poder de la cooperativa, quién lo marcó y cuándo.
--
-- Repetible: ver 021_multiprocess_guards.sql.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_applications' AND COLUMN_NAME = 'assigned_seller_id') = 0,
  'ALTER TABLE credit_applications ADD COLUMN assigned_seller_id INT NULL, ADD CONSTRAINT fk_applications_seller FOREIGN KEY (assigned_seller_id) REFERENCES users(id)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_seller') = 0,
  'ALTER TABLE credits ADD KEY idx_credits_seller (assigned_seller_id)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

CREATE TABLE IF NOT EXISTS associate_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  associate_id INT NOT NULL,
  document_type VARCHAR(120) NOT NULL,
  held TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  checked_by INT NULL,
  checked_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_associate_document (associate_id, document_type),
  FOREIGN KEY (associate_id) REFERENCES associates(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_legal_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  document_type VARCHAR(120) NOT NULL,
  held TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  checked_by INT NULL,
  checked_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_credit_legal_document (credit_id, document_type),
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Listas iniciales (propuestas: la cooperativa las ajusta en Parámetros). No pisa lo ya editado.
INSERT IGNORE INTO parameters (`key`, value, description) VALUES
  ('documentos_asociado',
   '["Cédula de ciudadanía", "Certificación laboral", "Desprendibles de pago", "Referencias personales", "Referencias laborales", "Autorización de tratamiento de datos"]',
   'Documentos que la cooperativa debe tener (en físico o digital) de cada asociado. En la ficha del asociado se marca cuáles se tienen.'),
  ('documentos_juridicos',
   '["Pagaré firmado", "Notificación de mora", "Notificación de embargo", "Orden de embargo", "Respuesta del pagador o empleador", "Poder para demanda"]',
   'Documentos del cobro jurídico de un crédito. En el crédito se marca cuáles se tienen.');

-- ============================================================
-- 026_reunion_fase5.sql
-- ============================================================

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

-- ============================================================
-- Registro de migraciones aplicadas (mismas columnas que usa el runner de
-- Postgres, para poder usar un runner con MySQL más adelante sin repetirlas)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(160) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES
  ('001_init.sql'),
  ('002_associates.sql'),
  ('003_credit_lifecycle.sql'),
  ('004_payments_delinquency.sql'),
  ('005_collections_and_refinancing.sql'),
  ('006_gastos_imputation.sql'),
  ('007_funder_rate.sql'),
  ('008_users_write_permission.sql'),
  ('009_associate_employer_fields.sql'),
  ('010_user_contact_fields.sql'),
  ('011_spanish_parameter_names.sql'),
  ('012_enable_rls_and_fix_search_path.sql'),
  ('013_application_review.sql'),
  ('014_dynamic_id_types.sql'),
  ('015_dynamic_payment_and_adjustment_types.sql'),
  ('016_associate_rejected_status.sql'),
  ('017_associate_employment_flag.sql'),
  ('018_password_reset_tokens.sql'),
  ('019_idempotency_keys.sql'),
  ('020_concurrency_guards.sql'),
  ('021_multiprocess_guards.sql'),
  ('022_query_indexes.sql'),
  ('023_reunion_fase1.sql'),
  ('024_reunion_fase2.sql'),
  ('025_reunion_fase3_4.sql'),
  ('026_reunion_fase5.sql');
