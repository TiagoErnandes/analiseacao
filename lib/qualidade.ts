// Nota de qualidade (0 a 10) calculada só com números do balanço, sem IA.
// Ideia: para previdência, só vale comprar barato o que é bom. Uma ação "barata" com nota baixa costuma ser armadilha.
import type { Fundamentos } from "./mercado";

export type Qualidade = { nota: number | null; pontos: string[]; alertas: string[] };

const SETORES_FINANCEIROS = /banco|segur|previd|intermedi|financ/i;

export function ehFinanceira(f: Fundamentos | null): boolean {
  return SETORES_FINANCEIROS.test(`${f?.setor ?? ""} ${f?.subsetor ?? ""}`);
}

export function calcularQualidade(d: {
  roe: number | null;
  lpa: number | null;
  dpa12m: number | null;
  fundamentos: Fundamentos | null;
}): Qualidade {
  const f = d.fundamentos;
  const pontos: string[] = [];
  const alertas: string[] = [];
  let ganho = 0;
  let maximo = 0;
  const criterio = (peso: number, valor: number | null | undefined, avaliar: (v: number) => number, rotulo: string) => {
    if (valor == null || !Number.isFinite(valor)) return; // sem dado: o critério não conta
    maximo += peso;
    const obtido = Math.max(0, Math.min(peso, avaliar(valor)));
    ganho += obtido;
    if (obtido >= peso) pontos.push(rotulo);
  };

  // Rentabilidade
  criterio(3, d.roe, (v) => (v >= 0.15 ? 3 : v >= 0.1 ? 2 : v >= 0.05 ? 1 : 0), "ROE alto");

  // Lucro e preço sobre lucro
  criterio(1, f?.pl, (v) => (v > 0 && v <= 15 ? 1 : 0), "P/L razoável");
  if (f?.pl != null && f.pl <= 0) alertas.push("empresa com prejuízo nos últimos 12 meses");

  // Dividendos sustentáveis: payout entre 25% e 90% do lucro
  const payout = d.dpa12m != null && d.lpa != null && d.lpa > 0 ? d.dpa12m / d.lpa : null;
  criterio(2, payout, (v) => (v >= 0.25 && v <= 0.9 ? 2 : v > 0.9 && v <= 1.1 ? 1 : 0), "payout sustentável");
  if (payout != null && payout > 1.1) alertas.push(`paga ${Math.round(payout * 100)}% do lucro em dividendos (insustentável)`);

  // Crescimento de receita em 5 anos (taxa anual)
  criterio(2, f?.crescReceita5a, (v) => (v >= 0.05 ? 2 : v > 0 ? 1 : 0), "receita crescendo");

  if (!ehFinanceira(f)) {
    // Endividamento, margem e liquidez não se aplicam a bancos e seguradoras
    criterio(2, f?.divLiqPatrim, (v) => (v <= 0.5 ? 2 : v <= 1 ? 1.5 : v <= 2 ? 0.5 : 0), "dívida controlada");
    if (f?.divLiqPatrim != null && f.divLiqPatrim > 2) alertas.push("dívida líquida acima de 2x o patrimônio");
    criterio(1, f?.margemLiquida, (v) => (v >= 0.1 ? 1 : v >= 0.05 ? 0.5 : 0), "boa margem líquida");
    criterio(1, f?.liquidezCorrente, (v) => (v >= 1 ? 1 : 0), "liquidez corrente ≥ 1");
  } else {
    criterio(1, f?.pvp, (v) => (v <= 1.5 ? 1 : v <= 2.5 ? 0.5 : 0), "P/VP razoável");
  }

  // Com poucos critérios disponíveis (peso total < 5), a nota não é confiável
  const nota = maximo >= 5 ? Math.round((ganho / maximo) * 100) / 10 : null;
  if (nota == null) alertas.push("poucos dados de balanço para dar nota de qualidade");
  return { nota, pontos, alertas };
}
