# Plantillas (código real, probado en producción en Coomulnissi)

Copiar y adaptar. Lo específico del proyecto de origen:

| Qué cambiar | Dónde |
|---|---|
| `import { env } from "../config/env.js"` y `pool` de `../db/pool.js` | `backend/turnstile.ts`, `backend/authGuard.ts`: apuntar a tu configuración y a tu conexión (mysql2). Con otro motor, adaptar las consultas (`NOW() - INTERVAL ? MINUTE`, `LAST_INSERT_ID`, `insertId`) |
| Variables `TURNSTILE_*`, `AUTH_RATE_LIMIT`, `AUTH_IP_FAILED_LIMIT`, `AUTH_MAX_FAILED_LOGINS` | tu `env.ts` y `.env.example` (el proyecto de origen las valida con zod) |
| `identifierFor()` (campos `identifier` y `uid`) | `backend/authGuard.ts`: el campo con el que se identifica a la persona en tus formularios |
| Acciones (`login`, `forgot_password`, `reset_password`) | `AuthAction` en `authGuard.ts` y los `useTurnstile("…")` de tus pantallas |
| Migración `030_antibots.sql` | renumerar según tus migraciones; repetible (`CREATE TABLE IF NOT EXISTS`) |
| `api` de `../lib/api` y la ruta `/auth/captcha-config` | `frontend/useTurnstile.tsx` (y el endpoint en el servidor: ver `references/anti-bots-turnstile.md`) |
| Estilos (clases de Tailwind) | `frontend/TurnstileWidget.tsx` |

Las pruebas (`*.test.ts`) usan Vitest; las de `authGuard.test.ts` necesitan una base real de pruebas (`TEST_DB=1`).
`turnstile.test.ts` no necesita red ni base.
