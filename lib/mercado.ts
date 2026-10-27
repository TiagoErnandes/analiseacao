// Dados de mercado gratuitos:
// - Yahoo Finance: preço atual e histórico de dividendos (5 anos), necessário para o preço teto de Bazin.
// - Fundamentus: LPA, VPA, ROE e variação do dia (balanço mais recente), para Graham.

export type DadosAcao = {
  ticker: string;
  nome: string | null;
  logo: string | null;
  preco: number | null;
  variacaoDia: number | null; // fração
  lpa: number | null;
  vpa: number | null;
  roe: number | null; // fração
  dyFundamentus: number | null; // dividend yield 12m (fração), do Fundamentus
  proventos: { valor: number; data: Date }[];
};

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };

/** "1.234,56" -> 1234.56 ; "12,3%" -> 0.123 */
export function numeroBr(txt: string | undefined): number | null {
  if (!txt) return null;
  const limpo = txt.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const ehPct = limpo.endsWith("%");
  const n = Number.parseFloat(limpo.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return ehPct ? n / 100 : n;
}

async function yahoo(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=6y&interval=1mo&events=div`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = (await res.json()) as any;
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: sem dados`);
  const proventos = Object.values<{ amount: number; date: number }>(r.events?.dividends ?? {})
    .filter((d) => d.amount > 0)
    .map((d) => ({ valor: d.amount, data: new Date(d.date * 1000) }));
  return {
    preco: typeof r.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : null,
    nome: (r.meta?.longName ?? r.meta?.shortName ?? null) as string | null,
    proventos,
  };
}

/** Pega o valor que vem logo depois de um rótulo na página de detalhes do Fundamentus. */
export function campoFundamentus(html: string, rotulo: string): string | undefined {
  const esc = rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<span class="txt">${esc}</span>[\\s\\S]*?<td[^>]*class="data[^"]*"[^>]*>\\s*(?:<[^>]+>\\s*)*([^<]+?)\\s*<`, "i");
  return html.match(re)?.[1];
}

async function fundamentus(ticker: string) {
  const res = await fetch(`https://www.fundamentus.com.br/detalhes.php?papel=${ticker}`, { headers: UA });
  if (!res.ok) throw new Error(`Fundamentus ${ticker}: HTTP ${res.status}`);
  const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
  return {
    preco: numeroBr(campoFundamentus(html, "Cotação")),
    nome: campoFundamentus(html, "Empresa") ?? null,
    lpa: numeroBr(campoFundamentus(html, "LPA")),
    vpa: numeroBr(campoFundamentus(html, "VPA")),
    roe: numeroBr(campoFundamentus(html, "ROE")),
    dy: numeroBr(campoFundamentus(html, "Div. Yield")),
    variacaoDia: numeroBr(campoFundamentus(html, "Dia")),
  };
}

export async function buscarAcao(ticker: string): Promise<DadosAcao> {
  const [y, f] = await Promise.allSettled([yahoo(ticker), fundamentus(ticker)]);
  if (y.status === "rejected" && f.status === "rejected") {
    throw new Error(`${y.reason?.message ?? y.reason} | ${f.reason?.message ?? f.reason}`);
  }
  const yv = y.status === "fulfilled" ? y.value : null;
  const fv = f.status === "fulfilled" ? f.value : null;
  if (!yv) console.warn(`  ${ticker}: sem histórico de dividendos (Yahoo falhou), Bazin ficará vazio`);
  if (!fv) console.warn(`  ${ticker}: sem LPA/VPA (Fundamentus falhou), Graham ficará vazio`);

  return {
    ticker,
    nome: fv?.nome ?? yv?.nome ?? null,
    logo: `https://icons.brapi.dev/icons/${ticker}.svg`,
    preco: yv?.preco ?? fv?.preco ?? null,
    variacaoDia: fv?.variacaoDia ?? null,
    lpa: fv?.lpa ?? null,
    vpa: fv?.vpa ?? null,
    roe: fv?.roe ?? null,
    dyFundamentus: fv?.dy ?? null,
    proventos: yv?.proventos ?? [],
  };
}
