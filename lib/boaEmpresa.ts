// Sem imports: usado também na tabela do ranking (no navegador).

/** Filtro "Boas empresas" do ranking: o mínimo para valer a pena olhar a ação. */
export const BOA_EMPRESA = {
  roeMinimo: 0.1, // 10% de ROE
  dividaMaxima: 2, // dívida bruta de até 2x o patrimônio (bancos não têm o dado e passam)
  liquidezMinima: 1_000_000, // R$ 1 milhão negociado por dia
  patrimonioMinimo: 1_000_000_000, // R$ 1 bilhão de patrimônio (porte)
  qualidadeMinima: 6, // nota de qualidade (0 a 10) das analisadas
  margemMaxima: 1.5, // mais de 150% até o teto costuma ser dado errado ou armadilha
  anosMinimos: 5, // anos de balanço na CVM para julgar a constância
  lucroMinimo: 0.7, // lucro em pelo menos 70% dos anos (7 de 10)
  dividendoMinimo: 0.5, // dividendo ou JCP em pelo menos metade dos anos (5 de 10)
} as const;

/** Constância nos últimos 10 anos (balanços da CVM). */
export type Constancia = { anos: number; anosComLucro: number; anosComDividendo: number };

/** Por que a constância não basta para o filtro (vazio: basta). */
export function motivosConstancia(c: Constancia | null | undefined): string[] {
  if (!c) return ["sem histórico de balanços na CVM"];
  const m: string[] = [];
  if (c.anos < BOA_EMPRESA.anosMinimos) m.push(`só ${c.anos} anos de balanço na CVM`);
  if (c.anosComLucro < Math.ceil(c.anos * BOA_EMPRESA.lucroMinimo)) m.push(`lucro em só ${c.anosComLucro} de ${c.anos} anos`);
  if (c.anosComDividendo < Math.ceil(c.anos * BOA_EMPRESA.dividendoMinimo)) m.push(`dividendo em só ${c.anosComDividendo} de ${c.anos} anos`);
  return m;
}

/**
 * Nota do ranking (0 a 100), para todas as ações da bolsa: 50% desconto até o teto, 30% anos com lucro e 20% anos com
 * dividendo nos últimos 10 anos. O desconto conta até 40% abaixo do teto, como no score (mais que isso costuma ser
 * armadilha), e vale proporcional aos anos com lucro: o teto de quem lucrou em 1 de 10 anos vem de um ano bom isolado e
 * quase não pesa. Sem histórico, o desconto vale a metade.
 */
export function notaRanking(margem: number | null, c: Constancia | null | undefined): number | null {
  if (margem == null) return null;
  const desconto = margem <= -1 ? -0.3 : margem / (1 + margem);
  const parteDesconto = (Math.max(-0.3, Math.min(0.4, desconto)) + 0.3) / 0.7;
  const lucro = c && c.anos ? c.anosComLucro / Math.max(c.anos, BOA_EMPRESA.anosMinimos) : 0;
  const dividendo = c && c.anos ? c.anosComDividendo / Math.max(c.anos, BOA_EMPRESA.anosMinimos) : 0;
  const confianca = c && c.anos ? lucro : 0.5;
  return Math.round((parteDesconto * confianca * 0.5 + lucro * 0.3 + dividendo * 0.2) * 100);
}
