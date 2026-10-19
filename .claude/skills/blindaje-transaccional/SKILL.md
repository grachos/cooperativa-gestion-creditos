---
name: blindaje-transaccional
description: Audita y blinda aplicaciones web que mueven dinero o registros críticos (créditos, pagos, cartera, inventario, facturación, reservas, cooperativas, fintech) contra duplicados, condiciones de carrera, doble clic, reintentos, commits ambiguos, deadlocks, migraciones que tumban el sitio, sesiones que no expiran y secretos filtrados. Úsalo siempre que el usuario pida revisar, auditar, endurecer o "poner en producción" un sistema transaccional, cuando empiece un sistema nuevo con pagos o saldos y quiera hacerlo bien desde el inicio, cuando mencione idempotencia, doble clic, pagos duplicados, concurrencia, bloqueos, deadlock, FOR UPDATE, transacciones, migraciones, sesión que no cierra, intentos de login, o pida "aplicar las mejoras de Coomulnissi" a otro proyecto — aunque no use la palabra "auditoría".
---

# Blindaje transaccional

Lecciones aprendidas, con incidentes reales, al llevar a producción el sistema de créditos de una
cooperativa (Coomulnissi: Node/Express + MySQL/MariaDB + React, en Hostinger). Cada regla existe porque
su ausencia causó o pudo causar un daño concreto: pagos duplicados, saldos descuadrados, el sitio caído.
Sirve para dos cosas:

- **Auditar un sistema existente:** encontrar dónde se puede perder o duplicar dinero, y corregirlo.
- **Diseñar uno nuevo:** construir desde el día uno con estas protecciones (es mucho más barato).

El stack de origen fue Node + MySQL, pero los principios son generales. Cuando el sistema use otro motor
o lenguaje, traduce el mecanismo (ver la sección "Portabilidad" de cada referencia), no el código.

## Método

### 1. Inventario (antes de opinar)

Lista **todas las operaciones de escritura**: endpoint, qué tablas toca, si va en transacción, qué bloquea
y en qué orden, si es idempotente, si un job la toca también. Marca las que mueven dinero o cambian
estados (aprobar, desembolsar, pagar, reversar, refinanciar, anular). Esa tabla es la base del informe y
evita la auditoría "por impresión".

Lee también: cómo se despliega (cuántos procesos, qué base, qué versión), cómo corren las migraciones,
qué jobs hay, y qué pruebas existen y contra qué base.

### 2. Evaluar por áreas

Recorre las áreas y lee la referencia de cada una **cuando llegues a ella** (no todas de golpe):

| Área | Referencia | Pregunta central |
|---|---|---|
| Concurrencia y transacciones | `references/concurrencia-y-transacciones.md` | ¿Dos peticiones simultáneas pueden pisarse, duplicar o bloquearse? |
| Idempotencia y doble clic | `references/idempotencia.md` | ¿Un reintento, doble clic o timeout repite el efecto? |
| Dinero y reglas de negocio | `references/dinero-y-reglas.md` | ¿Puede quedar un saldo imposible o una regla mal aplicada? |
| Migraciones y despliegue | `references/migraciones-y-despliegue.md` | ¿Un reinicio a mitad de arranque tumba el sitio? |
| Seguridad y sesiones | `references/seguridad-y-sesiones.md` | ¿Quién puede hacer qué, cuánto dura una sesión, hay secretos expuestos? |
| Operación y escalabilidad | `references/operacion-y-escalabilidad.md` | ¿Qué pasa con varios procesos, carga o una falla a las 3 a. m.? |
| Pruebas | `references/pruebas.md` | ¿Cómo se demuestra que el fallo existía y que ya no? |

### 3. Informe primero, cambios después

Si el usuario pidió diagnóstico, **no modifiques archivos ni ejecutes migraciones**: entrega el informe y
espera. En sistemas con dinero, una corrección apresurada es un riesgo nuevo. Formato:

```markdown
## Diagnóstico de [sistema]

### Inventario de operaciones de escritura
| Operación | Tablas | Transacción | Bloqueo (orden) | Idempotente | Riesgo |

### Hallazgos
| # | Prioridad | Tipo | Hallazgo | Evidencia | Escenario de falla | Corrección propuesta |
- Prioridad: P0 (pierde/duplica dinero o tumba el sitio), P1 (falla bajo carga o en casos comunes), P2 (riesgo acotado).
- Tipo: C = confirmado (reproducido con una prueba o con datos), R = riesgo (razonado, no reproducido).
- Evidencia: archivo:línea y, si existe, el dato real que lo demuestra (p. ej. "64 de 75 créditos con reverso descuadrados").

### Reglas de negocio a confirmar
Lo que el código asume y solo el dueño del negocio puede decidir, con un ejemplo numérico.

### Orden sugerido de corrección
```

Separa lo confirmado de lo sospechado. Decir "no lo pude reproducir" es parte del trabajo.

### 4. Corregir con prueba que falla antes y pasa después

Para cada hallazgo: escribe la prueba que lo reproduce, compruébala **fallando con el código viejo**
(`git stash` del arreglo), aplica el arreglo mínimo, y córrela de nuevo. Luego la suite completa **dos
veces** (las carreras y los datos compartidos aparecen en la segunda). Detalle en `references/pruebas.md`.

### 5. Documentar en el mismo commit

Cada cambio deja escrito: el problema medido o confirmado (el porqué), qué se hizo, cómo verificarlo y qué
queda pendiente o no se pudo probar. Mantén una tabla de hallazgos con estado (✅ / 🔶 / ⏳) y un historial.
Si el proyecto no tiene un `CLAUDE.md` con estas convenciones, propón crearlo: así la siguiente sesión
no repite errores ya corregidos.

### 6. Verificar en producción

Tras desplegar, lee los logs de arranque (migraciones aplicadas, sin errores) antes de decir "listo". Un
despliegue que no se verificó no está terminado.

## Principios que atraviesan todo

- **La base de datos es la última línea de defensa.** Validaciones en el código se saltan con una
  carrera; llaves únicas, `CHECK` y sentencias condicionales no.
- **Todo efecto o nada.** Una operación de dinero ocurre completa dentro de una transacción, incluida la
  marca de idempotencia y la auditoría; si algo falla, no queda nada.
- **Los reintentos van a ocurrir** (red, usuario impaciente, proxy, deadlock): diseña para que repetir sea
  inofensivo.
- **Varios procesos es el caso normal** en hosting compartido o serverless: nada crítico en memoria.
- **Las reglas de dinero las decide el negocio.** Si el código y el ejemplo del cliente difieren,
  muéstralo con números y pregunta; cuando el cliente no puede confirmar aún, parametriza con un valor
  inicial y déjalo documentado.
- **Honestidad en los reportes:** lo que no se probó se dice; lo que falló se muestra.
