import { infoTipo } from "@/lib/tipos";

// Cores por tipo (ações não levam etiqueta para não poluir as listas)
const COR: Record<string, string> = {
  fii: "bg-[#9085e9]/15 text-[#b1a9f0]",
  etf: "bg-[#c98500]/15 text-[#e0a83a]",
  bdr: "bg-[#199e70]/15 text-[#3fc795]",
  stock: "bg-[#3987e5]/15 text-[#6da7ec]",
  etf_int: "bg-[#d95926]/15 text-[#ef8a5c]",
  reit: "bg-[#d55181]/15 text-[#e98aad]",
  cripto: "bg-[#e66767]/15 text-[#f09a9a]",
  renda_fixa: "bg-[#8a9bb0]/15 text-[#b4c0ce]",
};

export function TipoAtivo({ tipo }: { tipo: string | null | undefined }) {
  const info = infoTipo(tipo);
  if (!info || info.id === "acao") return null;
  return <span className={`whitespace-nowrap rounded px-1 text-[10px] font-semibold uppercase ${COR[info.id]}`}>{info.curto}</span>;
}
