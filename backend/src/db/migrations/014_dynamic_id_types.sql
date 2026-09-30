-- Hasta ahora "tipos_identificacion" en Parámetros era solo una copia de
-- exhibición: el formulario de Asociados y Usuarios traía su propia lista
-- de tipos de documento fija en el código ("CC","CE","TI","PA","NIT"), y
-- además la tabla users tenía un CHECK que solo permitía esos 5 valores —
-- así que aunque se agregara un tipo nuevo desde Parámetros, no aparecía
-- en los formularios y tampoco se habría podido guardar. Se quita el CHECK
-- para que la lista de tipos válidos la gobierne únicamente el parámetro
-- (la tabla associates nunca tuvo este CHECK, por eso no se toca).
ALTER TABLE users DROP CONSTRAINT users_id_type_check;
