# Dinero y reglas de negocio

## Integridad de montos

1. **Todo pago queda aplicado por completo:** después de imputar (gastos → mora → interés → capital, o el
   orden que confirme el negocio), lo aplicado debe ser igual al monto. Si sobra, 409 con el máximo que se
   puede registrar hoy, y no se guarda nada. Antes se aceptaban excedentes que quedaban "guardados sin
   aplicarse".
2. **Solo a estados válidos:** pagos y cancelaciones solo a créditos VIGENTE o EN_MORA; nada a
   REFINANCIADO, PAGADO, ANULADO.
3. **Un reverso recalcula todo lo que el pago tocó:** saldos de cuota, estado (PAGADA/PARCIAL/VENCIDA/
   PENDIENTE), días de atraso, saldo de capital del crédito, y devuelve un crédito PAGADO a VIGENTE.
   Antes solo restaba lo pagado: 64 de 75 créditos con reverso quedaron descuadrados. Si un pago llevó
   descuento (cancelación anticipada), no se reversa o se reversa también el descuento.
4. **Repara los datos ya dañados** con una migración (repetible) que recalcula desde la fuente de verdad
   (las imputaciones), y verifícala en producción.
5. **Reglas `CHECK` en la base** como última barrera: pagado ≤ debido, saldos y pagados ≥ 0, pagos e
   imputaciones > 0, pagado de un cargo ≤ su valor. Ver `migraciones-y-despliegue.md` para agregarlas sin
   tumbar el arranque. Si una escritura las incumple, responde 500 con un código claro
   (`INTEGRITY_CHECK_FAILED`, "no se guardó nada") y queda en el log: es un error del programa.
6. **Dinero en DECIMAL(16,2)**, nunca FLOAT. En JS, redondea con una sola función `round2` en cada paso y
   compara con tolerancia (`Math.abs(a - b) > 0.005`).
7. **Auditoría con valor anterior y nuevo** de cada operación sensible (quién, cuándo, desde qué IP,
   motivo), escrita dentro de la misma transacción.

## Reglas de negocio: confirmar con números

El error más caro no es técnico: es implementar una regla de dinero distinta a la del negocio.

- **Verifica el modelo de interés contra datos reales** antes de construir. En Coomulnissi se suponía
  amortización francesa y era interés fijo sobre el capital original; se confirmó con un crédito real
  ($4.100.000 a 18 cuotas = $227.777,78 capital + $164.022,22 interés en cada cuota).
- **Cuando el cliente da un ejemplo, reprodúcelo en una tabla** comparando "su hoja" vs "la app hoy", y
  señala con números lo que parezca inconsistente (p. ej. un interés que se cobra dos veces). Pregunta con
  opciones concretas, cada una con su resultado numérico. El cliente decide; queda escrito que se le
  planteó.
- **Redondeo:** pregunta a qué múltiplo y en qué dirección, y adónde va la diferencia (en Coomulnissi:
  cuota hacia arriba a $100, la diferencia al interés). Una vez definido, verifica contra un caso real.
- **Lo que no se puede confirmar hoy se parametriza** con un valor inicial razonable, una descripción clara
  en la pantalla de parámetros, y se documenta como "valor inicial propuesto". Una migración que cambia un
  parámetro solo lo reemplaza si sigue con el valor original (nunca pisa lo que el usuario editó).
- **Escribe una prueba con el ejemplo exacto del cliente** (sus cifras) como prueba de aceptación.
- **Sugerir vs. aplicar:** cargos discrecionales (mora, gastos, descuentos) se calculan y SUGIEREN; los
  decide quien tiene el permiso, y la decisión queda registrada como ajuste.

## Separar capital e interés

En refinanciaciones y reestructuraciones guarda por separado: capital heredado, interés heredado, lo ya
pagado de capital y de interés, y de qué crédito viene. El "saldo de capital" del crédito nuevo es solo
capital real; si todo se registra como capital, los reportes y la contabilidad mienten.

## Dinero nuevo vs. reestructuración

Si el cliente pide dinero adicional al refinanciar, suele ser otro producto (otro crédito con su tasa).
Pregúntalo; no lo mezcles por defecto.
