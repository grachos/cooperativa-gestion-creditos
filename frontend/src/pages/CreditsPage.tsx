import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { Loading, ErrorView, EmptyView } from "../components/StateViews";

interface Credit {
  id: number;
  credit_number: string;
  status: string;
  principal_balance: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
}

export default function CreditsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["credits"],
    queryFn: () => api.get<{ data: Credit[] }>("/credits")
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorView message={(error as Error).message} />;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Créditos</h1>
      {data && data.data.length === 0 && <EmptyView message="No hay créditos desembolsados." />}
      {data && data.data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">Número</th>
                <th className="px-4 py-2">Titular</th>
                <th className="px-4 py-2">Saldo capital</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/creditos/${c.id}`} className="font-medium text-emerald-700 hover:underline">
                      {c.credit_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {c.first_name ? `${c.first_name} ${c.last_name}` : c.legal_name ?? "—"}
                  </td>
                  <td className="px-4 py-2">{formatCurrency(c.principal_balance)}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
