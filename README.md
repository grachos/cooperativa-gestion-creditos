# Cooperativa · Gestión de Créditos

Software operativo para el control de asociados, sociedades, solicitudes de
crédito, desembolsos, cronogramas, pagos, mora y alertas. Reemplaza el
seguimiento actual en Excel. No es un software contable: expone eventos y
exportaciones para el sistema contable externo de la contadora.

Este repositorio contiene la **primera versión demostrable (MVP)**, construida
con el stack solicitado: React 19 + TypeScript + Vite + Tailwind v4 +
TanStack Query en el frontend, y Node.js + Express + TypeScript + Postgres +
Zod + JWT + SSE en el backend (originalmente MySQL; se migró a Postgres
para desplegar en Supabase — ver sección 4bis).

## 1. Resumen ejecutivo

El MVP cubre el flujo completo de negocio de punta a punta:

`login → asociado → solicitud de crédito → aprobación → desembolso →
cronograma de cuotas → pago/abono → imputación → mora → alertas → tablero y
reportes → evento hacia contabilidad`

Todo el código compila sin errores de TypeScript (`npm run typecheck` /
`npm run build` en ambos paquetes) y el frontend se construye correctamente
con Vite.

## 2. Qué está implementado vs. simulado

**Implementado y funcional:**
- Autenticación JWT (access + refresh), roles y permisos, auditoría de login.
- CRUD de asociados y sociedades, con detección de identificación duplicada.
- Ciclo de vida completo de solicitudes (`BORRADOR→…→DESEMBOLSADA`), con
  historial de estados.
- Aprobación/rechazo como operación separada del desembolso, con
  transacción atómica: crea el crédito, congela condiciones, genera el
  cronograma y encola el evento contable.
- **Cronograma con interés fijo simple** sobre el capital original, repartido
  en partes iguales entre todas las cuotas (capital e interés constantes en
  cada cuota). Esto reemplaza la suposición inicial de amortización francesa
  y quedó **verificado contra el histórico real de la cooperativa**: un
  crédito de $4.100.000 a 18 cuotas reparte exactamente $227.777,78 de
  capital y $164.022,22 de interés en cada cuota, consistente con su propia
  nota de "interés del 4% mensual". Ver `schedule.service.ts`.
  **La cuota se redondea hacia arriba a los $100** (parámetro `redondeo_cuota`) y la
  diferencia queda como interés: $227.777,78 + $164.000 = $391.777,78 → cuota
  $391.800, exactamente como el crédito real. Aplica a lo que se desembolse o
  refinancie desde la migración 029; los cronogramas ya creados no cambian.
- Registro de pagos y abonos con **imputación real: gastos → mora → interés
  → capital**. El orden se confirmó contra el histórico de observaciones de
  pago de la cooperativa ("SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE
  NOTIFICACIÓN"): un gasto puntual (`credit_adjustments`, p. ej. un costo de
  notificación) se cobra junto con o antes que la cuota, no después del
  capital. El esquema ya tenía el concepto GASTOS en `payment_allocations`
  pero nunca se usaba; ahora los ajustes pendientes de cobro se descuentan
  automáticamente del siguiente pago. Reversión auditada (nunca borrado
  físico).
- **Mora por buckets de 30/60/90/120/150/180 días** (`CD001`, `CM030`…`CM180`),
  tomados literalmente de la columna "CÓDIGO DE MORA" del Excel real de la
  cooperativa, en vez de un umbral inventado de "mora inicial/prolongada".
  Se buscó explícitamente evidencia de interés de mora, recargos o cobros de
  abogado en el histórico real de observaciones de pago y **no aparece
  ningún cargo automático**: el único cargo visto fue un "gastos de
  notificación" de $100.000 aplicado manualmente una vez. Por eso la tasa de
  mora automática queda en 0% por defecto — la cooperativa hoy no cobra
  interés de mora, solo clasifica y hace seguimiento por bucket; cualquier
  cargo puntual se registra como ajuste manual auditable. Ver
  `delinquency.service.ts`.
- Alertas por vencimiento (próximo vencimiento, vencimiento del día) y una
  alerta nueva cada vez que una cuota entra a un bucket de mora distinto, con
  centro de alertas y actualización en tiempo real vía SSE. El estado del
  crédito (`VIGENTE`/`EN_MORA`) se sincroniza automáticamente con sus cuotas.
- **Compromisos de pago** (`collection_actions.promise_date`): fecha en que
  el cliente promete pagar, con seguimiento de cumplido/incumplido — hallazgo
  directo del Excel real (columna "FECHAS DE COMPROMISOS").
- **Gestor de cartera y vendedor asignados por crédito** (`assigned_collector_id`,
  `assigned_seller_id`), también tomado del Excel real ("GESTOR A CARGO",
  "VENDEDOR").
- **Ajustes manuales auditables** (`credit_adjustments`): interés por cambio
  de fecha, descuentos autorizados, gastos de notificación — en el Excel
  original eran columnas sueltas sin trazabilidad de quién autorizaba; aquí
  quedan como movimientos con aprobador obligatorio
  (`POST /credits/:id/adjustments`). Se investigó a fondo si "interés por
  cambio de fecha" sigue una fórmula de prorrateo automática (cuando el
  desembolso y la primera fecha de pago quedan a más de ~30 días): se
  confirmó el patrón en 3 créditos reales (p. ej. cuota normal $391.800 →
  primera cuota $421.800, diferencia $30.000, 37 días entre desembolso y
  primer pago), pero **ninguna fórmula de prorrateo probada** (interés
  mensual/30 × días extra, capital×tasa/30 × días extra, con distintas
  definiciones de "días extra") reproduce los tres valores reales
  ($30.000 / $22.400 / $31.000) de forma consistente — el patrón día-a-monto
  no cuadra con una tasa diaria fija entre créditos. Todo indica que es un
  valor definido a criterio del operador al desembolsar, no una fórmula de
  sistema, así que se mantiene como ajuste manual (ya soportado) en vez de
  cablear una fórmula adivinada al cronograma.
- **Crédito fondeado por un tercero ("tomador")** (`funder_name`,
  `funder_rate_percent` en `credits`): hallazgo del Excel real — 16 meses
  consecutivos muestran "Interés del 4% de los créditos abiertos" (tasa al
  asociado) junto a "Interés del 1,9% de los créditos abiertos" (tasa al
  tomador) y "Diferencia del 2,1%" (margen de la cooperativa), cuadrando
  exactamente mes a mes contra el mismo capital base — un patrón general, no
  una excepción. Se modela como campos opcionales por crédito; el detalle de
  crédito expone `funderSummary` con el margen calculado. **No** se modeló
  "Aportes del tomador de los créditos abiertos": es un saldo acumulado
  independiente (crece mes a mes sin corresponder al 1,9% de interés ni a un
  % fijo de capital) — falta confirmar con la cooperativa qué lo genera antes
  de construirlo.
- **Refinanciación** (`POST /credits/:id/refinance`, cálculo previo en
  `GET /credits/:id/refinance-quote?termValue=`): cierra el crédito actual
  (`REFINANCIADO`) y crea uno nuevo enlazado (`refinanced_from_credit_id` /
  `refinanced_to_credit_id`). Regla de la cooperativa (2026-10-19):
  - Cuotas pendientes = todas las no pagadas (si debe vencidas, se calcula desde la última pagada).
  - Nuevo crédito = lo que debe de esas cuotas (capital + interés) **+ interés mensual del préstamo
    inicial × cuotas pendientes** (parámetro `refinanciacion`, se puede apagar). Sin interés propio,
    en el plazo que se elija, con la cuota redondeada.
  - Ejemplo: $2.000.000 al 4 % a 15 cuotas ($213.400); pagó 7 → debe $1.707.200 + $80.000 × 8 =
    $2.347.200 → a 15 meses, cuota $156.500.
  - Se guarda separado el capital heredado (saldo de capital del nuevo crédito) y el interés heredado,
    y lo que ya había pagado de capital y de interés; el detalle del crédito nuevo muestra
    "Refinanciación: heredado del crédito …" (`parameters_snapshot.refinance`, y en la actividad).
  - No se refinancia con mora o gastos cobrados sin pagar (409). El dinero nuevo se presta como un
    crédito aparte, con su interés normal (`additionalCapital` > 0 responde 400). Si se envía
    `expectedTotal` y el cálculo cambió, responde 409.
- Tablero operativo y reportes (quién debe pagar en una fecha, cartera
  vencida, exportación CSV de pagos).
- Auditoría de operaciones sensibles (`audit_logs`) con valor anterior/nuevo.
- Outbox de integración contable (`integration_events`/`integration_attempts`)
  con reproceso manual y exportación JSON — **sin adaptador real** porque el
  formato del software contable aún no ha sido confirmado por la contadora.

**Simulado o pendiente para producción** (ver también sección 7):
- El adaptador real hacia el software contable externo (hoy solo se
  encola/exporta).
- Herramienta de importación masiva desde Excel (queda documentado el plan en
  la sección 6, no implementada en este MVP).
- Cifrado de datos sensibles en reposo, backups automatizados, HTTPS/despliegue
  productivo: son decisiones de infraestructura pendientes de la cooperativa.
- Pruebas automatizadas: se recomienda añadir suite Vitest para el motor de
  cuotas, mora e imputación antes de producción (no incluida en este corte).

## 3. Arquitectura

```
frontend/  React 19 + TS + Vite + Tailwind v4 + TanStack Query
backend/   Node + Express + TS + Postgres (pg) + Zod + JWT + SSE
  src/modules/<dominio>/   rutas + servicios por módulo de negocio
  src/db/migrations/       migraciones SQL versionadas (numeradas)
  src/db/seed.ts           datos de demostración
  src/shared/schemas.ts    esquemas Zod (fuente de verdad de validación)
api/index.ts       entrada serverless de Vercel: expone la misma app de Express
                   (vercel.json enruta /api/:path* hacia esta función)
vercel.json         build del frontend + rewrites (raíz del repo)
```

El backend es la autoridad final de permisos (middleware `requirePermission`);
el frontend solo oculta acciones no autorizadas, nunca depende de eso para
seguridad.

## 4. Instalación y ejecución (desarrollo)

Requisitos: Node.js 20+, Postgres 16 (o Docker).

```bash
# 1. Base de datos (opcional, con Docker)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # ajustar credenciales si no usa docker-compose
npm install
npm run migrate
npm run seed            # crea usuarios y un crédito de demostración
npm run dev              # http://localhost:4000

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173 (proxy a /api hacia el backend)
```

## 4bis. Despliegue en Vercel + Supabase

La base de datos es **Postgres** (antes MySQL; ver "Nota de migración" más
abajo) y el backend corre como **funciones serverless de Vercel**
(`api/[...path].ts` en la raíz del repo, que expone la misma app de
Express). Frontend y backend se despliegan juntos, en el mismo proyecto de
Vercel, mismo dominio — por eso no hace falta configurar CORS entre ellos.

### Base de datos (Supabase)

1. En [supabase.com](https://supabase.com) → **New Project**.
2. **Project Settings → Database → Connection string** → copia la URI del
   **"Transaction pooler"** (puerto `6543`; es la que funciona bien desde
   funciones serverless, a diferencia de la conexión directa).

### Proyecto de Vercel

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa
   este repositorio.
2. **Root Directory**: déjalo en blanco (la raíz del repo) — **no** lo
   pongas en `frontend`. `vercel.json` en la raíz ya define el build del
   frontend (`frontend/dist`) y las funciones de `api/` se detectan solas.
3. **Settings → Environment Variables**, agrega. La contraseña que genera
   Supabase suele traer caracteres especiales (`@ # ? %`) que rompen el
   parseo de una URL de conexión si no van con *percent-encoding*; para
   evitar ese problema por completo, usa las variables sueltas en vez de
   `DATABASE_URL`:

   | Variable | Valor |
   |---|---|
   | `DB_HOST` | host del *transaction pooler* de Supabase (ej. `aws-0-us-west-2.pooler.supabase.com`) |
   | `DB_PORT` | `6543` |
   | `DB_USER` | usuario del pooler (ej. `postgres.<project-ref>`) |
   | `DB_PASSWORD` | la contraseña de la base, tal cual (sin corchetes ni escapar nada) |
   | `DB_NAME` | `postgres` |
   | `DATABASE_SSL` | `true` |
   | `JWT_ACCESS_SECRET` | una cadena aleatoria larga |
   | `JWT_REFRESH_SECRET` | otra cadena aleatoria larga, distinta |
   | `TIMEZONE` | `America/Bogota` (opcional, ya es el default) |
   | `CURRENCY` | `COP` (opcional, ya es el default) |

4. Vuelve a desplegar (Deployments → ⋯ → Redeploy) para que tome las
   variables de entorno.
5. Corre las migraciones y el seed **contra la base de Supabase**, una sola
   vez, desde tu máquina (no desde Vercel — sus funciones no exponen una
   terminal). Dos formas, cualquiera de las dos sirve:

   - **Sin instalar nada**: pega `supabase_setup.sql` (las 6 migraciones ya
     concatenadas) en Supabase → **SQL Editor → New query → Run**. Después
     corre solo el seed:
     ```bash
     cd backend
     DB_HOST=... DB_PORT=6543 DB_USER=... DB_PASSWORD=... DB_NAME=postgres DATABASE_SSL=true npm run seed
     ```
   - **Con Node instalado**: corre migrate y seed normal, con las mismas
     variables sueltas de la tabla de arriba en vez de `DATABASE_URL`:
     ```bash
     cd backend
     DB_HOST=... DB_PORT=6543 DB_USER=... DB_PASSWORD=... DB_NAME=postgres DATABASE_SSL=true npm run migrate
     DB_HOST=... DB_PORT=6543 DB_USER=... DB_PASSWORD=... DB_NAME=postgres DATABASE_SSL=true npm run seed
     ```

Verificado localmente antes de desplegar: se instaló Postgres 16 en el
entorno de desarrollo y se corrieron las 5 migraciones, el seed, y un flujo
completo (login, asociado, solicitud → aprobación → desembolso → pago →
reversión → ajuste → compromiso de pago → refinanciación → reportes)
exactamente igual que contra MySQL antes de migrar. También se simuló
localmente la invocación estilo Vercel (la app de Express como handler
`(req, res)` sin `app.listen()`) para confirmar que `api/[...path].ts`
funciona antes de depender del despliegue real.

### Nota de migración: por qué Postgres y no MySQL

Vercel no aloja MySQL, y Supabase es Postgres — así que se portaron las 5
migraciones y todas las consultas del backend de MySQL a Postgres (tipos,
`ON DUPLICATE KEY` → `ON CONFLICT`, `DATEDIFF`/`CURDATE` → aritmética de
fechas de Postgres, etc.). El motor de reglas de negocio (cuotas, mora,
imputación, alertas) no cambió — solo el dialecto SQL.

### Esquema MySQL (para desplegar en Hostinger)

Hostinger no ofrece Postgres, así que el repositorio incluye el esquema en
MySQL/MariaDB en `backend/src/db/mysql/`: las 18 migraciones, un
`schema_completo.sql` para importar de una vez en phpMyAdmin y un
`seed_base.sql` con roles, permisos y parámetros. Está verificado contra
MySQL 8.0 y MariaDB 10.11 y es idéntico al de Postgres en columnas, llaves
foráneas y llaves únicas. Eso cubre la **base de datos**; el **backend sigue
hablando Postgres** y falta portar unas pocas consultas y el pool de
conexiones. Los pasos y la lista exacta de lo pendiente están en
[`backend/src/db/mysql/README.md`](backend/src/db/mysql/README.md).

## 5. Guion de demo sugerido

Usuarios de demostración **solo en una base local recién sembrada**
(`npm run seed`, contraseña `Demo1234*`): `admin`, `operador`, `aprobador`,
`contadora`, `consulta`. En producción esas cuentas están desactivadas;
cada usuario real debe tener su propia contraseña.

1. Iniciar sesión como `admin`.
2. Tablero: ver capital pendiente, créditos vigentes/vencidos, alertas.
3. Asociados → crear un asociado nuevo (o usar los de la semilla).
4. Solicitudes → nueva solicitud con titular y codeudor.
5. Aprobar la solicitud (usuario con permiso `applications:approve`).
6. Desembolsar (usuario con permiso `disbursements:write`) → se crea el
   crédito, se genera el cronograma y se ve el número único.
7. Crédito → registrar un pago o abono → ver imputación y saldo actualizado.
8. Crédito → registrar un compromiso de pago y un ajuste (descuento, gasto de
   notificación), y probar "Refinanciar crédito" para ver el nuevo crédito
   enlazado al anterior.
9. Alertas → clic en "Recalcular alertas (demo)" para ver alertas nuevas
   llegar en vivo por SSE sin recargar la página, y el crédito pasar a
   `EN_MORA` con su código de bucket (CM030…CM180).
10. Reportes → "quién debe pagar en una fecha", mora por bucket, cartera
    vencida con su código de mora, y exportar CSV.
11. Parámetros → ver la política de mora, los buckets, la imputación y el
    modelo de interés como parámetros configurables (no hardcodeados).

El crédito `CR-DEMO-00001` (creado por el seed) ya tiene su primera cuota
pagada, para mostrar historial de pagos sin pasos manuales adicionales.

## 6. Plan de migración desde Excel (documentado, no implementado en este MVP)

1. Inventariar archivos, hojas y columnas actuales.
2. Mapear columnas de Excel → tablas (`associates`, `credits`,
   `credit_schedule_installments`, `payments`).
3. Validar identificaciones, fechas, montos y saldos; generar reporte de
   errores antes de importar.
4. Importación de prueba con vista previa y registro de filas rechazadas.
5. Conciliar saldos migrados contra los saldos de Excel antes de confirmar.
6. Conservar copia de respaldo de los Excel originales.

Plantilla de importación sugerida (una fila por asociado/crédito/cuota/pago),
a definir con la cooperativa una vez se compartan los Excel operativos
depurados.

## 7. Supuestos de demostración y preguntas pendientes

Estos valores son **de demostración**, marcados explícitamente en el código
(`schedule.service.ts`, `delinquency.service.ts`, `seed.ts`) y deben
confirmarse antes de producción:

- Fórmula de interés: fija simple sobre capital original (verificada contra
  datos reales), tasa de demostración 4% mensual.
- Orden de imputación: gastos → mora → interés → capital (verificado contra
  el histórico real; ver sección 2).
- Buckets de mora (CD001/CM030…CM180): tomados literalmente del Excel real.
  Tasa de mora automática: **0% por defecto**, porque no hay evidencia de que
  la cooperativa cobre interés de mora hoy — queda como parámetro que se
  puede activar si la cooperativa confirma que sí quiere cobrarlo hacia
  adelante.
- Alerta temprana: 3 días antes del vencimiento.
- Interés por cambio de fecha (primera cuota): confirmado que el patrón es
  real, pero no se encontró fórmula de prorrateo que reproduzca los 3
  valores de ejemplo — queda como ajuste manual; pendiente preguntarle
  directamente al operador/contadora cómo lo calculan.
- Tasa del tomador / margen de la cooperativa: modelado como campo por
  crédito (`funder_rate_percent`), no hay validación de que la diferencia
  siempre deba ser exactamente 2,1 puntos porcentuales para créditos futuros.

El fondeo por "tomador" (tasa 4% al asociado / 1,9% al tomador / 2,1% margen
cooperativa) ya se modeló — ver sección 2 — tras confirmar que es un patrón
general (16 meses consecutivos cuadrando exacto). Lo que **no** se
implementó todavía: "Aportes del tomador de los créditos abiertos" es un
saldo acumulado que crece mes a mes de forma independiente al 1,9% de
interés y al capital abierto (no es una fórmula derivable de las columnas
disponibles) — falta confirmar con la cooperativa qué operación específica
lo alimenta antes de modelarlo.

Preguntas que deben resolverse con la cooperativa, su asesoría y la contadora
antes de pasar a producción (no bloquean el prototipo):

- Fórmula exacta de interés, periodicidad y regla de redondeo definitivas.
- Orden de imputación definitivo y días de gracia.
- Fórmula y topes de mora; costos de notificación/jurídicos.
- Campos, formato y frecuencia exigidos por la contadora para la integración
  contable, y método de autenticación de ese sistema externo.
- Retención de documentos y datos personales; usuarios y permisos definitivos.
- Proveedor de hosting, nivel de respaldo y política de backups/recuperación.

## 8. Checklist de seguridad (MVP)

- [x] Contraseñas con hash (`bcryptjs`), nunca en texto plano.
- [x] JWT con expiración configurable + refresh token con hash almacenado.
- [x] RBAC aplicado en el backend (autoridad final), no solo en el frontend.
- [x] Validación Zod de entradas en todos los endpoints de escritura.
- [x] Helmet, CORS configurable, consultas parametrizadas (sin SQL injection).
- [x] Transacciones para desembolso y registro/reversión de pagos.
- [x] Auditoría de operaciones sensibles con valor anterior/nuevo.
- [x] HTTPS (Vercel).
- [x] Bloqueo de cuenta tras 5 intentos fallidos (15 min) y máximo 3 correos
      de restablecimiento por hora, contados en BD (válido en serverless).
- [x] Desactivar un usuario revoca su sesión de inmediato.
- [x] Cierre de sesión tras 10 min de inactividad, con aviso previo. También al volver a abrir la aplicación: si la última actividad (guardada en el navegador) fue hace más de 10 min, se cierra de inmediato (antes el reloj se reiniciaba al abrir y una sesión de días seguía abierta, 2026-10-16). Además el refresh token dura `JWT_REFRESH_EXPIRES_IN` (por defecto 12 h; antes 7 d): es el límite duro aunque el navegador no ejecute el control.
- [x] Job diario (Vercel Cron, 6:00 a. m. Bogotá) que recalcula días de
      atraso, mora y alertas; protegido con `CRON_SECRET`.
- [ ] Backups automatizados y cifrado en reposo: dependen del plan de
      Supabase/hosting que apruebe la cooperativa.
- [ ] Verificar un dominio propio en Resend: en modo sandbox solo llega
      correo al dueño de la cuenta de Resend.

## 9. Riesgos y decisiones que requieren aprobación de la cooperativa

- Ninguna regla de mora, interés o cargos legales aquí es definitiva: son
  parámetros de demostración.
- El envío real de eventos al software contable no está construido porque el
  formato de esa integración no ha sido definido por la contadora.
- La replicación geográfica y el nivel de disponibilidad dependen del
  proveedor de hosting que la cooperativa apruebe; no se asume ninguno.

## Idempotencia: evitar registros duplicados (`Idempotency-Key`)

Una misma acción del usuario (doble clic, Enter repetido, reintento de red,
timeout, recarga) no debe crear dos registros. Se resuelve en dos capas.

### Operaciones protegidas (servidor)

El middleware `idempotent("operación")` (`backend/src/middlewares/idempotency.ts`)
está aplicado solo donde un reintento duplicaría un efecto:

| Operación | Ruta | Transaccional* |
|---|---|---|
| `payments.create` | `POST /payments` | sí |
| `payments.early-payoff` | `POST /payments/early-payoff` | sí |
| `credits.disburse` | `POST /credits/applications/:id/disburse` | sí |
| `credits.refinance` | `POST /credits/:id/refinance` | sí |
| `credits.adjustment` | `POST /credits/:id/adjustments` | no |
| `credits.promise` | `POST /credits/:id/promises` | no |
| `applications.create` | `POST /applications` | sí |
| `applications.reference` | `POST /applications/:id/references` | sí |
| `associates.create` | `POST /associates` | no |
| `societies.create` | `POST /societies` | no |
| `users.create` | `POST /users` | no |
| `parameters.create` | `POST /parameters` | no |

\* Si todo el efecto ocurre en una sola transacción, un 5xx implica que no hubo
efecto y la clave se libera. En las demás un 5xx deja el resultado **incierto**
(el INSERT pudo confirmarse antes de fallar el registro de auditoría): la clave se
conserva y el reintento recibe `409 IDEMPOTENCY_IN_PROGRESS` hasta que venza.

En las transaccionales la clave se marca completada **dentro de la misma
transacción** del efecto (`completeIdempotencyInTransaction`, última sentencia antes
del COMMIT): si algo falla después del COMMIT y la ruta responde 500, la clave ya
quedó completada y el reintento recibe la respuesta original en vez de repetir el
pago (ver `docs/escalabilidad.md` §3.16). Toda ruta nueva transaccional con
`idempotent(...)` debe llamarla.

No se protegieron las transiciones que el servidor ya rechaza por estado
(aprobar/rechazar/revisar solicitud, reversar un pago: un segundo intento da 409
por estado); en la interfaz solo llevan el guard anti doble envío.

### Cómo se usa

```
POST /api/v1/payments
Idempotency-Key: 6f1c0c1e-3f8e-4c53-9d0a-7a1d2b9e5c10   # 16–128 caracteres: A-Z a-z 0-9 _ -
```

- **Sin el header** la ruta se comporta como siempre (compatibilidad con clientes existentes).
- La clave se acota por **usuario + operación**. Se guarda con un hash SHA-256 de
  método + URL + cuerpo (el cuerpo no se almacena) y, al terminar bien (2xx), la
  respuesta original.
- Misma clave y misma petición tras un éxito → se devuelve la respuesta guardada
  (cabecera `Idempotent-Replayed: true`) sin repetir el efecto.
- Misma clave con otro contenido → `409` con `code: "IDEMPOTENCY_KEY_REUSED"`.
- Peticiones simultáneas con la misma clave: la llave única
  `(user_id, operation, idempotency_key)` deja pasar solo una; las otras esperan
  hasta `IDEMPOTENCY_WAIT_MS` y reciben la respuesta guardada, o `409`
  `IDEMPOTENCY_IN_PROGRESS` (con `Retry-After`) si sigue en curso.
- Un 4xx (validación, permisos, regla de negocio) ocurre antes del efecto: la clave
  se libera y se puede reintentar con el mismo contenido.
- Si el proceso muere a mitad de una operación, la clave queda `IN_PROGRESS` y no
  se re-ejecuta hasta vencer (decisión deliberada: no se sabe si el efecto ocurrió).
  Un administrador puede borrar la fila de `idempotency_keys` tras verificar el efecto.
- No hay llamadas a proveedores externos de pago en este proyecto, por lo que no hay
  clave que propagar. Si se agrega uno, pásele la misma `Idempotency-Key`.

**Vigencia:** `IDEMPOTENCY_TTL_HOURS` (por defecto 24 h; el proyecto no tenía una
convención previa, así que se eligió un valor que cubre reintentos y recargas del
mismo día). Las claves vencidas se tratan como nuevas y se borran cada hora.
`IDEMPOTENCY_WAIT_MS` (por defecto 8000). Tabla: `idempotency_keys` (migración 019,
solo MySQL).

### Interfaz (frontend)

- `useIdempotentSubmit(scope)` (`frontend/src/hooks/useIdempotentSubmit.ts`): marca
  `pending` al instante (botón deshabilitado + texto "Registrando…") **y** ignora
  cualquier envío mientras haya uno en curso mediante un `ref` síncrono (cubre doble
  clic, Enter repetido y varios controles, que el `disabled` por sí solo no frena).
- Una clave por operación lógica (`frontend/src/lib/idempotency.ts`): se reutiliza
  en cada reintento del mismo contenido —incluidos los reintentos automáticos de red
  y el reintento tras renovar el token— y se descarta al tener éxito. Si el usuario
  cambia el contenido, o hace una acción nueva, se genera otra. Se guarda en
  `sessionStorage` para sobrevivir a una recarga.
- `api.post(path, body, { idempotencyKey })` reintenta (máx. 3, con espera) solo las
  peticiones que llevan clave: fallo de red, 502/503/504 y `IDEMPOTENCY_IN_PROGRESS`.

### Pruebas

```bash
cd backend  && npm test                       # núcleo + store en memoria
IDEMPOTENCY_TEST_DB=1 DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… DB_NAME=… npm test   # también contra MySQL real
cd frontend && npm test
```

## Cambios de la reunión con la cooperativa (2026-10-16) — Fase 1

Plan completo en `docs/plan-reunion-2026-10-16.md`. Migración `023_reunion_fase1.sql`.

- **Búsqueda y paginación:** Asociados, Solicitudes y Créditos tienen buscador (con espera de 350 ms) y
  botones Anterior/Siguiente. `GET /applications?search=` busca por cédula/NIT (prefijo), nombre del titular,
  razón social o número de solicitud; `GET /credits?search=` por número de crédito, cédula/NIT, nombre o razón
  social. Ambos aceptan `page`/`pageSize` y devuelven `total` del resultado filtrado.
- **Documentos por participante:** los parámetros `documentos_requeridos_titular` y
  `documentos_requeridos_codeudor` (editables en Parámetros) definen qué se revisa al titular y a cada
  codeudor. La solicitud muestra una tarjeta por participante con sus documentos; no se puede aprobar mientras
  quede alguno sin aprobar (el error indica de qué participante). Las solicitudes anteriores conservan su lista
  única (`documentos_requeridos`, ahora solo respaldo). Todos los documentos listados son obligatorios: para
  hacer uno opcional se quita de la lista.
- **Compromisos de pago:** campo `observation` (hasta 500 caracteres), aparte de la nota del compromiso.
- **Pago verificado:** `POST /payments` acepta `verified` (verificado en banco y soporte archivado);
  `PUT /payments/:id/verified` lo marca o desmarca después. Se guarda quién y cuándo y se muestra en los pagos
  del crédito. No se suben archivos.
- **Desembolso:** `POST /credits/applications/:id/disburse` acepta `disbursementToAccount` (cuenta del
  asociado), `disbursementFromAccount` (cuenta de la cooperativa; lista en el parámetro
  `cuentas_bancarias_cooperativa`) y `disbursementProofFiled`. La fecha de desembolso ya existía.

- **Cronograma de cuotas:** columna "Pago verificado" (por cuota: verificado, sin verificar o sin pagos).

## Cambios de la reunión con la cooperativa (2026-10-16) — Fase 2

Migración `024_reunion_fase2.sql` y permiso nuevo en `seed_base.sql` (corre en cada arranque).

- **Permisos por usuario (casillas):** en Usuarios, cada persona tiene "Permisos (n)" con una casilla por
  acción. Parte viene de su rol; lo que se agrega o quita se guarda como diferencia en `user_permissions`
  (`granted` 1 = agrega, 0 = quita), así que un cambio posterior en un rol sigue aplicando. Endpoints (permiso
  `users:write`): `GET /users/permissions`, `GET /users/manage` (ahora con `permissions` efectivos) y
  `PUT /users/:id/permissions` (recibe la lista final). No se puede quitar a uno mismo `users:write`. El
  cambio se invalida la sesión de esa persona: lo ve al volver a entrar o, como mucho, a los 15 min.
- **Revisar vs. aprobar:** nuevo permiso `applications:review` (poner en revisión, revisar documentos y
  participantes, verificar referencias). `applications:approve` queda solo para aprobar o rechazar. Los roles
  Administrador y Aprobador tienen ambos, así que nada cambia para ellos; el Operador sigue sin poder revisar
  salvo que se le marque la casilla.
- **Referencias:** `POST/PUT /applications/:id/references` (personal o laboral, contactada o no, resultado
  positiva/negativa/sin respuesta, observación, quién y cuándo). Solo mientras la solicitud está radicada o en
  revisión. No es requisito para aprobar.
- **Quién hizo qué:** el detalle de la solicitud muestra quién la radicó, quién revisó cada documento y
  participante, quién la decidió y quién hizo cada cambio de estado; el crédito muestra quién desembolsó, quién
  registró cada pago y cada compromiso. La revisión de documentos/participantes, el inicio de revisión y las
  referencias ahora quedan en la auditoría.
- **Actividad por usuario** (menú Actividad, permiso `audit:read`): `GET /audit` con filtros `userId`,
  `action`, `entity`, `from`, `to` (devuelve `user_name`), `GET /audit/filters` y `GET /audit/export.csv`
  (hasta 50.000 filas). Nuevo índice `(user_id, created_at)` en `audit_logs`.
- Los nombres de los permisos en español están en `frontend/src/lib/permissions.ts`.

## Cambios de la reunión con la cooperativa (2026-10-16) — Fases 3 y 4

Migración `025_reunion_fase3_4.sql`.

- **Asesor** (antes "vendedor"; es un usuario sin acceso al sistema): se elige al radicar la solicitud
  (`assignedSellerId` en `POST /applications`), se hereda al crédito al desembolsar (el desembolso puede
  cambiarlo) y se muestra en solicitud, crédito y listado. `GET /credits?sellerId=<id|none>` filtra por
  asesor y `GET /reports/by-seller` (pestaña Reportes › Por asesor, con caché como los demás) da créditos,
  desembolsado, saldo de capital y créditos en mora por asesor.
- **Documentos del asociado:** parámetro `documentos_asociado`; en la ficha del asociado se marca "lo tenemos /
  no lo tenemos" por documento con nota, quién y cuándo (`GET/PUT /associates/:id/documents`, permiso
  `associates:write`).
- **Cobro jurídico** (en el detalle del crédito): parámetro `documentos_juridicos` con la misma lista de chequeo
  (`GET/PUT /credits/:id/legal-documents`) y bitácora de gestiones (`POST /credits/:id/actions` con tipo
  notificación / gestión de cobro / preparación jurídica; `POST /credits/actions/:id/complete`). Permiso
  `collections:write`. Los compromisos de pago siguen en su propia sección.
- Las listas iniciales de documentos del asociado y jurídicos son una propuesta: ajustarlas en Parámetros.
- Los archivos no se suben al servidor; solo se deja constancia de si el documento está en poder de la
  cooperativa (decisión de la reunión, por el costo de almacenamiento).

## Cambios de la reunión con la cooperativa (2026-10-16) — Fase 5: mora, gastos y descuento

Migración `026_reunion_fase5.sql`. Todo sale de Parámetros, con un **valor inicial propuesto** (la cooperativa
no tuvo que confirmarlo; se ajusta cuando quiera):

| Parámetro | Valor inicial | Qué controla |
|---|---|---|
| `politica_mora` | 0,05 % por día de atraso, sobre la cuota vencida, 8 días de gracia, sin tope, modo `SUGERIDO` | `rateOrValue` (% por día; con `rateType` `MENSUAL_FIJA` es un % único de la cuota), `graceDays`, `base` (`CUOTA_VENCIDA` o `CAPITAL_VENCIDO`), `cap` (tope en pesos), `mode` |
| `gasto_notificacion` | $100.000 a los 30 días de mora y de nuevo cada 30 | `amount`, `firstAfterOverdueDays`, `repeatEveryOverdueDays` (0 = una sola vez), `enabled` |
| `descuento_pago_anticipado` | 50 % del interés de las cuotas aún no vencidas | `percentOfFutureInterest`, `enabled` |

- 0,05 % diario equivale a ≈ 1,5 % al mes, la cifra mencionada en la reunión. La migración solo reemplaza
  `politica_mora` si seguía con el valor original de demostración (sin mora); si ya fue editada, no la toca.
- **Mora sugerida, no automática** (`mode` `SUGERIDO`): al registrar un pago el sistema muestra, por cuota
  vencida, la mora calculada menos lo ya cobrado. Quien tiene el permiso de ajustes (`adjustments:write`)
  decide cuánto cobrar (por defecto lo sugerido, 0 = no cobrarla; nunca más de lo calculado). Lo cobrado queda
  como ajuste `INTERES_MORA` y el mismo pago lo cubre primero. Quien no tiene ese permiso la ve pero el pago se
  registra sin ella. `mode` `AUTOMATICO` conserva el comportamiento anterior (se cobra siempre).
- **Gasto de notificación:** se sugiere al llegar al umbral de mora, una vez por umbral; tope = `amount`.
- **Cancelación anticipada** (`POST /payments/early-payoff`, botón en el crédito): total = capital + interés
  pendiente − descuento + cargos pendientes. El descuento solo lo aplica (y puede cambiarlo) quien tiene el
  permiso de ajustes; reduce el interés de las cuotas no vencidas y queda como ajuste `DESCUENTO`. El total
  mostrado debe coincidir con el del servidor (si cambió, 409). Deja el crédito `PAGADO`. **Ese pago no se puede
  reversar** desde la aplicación (el descuento ya modificó las cuotas).
- `GET /payments/quote?creditId=&date=&discountPercent=` entrega lo sugerido (mora, notificación, cancelación).

## Permisos por módulo y visor de actividad (ajuste del 2026-10-16)

- **Permisos por módulo y acción.** En Usuarios, cada persona tiene el botón **"Permisos por módulo"**: una
  tarjeta por módulo (Asociados, Solicitudes, Créditos, Pagos, Mora y descuentos, Cobranza, Alertas, Reportes,
  Actividad, Parámetros, Usuarios, Integración) con una casilla por acción (ver, crear, editar, cancelar, revisar,
  aprobar, desembolsar, refinanciar, registrar/verificar/reversar pagos, cancelar por pago anticipado, exportar…)
  y los atajos "Todo" / "Ninguno". Catálogo en `backend/src/shared/permissionCatalog.ts`
  (`GET /users/permissions`). El rol da los permisos de partida; lo que se marca o desmarca solo afecta a ese
  usuario (`PUT /users/:id/permissions`).
- **Nuevos permisos:** `associates:read|create|update|documents` (reemplazan a `associates:write`),
  `applications:read|cancel`, `credits:read|refinance`, `payments:verify|reverse|payoff`, `alerts:read`,
  `reports:export`. Ahora **ver** cada módulo es un permiso: sin él la API responde 403 y el menú no lo muestra.
  Los roles existentes conservan todo lo que podían hacer (se asigna en `seed_base.sql` en cada arranque).
- **Visor "Actividad"** (menú Actividad, permiso `audit:read`; el administrador y la contadora lo tienen, a los
  demás se les marca la casilla de *Actividad por usuario*): cada línea dice en palabras qué hizo la persona
  ("Aprobó la solicitud (monto $…)", "Dio un descuento de $…", "Autorizó el cobro de mora…", "Canceló el crédito
  por pago anticipado…"), sobre qué crédito/solicitud/persona (con enlace) y con el motivo; "Ver detalle" muestra
  los valores antes/después. Filtros: usuario, acción, módulo, fechas, número de crédito, y búsqueda libre;
  atajos de un clic ("Quién aprobó o rechazó", "Descuentos y ajustes", "Desembolsos y refinanciaciones"…).
  Desde el crédito, la solicitud o el asociado, el enlace "Ver historial de actividad" abre el visor ya filtrado.
  `GET /audit` (filtros `userId`, `action` con varias separadas por coma, `entity`, `from`, `to`, `credit`,
  `application`, `associate`, `q`) y `GET /audit/export.csv`.
- Solo queda en la actividad lo que se hizo desde el 16 de octubre en adelante para revisión de documentos,
  referencias, permisos, pagos verificados y gestiones; lo anterior no tenía registro.

## Skill reutilizable: blindaje transaccional

Las lecciones de este proyecto (concurrencia, idempotencia y doble clic, commit ambiguo, reglas de dinero,
migraciones repetibles, sesiones, operación con varios procesos, pruebas) quedaron empaquetadas como skill de
Claude para auditar o diseñar otros sistemas: `.claude/skills/blindaje-transaccional/` (se carga sola en este
repositorio) y `docs/skills/blindaje-transaccional.skill` (para instalarla en la cuenta y usarla en cualquier
proyecto).

## Carga masiva de asociados (Excel)

Plantilla: [`docs/plantillas/plantilla_asociados.xlsx`](docs/plantillas/plantilla_asociados.xlsx). Una fila por
asociado (titulares y codeudores), con las mismas reglas que el formulario de la app: documento único por tipo,
celular de 10 dígitos, correo válido y fecha AAAA-MM-DD. La hoja «Instrucciones» explica cada columna. Las filas
con error se reportan con su número y motivo; las correctas se cargan.

## Reglas de pagos y reversos (auditoría de transacciones, 2026-10-19)

- Solo se registran pagos y cancelaciones anticipadas a créditos **VIGENTE o EN_MORA** (un crédito refinanciado,
  pagado o anulado responde 409).
- **No se aceptan excedentes:** si el pago supera lo adeudado, responde 409 con el máximo que se puede registrar
  ese día y no guarda nada.
- **Reversar un pago** recalcula el saldo de capital del crédito y el saldo y estado de cada cuota; un crédito
  PAGADO vuelve a VIGENTE (o EN_MORA). No se pueden reversar pagos de créditos refinanciados o anulados.
- Si la base elige una transacción como víctima de un deadlock, se reintenta sola (hasta 2 veces).
- **Solicitudes:** aprobar, rechazar, cancelar, revisar y desembolsar se aplican de a una por solicitud; si dos personas
  deciden a la vez, la segunda recibe 409. Radicar valida que existan el titular, los codeudores y el asesor (400), no
  acepta al titular como su propio codeudor y, si algo falla, no guarda nada. Cancelar queda en la actividad.
- **Reglas en la base (migración 028):** la base rechaza pagado > debido, saldos o montos pagados negativos, pagos y
  líneas de imputación en cero, y ajustes con más pagado que su valor. Si una operación las incumple (sería un error
  del programa) responde 500 con `code: "INTEGRITY_CHECK_FAILED"` y no guarda nada. Al arrancar, el log muestra la
  versión de la base y las reglas activas (`[db] …; reglas CHECK activas 10/10`); si falta alguna, lo dice y por qué
  revisarlo (§3.17).
- Detalle, mediciones y pendientes en `docs/escalabilidad.md` §3.14. La migración 027 repara los saldos que
  quedaron mal por reversos anteriores.

## Escalabilidad y concurrencia

Diagnóstico de escalabilidad, cambios realizados, mediciones y pendientes:
[`docs/escalabilidad.md`](docs/escalabilidad.md). Resumen de lo ya aplicado:

- **Operaciones de dinero con bloqueo de filas** (`SELECT … FOR UPDATE`): pagos,
  reversos, desembolsos y refinanciaciones simultáneas ya no pierden abonos, ni se
  aplican dos veces, ni fallan por deadlock. Número de crédito atómico (`sequences`).
  Migración `020_concurrency_guards.sql`.
- **Hash de contraseñas sin bloquear el servidor**: `bcrypt` nativo (con respaldo
  automático a `bcryptjs`) y SHA-256 para refresh tokens y tokens de restablecimiento.
  Con 30 logins simultáneos el tiempo total pasó de 5,3 s a 0,7 s.
- **Job de alertas por lotes y a prueba de varios procesos**: 18× más rápido a 23.000
  cuotas con el mismo resultado, una sola ejecución a la vez y una vez por día, y alertas
  abiertas únicas. Alertas en vivo (SSE) que llegan aunque haya varios procesos Node.
  Migración `021_multiprocess_guards.sql`.
- **Salud y límites**: `/health` verifica la base de datos y devuelve el id del proceso
  (`instance`); `/api` nunca se cachea (`no-store`); cola del pool limitada (503 al saturarse).
- **Índices medidos con EXPLAIN** (migración `022`): p. ej. el listado de auditoría pasó de
  527 ms a 0,6 ms con 1 M de filas. **Reportes pesados con caché y coalescencia**: 20 usuarios
  abriendo el mismo reporte ya no bloquean al resto. `pagos.csv` por tramos (`?from=&to=`) y con
  escapado contra inyección de fórmulas de Excel.
- **Observabilidad**: cada petición lleva `X-Request-Id`; log JSON de errores y peticiones lentas;
  consultas lentas registradas sin parámetros; `GET /api/v1/admin/metrics` (permiso `audit:read`)
  con memoria, latencias, pool y caché. Qué vigilar y cómo configurar el monitor externo:
  `docs/escalabilidad.md` §10.
- Variables: `AUTH_RATE_LIMIT`, `DB_POOL_SIZE`, `DB_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT_MS`,
  `REQUEST_TIMEOUT_MS`, `REPORT_CACHE_TTL_SECONDS`, `REQUEST_LOG`, `SLOW_REQUEST_MS`,
  `SLOW_QUERY_MS` (ver `backend/.env.example`).
- Pruebas: `cd backend && npm test` (las que usan base de datos son opcionales; ver
  el documento de escalabilidad, sección 4).
