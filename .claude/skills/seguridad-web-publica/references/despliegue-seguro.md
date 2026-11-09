# Despliegue seguro (cuando ya hay usuarios y datos reales)

Casi todo lo que salió mal en este proyecto fue de **puesta en marcha**, no de código. Reglas aprendidas:

## El orden de salida de una defensa nueva

1. **Variables de entorno primero** (llaves del captcha, lista de dominios, `ENFORCE`). Mientras el código no las lee, no
   hacen nada. Verifica que existen leyendo los **nombres** con la API del hosting (los valores van enmascarados: no se puede
   saber si están bien escritos; la prueba real es entrar).
2. **Código después**, cuando servidor y pantalla puedan salir juntos. Si el servidor exige el reto y la pantalla aún no lo
   muestra (o al revés), **nadie puede iniciar sesión**.
3. **Que el dueño pruebe el ingreso real** apenas salga. Tú revisas los registros de arranque (migración aplicada, sin
   errores, escuchando) pero no puedes ver el navegador.
4. **Palanca de emergencia lista y explicada** antes de publicar (`TURNSTILE_ENFORCE=false` + reiniciar).

## Autodespliegue: cuidado con cada `git push`

Si el hosting despliega solo al subir a una rama, **cada push es un despliegue a producción**, también uno «de
documentación» (reinicia la aplicación). Estrategia: el trabajo a medias va a **otra rama** que no se despliega y se pasa a
la rama de despliegue (avance rápido) solo cuando todo está probado y las variables creadas. Escribirlo en el `CLAUDE.md`.
Verifica con la API del hosting que el autodespliegue está **activo** (`gitAutoDeployment`): en este proyecto la conexión
con GitHub se había perdido y durante semanas nada se publicó, sin ningún aviso; reconectar GitHub en el panel del hosting
lo resolvió.

## Nada destructivo contra producción

- **Respaldo antes de migraciones y limpiezas** (exportar desde phpMyAdmin o similar). Dilo siempre; no puedes comprobarlo.
- Las migraciones de este tipo **solo crean** (`CREATE TABLE IF NOT EXISTS`); repetibles (ver `blindaje-transaccional`).
- **Scripts que borran** (limpieza de datos de prueba): (a) exigen una confirmación escrita en una variable
  (`SET @confirmar = 'SI, BORRAR TODO'`); sin ella, todo se revierte; (b) corren en una transacción con un camino de reversa
  (p. ej. si no se conserva ningún usuario); (c) se prueban localmente **en ambos caminos** (con y sin confirmación); (d) no
  usan `FOREIGN_KEY_CHECKS=0` (phpMyAdmin lo reactiva): borran en orden de dependencias; (e) incluyen **todas** las tablas
  nuevas — comprobarlo con una consulta a `information_schema` contra el script; (f) llevan arriba un aviso grande de que
  borran datos reales también. Cuando el dueño avise que «estamos en producción», **tú no ejecutas nada destructivo**:
  entregas el script y los pasos, y ejecuta él.
- La sesión de desarrollo trabaja contra su **propia base de pruebas**. Nunca contra la de producción.

## Qué verificar tras publicar

- Compilación terminada, aplicación reiniciada, migración aplicada, `[db] … reglas activas`, sin errores en los registros.
- Que el dueño entre, y prueba también recuperar/restablecer contraseña (suelen olvidarse).
- Que la auditoría esté llenándose (unos días después).

## Lo que no puedes probar y debes decir

El contacto real con el proveedor del captcha (si el entorno de desarrollo bloquea esos dominios), el widget en un
navegador real y la configuración de Cloudflare (dominios autorizados). Tu informe separa «probado con pruebas» de «lo
comprobará el dueño al entrar».

## Atención a la rotación de secretos

Si una clave pasó por un chat, una captura o un registro, rotarla. Una contraseña visible en una captura de pantalla también
cuenta: pedir que la cambie.
