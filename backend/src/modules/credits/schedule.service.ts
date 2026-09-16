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
 * Sistema francés de cuota fija. ASUNCIÓN DE DEMOSTRACIÓN (pendiente de
 * confirmación por la cooperativa): interestRate es una tasa mensual
 * nominal expresada en porcentaje y se usa directamente como tasa
 * periódica. La fórmula y la periodicidad definitivas deben confirmarse
 * (ver sección "preguntas pendientes").
 */
export function buildAmortizationSchedule(params: {
  principal: number;
  monthlyRatePercent: number;
  termMonths: number;
  firstInstallmentDate: Date;
}): ScheduleRow[] {
  const { principal, monthlyRatePercent, termMonths, firstInstallmentDate } = params;
  const i = monthlyRatePercent / 100;
  const n = termMonths;

  const installmentValue =
    i === 0
      ? round2(principal / n)
      : round2((principal * i) / (1 - Math.pow(1 + i, -n)));

  let balance = principal;
  const rows: ScheduleRow[] = [];

  for (let k = 1; k <= n; k++) {
    const interestDue = round2(balance * i);
    let principalDue = round2(installmentValue - interestDue);
    if (k === n) {
      // Ajuste de redondeo en la última cuota para saldar exactamente el capital.
      principalDue = round2(balance);
    }
    balance = round2(balance - principalDue);

    const dueDate = new Date(firstInstallmentDate);
    dueDate.setMonth(dueDate.getMonth() + (k - 1));

    rows.push({
      installmentNumber: k,
      dueDate: dueDate.toISOString().slice(0, 10),
      principalDue,
      interestDue,
      otherDue: 0,
      totalDue: round2(principalDue + interestDue),
      balance: Math.max(balance, 0)
    });
  }

  return rows;
}
