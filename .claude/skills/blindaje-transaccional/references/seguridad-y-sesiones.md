# Seguridad y sesiones

## Ingreso seguro

| Regla | Por qué (caso real) |
|---|---|
| Hash de contraseña con bcrypt **nativo** (respaldo a bcryptjs) o argon2 | bcryptjs (JS puro) bloqueaba el hilo de Node: 30 logins simultáneos tardaban 5,3 s; con nativo 0,7 s |
| Tokens de refresh y de restablecimiento guardados como **SHA-256**, no bcrypt | Son aleatorios de alta entropía: bcrypt solo gasta CPU. Migrar en el acto los hashes viejos al validarlos |
| Bloqueo tras 5 intentos fallidos en 15 min, **contado en la base** | En serverless o con varios procesos, un contador en memoria no frena nada |
| Máximo 3 correos de restablecimiento por hora por usuario; respuesta siempre 204 | Evita inundar buzones y averiguar qué cuentas existen |
| Correo de restablecimiento fuera de la ruta crítica, con timeout SMTP | Un proveedor lento no debe colgar la petición |
| Token manipulado o vencido → 401, nunca 500 | Un 500 en auth confunde y llena los logs |
| Desactivar un usuario o quitarle permisos revoca su sesión de inmediato | Borrar el hash del refresh y validar `status` al renovar |
| `Cache-Control: no-store` en toda la API | Un CDN o cache del hosting (LiteSpeed) podía servir respuestas de un usuario a otro |
| Helmet, CORS explícito, consultas parametrizadas, validación (Zod) en todas las escrituras | Base mínima |

## Sesiones que sí expiran

Caso real: un usuario volvió tras 5 días y la sesión seguía abierta. Causas: refresh token de 7 días y un
temporizador de inactividad que **se reiniciaba al abrir** la app. Corrección en tres capas:

1. **Inactividad en el navegador** (10 min, con aviso previo): guarda `lastActivityAt` en
   `localStorage` y, **al abrir la app**, si pasó más del límite, cierra de inmediato.
2. **Al iniciar sesión, escribe `lastActivityAt = ahora`** y al cerrar sesión bórralo. Sin esto, la marca
   vieja de la sesión anterior cierra la sesión recién abierta en el acto (pasó: nadie podía entrar).
   Prueba siempre el flujo completo de login después de tocar la expiración.
3. **Límite duro en el servidor:** refresh token corto (`JWT_REFRESH_EXPIRES_IN`, p. ej. 12 h), porque
   el control del navegador puede no ejecutarse.

## Permisos

- **RBAC en el backend** (autoridad final), el frontend solo oculta.
- **Granular por módulo × acción** (`associates:read|create|update`, `payments:verify|reverse|payoff`,
  `credits:refinance`, `reports:export`…) con catálogo en un solo archivo compartido.
- **Roles + excepciones por usuario** (`user_permissions.granted` 1 agrega / 0 quita) editables con
  casillas: el cliente pidió "qué puede hacer cada uno", no solo roles fijos.
- Separar funciones: quien registra pagos no necesariamente decide mora/descuentos.

## Trazabilidad

- `audit_logs` con quién, qué, cuándo, IP, valor anterior/nuevo y motivo, escrito en la transacción.
- **Visor de actividad** filtrable por usuario, acción, entidad, fechas y texto ("quién aprobó", "quién
  bajó la cuota"), con descripción legible y exportación CSV. Sin visor, la auditoría no sirve al negocio.
- Índices en `audit_logs` (entidad, usuario, fecha) medidos con EXPLAIN: crece rápido.

## Secretos

- Nunca en el repositorio: ni `.env`, ni contraseñas de prueba literales. Las pruebas generan contraseñas
  aleatorias en cada corrida (`randomPassword()`); un escáner (GitGuardian) detectó las literales.
- Si un secreto pasó por un chat, un log o un commit: rotarlo. Borrarlo del historial no basta.
- Secretos del hosting en sus variables de entorno; `.env.example` sin valores reales.
- Endpoints de cron protegidos con un secreto (`CRON_SECRET`).
- Pruebas que crean datos: **solo contra una base de pruebas**, nunca producción.
