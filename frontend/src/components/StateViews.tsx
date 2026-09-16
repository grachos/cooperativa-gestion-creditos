export function Loading() {
  return <p className="py-8 text-center text-sm text-slate-500">Cargando...</p>;
}

export function ErrorView({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>
  );
}

export function EmptyView({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{message}</p>;
}
