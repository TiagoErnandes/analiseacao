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
  fundamentos: Fundamentos | null;
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

const ENTIDADES: Record<string, string> = {
  "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú", "&atilde;": "ã",
  "&otilde;": "õ", "&ccedil;": "ç", "&ecirc;": "ê", "&ocirc;": "ô", "&nbsp;": " ", "&amp;": "&",
};

/** Normaliza um rótulo para comparar sem acento, espaço ou pontuação: "Dív Líq / Patrim" -> "divliqpatrim". */
export function chaveRotulo(txt: string): string {
  return txt
    .replace(/&[a-z]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Lê todos os pares rótulo/valor da página de detalhes do Fundamentus. */
export function paresFundamentus(html: string): Map<string, string> {
  const pares = new Map<string, string>();
  const re = /<span class="txt">([^<]+)<\/span>[\s\S]*?<td[^>]*class="data[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]*?)\s*</gi;
  for (const m of html.matchAll(re)) {
    const k = chaveRotulo(m[1]);
    if (k && !pares.has(k)) pares.set(k, m[2].replace(/&[a-z]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? "").trim());
  }
  return pares;
}

/** Compatível com o uso antigo: valor de um rótulo. */
export function campoFundamentus(html: string, rotulo: string): string | undefined {
  return paresFundamentus(html).get(chaveRotulo(rotulo));
}

export type Fundamentos = {
  setor: string | null;
  subsetor: string | null;
  pl: number | null;
  pvp: number | null;
  evEbitda: number | null;
  margemLiquida: number | null;
  roic: number | null;
  liquidezCorrente: number | null;
  divLiqPatrim: number | null;
  crescReceita5a: number | null;
  lucroLiquido12m: number | null;
};

export function extrairFundamentus(html: string) {
  const p = paresFundamentus(html);
  const n = (k: string) => numeroBr(p.get(k));
  const t = (k: string) => (p.get(k) && p.get(k) !== "-" ? p.get(k)! : null);
  const fundamentos: Fundamentos = {
    setor: t("setor"),
    subsetor: t("subsetor"),
    pl: n("pl"),
    pvp: n("pvp"),
    evEbitda: n("evebitda"),
    margemLiquida: n("margliquida"),
    roic: n("roic"),
    liquidezCorrente: n("liquidezcorr"),
    divLiqPatrim: n("divliqpatrim"),
    crescReceita5a: n("cresrec5a"),
    lucroLiquido12m: n("lucroliquido"),
  };
  return {
    preco: n("cotacao"),
    nome: t("empresa"),
    lpa: n("lpa"),
    vpa: n("vpa"),
    roe: n("roe"),
    dy: n("divyield"),
    variacaoDia: n("dia"),
    fundamentos,
  };
}

async function fundamentus(ticker: string) {
  const res = await fetch(`https://www.fundamentus.com.br/detalhes.php?papel=${ticker}`, { headers: UA });
  if (!res.ok) throw new Error(`Fundamentus ${ticker}: HTTP ${res.status}`);
  return extrairFundamentus(new TextDecoder("latin1").decode(await res.arrayBuffer()));
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
    fundamentos: fv?.fundamentos ?? null,
    proventos: yv?.proventos ?? [],
  };
}
