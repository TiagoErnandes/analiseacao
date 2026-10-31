// Renda fixa e outros bens sem cotação: o valor cresce por uma fração do CDI (série diária do Banco Central, tabela indices).
// Cada "cota" vale R$ 1 na aplicação; o preço de hoje é o fator acumulado.
import { query } from "./db";

export type CdiDia = { data: string; valor: number }; // valor: % ao dia

export async function serieCdi(desde: string | null): Promise<CdiDia[]> {
  if (!desde) return [];
  return query<CdiDia>("select data::text, valor from indices where serie = 'cdi' and data > $1 order by data", [desde]);
}

/** Fator acumulado desde `desde` (exclusive) rendendo `taxa` × CDI. */
export function fatorCdi(cdi: CdiDia[], desde: string | null | undefined, taxa: number | null | undefined): number {
  if (!desde || !taxa) return 1;
  let f = 1;
  for (const d of cdi) if (d.data > desde) f *= 1 + (d.valor / 100) * taxa;
  return f;
}

/** Preço de hoje (fator) de cada posição de renda fixa da lista. */
export async function precosRendaFixa(
  posicoes: { ticker: string; tipo: string | null; taxa_cdi?: number | null; data_aplicacao?: string | null }[],
): Promise<Map<string, number>> {
  const rf = posicoes.filter((p) => p.tipo === "renda_fixa");
  const r = new Map<string, number>();
  if (!rf.length) return r;
  const desde = rf.map((p) => p.data_aplicacao).filter((d): d is string => !!d).sort()[0] ?? null;
  const cdi = await serieCdi(desde);
  for (const p of rf) r.set(p.ticker, fatorCdi(cdi, p.data_aplicacao, p.taxa_cdi));
  return r;
}
