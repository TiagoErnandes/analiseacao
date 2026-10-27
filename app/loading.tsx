export default function Carregando() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-painel" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-painel" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-painel" />
    </div>
  );
}
