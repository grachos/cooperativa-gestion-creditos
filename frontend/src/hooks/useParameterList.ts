import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Parameter {
  key: string;
  value: unknown;
}

/**
 * Lee un parámetro de tipo "lista de valores" (ver Parámetros) para que los
 * formularios ofrezcan siempre las opciones vigentes en vez de una lista
 * fija en el código — si alguien agrega un tipo nuevo en Parámetros, debe
 * aparecer aquí sin tocar el frontend. `fallback` solo se usa mientras
 * carga o si el parámetro no existe.
 */
export function useParameterList(key: string, fallback: string[] = []): string[] {
  const { data } = useQuery({
    queryKey: ["parameters"],
    queryFn: () => api.get<Parameter[]>("/parameters"),
    staleTime: 60_000
  });

  const value = data?.find((p) => p.key === key)?.value;
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : fallback;
}
