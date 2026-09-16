import { round2 } from "../../utils/money.js";

export interface DelinquencyPolicy {
  version: string;
  graceDays: number;
  base: "CAPITAL_VENCIDO" | "CUOTA_VENCIDA";
  rateType: "DIARIA" | "MENSUAL_FIJA";
  rateOrValue: number;
  cap: number | null;
  earlyAlertDays: number;
  lateAlertDays: number;
}

/** Política de demostración. Debe confirmarse con la cooperativa y su asesoría. */
export const DEFAULT_DELINQUENCY_POLICY: DelinquencyPolicy = {
  version: "demo-v1",
  graceDays: 3,
  base: "CAPITAL_VENCIDO",
  rateType: "DIARIA",
  rateOrValue: 0.06, // % diario de demostración
  cap: null,
  earlyAlertDays: -3, // alerta temprana 3 días antes del vencimiento
  lateAlertDays: 15
};

export function calculateOverdueDays(dueDate: Date, asOf: Date): number {
  const ms = asOf.getTime() - dueDate.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function calculateLateFee(params: {
  policy: DelinquencyPolicy;
  overdueDays: number;
  principalOrInstallmentBase: number;
}): { chargeableDays: number; result: number } {
  const { policy, overdueDays, principalOrInstallmentBase } = params;
  const chargeableDays = Math.max(0, overdueDays - policy.graceDays);
  if (chargeableDays <= 0) return { chargeableDays: 0, result: 0 };

  let result: number;
  if (policy.rateType === "DIARIA") {
    result = round2(principalOrInstallmentBase * (policy.rateOrValue / 100) * chargeableDays);
  } else {
    result = round2(principalOrInstallmentBase * (policy.rateOrValue / 100));
  }
  if (policy.cap !== null) result = Math.min(result, policy.cap);
  return { chargeableDays, result };
}
