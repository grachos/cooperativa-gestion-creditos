export function formatCurrency(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" }).format(
    new Date(value)
  );
}

export function formatPercent(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `${n.toFixed(2)}%`;
}

/** Formatea un número con separador de miles (es-CO), sin símbolo de moneda
 * — para mostrar en un input mientras se escribe. */
export function formatThousands(value: number): string {
  return new Intl.NumberFormat("es-CO").format(value);
}
