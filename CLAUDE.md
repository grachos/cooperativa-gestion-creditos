# Convenciones del proyecto (Coomulnissi)

## Documentación: siempre
Todo cambio relevante se documenta **en el mismo commit** que el código:

- Rendimiento, concurrencia, capacidad o infraestructura → `docs/escalabilidad.md`
  (actualizar el estado de los hallazgos, la sección de cambios y el historial).
- Comportamiento de la app, endpoints, variables de entorno, operación → `README.md`
  y `backend/.env.example`.
- Cambios de esquema → nueva migración en `backend/src/db/mysql/migrations/` con un
  comentario que explique el porqué, y regenerar `schema_completo.sql`
  (`npm run db:mysql:build`).

La documentación explica el **porqué** (el problema medido o confirmado), qué se
hizo, cómo verificarlo y qué queda pendiente. Si algo no se pudo probar, se dice.

## Seguridad y datos
- Nunca imprimir ni guardar secretos en el repositorio. Las claves viven en variables
  de entorno de Hostinger.
- Las pruebas que usan base de datos crean datos: solo contra una base de pruebas.

## Operaciones de dinero
- Bloquear con `SELECT … FOR UPDATE` como primera sentencia de la transacción, en el
  orden crédito → pago (ver `docs/escalabilidad.md` §3.1).
- Los endpoints que crean registros llevan `idempotent(...)` (ver README, "Idempotencia").

## Despliegue
- Hostinger compila desde la rama `claude/gifted-fermi-xbyqul` (la rama por defecto).
