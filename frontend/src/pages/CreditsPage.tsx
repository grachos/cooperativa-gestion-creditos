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
  moraCode: string | null;
  moraLabel: string | null;
}

const MORA_BADGE_CLASS: Record<string, string> = {
  CD001: "bg-emerald-50 text-emerald-700",
  CM030: "bg-amber-50 text-amber-700",
  CM060: "bg-amber-100 text-amber-800",
  CM090: "bg-orange-100 text-orange-800",
  CM120: "bg-red-50 text-red-700",
  CM150: "bg-red-100 text-red-800",
  CM180: "bg-red-200 text-red-900"
};

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
        <>
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {data.data.map((c) => (
              <Link
                key={c.id}
                to={`/creditos/${c.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-emerald-700">{c.credit_number}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{c.status}</span>
                </div>
                <p className="text-sm text-slate-500">
                  {c.first_name ? `${c.first_name} ${c.last_name}` : c.legal_name ?? "—"}
                </p>
                <p className="text-sm text-slate-500">{formatCurrency(c.principal_balance)}</p>
                {c.moraCode && (
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${MORA_BADGE_CLASS[c.moraCode] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {c.moraCode} · {c.moraLabel}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Número</th>
                  <th className="px-4 py-2">Titular</th>
                  <th className="px-4 py-2">Saldo capital</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Mora</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2">
                      <Link to={`/creditos/${c.id}`} className="font-medium text-emerald-700 hover:underline">
                        {c.credit_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      {c.first_name ? `${c.first_name} ${c.last_name}` : c.legal_name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatCurrency(c.principal_balance)}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{c.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {c.moraCode && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${MORA_BADGE_CLASS[c.moraCode] ?? "bg-slate-100 text-slate-600"}`}>
                          {c.moraCode} · {c.moraLabel}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
