export default function Carregando() {
  return (
    <div className="space-y-5">
      <div className="h-4 w-40 animate-pulse rounded bg-painel" />
      <div className="cartao flex items-center gap-4 p-5">
        <div className="h-14 w-14 animate-pulse rounded-lg bg-painel2" />
        <div className="space-y-2">
          <div className="h-6 w-32 animate-pulse rounded bg-painel2" />
          <div className="h-4 w-48 animate-pulse rounded bg-painel2" />
        </div>
      </div>
      <p className="text-center text-sm text-suave">Buscando cotação, balanço e dividendos... (ativos fora da lista levam alguns segundos)</p>
      <div className="h-80 animate-pulse rounded-xl bg-painel" />
    </div>
  );
}
