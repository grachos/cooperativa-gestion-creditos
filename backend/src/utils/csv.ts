/**
 * Escapado de CSV (RFC 4180) con protección contra "inyección de fórmulas":
 * una celda de TEXTO que empiece por = + - @ (o tabulador / retorno) la ejecuta Excel como
 * fórmula al abrir el archivo. Se antepone una comilla simple para que se vea como texto.
 * Los valores numéricos y fechas NO pasan por la protección (un monto negativo es legítimo).
 */
export function csvText(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return csvQuote(s);
}

export function csvRaw(value: unknown): string {
  return csvQuote(value === null || value === undefined ? "" : String(value));
}

function csvQuote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
