# Cooperativa · Gestión de Créditos

Software operativo para el control de asociados, sociedades, solicitudes de
crédito, desembolsos, cronogramas, pagos, mora y alertas. Reemplaza el
seguimiento actual en Excel. No es un software contable: expone eventos y
exportaciones para el sistema contable externo de la contadora.

Este repositorio contiene la **primera versión demostrable (MVP)**, construida
con el stack solicitado: React 19 + TypeScript + Vite + Tailwind v4 +
TanStack Query en el frontend, y Node.js + Express + TypeScript + MySQL2 + Zod
+ JWT + SSE en el backend.

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
- Registro de pagos y abonos con imputación configurable (mora → interés →
  capital), reversión auditada (nunca borrado físico).
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
backend/   Node + Express + TS + MySQL2 + Zod + JWT + SSE
  src/modules/<dominio>/   rutas + servicios por módulo de negocio
  src/db/migrations/       migraciones SQL versionadas (numeradas)
  src/db/seed.ts           datos de demostración
  src/shared/schemas.ts    esquemas Zod (fuente de verdad de validación)
```

El backend es la autoridad final de permisos (middleware `requirePermission`);
el frontend solo oculta acciones no autorizadas, nunca depende de eso para
seguridad.

## 4. Instalación y ejecución (desarrollo)

Requisitos: Node.js 20+, MySQL 8 (o Docker).

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

## 4bis. Despliegue del frontend en Vercel

Vercel no aloja MySQL ni procesos Node de larga duración como Express, así
que por ahora solo el **frontend** se despliega ahí (sirve como build/deploy
de demostración de la interfaz; el login y las llamadas a `/api/...`
fallarán hasta que el backend tenga un host propio con una base de datos
accesible desde internet — ver sección 9).

Pasos:

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa
   este repositorio de GitHub.
2. En la configuración del proyecto, **Root Directory** → `frontend`.
   Vercel detecta Vite automáticamente (`npm run build`, salida `dist`).
3. `frontend/vercel.json` ya incluye el rewrite necesario para que las
   rutas de React Router (`/creditos/1`, etc.) no den 404 al recargar.
4. Si más adelante el backend queda desplegado en otro dominio, configura
   la variable de entorno `VITE_API_BASE_URL` en el proyecto de Vercel
   (Settings → Environment Variables) apuntando a
   `https://tu-backend.dominio.com/api/v1`, y vuelve a desplegar.

Verificado localmente: `npm run build` genera `frontend/dist` sin errores
de TypeScript, y sirviendo ese `dist` de forma estática se carga el login
correctamente (sin la base de datos, cualquier intento de ingresar fallará
con un error de red — comportamiento esperado hasta desplegar el backend).

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
- Orden de imputación: mora → interés → capital.
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
