-- El formulario de Asociados necesita un campo explícito "¿Es empleado?"
-- (sí/no) que determine si los datos de la empresa son obligatorios, en vez
-- de inferirlo de si employer_name viene vacío o no.
ALTER TABLE associates ADD COLUMN is_employed BOOLEAN NOT NULL DEFAULT false;

-- Asociados existentes que ya tenían datos de empresa cargados se marcan
-- como empleados para no perder esa información de vista.
UPDATE associates SET is_employed = true WHERE employer_name IS NOT NULL AND employer_name <> '';
