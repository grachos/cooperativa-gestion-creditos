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
  cronograma (sistema francés de cuota fija) y encola el evento contable.
- Registro de pagos y abonos con imputación configurable (mora → interés →
  capital), reversión auditada (nunca borrado físico).
- Motor de mora parametrizable (días de gracia, tasa/base, tope) — valores de
  **demostración**, no definitivos.
- Alertas (próximo vencimiento, vencimiento del día, mora inicial/prolongada)
  con centro de alertas y actualización en tiempo real vía SSE.
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
8. Alertas → clic en "Recalcular alertas (demo)" para ver alertas nuevas
   llegar en vivo por SSE sin recargar la página.
9. Reportes → "quién debe pagar en una fecha" y cartera vencida, exportar CSV.
10. Parámetros → ver la política de mora e imputación como parámetros
    configurables (no hardcodeados).

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

- Fórmula de interés: sistema francés de cuota fija, tasa mensual nominal.
- Orden de imputación: mora → interés → capital.
- Política de mora: 3 días de gracia, tasa diaria de demostración, sin tope.
- Umbrales de alerta temprana/tardía: 3 días antes / 15 días de mora.

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
