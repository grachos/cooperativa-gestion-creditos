import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Loading, ErrorView } from "../components/StateViews";

interface Parameter {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export default function ParametersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["parameters"],
    queryFn: () => api.get<Parameter[]>("/parameters")
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Parámetros del sistema</h1>
      <p className="mb-4 text-sm text-slate-400">
        Valores de demostración. Deben confirmarse con la cooperativa antes de producción.
      </p>

      <div className="space-y-3">
        {data?.map((p) => (
          <div key={p.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-1 text-sm font-semibold text-slate-700">{p.key}</p>
            {p.description && <p className="mb-2 text-xs text-slate-400">{p.description}</p>}
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              {JSON.stringify(p.value, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
