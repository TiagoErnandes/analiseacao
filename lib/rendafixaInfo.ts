// Partes da renda fixa sem banco de dados (servem também às telas no navegador).

export type Indexador = "cdi" | "pre" | "ipca";

export const INDEXADORES: { id: Indexador; nome: string; rotuloTaxa: string; padrao: string; exemplo: string }[] = [
  { id: "cdi", nome: "% do CDI (pós-fixado, caixinhas)", rotuloTaxa: "Rende (% do CDI)", padrao: "100", exemplo: "100" },
  { id: "pre", nome: "Prefixado", rotuloTaxa: "Taxa (% ao ano)", padrao: "", exemplo: "12,5" },
  { id: "ipca", nome: "IPCA +", rotuloTaxa: "IPCA + (% ao ano)", padrao: "", exemplo: "6,2" },
];

export type PosicaoRf = {
  tipo: string | null;
  indexador?: string | null;
  taxa_cdi?: number | null; // cdi: 1 = 100% do CDI; 0 = valor parado
  taxa_anual?: number | null; // pre: taxa ao ano; ipca: juro real ao ano (0,06 = 6%)
  data_aplicacao?: string | null;
  vencimento?: string | null;
};

export function indexadorDe(p: PosicaoRf): Indexador {
  return p.indexador === "pre" || p.indexador === "ipca" ? p.indexador : "cdi";
}

/** "110% do CDI", "12,5% ao ano", "IPCA + 6,2%", "sem rendimento". */
export function descreverTaxa(p: PosicaoRf): string {
  const n = (v: number) => (Math.round(v * 10000) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const ix = indexadorDe(p);
  if (ix === "pre") return `${n(p.taxa_anual ?? 0)}% ao ano (prefixado)`;
  if (ix === "ipca") return `IPCA + ${n(p.taxa_anual ?? 0)}%`;
  return p.taxa_cdi ? `${n(p.taxa_cdi)}% do CDI` : "sem rendimento";
}
