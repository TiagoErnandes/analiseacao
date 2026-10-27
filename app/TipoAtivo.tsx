// Etiqueta pequena com o tipo do ativo (ações não levam etiqueta).
export function TipoAtivo({ tipo }: { tipo: string | null | undefined }) {
  if (tipo === "fii") return <span className="rounded bg-[#9085e9]/15 px-1 text-[10px] font-semibold text-[#b1a9f0]">FII</span>;
  if (tipo === "etf") return <span className="rounded bg-[#c98500]/15 px-1 text-[10px] font-semibold text-[#e0a83a]">ETF</span>;
  return null;
}
