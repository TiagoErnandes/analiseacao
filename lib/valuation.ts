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
 * Nota final de 0 a 100 para ordenar as ações do dia:
 * 40% desconto em relação ao teto, 25% qualidade do balanço, 25% nota da IA, 10% peso faltando na carteira.
 * Sem nota de qualidade ou da IA, a parte que falta conta como zero (melhor errar para baixo).
 */
export function scoreFinal(opts: {
  margem: number | null;
  qualidade?: number | null;
  notaIa: number | null;
  faltaParaIdeal?: number | null; // fração: 0.05 = está 5 pontos percentuais abaixo do ideal
}): number {
  const m = Math.max(-0.3, Math.min(0.5, opts.margem ?? -0.3));
  const parteMargem = (m + 0.3) / 0.8; // 0..1
  const parteQualidade = Math.max(0, Math.min(10, opts.qualidade ?? 0)) / 10;
  const falta = Math.max(0, Math.min(0.1, opts.faltaParaIdeal ?? 0)) / 0.1;
  // Sem nota da IA (modo sem IA ou ativo que não foi para a IA), os outros pesos são reescalados
  if (opts.notaIa == null) return Math.round(((parteMargem * 0.4 + parteQualidade * 0.25 + falta * 0.1) / 0.75) * 100);
  const parteIa = Math.max(0, Math.min(10, opts.notaIa)) / 10;
  return Math.round((parteMargem * 0.4 + parteQualidade * 0.25 + parteIa * 0.25 + falta * 0.1) * 100);
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

/** Abaixo disso de dividend yield, a empresa é tratada como "não pagadora" e o teto vem do Graham. */
export const DY_MINIMO_PAGADORA = 0.02;
/** Diferença máxima aceitável entre o DPA 12m do Yahoo e o do Fundamentus antes de desconfiar do histórico. */
const TOLERANCIA_FONTES = 0.35;

export type Indicadores = {
  dpa12m: number | null;
  dpaMedio: number | null;
  dy12m: number | null;
  bazin: number | null;
  graham: number | null;
  teto: number | null;
  margem: number | null;
  alertas: string[];
};

/**
 * Junta as duas fontes e calcula o preço teto de forma conservadora (foco em previdência):
 * - DPA 12m vem do DY do Fundamentus (mais confiável); o Yahoo só entra no histórico de 5 anos,
 *   e só se o 12m dele bater com o do Fundamentus.
 * - Bazin usa o MENOR entre o DPA 12m e a média de 5 anos, para não pagar caro por dividendos
 *   extraordinários do passado (ex.: Petrobras 2022) nem por um pico pontual recente.
 * - LPA claramente errado (ROE implícito < 1%) invalida o Graham.
 */
export function calcularIndicadores(d: {
  preco: number | null;
  lpa: number | null;
  vpa: number | null;
  dyFundamentus: number | null;
  proventos: { valor: number; data: Date }[];
}, hoje = new Date()): Indicadores {
  const alertas: string[] = [];
  const yahoo = calcularDpa(d.proventos, hoje);
  const dpa12mFund = d.dyFundamentus != null && d.preco ? d.dyFundamentus * d.preco : null;

  let dpa12m = dpa12mFund ?? yahoo.dpa12m;
  let dpaMedio = yahoo.dpaMedio;
  if (dpa12mFund != null && dpa12mFund > 0) {
    const y = yahoo.dpa12m ?? 0;
    if (Math.abs(y - dpa12mFund) / dpa12mFund > TOLERANCIA_FONTES) {
      alertas.push("histórico de dividendos do Yahoo não bate com o DY do Fundamentus, média de 5 anos ignorada");
      dpaMedio = null;
    }
  } else if (dpa12mFund == null) {
    alertas.push("sem DY do Fundamentus; DPA 12m vem só do Yahoo");
  }

  const dy12m = dpa12m && d.preco ? dpa12m / d.preco : null;
  let bazin: number | null = null;
  if (dy12m != null && dy12m >= DY_MINIMO_PAGADORA) {
    const base = Math.min(dpa12m ?? Infinity, dpaMedio ?? Infinity);
    bazin = tetoBazin(Number.isFinite(base) ? base : null);
  } else {
    alertas.push("paga pouco ou nenhum dividendo, teto pelo Graham");
    if (!dpa12m) dpa12m = null;
  }

  let graham = tetoGraham(d.lpa, d.vpa);
  if (d.lpa != null && d.vpa && d.vpa > 0 && d.lpa / d.vpa < 0.01) {
    alertas.push(`LPA ${d.lpa} parece errado (ROE implícito < 1%), Graham ignorado`);
    graham = null;
  }

  const teto = precoTeto(bazin, graham);
  return { dpa12m, dpaMedio, dy12m, bazin, graham, teto, margem: margem(d.preco, teto), alertas };
}

/** FIIs pagam mais que ações; para valer a pena frente à renda fixa, exigimos pelo menos 8% ao ano. */
export const YIELD_MINIMO_FII = 0.08;

/**
 * Preço teto de FII (Bazin adaptado): o dividendo sustentável ÷ 8%.
 * Dividendo sustentável = o menor entre o pago nos últimos 12 meses, o FFO por cota (o que o fundo de fato gera)
 * e a média de 5 anos — para não pagar caro por rendimento extraordinário (venda de imóveis, por exemplo).
 */
export function calcularIndicadoresFii(d: {
  preco: number | null;
  dividendoCota: number | null;
  ffoCota: number | null;
  dyFundamentus: number | null;
  proventos: { valor: number; data: Date }[];
}, hoje = new Date()): Indicadores {
  const alertas: string[] = [];
  const yahoo = calcularDpa(d.proventos, hoje);
  const dpa12m = d.dividendoCota ?? (d.dyFundamentus != null && d.preco ? d.dyFundamentus * d.preco : yahoo.dpa12m);
  let dpaMedio = yahoo.dpaMedio;
  if (dpa12m && yahoo.dpa12m && Math.abs(yahoo.dpa12m - dpa12m) / dpa12m > TOLERANCIA_FONTES) {
    alertas.push("histórico de rendimentos do Yahoo não bate com o Fundamentus, média de 5 anos ignorada");
    dpaMedio = null;
  }
  const candidatos = [dpa12m, d.ffoCota && d.ffoCota > 0 ? d.ffoCota : null, dpaMedio].filter((v): v is number => v != null && v > 0);
  const base = candidatos.length ? Math.min(...candidatos) : null;
  if (dpa12m && d.ffoCota && d.ffoCota > 0 && dpa12m > d.ffoCota * 1.3) {
    alertas.push(`distribui ${Math.round((dpa12m / d.ffoCota) * 100)}% do FFO (rendimento acima do que gera, pode cair)`);
  }
  const bazin = base ? base / YIELD_MINIMO_FII : null;
  return {
    dpa12m: dpa12m || null,
    dpaMedio,
    dy12m: dpa12m && d.preco ? dpa12m / d.preco : null,
    bazin,
    graham: null,
    teto: bazin,
    margem: margem(d.preco, bazin),
    alertas,
  };
}

/**
 * ETF não tem lucro nem balanço. Se paga dividendos relevantes (ex.: DIVO11), usa Bazin;
 * senão a referência é a média de preço dos últimos 12 meses: comprar abaixo dela é comprar "na baixa".
 */
export function calcularIndicadoresEtf(d: {
  preco: number | null;
  media12m: number | null;
  proventos: { valor: number; data: Date }[];
}, hoje = new Date()): Indicadores {
  const { dpa12m, dpaMedio } = calcularDpa(d.proventos, hoje);
  const dy12m = dpa12m && d.preco ? dpa12m / d.preco : null;
  const bazin = dy12m != null && dy12m >= DY_MINIMO_PAGADORA ? tetoBazin(Math.min(dpa12m!, dpaMedio ?? Infinity)) : null;
  const teto = bazin ?? d.media12m;
  const alertas = teto == null ? ["sem histórico de preço suficiente para referência"] : [];
  return { dpa12m, dpaMedio, dy12m, bazin, graham: null, teto, margem: margem(d.preco, teto), alertas };
}
