// Nota de qualidade (0 a 10) calculada só com números do balanço, sem IA.
// Ideia: para previdência, só vale comprar barato o que é bom. Uma ação "barata" com nota baixa costuma ser armadilha.
import type { HistoricoLucro } from "./cvm";
import type { DadosFii, Fundamentos, HistoricoPreco } from "./mercado";
import type { ConsistenciaDividendos } from "./valuation";

export type Qualidade = { nota: number | null; pontos: string[]; alertas: string[] };

const SETORES_FINANCEIROS = /banco|segur|previd|intermedi|financ/i;
/**
 * Setores perenes (o "BESST" do Barsi: bancos, energia, saneamento, seguros, telecom): demanda estável e dividendo previsível.
 * Cíclicos (commodities, construção, varejo, aéreas): o lucro e o dividendo sobem e caem com o ciclo.
 */
const SETORES_PERENES = /banco|intermedi|energia el|saneamento|[áa]gua|segur|previd|telecom|telefon|transmiss|g[áa]s/i;
const SETORES_CICLICOS = /minera|siderur|petr[óo]leo|papel e celulose|qu[íi]mic|constru|incorpora|aere|a[ée]reo|com[ée]rcio|varejo|tecido|vestu|automo|agr[íi]col|carnes|a[çc]ucar/i;

export function tipoDeSetor(f: Fundamentos | null): "perene" | "ciclico" | "outro" | null {
  const s = `${f?.setor ?? ""} ${f?.subsetor ?? ""}`.trim();
  if (!s) return null;
  // Cíclico primeiro: "Petróleo, Gás e Biocombustíveis" é commodity, mesmo com "gás" no nome
  return SETORES_CICLICOS.test(s) ? "ciclico" : SETORES_PERENES.test(s) ? "perene" : "outro";
}

export function ehFinanceira(f: Fundamentos | null): boolean {
  return SETORES_FINANCEIROS.test(`${f?.setor ?? ""} ${f?.subsetor ?? ""}`);
}

export function calcularQualidade(d: {
  roe: number | null;
  lpa: number | null;
  dpa12m: number | null;
  fundamentos: Fundamentos | null;
  lucros?: HistoricoLucro | null; // lucro de cada ano nos balanços da CVM (até 10 anos)
  dividendos?: ConsistenciaDividendos | null; // dividendos de cada ano (até 10 anos)
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

  // Constância em 10 anos: para previdência, lucro e dividendo todo ano valem mais que um ano excelente
  const l = d.lucros;
  if (l && l.anos >= 5) {
    criterio(2, l.anosComLucro / l.anos, (v) => (v >= 1 ? 2 : v >= 0.8 ? 1 : 0), `lucro em todos os ${l.anos} anos`);
    if (l.anosComLucro < l.anos) alertas.push(`prejuízo em ${l.anos - l.anosComLucro} dos últimos ${l.anos} anos`);
    criterio(1, l.crescimentoAnual, (v) => (v >= 0.03 ? 1 : v >= 0 ? 0.5 : 0), "lucro crescendo em 10 anos");
  }
  const dv = d.dividendos;
  if (dv && dv.anos >= 5) {
    criterio(1, dv.anosPagos / dv.anos - dv.cortes * 0.1, (v) => (v >= 0.95 ? 1 : v >= 0.7 ? 0.5 : 0), `dividendos em ${dv.anosPagos} de ${dv.anos} anos`);
    if (dv.cortes >= 3) alertas.push(`cortou o dividendo pela metade ${dv.cortes} vezes em ${dv.anos} anos`);
    // Dividendo que cresce acima da inflação protege a renda (aristocratas de dividendos)
    criterio(1, dv.crescimento, (v) => (v >= 0.05 ? 1 : v >= 0 ? 0.5 : 0), "dividendo crescendo");
    if (dv.crescimento != null && dv.crescimento < -0.05) alertas.push(`dividendo caindo ${Math.round(-dv.crescimento * 100)}% ao ano`);
  }

  // Setor: perene vale mais para quem vive de dividendos
  const setor = tipoDeSetor(f);
  criterio(1, setor == null ? null : setor === "perene" ? 1 : setor === "outro" ? 0.5 : 0, (v) => v, "setor perene");
  if (setor === "ciclico") alertas.push("setor cíclico: lucro e dividendo oscilam com o ciclo");

  // Liquidez: dá para comprar e vender sem mexer no preço (empresas sólidas costumam ser grandes e negociadas)
  criterio(1, f?.volumeMedio, (v) => (v >= 10_000_000 ? 1 : v >= 2_000_000 ? 0.5 : 0), "boa liquidez");
  if (f?.volumeMedio != null && f.volumeMedio < 1_000_000) alertas.push("pouca liquidez (menos de R$ 1 milhão por dia)");

  if (!ehFinanceira(f)) {
    // Endividamento, margem e liquidez não se aplicam a bancos e seguradoras
    criterio(2, f?.divLiqPatrim, (v) => (v <= 0.5 ? 2 : v <= 1 ? 1.5 : v <= 2 ? 0.5 : 0), "dívida controlada");
    if (f?.divLiqPatrim != null && f.divLiqPatrim > 2) alertas.push("dívida líquida acima de 2x o patrimônio");
    // Dívida líquida / EBIT: quantos anos de lucro operacional pagam a dívida (caixa líquido conta como 0)
    const dlEbit = f?.divLiquida != null && f?.ebit12m != null && f.ebit12m > 0 ? Math.max(0, f.divLiquida) / f.ebit12m : null;
    criterio(1, dlEbit, (v) => (v <= 2 ? 1 : v <= 3.5 ? 0.5 : 0), "dívida baixa frente ao lucro operacional");
    if (dlEbit != null && dlEbit > 4) alertas.push(`dívida líquida de ${dlEbit.toFixed(1).replace(".", ",")} anos de EBIT`);
    if (f?.ebit12m != null && f.ebit12m <= 0) alertas.push("EBIT negativo nos últimos 12 meses");
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

/** Qualidade de FII: renda sustentável, preço sobre patrimônio, vacância, liquidez e tamanho. */
export function calcularQualidadeFii(f: DadosFii | null, dpa12m: number | null): Qualidade {
  const pontos: string[] = [];
  const alertas: string[] = [];
  let ganho = 0;
  let maximo = 0;
  const criterio = (peso: number, valor: number | null | undefined, avaliar: (v: number) => number, rotulo: string) => {
    if (valor == null || !Number.isFinite(valor)) return;
    maximo += peso;
    const obtido = Math.max(0, Math.min(peso, avaliar(valor)));
    ganho += obtido;
    if (obtido >= peso) pontos.push(rotulo);
  };
  const tijolo = (f?.qtdImoveis ?? 0) > 0;

  criterio(2, f?.pvp, (v) => (v <= 0.95 ? 2 : v <= 1.05 ? 1.5 : v <= 1.2 ? 0.5 : 0), "P/VP abaixo de 1");
  if (f?.pvp != null && f.pvp > 1.2) alertas.push(`P/VP ${f.pvp.toFixed(2).replace(".", ",")}: pagando bem acima do patrimônio`);
  const cobertura = dpa12m && f?.ffoCota && f.ffoCota > 0 ? dpa12m / f.ffoCota : null;
  criterio(2, cobertura, (v) => (v <= 1.1 ? 2 : v <= 1.3 ? 1 : 0), "rendimento coberto pelo FFO");
  if (tijolo) {
    criterio(2, f?.vacancia, (v) => (v <= 0.05 ? 2 : v <= 0.1 ? 1 : 0), "vacância baixa");
    if (f?.vacancia != null && f.vacancia > 0.15) alertas.push(`vacância de ${Math.round(f.vacancia * 100)}%`);
    criterio(1, f?.qtdImoveis, (v) => (v >= 10 ? 1 : v >= 4 ? 0.5 : 0), "vários imóveis");
  }
  criterio(2, f?.volumeMedio, (v) => (v >= 5_000_000 ? 2 : v >= 1_000_000 ? 1 : 0), "boa liquidez");
  if (f?.volumeMedio != null && f.volumeMedio < 500_000) alertas.push("pouca liquidez (difícil vender)");
  criterio(1, f?.patrimonio, (v) => (v >= 1_000_000_000 ? 1 : v >= 300_000_000 ? 0.5 : 0), "fundo grande");

  const nota = maximo >= 5 ? Math.round((ganho / maximo) * 100) / 10 : null;
  if (nota == null) alertas.push("poucos dados do fundo para dar nota de qualidade");
  return { nota, pontos, alertas };
}

/** Qualidade de ETF: retorno no longo prazo, quedas sofridas, liquidez e renda. */
export function calcularQualidadeEtf(h: HistoricoPreco | null, dy12m: number | null): Qualidade {
  const pontos: string[] = [];
  const alertas: string[] = [];
  let ganho = 0;
  let maximo = 0;
  const criterio = (peso: number, valor: number | null | undefined, avaliar: (v: number) => number, rotulo: string) => {
    if (valor == null || !Number.isFinite(valor)) return;
    maximo += peso;
    const obtido = Math.max(0, Math.min(peso, avaliar(valor)));
    ganho += obtido;
    if (obtido >= peso) pontos.push(rotulo);
  };
  criterio(3, h?.retornoAnual5a, (v) => (v >= 0.12 ? 3 : v >= 0.08 ? 2 : v >= 0.04 ? 1 : 0), "bom retorno em 5 anos");
  criterio(2, h?.quedaMaxima5a, (v) => (v <= 0.2 ? 2 : v <= 0.35 ? 1 : 0), "quedas moderadas");
  criterio(2, h?.volumeMensalMedio, (v) => (v >= 200_000_000 ? 2 : v >= 20_000_000 ? 1 : 0), "boa liquidez");
  if (h?.volumeMensalMedio != null && h.volumeMensalMedio < 5_000_000) alertas.push("pouca liquidez (difícil vender)");
  criterio(1, dy12m ?? 0, (v) => (v >= 0.04 ? 1 : v >= 0.02 ? 0.5 : 0), "paga dividendos");
  if (h && h.anos < 3) alertas.push(`só ${h.anos} ano(s) de histórico`);

  const nota = maximo >= 5 ? Math.round((ganho / maximo) * 100) / 10 : null;
  if (nota == null) alertas.push("pouco histórico para dar nota de qualidade");
  return { nota, pontos, alertas };
}
