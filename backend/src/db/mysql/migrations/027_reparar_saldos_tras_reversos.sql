-- Reparación de datos tras la auditoría de transacciones (hallazgo H1, docs/escalabilidad.md §3.14).
--
-- Hasta este cambio, reversar un pago devolvía lo pagado a las cuotas pero NO recalculaba:
--   * credits.principal_balance (seguía con el saldo como si el pago existiera; el tablero y los reportes
--     mostraban menos capital pendiente del real), ni
--   * credit_schedule_installments.balance, y dejaba la cuota en PARCIAL aunque quedara sin ningún abono.
-- El código ya lo corrige al reversar; esto arregla lo que quedó mal antes. Todo se recalcula a partir de lo
-- pagado en cada cuota, que siempre fue correcto.
--
-- Repetible: son UPDATE que dejan el mismo resultado si se ejecutan otra vez (o a medias y de nuevo).

-- 1) Saldo de cada cuota = capital + interés que le falta (misma fórmula que al aplicar un pago).
UPDATE credit_schedule_installments
SET balance = GREATEST(principal_due - principal_paid + interest_due - interest_paid, 0)
WHERE status <> 'ANULADA'
  AND balance <> GREATEST(principal_due - principal_paid + interest_due - interest_paid, 0);

-- 2) Cuotas en PARCIAL sin ningún abono: vuelven a PENDIENTE con 0 días de atraso; el job diario de alertas
--    las reclasifica en VENCIDA / EN_MORA según su fecha en la siguiente corrida.
UPDATE credit_schedule_installments
SET status = 'PENDIENTE', overdue_days = 0
WHERE status = 'PARCIAL' AND principal_paid = 0 AND interest_paid = 0 AND late_fee_paid = 0;

-- 3) Saldo de capital del crédito = capital que les falta a sus cuotas (solo créditos activos o pagados;
--    los refinanciados conservan el valor con el que se cerraron).
UPDATE credits c
JOIN (
  SELECT credit_id, SUM(principal_due - principal_paid) AS remaining
  FROM credit_schedule_installments
  WHERE status <> 'ANULADA'
  GROUP BY credit_id
) s ON s.credit_id = c.id
SET c.principal_balance = s.remaining
WHERE c.status IN ('VIGENTE', 'EN_MORA', 'PAGADO')
  AND c.principal_balance <> s.remaining;
