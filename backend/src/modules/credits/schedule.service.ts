import { round2 } from "../../utils/money.js";

export interface ScheduleRow {
  installmentNumber: number;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  otherDue: number;
  totalDue: number;
  balance: number;
}

/** Redondea hacia arriba al múltiplo indicado (la cuota de $213.333,33 con múltiplo 100 queda en $213.400). */
export function ceilToMultiple(value: number, multiple: number): number {
  if (!(multiple > 0.01)) return Math.ceil(round2(value) * 100 - 1e-6) / 100;
  return Math.ceil(round2(value) / multiple - 1e-9) * multiple;
}

/**
 * Interés fijo simple sobre el capital original (NO amortización francesa).
 *
 * Verificado contra los datos reales de la cooperativa: un crédito de
 * $4.100.000 a 18 cuotas de $391.800 reparte exactamente $227.777,78 de
 * capital y $164.022,22 de interés en CADA cuota (capital e interés
 * constantes, sin importar el saldo pendiente).
 *
 * La cuota se redondea HACIA ARRIBA al múltiplo `roundTo` (parámetro `redondeo_cuota`, $100) y la
 * diferencia queda como interés: $227.777,78 + $164.000 = $391.777,78 → cuota $391.800, interés
 * $164.022,22, igual que el crédito real. La última cuota salda el capital exacto y conserva el mismo
 * valor de cuota.
 *
 * `totalInterest` (opcional) fija el interés total en lugar de capital × tasa × plazo: lo usa la
 * refinanciación, cuyo interés se hereda del crédito anterior (refinance.service.ts).
 */
export function buildAmortizationSchedule(params: {
  principal: number;
  monthlyRatePercent: number;
  termMonths: number;
  firstInstallmentDate: Date;
  totalInterest?: number;
  roundTo?: number;
}): ScheduleRow[] {
  const { principal, monthlyRatePercent, termMonths, firstInstallmentDate } = params;
  const n = termMonths;

  const principalPerInstallment = round2(principal / n);
  const totalInterest = params.totalInterest ?? round2(principal * (monthlyRatePercent / 100) * n);
  const installment = round2(ceilToMultiple((principal + totalInterest) / n, params.roundTo ?? 0));

  let principalRemaining = principal;
  const rows: ScheduleRow[] = [];

  for (let k = 1; k <= n; k++) {
    // La última cuota salda exactamente el capital; el interés es lo que falta para la cuota.
    const principalDue = k === n ? round2(principalRemaining) : principalPerInstallment;
    const interestDue = round2(installment - principalDue);
    principalRemaining = round2(principalRemaining - principalDue);

    const dueDate = new Date(firstInstallmentDate);
    dueDate.setMonth(dueDate.getMonth() + (k - 1));

    rows.push({
      installmentNumber: k,
      dueDate: dueDate.toISOString().slice(0, 10),
      principalDue,
      interestDue,
      otherDue: 0,
      totalDue: round2(principalDue + interestDue),
      balance: round2(principalDue + interestDue)
    });
  }

  return rows;
}
