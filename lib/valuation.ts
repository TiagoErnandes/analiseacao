// Métodos clássicos de preço teto para quem investe pensando em renda e longo prazo.

/** Bazin: o preço máximo para receber pelo menos 6% ao ano em dividendos. */
export const YIELD_MINIMO_BAZIN = 0.06;

export function tetoBazin(dpaMedio: number | null): number | null {
  if (!dpaMedio || dpaMedio <= 0) return null;
  return dpaMedio / YIELD_MINIMO_BAZIN;
}

/** Graham: valor justo = raiz(22,5 × LPA × VPA). Só faz sentido com lucro e patrimônio positivos. */
export function tetoGraham(lpa: number | null, vpa: number | null): number | null {
  if (!lpa || !vpa || lpa <= 0 || vpa <= 0) return null;
  return Math.sqrt(22.5 * lpa * vpa);
}

/**
 * Preço teto final. Para previdência o foco é renda, então Bazin manda quando a empresa paga dividendos.
 * Sem dividendos, usamos Graham.
 */
export function precoTeto(bazin: number | null, graham: number | null): number | null {
  return bazin ?? graham ?? null;
}

/** Margem de segurança: quanto o preço está abaixo do teto (0.2 = 20% abaixo). Negativo = acima do teto. */
export function margem(preco: number | null, teto: number | null): number | null {
  if (!preco || !teto) return null;
  return (teto - preco) / teto;
}

/**
 * Nota final de 0 a 100 para ordenar as ações do dia.
 * 50% desconto em relação ao teto, 35% nota da IA, 15% quanto falta para o peso ideal na carteira.
 */
export function scoreFinal(opts: {
  margem: number | null;
  notaIa: number | null;
  faltaParaIdeal?: number | null; // fração: 0.05 = está 5 pontos percentuais abaixo do ideal
}): number {
  const m = Math.max(-0.3, Math.min(0.5, opts.margem ?? -0.3));
  const parteMargem = (m + 0.3) / 0.8; // 0..1
  const parteIa = Math.max(0, Math.min(10, opts.notaIa ?? 0)) / 10;
  const falta = Math.max(0, Math.min(0.1, opts.faltaParaIdeal ?? 0)) / 0.1;
  return Math.round((parteMargem * 0.5 + parteIa * 0.35 + falta * 0.15) * 100);
}

/** Soma os dividendos por ano e devolve DPA dos últimos 12 meses e a média anual (até 5 anos completos). */
export function calcularDpa(
  proventos: { valor: number; data: Date }[],
  hoje = new Date(),
): { dpa12m: number | null; dpaMedio: number | null } {
  if (proventos.length === 0) return { dpa12m: null, dpaMedio: null };

  const umAnoAtras = new Date(hoje);
  umAnoAtras.setFullYear(hoje.getFullYear() - 1);
  const dpa12m = proventos.filter((p) => p.data > umAnoAtras && p.data <= hoje).reduce((s, p) => s + p.valor, 0);

  const anoAtual = hoje.getFullYear();
  const porAno = new Map<number, number>();
  for (const p of proventos) {
    const ano = p.data.getFullYear();
    if (ano >= anoAtual - 5 && ano < anoAtual) porAno.set(ano, (porAno.get(ano) ?? 0) + p.valor);
  }
  // Anos sem dividendo entre o primeiro ano com dados e o ano passado contam como zero.
  const primeiroAno = Math.min(...porAno.keys());
  const totalAnos = porAno.size > 0 ? anoAtual - primeiroAno : 0;
  const soma = [...porAno.values()].reduce((s, v) => s + v, 0);
  const dpaMedio = totalAnos > 0 ? soma / totalAnos : dpa12m || null;

  return { dpa12m: dpa12m || null, dpaMedio };
}
