import { metrics, normalizeSql } from "./metrics.js";

/**
 * Mide una consulta: la cuenta en las métricas y, si pasó del umbral, la deja en el log
 * (SQL normalizado, SIN parámetros: pueden ser datos personales).
 */
export function recordQueryTiming(
  ms: number,
  sql: string,
  slowMs: number,
  log: (line: string) => void = (l) => console.warn(l)
) {
  const slow = ms >= slowMs;
  const text = slow ? normalizeSql(sql) : "";
  metrics.recordQuery(ms, text, slow);
  if (slow) log(JSON.stringify({ t: "slowq", ms: Math.round(ms), sql: text }));
}
