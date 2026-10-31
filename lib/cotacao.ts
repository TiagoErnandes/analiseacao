// Cotação histórica para o gráfico da página de cada ativo e a faixa de índices do topo.
// Vem do Yahoo Finance (grátis) e fica alguns minutos na memória para não pedir de novo a cada clique.

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };

export const PERIODOS = {
  "1d": { rotulo: "1D", range: "1d", interval: "5m", minutos: 2 },
  "5d": { rotulo: "5D", range: "5d", interval: "30m", minutos: 5 },
  "1m": { rotulo: "1M", range: "1mo", interval: "1d", minutos: 30 },
  "6m": { rotulo: "6M", range: "6mo", interval: "1d", minutos: 30 },
  ytd: { rotulo: "No ano", range: "ytd", interval: "1d", minutos: 30 },
  "1a": { rotulo: "1A", range: "1y", interval: "1d", minutos: 60 },
  "5a": { rotulo: "5A", range: "5y", interval: "1wk", minutos: 360 },
  max: { rotulo: "Máx", range: "max", interval: "1mo", minutos: 720 },
} as const;
export type Periodo = keyof typeof PERIODOS;
export const ehPeriodo = (p: string | null): p is Periodo => p != null && p in PERIODOS;

export type Cotacao = {
  pontos: { t: number; c: number }[]; // t em ms, c = fechamento
  moeda: string | null; // moeda informada pelo Yahoo (BRL, USD...)
  anterior: number | null; // fechamento do dia anterior (referência do 1D)
  preco: number | null;
  minimo52s: number | null;
  maximo52s: number | null;
};

const memoria = new Map<string, { ate: number; dados: Cotacao }>();

async function chart(simbolo: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${simbolo}: HTTP ${res.status}`);
  const r = ((await res.json()) as any)?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${simbolo}: sem dados`);
  return r;
}

export async function cotacaoHistorica(simbolo: string, periodo: Periodo): Promise<Cotacao> {
  const chave = `${simbolo}:${periodo}`;
  const m = memoria.get(chave);
  if (m && m.ate > Date.now()) return m.dados;
  const p = PERIODOS[periodo];
  const r = await chart(simbolo, p.range, p.interval);
  const fech: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const pontos = ((r.timestamp ?? []) as number[])
    .map((t, i) => ({ t: t * 1000, c: fech[i] as number }))
    .filter((x) => typeof x.c === "number" && x.c > 0);
  const meta = r.meta ?? {};
  const preco = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  // O último ponto do dia às vezes vem atrasado: encosta no preço de agora
  if (preco != null && pontos.length && periodo !== "max") {
    const ult = pontos[pontos.length - 1];
    if (Date.now() - ult.t < 7 * 24 * 3600 * 1000) ult.c = preco;
  }
  const dados: Cotacao = {
    pontos,
    moeda: typeof meta.currency === "string" ? meta.currency : null,
    anterior: typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : typeof meta.previousClose === "number" ? meta.previousClose : null,
    preco,
    minimo52s: typeof meta.fiftyTwoWeekLow === "number" ? meta.fiftyTwoWeekLow : null,
    maximo52s: typeof meta.fiftyTwoWeekHigh === "number" ? meta.fiftyTwoWeekHigh : null,
  };
  memoria.set(chave, { ate: Date.now() + p.minutos * 60_000, dados });
  if (memoria.size > 500) memoria.delete(memoria.keys().next().value!);
  return dados;
}

/** Índices da faixa do topo do site. */
export const INDICES = [
  { simbolo: "^BVSP", nome: "Ibovespa", tipo: "pontos" },
  { simbolo: "BRL=X", nome: "Dólar", tipo: "brl" },
  { simbolo: "EURBRL=X", nome: "Euro", tipo: "brl" },
  { simbolo: "^GSPC", nome: "S&P 500", tipo: "pontos" },
  { simbolo: "^IXIC", nome: "Nasdaq", tipo: "pontos" },
  { simbolo: "BTC-BRL", nome: "Bitcoin", tipo: "brl" },
] as const;

export type Indice = { nome: string; tipo: "pontos" | "brl"; valor: number; variacao: number | null };

let indicesMemoria: { ate: number; dados: Indice[] } | null = null;

export async function indicesMercado(): Promise<Indice[]> {
  if (indicesMemoria && indicesMemoria.ate > Date.now()) return indicesMemoria.dados;
  const res = await Promise.allSettled(
    INDICES.map(async (i) => {
      const r = await chart(i.simbolo, "1d", "1d");
      const preco = r.meta?.regularMarketPrice;
      const ant = r.meta?.chartPreviousClose ?? r.meta?.previousClose;
      if (typeof preco !== "number") throw new Error("sem preço");
      return { nome: i.nome, tipo: i.tipo, valor: preco, variacao: typeof ant === "number" && ant > 0 ? preco / ant - 1 : null } as Indice;
    }),
  );
  const dados = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  // Se tudo falhou, tenta de novo em 1 minuto; senão guarda por 5
  indicesMemoria = { ate: Date.now() + (dados.length ? 5 : 1) * 60_000, dados };
  return dados;
}
