---
name: seguridad-web-publica
description: >-
  Protege la parte pública de una aplicación web contra bots, fuerza bruta, abuso y enumeración de usuarios, con
  protocolos probados en producción: Cloudflare Turnstile (captcha) verificado en el servidor y falla cerrado,
  límites de intentos y bloqueos temporales guardados en base de datos (no en memoria), mensajes uniformes,
  auditoría de accesos, cabeceras y política de contenido (CSP), llaves de API para integraciones legítimas,
  reintentos seguros con 429/Retry-After, y despliegue sin dejar a nadie fuera. Úsalo siempre que el usuario
  pida proteger un login, formulario público, registro, recuperar contraseña o API; mencione bots, captcha,
  Turnstile, reCAPTCHA, hCaptcha, rate limit, límite de intentos, bloqueo de cuenta, fuerza bruta, scraping,
  CSP, cabeceras de seguridad, llaves de API, reintentos, 429, auditoría de accesos o "endurecer/asegurar/poner
  en producción de forma segura"; o quiera aplicar "los protocolos de seguridad de Coomulnissi" a otro sistema —
  aunque no use la palabra "seguridad".
---

# Seguridad de la parte pública

Protocolos aprendidos, con sus tropiezos reales, al blindar el sistema de créditos de una cooperativa (Node/Express +
MariaDB + React, en Hostinger, **en producción con datos reales**). Cada regla existe porque su ausencia causó o pudo
causar un daño: bots probando contraseñas, usuarios que se podían enumerar, un contador de intentos que cada proceso
llevaba aparte, un captcha que bloqueaba a todos al desplegarse.

Complementa a `blindaje-transaccional` (dinero, concurrencia, idempotencia, migraciones). De esa skill vienen las
sesiones que expiran, los permisos por módulo, los secretos y el hash de contraseñas: **no se repiten aquí**; léela si
el sistema también mueve dinero.

## Método

### 1. Inventario de la superficie pública (antes de tocar nada)

Lista **todo lo que se puede llamar sin sesión**: login, registro, recuperar/restablecer contraseña, contacto,
búsquedas abiertas, webhooks, `/health`, cron, y los endpoints que reciben llaves. Para cada uno: qué cuesta que un bot lo
llame mil veces (correos enviados, filas escritas, CPU de hash, datos revelados) y qué defensa tiene hoy. Averigua también
cómo se despliega (cuántos procesos, si hay autodespliegue, qué ramas, cómo se cambian variables): condiciona el orden de
salida (ver `references/despliegue-seguro.md`). Pregunta qué rutas SÍ existen: no inventes formularios que no hay.

### 2. Elegir las defensas por capas

| Capa | Qué evita | Referencia |
|---|---|---|
| Captcha verificado en el servidor (Turnstile) | automatización masiva | `references/anti-bots-turnstile.md` |
| Límites y bloqueos en la base de datos | fuerza bruta, relleno de credenciales, inundar correos | `references/limites-y-bloqueos.md` |
| Respuestas uniformes + auditoría | enumerar usuarios, no saber qué pasó | `references/limites-y-bloqueos.md` |
| Cabeceras / CSP | scripts ajenos, clickjacking; **y que el widget cargue** | `references/anti-bots-turnstile.md` |
| Llaves de API para integraciones | que tus propios bots y cron no pasen por el captcha, sin abrir un hueco | `references/llaves-de-api.md` |
| Reintentos y fallas | duplicados por reintento, tormentas de reintentos, quedarse dentro o fuera al fallar | `references/reintentos-y-fallas.md` |
| Puesta en marcha | dejar a todos fuera, o borrar datos reales | `references/despliegue-seguro.md` |

### 3. Informe primero, cambios después

Antes de escribir código entrega: qué encontraste, qué archivos vas a tocar, en qué incrementos, y qué decisiones necesitas
del dueño (alcance, dominios, qué pasa si falta la clave). Espera su aprobación. Si es un sistema en producción, dilo
explícitamente en el plan y di cómo se sale sin riesgo.

### 4. Incrementos pequeños, cada uno con prueba

Orden que funcionó: (1) el verificador/guardia **sin conectarlo** a ninguna ruta, con pruebas; (2) conectarlo al servidor,
con migración y auditoría; (3) la pantalla; (4) llaves de API. Cada incremento termina con pruebas verdes, commit y
documentación en el mismo commit. Las pruebas deben **fallar cuando rompes la defensa a propósito** (quita la comprobación
y mira que fallen): una prueba que nunca falló no demuestra nada.

### 5. Publicar sin dejar a nadie fuera

Variables de entorno primero, código después; una palanca de emergencia documentada; verificar en los registros de
arranque y que el dueño pruebe el ingreso real. Detalle en `references/despliegue-seguro.md`.

## Plantillas listas (en `assets/`)

Código real, ya probado en producción. Adáptalo (rutas de importación, nombres de variables, tabla de usuarios):

| Archivo | Qué es |
|---|---|
| `assets/backend/turnstile.ts` + `turnstile.test.ts` | verificador que falla cerrado, con 19 pruebas sin red |
| `assets/backend/authGuard.ts` + `authGuard.test.ts` | límites en base de datos, reto por acción y auditoría (middleware Express) |
| `assets/backend/030_antibots.sql` | tablas `auth_attempts` y `auth_audit` (repetible) |
| `assets/frontend/TurnstileWidget.tsx`, `useTurnstile.tsx` + prueba | widget y hook de React |

## Principios

- **Falla cerrado** en lo que protege: sin llave o sin respuesta del servicio de captcha, se rechaza. Pero con una palanca
  de emergencia (variable de entorno) que el dueño pueda activar sin esperar a un programador.
- **La base de datos, no la memoria:** el hosting corre varios procesos y serverless no comparte estado.
- **Misma respuesta exista o no la cuenta:** el bloqueo, el mensaje y el tiempo no deben delatar qué usuarios hay.
- **Nunca guardar** contraseñas, tokens ni lo tecleado en claro (a veces es una contraseña en el campo equivocado): hash.
- **Los errores del proveedor van a los registros, no a la respuesta.**
- **Producción es sagrada:** nada destructivo sin confirmación escrita; lo que dependa de variables nuevas va a otra rama
  hasta que todo esté listo; y lo que no se pudo probar (p. ej. contacto real con Cloudflare desde el entorno de
  desarrollo) se dice.
