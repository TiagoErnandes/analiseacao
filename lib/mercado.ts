// Dados de mercado gratuitos:
// - Yahoo Finance: preço atual, histórico mensal de preços e de dividendos (até 6 anos).
// - Fundamentus: balanço das ações (LPA, VPA, ROE...) e indicadores dos FIIs (P/VP, FFO, vacância...).
// ETFs não estão no Fundamentus: usam só o Yahoo.

import { simboloYahoo, type Tipo } from "./tipos";

export type TipoAtivo = Tipo;

export type DadosAcao = {
  ticker: string;
  tipo: TipoAtivo;
  moeda: "BRL" | "USD"; // moeda do preço e dos dividendos
  cambio: number; // reais por unidade da moeda (1 para BRL)
  nome: string | null;
  logo: string | null;
  preco: number | null;
  variacaoDia: number | null; // fração
  lpa: number | null;
  vpa: number | null;
  roe: number | null; // fração
  dyFundamentus: number | null; // dividend yield 12m (fração), do Fundamentus
  fundamentos: Fundamentos | null;
  fii: DadosFii | null;
  historico: HistoricoPreco | null; // calculado do Yahoo (usado nos ETFs)
  proventos: { valor: number; data: Date }[];
};

export type DadosFii = {
  segmento: string | null;
  gestao: string | null;
  dy: number | null;
  pvp: number | null;
  ffoYield: number | null;
  ffoCota: number | null;
  dividendoCota: number | null; // dividendos por cota nos últimos 12 meses
  vpCota: number | null;
  vacancia: number | null;
  qtdImoveis: number | null;
  capRate: number | null;
  volumeMedio: number | null; // R$ por dia (média de 2 meses)
  valorMercado: number | null;
  patrimonio: number | null;
};

export type HistoricoPreco = {
  media12m: number | null; // média dos fechamentos mensais dos últimos 12 meses
  retornoAnual5a: number | null; // retorno anual composto de preço em até 5 anos
  quedaMaxima5a: number | null; // maior queda do topo ao fundo (fração positiva)
  volumeMensalMedio: number | null; // R$ negociados por mês (média de 12 meses)
  anos: number; // anos de histórico disponíveis
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

async function yahoo(ticker: string, simbolo = `${ticker}.SA`) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=6y&interval=1mo&events=div`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = (await res.json()) as any;
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: sem dados`);
  const proventos = Object.values<{ amount: number; date: number }>(r.events?.dividends ?? {})
    .filter((d) => d.amount > 0)
    .map((d) => ({ valor: d.amount, data: new Date(d.date * 1000) }));
  const preco = typeof r.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : null;
  const q = r.indicators?.quote?.[0] ?? {};
  const meses: { fechamento: number; volume: number }[] = ((r.timestamp ?? []) as number[])
    .map((_, i) => ({ fechamento: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
    .filter((m) => typeof m.fechamento === "number" && m.fechamento > 0);
  // Variação do dia: preço de agora contra o fechamento do pregão anterior (pedido curto e separado; falha não atrapalha)
  let variacaoDia: number | null = null;
  try {
    const d = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=1d`, { headers: UA });
    const m = ((await d.json()) as any)?.chart?.result?.[0]?.meta;
    const anterior = m?.chartPreviousClose ?? m?.previousClose;
    if (typeof m?.regularMarketPrice === "number" && typeof anterior === "number" && anterior > 0) {
      variacaoDia = m.regularMarketPrice / anterior - 1;
    }
  } catch {
    /* sem variação do dia */
  }
  return {
    preco,
    variacaoDia,
    nome: (r.meta?.longName ?? r.meta?.shortName ?? null) as string | null,
    proventos,
    historico: calcularHistorico(meses, preco),
  };
}

export function calcularHistorico(meses: { fechamento: number; volume: number }[], preco: number | null): HistoricoPreco | null {
  if (meses.length < 6) return null;
  const ultimos12 = meses.slice(-12);
  const janela = meses.slice(-61); // até 5 anos
  const anos = (janela.length - 1) / 12;
  const atual = preco ?? janela[janela.length - 1].fechamento;
  let topo = 0;
  let queda = 0;
  for (const m of janela) {
    topo = Math.max(topo, m.fechamento);
    queda = Math.max(queda, 1 - m.fechamento / topo);
  }
  return {
    media12m: ultimos12.reduce((s, m) => s + m.fechamento, 0) / ultimos12.length,
    retornoAnual5a: anos >= 1 ? Math.pow(atual / janela[0].fechamento, 1 / anos) - 1 : null,
    quedaMaxima5a: queda,
    volumeMensalMedio: ultimos12.reduce((s, m) => s + m.volume * m.fechamento, 0) / ultimos12.length || null,
    anos: Math.floor(anos),
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
  const ehFii = p.has("fii") || p.has("ffoyield");
  const fii: DadosFii | null = ehFii
    ? {
        segmento: t("segmento"),
        gestao: t("gestao"),
        dy: n("divyield"),
        pvp: n("pvp"),
        ffoYield: n("ffoyield"),
        ffoCota: n("ffocota"),
        dividendoCota: n("dividendocota"),
        vpCota: n("vpcota"),
        vacancia: n("vacanciamedia"),
        qtdImoveis: n("qtdimoveis"),
        capRate: n("caprate"),
        volumeMedio: n("volmed2m"),
        valorMercado: n("valordemercado"),
        patrimonio: n("patrimliquido"),
      }
    : null;
  return {
    encontrado: p.has("cotacao"),
    fii,
    preco: n("cotacao"),
    nome: t("empresa") ?? t("nome"),
    lpa: n("lpa"),
    vpa: n("vpa"),
    roe: n("roe"),
    dy: n("divyield"),
    variacaoDia: n("dia"),
    fundamentos: ehFii ? null : fundamentos,
  };
}

async function fundamentus(ticker: string) {
  const res = await fetch(`https://www.fundamentus.com.br/detalhes.php?papel=${ticker}`, { headers: UA });
  if (!res.ok) throw new Error(`Fundamentus ${ticker}: HTTP ${res.status}`);
  return extrairFundamentus(new TextDecoder("latin1").decode(await res.arrayBuffer()));
}

/** Cotação do dólar em reais (Yahoo). */
export async function cotacaoDolar(): Promise<number> {
  const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?range=5d&interval=1d", { headers: UA });
  if (!res.ok) throw new Error(`Dólar: HTTP ${res.status}`);
  const v = ((await res.json()) as any)?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof v !== "number" || v <= 0) throw new Error("Dólar: sem cotação");
  return v;
}

/**
 * Ativos fora do Fundamentus (BDR, stocks, ETFs internacionais, REITs e cripto): só o Yahoo.
 * Stocks, REITs e ETFs internacionais ficam em dólar; cripto é convertida para reais.
 */
export async function buscarExterior(ticker: string, tipo: Tipo, dolar: number | null): Promise<DadosAcao> {
  const y = await yahoo(ticker, simboloYahoo(ticker, tipo));
  const emDolar = tipo === "stock" || tipo === "etf_int" || tipo === "reit";
  if ((emDolar || tipo === "cripto") && !dolar) throw new Error(`${ticker}: sem cotação do dólar para converter`);
  const fator = tipo === "cripto" ? dolar! : 1; // cripto vem em US$ e é guardada em R$
  return {
    ticker,
    tipo,
    moeda: emDolar ? "USD" : "BRL",
    cambio: emDolar ? dolar! : 1,
    nome: y.nome,
    logo: tipo === "bdr" ? `https://icons.brapi.dev/icons/${ticker}.svg` : null,
    preco: y.preco != null ? y.preco * fator : null,
    variacaoDia: y.variacaoDia,
    lpa: null,
    vpa: null,
    roe: null,
    dyFundamentus: null,
    fundamentos: null,
    fii: null,
    historico: y.historico,
    proventos: y.proventos,
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
  const noFundamentus = !!fv?.encontrado;
  // O Fundamentus respondeu mas não conhece o código e ele termina em 11: é ETF (units de ações e FIIs estão lá)
  const tipo: TipoAtivo = fv?.fii ? "fii" : fv && !noFundamentus && ticker.endsWith("11") && yv ? "etf" : "acao";
  if (tipo === "acao" && !noFundamentus) console.warn(`  ${ticker}: sem dados do Fundamentus, Graham e qualidade ficarão vazios`);
  return {
    ticker,
    tipo,
    moeda: "BRL",
    cambio: 1,
    nome: fv?.nome ?? yv?.nome ?? null,
    logo: `https://icons.brapi.dev/icons/${ticker}.svg`,
    preco: yv?.preco ?? fv?.preco ?? null,
    variacaoDia: fv?.variacaoDia ?? yv?.variacaoDia ?? null,
    lpa: fv?.lpa ?? null,
    vpa: fv?.fii ? fv.fii.vpCota : (fv?.vpa ?? null), // nos FIIs, VP por cota
    roe: fv?.roe ?? null,
    dyFundamentus: fv?.dy ?? null,
    fundamentos: noFundamentus ? (fv?.fundamentos ?? null) : null,
    fii: fv?.fii ?? null,
    historico: yv?.historico ?? null,
    proventos: yv?.proventos ?? [],
  };
}
