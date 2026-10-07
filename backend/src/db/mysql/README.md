# Base de datos MySQL (para Hostinger)

Esta carpeta es la versión MySQL del esquema que hoy corre en Postgres
(Supabase). Sirve para crear la base en Hostinger sin reescribir nada a mano.

**Alcance:** esto deja lista la **base de datos**. El **backend todavía habla
Postgres** (ver "Qué falta" al final), así que con solo importar estos archivos
la aplicación aún no arranca contra MySQL.

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| `schema_completo.sql` | Las 18 migraciones juntas, listas para importar de una vez (27 tablas). **Es el que se usa en Hostinger.** |
| `seed_base.sql` | Datos mínimos para que la app funcione: 5 roles, 13 permisos y los 8 parámetros del sistema. Sin usuarios ni datos de demostración. |
| `migrations/001…018_*.sql` | Las mismas migraciones por separado, con la misma numeración que las de Postgres (`../migrations`). |
| `build-schema.mjs` | Genera `schema_completo.sql` a partir de `migrations/`. |

Las migraciones 012 y 014 no hacen nada en MySQL (`DO 0;`) y lo explican en un
comentario: la 012 es Row Level Security, que MySQL no tiene, y la 014 quita un
`CHECK` que en MySQL nunca se crea. Se conservan para que la numeración coincida
con Postgres.

## Puesta en marcha en Hostinger

1. **Crear la base y su usuario** en hPanel → *Bases de datos* → *Gestión*.
   Anota el nombre de la base, el usuario y la contraseña. Usa un usuario
   exclusivo de la app (es el reemplazo de lo que hacía RLS en Supabase) y deja
   el acceso remoto apagado salvo que haga falta.
2. **Importar el esquema:** abrir phpMyAdmin → elegir la base → *Importar* →
   subir `schema_completo.sql` → en *Juego de caracteres del archivo* dejar
   **utf8mb4** → *Continuar*. Después importar `seed_base.sql` igual.
   Ambos se deben importar **una sola vez sobre una base vacía**
   (`schema_completo.sql` no es repetible; `seed_base.sql` sí lo es y nunca pisa
   parámetros ya editados).
3. **Crear el primer administrador.** El seed no trae usuarios a propósito
   (los de demostración tenían una contraseña pública). Genera el hash:

   ```bash
   cd backend && node -e "console.log(require('bcryptjs').hashSync('TU_CONTRASEÑA_AQUÍ', 10))"
   ```

   y ejecútalo en phpMyAdmin → *SQL*, pegando el hash en `HASH_AQUI`:

   ```sql
   INSERT INTO users (email, username, password_hash, full_name)
   VALUES ('admin@tudominio.com', 'admin', 'HASH_AQUI', 'Administrador');
   INSERT INTO user_roles (user_id, role_id)
   SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'admin' AND r.code = 'ADMIN';
   ```

   Los demás usuarios se crean desde la pantalla *Usuarios* de la app.

## Lo que se verificó

Se ejecutó todo contra **MySQL 8.0.46** y **MariaDB 10.11**, ambos en modo
estricto, y MariaDB además con el comportamiento antiguo de `TIMESTAMP`
(`explicit_defaults_for_timestamp=OFF`) y `sql_mode` vacío:

- Las 18 migraciones en orden, y el `schema_completo.sql`, sobre una base vacía
  creada con charset `latin1` a propósito: todas las tablas quedan en
  `utf8mb4_unicode_ci`/InnoDB y guardan bien tildes y ñ.
- El seed ejecutado dos veces: 5 roles, 13 permisos, 27 asignaciones, 8
  parámetros con JSON válido, sin duplicados.
- Comparado contra la base Postgres real: **las 260 columnas** coinciden en
  nombre, nulabilidad y precisión, y también las **37 llaves foráneas** (con su
  regla de borrado) y las **11 llaves únicas**. La única diferencia de forma es
  que los estados son `ENUM` en MySQL y `VARCHAR`+`CHECK` en Postgres.
- Comportamiento: se aceptan el estado `RECHAZADO`, el crédito `REFINANCIADO`,
  tipos de documento y de ajuste nuevos, y una asignación de pago sin cuota; se
  rechazan una llave foránea inválida, un estado inexistente, un JSON inválido
  y un rol duplicado.

No se probó en el MySQL/MariaDB de Hostinger en sí (no hay acceso desde aquí):
al crear la base, confirma la versión en hPanel. Se evitó a propósito sintaxis
que difiere entre ambos motores (por ejemplo `DROP CHECK` frente a
`DROP CONSTRAINT`).

## Mantenerlo al día

Cada migración nueva en `../migrations` (Postgres) necesita su gemela aquí con
el mismo número. Después:

```bash
npm run db:mysql:build   # regenera schema_completo.sql
```

y se sube `schema_completo.sql` junto con el cambio. Reglas que ya cuestan caro
si se olvidan: poner `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci` a cada `CREATE TABLE`; declarar las llaves
foráneas con `FOREIGN KEY (...)` (un `REFERENCES` en la columna **se ignora en
silencio** en MySQL); y poner `DEFAULT` explícito a las columnas `TIMESTAMP`.

## Qué falta para que la app corra sobre MySQL

El código del backend usa placeholders `?` y comillas invertidas (estilo MySQL)
y `src/db/pool.ts` los traduce a Postgres al vuelo. Eso deja el trabajo
pendiente acotado, pero no es cero:

1. **Reemplazar `src/db/pool.ts`** por un pool de `mysql2` (la versión original
   está en git: `git show 4e367a1^:backend/src/db/pool.ts`) y agregar la
   dependencia `mysql2`.
2. **Reescribir el SQL exclusivo de Postgres** (no hay otro en el código):
   - `modules/reports/reports.routes.ts` — `generate_series`, `date_trunc`,
     `to_char`, `::` y `FILTER (WHERE …)` (los reportes mensuales).
   - `modules/auth/auth.routes.ts` — `now() - make_interval(...)` e
     `interval '1 hour'` (bloqueo por intentos y límite de correos).
   - `modules/users/users.routes.ts` — `json_agg` (roles por usuario).
   - `modules/integration/integration.service.ts` — `ON CONFLICT`.
   - `db/seed.ts` — `ON CONFLICT`, `INTERVAL`, `CURRENT_DATE +`.
3. **Revisar las diferencias de comportamiento** que no son de sintaxis, porque
   el `grep` no las encuentra: `BOOLEAN` vuelve como `0/1` en vez de
   `true/false`, el `insertId` de los `INSERT`, y cómo `mysql2` devuelve
   `DATE`, `TIMESTAMP` y `COUNT(*)`.
4. **Probar** el flujo completo (asociado → solicitud → aprobación →
   desembolso → pago → reversión → reportes) contra MySQL; hoy no hay pruebas
   automáticas.
5. **Alertas en tiempo real (SSE):** el servidor las mantiene abiertas en
   memoria (`modules/alerts/sse.hub.ts`). Funciona en Hostinger solo si el
   backend corre como proceso Node permanente (plan Cloud/VPS); en hosting
   compartido o en funciones serverless no es confiable.
