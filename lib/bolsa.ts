// Toda a bolsa no ranking: as ações que não entram na análise diária aparecem com o preço teto estimado pelos números
// da tabela pública do Fundamentus (cotação, P/L, P/VP, dividend yield e ROE). Sem histórico de dividendos, balanço
// da CVM e IA: ficam sem qualidade, nota e score, mas com o teto de cada método e a margem até ele.
import type { Analise } from "./db";
import { col, tabelaFundamentus, type Linha } from "./garimpo";
import { calcularIndicadores, YIELD_MINIMO_BAZIN } from "./valuation";
import { BOA_EMPRESA, motivosConstancia, type Constancia } from "./boaEmpresa";
import { constanciaPorTicker } from "./cvm";

/** Ações, units e preferenciais da B3 (ex.: PETR4, TAEE11). */
const TICKER_ACAO = /^[A-Z]{4}\d{1,2}$/;

export type LinhaBolsa = {
  ticker: string;
  preco: number;
  pl: number | null;
  pvp: number | null;
  dy: number | null;
  roe: number | null;
  liquidez: number | null; // volume médio diário dos últimos 2 meses, em R$
  margemLiquida?: number | null;
  divida?: number | null; // dívida bruta ÷ patrimônio
  patrimonio?: number | null; // patrimônio líquido, em R$
};

/** Lê uma linha da tabela de ações do Fundamentus. Sem cotação ou sem negócio nos últimos 2 meses: fica de fora. */
export function lerLinhaBolsa(l: Linha): LinhaBolsa | null {
  const ticker = (l.Papel ?? "").toUpperCase();
  const preco = col(l, /^cota/i);
  const liquidez = col(l, /liq\.?\s*2\s*meses/i);
  if (!TICKER_ACAO.test(ticker) || !preco || preco <= 0 || !liquidez || liquidez <= 0) return null;
  return {
    ticker, preco, liquidez,
    pl: col(l, /^P\/L$/i), pvp: col(l, /^P\/VP$/i), dy: col(l, /div\.?\s*yield/i), roe: col(l, /^ROE$/i),
    margemLiquida: col(l, /^mrg\.?\s*l.{1,2}q/i), divida: col(l, /^d.{1,2}v\.?\s*brut/i), patrimonio: col(l, /^patrim/i),
  };
}

export { BOA_EMPRESA };

const mi = (v: number) => (v >= 1e9 ? `R$ ${(v / 1e9).toFixed(1).replace(".", ",")} bi` : `R$ ${Math.round(v / 1e6)} mi`);
const pctTxt = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Por que a ação não passa no filtro de boas empresas (vazio: passa). Só com os números do Fundamentus. */
export function motivosFundamentus(b: LinhaBolsa): string[] {
  const m: string[] = [];
  const c = BOA_EMPRESA;
  if (b.pl == null || b.pl <= 0) m.push("prejuízo nos últimos 12 meses");
  if (b.margemLiquida != null && b.margemLiquida <= 0) m.push("margem líquida negativa");
  if (b.roe == null || b.roe < c.roeMinimo) m.push(`ROE abaixo de ${pctTxt(c.roeMinimo)}`);
  if (b.divida != null && b.divida > c.dividaMaxima) m.push(`dívida bruta de ${b.divida.toFixed(1).replace(".", ",")}x o patrimônio`);
  if (b.liquidez == null || b.liquidez < c.liquidezMinima) m.push(`liquidez abaixo de ${mi(c.liquidezMinima)} por dia`);
  if (b.patrimonio == null || b.patrimonio < c.patrimonioMinimo) m.push(`patrimônio abaixo de ${mi(c.patrimonioMinimo)}`);
  return m;
}

/** Analisadas: vale a nota de qualidade (10 anos de lucro e dividendo, dívida, porte) e a liquidez. */
export function motivosAnalisada(a: Pick<Analise, "qualidade">, b?: LinhaBolsa): string[] {
  const m: string[] = [];
  if (a.qualidade == null || a.qualidade < BOA_EMPRESA.qualidadeMinima) m.push(`qualidade ${a.qualidade ?? "—"} (mínimo ${BOA_EMPRESA.qualidadeMinima})`);
  if (b?.liquidez != null && b.liquidez < BOA_EMPRESA.liquidezMinima) m.push(`liquidez abaixo de ${mi(BOA_EMPRESA.liquidezMinima)} por dia`);
  return m;
}

/** Uma linha do Fundamentus vira uma "análise" só com o preço teto (as mesmas regras da análise diária, sem o histórico). */
export function analiseDaBolsa(b: LinhaBolsa, data: string, exigido = YIELD_MINIMO_BAZIN, constancia?: Constancia | null, usarConstancia = false): Analise {
  // P/L e P/VP negativos (prejuízo, patrimônio negativo) dão LPA e VPA negativos: os métodos de lucro ficam sem valor
  const lpa = b.pl ? b.preco / b.pl : null;
  const vpa = b.pvp ? b.preco / b.pvp : null;
  const ind = calcularIndicadores({ preco: b.preco, lpa, vpa, dyFundamentus: b.dy, proventos: [] }, new Date(), exigido);
  return {
    data,
    ticker: b.ticker,
    nome: null,
    logo: null,
    preco: b.preco,
    variacao_dia: null,
    lpa,
    vpa,
    dpa_12m: ind.dpa12m,
    dpa_medio: null,
    dy_12m: b.dy,
    roe: b.roe,
    teto_bazin: ind.bazin,
    teto_graham: ind.graham,
    teto_buffett: ind.buffett,
    preco_teto: ind.teto,
    margem: ind.margem,
    nota_ia: null,
    recomendacao: null,
    resumo_ia: null,
    riscos_ia: null,
    score: null,
    na_carteira: false,
    qualidade: null,
    setor: null,
    alertas: null,
    tipo: "acao",
    moeda: "BRL",
    cambio: 1,
    indicadores: null,
    fora_da_analise: true,
    liquidez: b.liquidez,
    constancia: constancia ?? null,
    fora_do_filtro: [...motivosFundamentus(b), ...(usarConstancia ? motivosConstancia(constancia) : [])].join("; ") || null,
  };
}

/**
 * Junta as análises do dia com todas as outras ações da bolsa. As analisadas ganham a liquidez do Fundamentus
 * (para o filtro de liquidez); as de fora entram com o teto estimado. Fundamentus fora do ar: só as analisadas.
 */
export async function comTodaABolsa(analises: Analise[], data: string, exigido?: number): Promise<Analise[]> {
  const linhas = await tabelaFundamentus()
    .then((t) => t.acoes.map(lerLinhaBolsa).filter((b): b is LinhaBolsa => b != null))
    .catch((e) => (console.warn(`Ranking: tabela do Fundamentus indisponível (${(e as Error).message})`), [] as LinhaBolsa[]));
  const porTicker = new Map(linhas.map((b) => [b.ticker, b]));
  // Lucro e dividendo nos últimos 10 anos (CVM). Enquanto a análise diária não baixou o histórico, o filtro ignora a constância
  const constancias = await constanciaPorTicker().catch(() => new Map<string, Constancia>());
  const usar = constancias.size > 0;
  const ja = new Set(analises.map((a) => a.ticker));
  return [
    ...analises.map((a) => {
      const b = porTicker.get(a.ticker);
      const c = constancias.get(a.ticker) ?? null;
      const motivos = [...motivosAnalisada(a, b), ...(usar && (a.tipo ?? "acao") === "acao" ? motivosConstancia(c) : [])];
      return { ...a, liquidez: b?.liquidez ?? null, constancia: c, fora_do_filtro: motivos.join("; ") || null };
    }),
    ...linhas.filter((b) => !ja.has(b.ticker)).map((b) => analiseDaBolsa(b, data, exigido, constancias.get(b.ticker), usar)),
  ];
}
