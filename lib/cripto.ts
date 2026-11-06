// Criptomoedas: cotação da Binance (onde a compra é feita) e uma análise própria.
// Cripto não tem lucro, balanço nem dividendo, então Bazin e Graham não se aplicam. A referência de preço é a
// média dos últimos 200 dias (o "múltiplo de Mayer" = preço ÷ média de 200 dias), usada há anos para o Bitcoin:
// abaixo de 1 o preço está abaixo da tendência de longo prazo; acima de 2,4 foram os topos de euforia.
// A Binance é consultada pelo endereço público de dados de mercado (sem conta e sem chave).
// Se ela falhar, o Yahoo entra como reserva.

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
const BINANCE = ["https://data-api.binance.vision/api/v3", "https://api.binance.com/api/v3"];

/** Moedas atreladas ao dólar: servem de caixa, não de investimento (não há o que analisar). */
export const STABLECOINS = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "BUSD", "USDP", "PYUSD", "USDE"]);

/** Criptos conhecidas: a busca do topo trata estes códigos como cripto, não como ação americana (ex.: BTC). */
export const CRIPTOS_CONHECIDAS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "TRX", "LINK", "DOT", "AVAX", "LTC", "BCH", "TON", "XLM", "SHIB", "UNI",
  "ATOM", "NEAR", "APT", "ARB", "OP", "POL", "SUI", "PEPE", "RENDER", "FET", "INJ", "AAVE", "ETC", "FIL", "HBAR",
  ...STABLECOINS,
]);

/** Múltiplo de Mayer que marca os topos de euforia do Bitcoin. */
export const MAYER_BOLHA = 2.4;

class ParInexistente extends Error {}

async function binance<T>(caminho: string): Promise<T> {
  let erro: unknown = null;
  for (const base of BINANCE) {
    try {
      const res = await fetch(`${base}${caminho}`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (res.status === 400) throw new ParInexistente(caminho); // símbolo que a Binance não negocia
      if (!res.ok) throw new Error(`Binance: HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ParInexistente) throw e;
      erro = e; // fora do ar ou bloqueado: tenta o outro endereço
    }
  }
  throw erro instanceof Error ? erro : new Error("Binance indisponível");
}

type Ticker24h = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string };
const ticker24h = (par: string) => binance<Ticker24h>(`/ticker/24hr?symbol=${par}`);

export type CotacaoCripto = {
  preco: number; // R$
  variacaoDia: number | null; // fração, últimas 24 horas
  volumeDiario: number | null; // R$ negociados nas últimas 24 horas (par em reais + par em USDT)
  par: string; // par usado no preço (BTCBRL, ou ETHUSDT convertido)
  usdtBrl: number | null; // reais por USDT
  fonte: "binance";
};

/** Reais por 1 USDT na Binance (cotação do "dólar cripto"). */
export async function cotacaoUsdtBrl(): Promise<number> {
  const t = await ticker24h("USDTBRL");
  const v = Number(t.lastPrice);
  if (!(v > 0)) throw new Error("Binance: sem cotação do USDT");
  return v;
}

/** Preço de agora em reais: pelo par em reais (BTCBRL) se existir, senão pelo par em USDT × USDT/BRL. */
export async function cotacaoBinance(ticker: string): Promise<CotacaoCripto> {
  const t = ticker.toUpperCase();
  if (t === "USDT") {
    const u = await ticker24h("USDTBRL");
    return {
      preco: Number(u.lastPrice),
      variacaoDia: Number(u.priceChangePercent) / 100,
      volumeDiario: Number(u.quoteVolume) || null,
      par: "USDTBRL",
      usdtBrl: Number(u.lastPrice),
      fonte: "binance",
    };
  }
  const [brl, usdt, usdtBrl] = await Promise.allSettled([ticker24h(`${t}BRL`), ticker24h(`${t}USDT`), cotacaoUsdtBrl()]);
  const b = brl.status === "fulfilled" ? brl.value : null;
  const u = usdt.status === "fulfilled" ? usdt.value : null;
  const taxa = usdtBrl.status === "fulfilled" ? usdtBrl.value : null;
  const volume = (b ? Number(b.quoteVolume) : 0) + (u && taxa ? Number(u.quoteVolume) * taxa : 0);
  if (b && Number(b.lastPrice) > 0) {
    return { preco: Number(b.lastPrice), variacaoDia: Number(b.priceChangePercent) / 100, volumeDiario: volume || null, par: b.symbol, usdtBrl: taxa, fonte: "binance" };
  }
  if (u && taxa && Number(u.lastPrice) > 0) {
    return { preco: Number(u.lastPrice) * taxa, variacaoDia: Number(u.priceChangePercent) / 100, volumeDiario: volume || null, par: u.symbol, usdtBrl: taxa, fonte: "binance" };
  }
  const motivo = [brl, usdt].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (motivo?.reason instanceof ParInexistente && !b && !u) throw new Error(`${t}: a Binance não negocia esta moeda em BRL nem em USDT`);
  throw new Error(`${t}: sem cotação na Binance (${(motivo?.reason as Error)?.message ?? "sem preço"})`);
}

/** Fechamentos diários, do mais antigo ao mais novo, já em reais. */
export type Velas = { fonte: "binance" | "yahoo"; par: string; fechamentos: number[] };

/** Até 1000 dias de fechamentos diários na Binance (par em reais, ou em USDT convertido pela cotação de hoje). */
export async function velasBinance(ticker: string, usdtBrl: number | null): Promise<Velas> {
  const t = ticker.toUpperCase();
  const pares = t === "USDT" ? ["USDTBRL"] : [`${t}BRL`, `${t}USDT`];
  let erro: unknown = null;
  for (const par of pares) {
    const fator = par.endsWith("USDT") ? usdtBrl : 1;
    if (!fator) continue;
    try {
      const k = await binance<unknown[][]>(`/klines?symbol=${par}&interval=1d&limit=1000`);
      const fechamentos = k.map((v) => Number(v[4]) * fator).filter((v) => Number.isFinite(v) && v > 0);
      // Par em reais com pouco histórico (lançado há pouco): o par em USDT costuma ter mais
      if (par.endsWith("BRL") && fechamentos.length < 365 && pares.length > 1) {
        erro = new Error(`${par}: só ${fechamentos.length} dias`);
        continue;
      }
      if (fechamentos.length) return { fonte: "binance", par, fechamentos };
    } catch (e) {
      erro = e;
    }
  }
  throw erro instanceof Error ? erro : new Error(`${t}: sem histórico na Binance`);
}

/** Reserva: histórico diário de 3 anos no Yahoo (BTC-BRL; se não houver, BTC-USD × dólar). */
export async function velasYahoo(ticker: string, dolar: number | null): Promise<Velas & { preco: number | null; variacaoDia: number | null }> {
  const t = ticker.toUpperCase();
  const tentativas: [string, number | null][] = [[`${t}-BRL`, 1], [`${t}-USD`, dolar]];
  let erro: unknown = null;
  for (const [simbolo, fator] of tentativas) {
    if (!fator) continue;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=3y&interval=1d`;
      const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Yahoo ${simbolo}: HTTP ${res.status}`);
      const r = ((await res.json()) as any)?.chart?.result?.[0];
      const fech = ((r?.indicators?.quote?.[0]?.close ?? []) as (number | null)[]).filter((v): v is number => typeof v === "number" && v > 0);
      if (!fech.length) throw new Error(`Yahoo ${simbolo}: sem dados`);
      const m = r.meta ?? {};
      const preco = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice * fator : null;
      const anterior = typeof m.chartPreviousClose === "number" ? m.chartPreviousClose * fator : null;
      // No range de 3 anos o "anterior" é o de 3 anos atrás: a variação do dia sai dos dois últimos fechamentos
      const penultimo = fech.length >= 2 ? fech[fech.length - 2] * fator : anterior;
      return {
        fonte: "yahoo",
        par: simbolo,
        fechamentos: fech.map((v) => v * fator),
        preco,
        variacaoDia: preco != null && penultimo ? preco / penultimo - 1 : null,
      };
    } catch (e) {
      erro = e;
    }
  }
  throw erro instanceof Error ? erro : new Error(`${t}: sem histórico no Yahoo`);
}

export type IndicadoresCripto = {
  fonte: "binance" | "yahoo";
  par: string;
  dias: number; // dias de histórico usados (até 1000)
  mm200: number | null; // média dos últimos 200 fechamentos, em R$
  mayer: number | null; // preço ÷ média de 200 dias
  zona: string | null;
  topo: number | null; // maior fechamento no período
  quedaDoTopo: number | null; // quanto o preço está abaixo do topo (fração positiva)
  quedaMaxima: number | null; // maior queda do topo ao fundo no período (fração positiva)
  retorno1a: number | null;
  volatilidade: number | null; // anualizada (desvio dos retornos diários × √365)
  volumeDiario: number | null; // R$ por dia
  usdtBrl: number | null;
  stablecoin: boolean;
};

/** Faixas do múltiplo de Mayer. */
export function zonaMayer(mayer: number | null): string | null {
  if (mayer == null) return null;
  if (mayer < 0.8) return "muito abaixo da média (raro, historicamente ótimo para comprar)";
  if (mayer < 1) return "abaixo da média de 200 dias (bom momento para aportar)";
  if (mayer < 1.5) return "perto da média (aporte regular, sem pressa)";
  if (mayer < MAYER_BOLHA) return "esticado (bem acima da média: aportes menores)";
  return "euforia (zona dos topos históricos: evite comprar)";
}

export function calcularCripto(
  ticker: string,
  velas: Velas,
  preco: number,
  extra: { volumeDiario: number | null; usdtBrl: number | null },
): IndicadoresCripto {
  const f = velas.fechamentos;
  const ultimos200 = f.slice(-200);
  const mm200 = ultimos200.length >= 200 ? ultimos200.reduce((s, v) => s + v, 0) / 200 : null;
  const mayer = mm200 ? preco / mm200 : null;
  let topo = 0;
  let quedaMaxima = 0;
  for (const v of f) {
    topo = Math.max(topo, v);
    quedaMaxima = Math.max(quedaMaxima, 1 - v / topo);
  }
  topo = Math.max(topo, preco);
  const retornos: number[] = [];
  for (let i = Math.max(1, f.length - 365); i < f.length; i++) retornos.push(Math.log(f[i] / f[i - 1]));
  const media = retornos.reduce((s, v) => s + v, 0) / (retornos.length || 1);
  const variancia = retornos.reduce((s, v) => s + (v - media) ** 2, 0) / Math.max(1, retornos.length - 1);
  const umAno = f.length > 365 ? f[f.length - 366] : null;
  return {
    fonte: velas.fonte,
    par: velas.par,
    dias: f.length,
    mm200,
    mayer,
    zona: zonaMayer(mayer),
    topo: f.length ? topo : null,
    quedaDoTopo: f.length ? 1 - preco / topo : null,
    quedaMaxima: f.length ? quedaMaxima : null,
    retorno1a: umAno ? preco / umAno - 1 : null,
    volatilidade: retornos.length >= 60 ? Math.sqrt(variancia) * Math.sqrt(365) : null,
    volumeDiario: extra.volumeDiario,
    usdtBrl: extra.usdtBrl,
    stablecoin: STABLECOINS.has(ticker.toUpperCase()),
  };
}

/**
 * Avaliação de cripto no formato do resto do app:
 * - "teto" = preço de referência = média de 200 dias (múltiplo de Mayer 1); "margem" > 0 quer dizer abaixo dela.
 * - "nota" (0 a 10) mede o risco do ativo, não o momento: rede consolidada, liquidez, volatilidade, quedas e histórico.
 */
export function avaliarCripto(
  ticker: string,
  c: IndicadoresCripto | null,
  preco: number | null,
): { teto: number | null; margem: number | null; nota: number | null; pontos: string[]; alertas: string[] } {
  const t = ticker.toUpperCase();
  const alertas: string[] = [];
  if (c?.stablecoin || STABLECOINS.has(t)) {
    return { teto: null, margem: null, nota: null, pontos: [], alertas: ["stablecoin: acompanha o dólar e não valoriza; serve como caixa em dólar"] };
  }
  if (!c) {
    return { teto: null, margem: null, nota: null, pontos: [], alertas: ["criptomoeda: sem histórico de preço para análise"] };
  }
  const teto = c.mm200;
  const margem = teto && preco ? teto / preco - 1 : null;
  if (c.mayer == null) alertas.push(`criptomoeda: só ${c.dias} dias de histórico (precisa de 200 para a média)`);
  else if (c.mayer >= MAYER_BOLHA) alertas.push(`múltiplo de Mayer ${c.mayer.toFixed(2).replace(".", ",")}: zona de euforia, onde ficaram os topos`);

  const pontos: string[] = [];
  let ganho = 0;
  let maximo = 0;
  const criterio = (peso: number, valor: number | null | undefined, avaliar: (v: number) => number, rotulo: string) => {
    if (valor == null || !Number.isFinite(valor)) return;
    maximo += peso;
    const obtido = Math.max(0, Math.min(peso, avaliar(valor)));
    ganho += obtido;
    if (obtido >= peso) pontos.push(rotulo);
  };
  // Bitcoin: a rede mais antiga, maior e mais descentralizada; Ethereum vem em seguida
  criterio(2, t === "BTC" ? 2 : t === "ETH" ? 1 : 0, (v) => v, "rede mais antiga e consolidada");
  criterio(2, c.volumeDiario, (v) => (v >= 1_000_000_000 ? 2 : v >= 50_000_000 ? 1 : 0), "muita liquidez");
  criterio(2, c.volatilidade, (v) => (v <= 0.5 ? 2 : v <= 0.8 ? 1 : 0), "volatilidade menor que a das outras criptos");
  criterio(2, c.quedaMaxima, (v) => (v <= 0.5 ? 2 : v <= 0.7 ? 1 : 0), "quedas menores no período");
  criterio(1, c.dias, (v) => (v >= 900 ? 1 : v >= 365 ? 0.5 : 0), "histórico de quase 3 anos");
  const nota = maximo >= 5 ? Math.round((ganho / maximo) * 100) / 10 : null;

  if (c.volumeDiario != null && c.volumeDiario < 10_000_000) alertas.push("pouca liquidez na Binance (difícil vender sem mexer no preço)");
  if (c.volatilidade != null && c.volatilidade > 0.8) alertas.push(`volatilidade muito alta (${Math.round(c.volatilidade * 100)}% ao ano)`);
  alertas.push("criptomoeda: sem lucro nem dividendos, alta volatilidade; mantenha como parcela pequena da carteira");
  return { teto, margem, nota, pontos, alertas };
}
