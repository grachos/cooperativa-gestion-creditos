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

/**
 * Interés fijo simple sobre el capital original (NO amortización francesa).
 *
 * Verificado contra los datos reales de la cooperativa: un crédito de
 * $4.100.000 a 18 cuotas de $391.800 reparte exactamente $227.777,78 de
 * capital y $164.022,22 de interés en CADA cuota (capital e interés
 * constantes, sin importar el saldo pendiente). El interés total
 * corresponde a `principal * monthlyRatePercent/100 * termMonths`
 * (≈4% mensual sobre el capital original en los créditos revisados).
 *
 * Esto reemplaza la suposición inicial de "sistema francés" (cuota fija
 * con interés decreciente), que no coincide con cómo la cooperativa
 * calcula sus créditos hoy.
 */
export function buildAmortizationSchedule(params: {
  principal: number;
  monthlyRatePercent: number;
  termMonths: number;
  firstInstallmentDate: Date;
}): ScheduleRow[] {
  const { principal, monthlyRatePercent, termMonths, firstInstallmentDate } = params;
  const n = termMonths;

  const principalPerInstallment = round2(principal / n);
  const totalInterest = round2(principal * (monthlyRatePercent / 100) * n);
  const interestPerInstallment = round2(totalInterest / n);

  let principalRemaining = principal;
  let interestRemaining = totalInterest;
  const rows: ScheduleRow[] = [];

  for (let k = 1; k <= n; k++) {
    let principalDue = principalPerInstallment;
    let interestDue = interestPerInstallment;
    if (k === n) {
      // Ajuste de redondeo en la última cuota para saldar exactamente capital e interés.
      principalDue = round2(principalRemaining);
      interestDue = round2(interestRemaining);
    }
    principalRemaining = round2(principalRemaining - principalDue);
    interestRemaining = round2(interestRemaining - interestDue);

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
