# Plan de cambios — reunión con la cooperativa (2026-10-16)

Fuente: transcripción de la reunión de revisión de la app (Juan Carlos, Jorge Enrique,
Tatiana/Diana, Yenny). Cada punto indica qué pidió el cliente, qué existe hoy en el código
y qué falta.

## Personas y responsabilidades (según la reunión)

| Persona | Responsabilidad en la app |
|---|---|
| Diana Acevedo | Carga de asociados (titulares y codeudores) y radicación de solicitudes |
| Jorge Enrique Guarín | Único que aprueba/rechaza solicitudes y negocia cobros de mora/descuentos |
| Tatiana | Verifica en banco y registra los pagos |
| Asesores externos | Venden el crédito; **sin acceso** al sistema, solo quedan registrados |
| Yenny Huérfano (contadora) | Parte contable: se trata aparte (ver Fase 6) |

## Fase 1 — Ajustes rápidos (no dependen de datos del cliente) — IMPLEMENTADA (2026-10-16)

Nota: la fecha de desembolso ya existía; se agregaron cuentas y soporte. Falta la marca de verificación dentro del cronograma de cuotas (hoy se ve en la tabla de pagos).

1. **Búsqueda y paginación en listados.** Asociados, Solicitudes y Créditos.
   - Hoy: el backend ya pagina (`?page=&pageSize=`) y Asociados busca por nombre/cédula, pero
     las páginas del frontend no muestran controles de página y Solicitudes/Créditos no tienen búsqueda.
   - Falta: buscador por cédula/nombre del titular (solicitudes y créditos) y por número de crédito;
     controles Anterior/Siguiente en las tres páginas.
2. **Compromisos de pago: campo "Observación"** además de la nota del compromiso
   (p. ej. "titular se retiró de la empresa, pasa a PU"). Hoy solo hay `description`.
   Falta: columna `observation` en `collection_actions`, formulario y listado.
3. **Pago verificado.** Casilla "Pago verificado en banco y soporte archivado" al registrar un pago,
   visible en el historial y en el cronograma de cuotas. Queda registrado quién lo marcó.
4. **Datos del desembolso.** Hoy solo se piden fecha de primera cuota y gestor. Falta:
   fecha de desembolso, cuenta destino del asociado (banco, tipo y número), cuenta de la
   cooperativa desde la que salió (lista parametrizable) y casilla "soporte de desembolso archivado".
   No se suben archivos: el soporte se guarda fuera de la app (decisión de la reunión, por costo de servidor).

5. **Documentos requeridos por participante (titular y cada codeudor), parametrizables.**
   - Hoy: hay un solo parámetro `documentos_requeridos` con una lista única por **solicitud**; no distingue
     si el documento es del titular o de un codeudor, y con dos codeudores no hay forma de marcar
     "cédula del codeudor 2".
   - Falta: en Parámetros, dos listas editables — documentos del **titular** y documentos de **cada codeudor**
     (agregar, quitar, renombrar, marcar obligatorio/opcional). En la revisión de la solicitud, cada
     participante muestra su propia lista con aprobado/rechazado, observación, quién y cuándo. Para aprobar,
     los obligatorios de todos los participantes deben estar revisados.
   - Las solicitudes ya existentes conservan su lista actual (no se reescribe el histórico).

## Fase 2 — Permisos por acción y trazabilidad

6. **Permisos por usuario con casillas.** Hoy hay roles fijos (permisos como `applications:write`,
   `applications:approve`, `payments:write`). Falta:
   - Separar permisos finos: radicar solicitud, poner en revisión, revisar documentos/participantes,
     aprobar/rechazar, desembolsar, registrar pagos, negociar mora/descuentos.
   - En Usuarios, una sección de casillas "qué puede hacer" por usuario (además del rol).
7. **Registro de quién hizo qué.** La base ya guarda `created_by`, `decided_by`, `reviewed_by`,
   historial de estados y `audit_logs`. Falta mostrarlo:
   - En el detalle de solicitud y crédito: "Radicó / revisó / aprobó / desembolsó / registró pago: usuario, fecha".
   - Reporte "Actividad por usuario" filtrable por usuario, acción y fechas, exportable a CSV.
   - Incluir verificación de referencias (contactada sí/no, resultado positivo/negativo, quién).

## Fase 3 — Asesores externos

8. Hoy el "vendedor" de un crédito es un usuario sin roles (no entra al sistema), lo que ya cumple
   la idea. Falta: llamarlo **Asesor**, poder asignarlo **al radicar la solicitud** (hoy solo en el crédito)
   y un filtro/reporte de créditos por asesor.

## Fase 4 — Documentos físicos y módulo jurídico

9. **Categorías de documentos parametrizables:** además de las de solicitud (titular/codeudor, Fase 1), las del asociado y las de cobro jurídico.
10. **Documentos del asociado:** lista de chequeo "lo tenemos en físico: sí/no" (cédula, certificación
   laboral, desprendibles, referencias…), con quién lo marcó y cuándo.
11. **Módulo de cobro jurídico** por crédito: documentos (notificación de embargo, embargo, etc.) con
    la misma lista "en nuestro poder sí/no" y bitácora de gestiones. Hoy existe el tipo
    `PREPARACION_JURIDICA` en gestiones de cobro, pero sin documentos.

## Fase 5 — Interés de mora, gastos y descuentos (requiere datos del cliente)

12. **Interés de mora sugerido.** Hoy la política es "no se cobra mora automática"
    (parámetro `politica_mora`) y **no existe ningún parámetro de tasa de mora**. Lo pedido:
    - Parámetro editable en Parámetros: **% de interés de mora por día de atraso** (con historial de cambios
      y motivo, como la tasa corriente). Opcional: días de gracia antes de empezar a cobrar.
    - Cálculo: saldo vencido × % diario × días de atraso (la base exacta — cuota completa o solo capital — la confirma el cliente).
    - Al registrar un pago, mostrar: cuota ordinaria, mora sugerida y total sugerido.
    - Solo quien tenga el permiso "negociar mora" (Jorge Enrique) decide cobrarla completa, parcial o no cobrarla;
      la decisión queda registrada como ajuste del crédito.
13. **Gasto de notificación automático** a los 30/60 días de mora (como sugerido, mismo criterio).
14. **Descuento por pago anticipado / cancelación anticipada del crédito**, parametrizable.

**Bloqueo:** Jorge Enrique y Tatiana deben entregar los valores y condiciones exactos
(valor del % diario de mora y sobre qué saldo se aplica, días de gracia, valor y momento del gasto de notificación, reglas del descuento).

## Fase 6 — Fuera de este alcance (se coordina aparte)

- **Contabilidad** (Yenny): reunión pendiente. Opciones: exportes/archivos planos o API hacia su
  software contable (lo más probable), o un módulo contable propio (negocio aparte). Urgente por el cierre de año.
- **Migración de datos desde Excel:** la hace la cooperativa; se puede ofrecer una herramienta de importación.
- **Entrega:** cambiar el correo del administrador al de la cooperativa para que ellos fijen su contraseña.
- **Futuro:** pagos PSE, portal para asociados, llamadas de cobro con IA.

## Orden propuesto

1. Fase 1 completa (independiente, alto impacto en el uso diario).
2. Fase 2 (los permisos son necesarios antes de crear los usuarios reales de Diana, Jorge y Tatiana).
3. Fase 3 y Fase 4.
4. Fase 5 cuando lleguen los parámetros del cliente.

Cada fase: migración repetible, pruebas, documentación y despliegue por separado.
