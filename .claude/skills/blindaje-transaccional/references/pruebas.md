# Pruebas que demuestran algo

## Principios

1. **Primero la prueba que falla.** Reproduce el hallazgo, comprueba que falla con el código viejo
   (`git stash push <archivos del arreglo>`, correr, `git stash pop`), y solo entonces arregla. Una prueba
   que nunca falló no demuestra que el arreglo sirva. Si no logras reproducir una carrera, dilo en el
   informe en vez de darla por corregida.
2. **Contra la base real**, no mocks, para todo lo de transacciones, bloqueos, llaves y CHECK. Actívalas
   con una variable (`TEST_DB=1`) para que la suite rápida siga corriendo sin base, y **solo contra una
   base de pruebas** (crean datos).
3. **Datos únicos por corrida** (sufijo con `Date.now()`) y nada de modificar parámetros globales que usan
   otras pruebas en paralelo (eso causó pruebas intermitentes).
4. **Suite completa dos veces seguidas** antes de subir: los conflictos de datos y las carreras aparecen
   en la segunda.
5. **Contraseñas de usuarios de prueba generadas** en cada corrida, nunca literales.

## Patrones

**Concurrencia:** dispara N peticiones a la vez y verifica el invariante, no la respuesta individual.

```ts
const results = await Promise.all(Array.from({ length: 10 }, () => pay(creditId, 50_000)));
expect(results.filter(r => r.status === 201)).toHaveLength(10);
expect(await sumPaid(creditId)).toBe(500_000);          // nada perdido
expect(await principalBalanceMatchesSchedule(creditId)).toBe(true);
```

**Doble decisión:** dos aprobaciones simultáneas → exactamente una 200 y una 409.

**Deadlock real:** dos transacciones que bloquean A→B y B→A con una pausa en medio; verifica que el
helper reintenta y ambas terminan (y que con 0 reintentos falla).

**Commit ambiguo (idempotencia):** fuerza un error DESPUÉS del COMMIT (p. ej. reemplaza temporalmente el
emisor de eventos por uno que lanza), espera 500, reintenta con la misma clave y verifica 201 repetido
(`Idempotent-Replayed: true`) y un solo registro.

**Rollback libera la clave:** una operación que falla por regla de negocio dentro de la transacción no
deja clave ni efecto.

**Invariantes contables** después de cada escenario: saldo de capital = capital debido − pagado de las
cuotas vivas; saldo de cada cuota = lo que le falta; PARCIAL implica algo pagado.

**Ejemplo del cliente:** una prueba con las cifras exactas que dio el negocio.

**Migraciones:** aplicar, repetir, interrumpida a medias, dos procesos a la vez, y datos que incumplen
una restricción nueva (ver `migraciones-y-despliegue.md`).

**Frontend:** doble clic y Enter repetido en el formulario → una sola petición; la misma clave en el
reintento; clave nueva tras el éxito.

## Antes de decir "listo"

- Typecheck, lint y build del frontend.
- Suite backend con base (dos veces) y frontend.
- Diff releído buscando qué rompería la integración continua.
- Despliegue verificado en los logs.
- Informe con lo que pasó, lo que no se pudo probar y lo que queda pendiente.
