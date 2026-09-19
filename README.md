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
  quedan como movimientos con aprobador obligatorio.
- **Refinanciación** (`POST /credits/:id/refinance`): cierra el crédito
  actual (`REFINANCIADO`), traslada el saldo pendiente + capital adicional a
  un crédito nuevo con su propio cronograma, y deja ambos créditos enlazados
  (`refinanced_from_credit_id` / `refinanced_to_credit_id`). Modela el patrón
  visto en el Excel real ("SE CANCELA CRÉDITO 254 Y SE LE RESTRUCTURA...").
- Tablero operativo y reportes (quién debe pagar en una fecha, cartera
  vencida, exportación CSV de pagos).
- Auditoría de operaciones sensibles (`audit_logs`) con valor anterior/nuevo.
- Outbox de integración contable (`integration_events`/`integration_attempts`)
  con reproceso manual y exportación JSON — **sin adaptador real** porque el
  formato del software contable aún no ha sido confirmado por la contadora.

**Simulado o pendiente para producción** (ver también sección 7):
- El adaptador real hacia el software contable externo (hoy solo se
  encola/exporta).
- Job programado de recálculo de alertas y mora (hoy es un endpoint on-demand
  para la demo; en producción debe ser un proceso periódico).
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
api/[...path].ts   entrada serverless de Vercel: expone la misma app de Express
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

## 5. Guion de demo sugerido

Usuarios de demostración (contraseña `Demo1234*`):
`admin`, `operador`, `aprobador`, `contadora`, `consulta`.

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

Un hallazgo del Excel real que **no** se implementó todavía, por no tener
suficiente certeza de si aplica a toda la cartera: junto al 4% cobrado al
cliente, el Excel también registra una tasa menor (~1,9%) y "aportes del
tomador de los créditos abiertos", sugiriendo que algunos créditos se fondean
con capital de un tercero ("tomador") que recibe una tasa distinta a la que
paga el cliente. Antes de modelar esto hay que confirmar con la cooperativa
si es un patrón general o excepcional.

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
- [ ] HTTPS, rate limiting por endpoint, backups automatizados y cifrado en
      reposo: pendientes de la decisión de hosting/infraestructura de la
      cooperativa (sección 9 del prompt original).

## 9. Riesgos y decisiones que requieren aprobación de la cooperativa

- Ninguna regla de mora, interés o cargos legales aquí es definitiva: son
  parámetros de demostración.
- El envío real de eventos al software contable no está construido porque el
  formato de esa integración no ha sido definido por la contadora.
- La replicación geográfica y el nivel de disponibilidad dependen del
  proveedor de hosting que la cooperativa apruebe; no se asume ninguno.
