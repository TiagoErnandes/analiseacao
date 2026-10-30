// Dados de mercado gratuitos:
// - Yahoo Finance: preço atual, histórico mensal de preços e de dividendos (até 11 anos).
// - Fundamentus: balanço das ações (LPA, VPA, ROE...) e indicadores dos FIIs (P/VP, FFO, vacância...).
// ETFs não estão no Fundamentus: usam só o Yahoo.

import { query } from "./db";
import { simboloYahoo, type Tipo } from "./tipos";

// Cache das fontes no banco: balanço e histórico mudam pouco, então só buscamos de novo quando pode ter novidade.
const DIA = 24 * 60 * 60 * 1000;
export async function lerCache<T>(chave: string): Promise<{ dados: T; idadeDias: number; buscadoEm: Date } | null> {
  try {
    const [c] = await query<{ dados: T; buscado_em: Date }>("select dados, buscado_em from cache_fontes where chave = $1", [chave]);
    return c ? { dados: c.dados, buscadoEm: new Date(c.buscado_em), idadeDias: (Date.now() - new Date(c.buscado_em).getTime()) / DIA } : null;
  } catch {
    return null; // sem banco (testes) ou tabela ainda não criada: busca na fonte
  }
}
export async function salvarCache(chave: string, dados: unknown) {
  try {
    await query(
      `insert into cache_fontes (chave, dados, buscado_em) values ($1, $2, now())
       on conflict (chave) do update set dados = excluded.dados, buscado_em = now()`,
      [chave, JSON.stringify(dados)],
    );
  } catch {
    /* cache é só otimização */
  }
}
/** Contadores da execução (para o log): quantas vezes cada fonte foi consultada ou reaproveitada. */
export const usoFontes = { fundamentus: 0, fundamentusCache: 0, historico: 0, historicoCache: 0 };
export function zerarUsoFontes() {
  Object.assign(usoFontes, { fundamentus: 0, fundamentusCache: 0, historico: 0, historicoCache: 0 });
}

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

type HistoricoBruto = { meses: { fechamento: number; volume: number }[]; proventos: { valor: number; data: number }[]; nome: string | null; preco: number | null };

/** Histórico mensal de 11 anos (preços e dividendos, para medir 10 anos completos). É o pedido pesado: fica guardado e é renovado por semana ou na virada do mês. */
async function historicoYahoo(simbolo: string): Promise<HistoricoBruto & { fresco: boolean }> {
  const chave = `yahoo11:${simbolo}`; // chave nova ao passar de 6 para 11 anos (busca de novo uma vez)
  const c = await lerCache<HistoricoBruto>(chave);
  const virouMes = c ? c.buscadoEm.getUTCMonth() !== new Date().getUTCMonth() : true;
  if (c && c.idadeDias < 7 && !virouMes) {
    usoFontes.historicoCache++;
    return { ...c.dados, fresco: false };
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=11y&interval=1mo&events=div`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`Yahoo ${simbolo}: HTTP ${res.status}`);
    const r = ((await res.json()) as any)?.chart?.result?.[0];
    if (!r) throw new Error(`Yahoo ${simbolo}: sem dados`);
    const q = r.indicators?.quote?.[0] ?? {};
    const bruto: HistoricoBruto = {
      meses: ((r.timestamp ?? []) as number[])
        .map((_, i) => ({ fechamento: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
        .filter((m) => typeof m.fechamento === "number" && m.fechamento > 0),
      proventos: Object.values<{ amount: number; date: number }>(r.events?.dividends ?? {})
        .filter((d) => d.amount > 0)
        .map((d) => ({ valor: d.amount, data: d.date * 1000 })),
      nome: (r.meta?.longName ?? r.meta?.shortName ?? null) as string | null,
      preco: typeof r.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : null,
    };
    usoFontes.historico++;
    await salvarCache(chave, bruto);
    return { ...bruto, fresco: true };
  } catch (err) {
    if (c) return { ...c.dados, fresco: false }; // fonte fora do ar: usa o que já tinha
    throw err;
  }
}

/** Preço de agora e variação do dia (pedido leve, todo dia). */
export async function precoYahoo(simbolo: string): Promise<{ preco: number | null; variacaoDia: number | null }> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=1d`, { headers: UA });
  if (!res.ok) throw new Error(`Yahoo ${simbolo}: HTTP ${res.status}`);
  const m = ((await res.json()) as any)?.chart?.result?.[0]?.meta;
  const preco = typeof m?.regularMarketPrice === "number" ? m.regularMarketPrice : null;
  const anterior = m?.chartPreviousClose ?? m?.previousClose;
  return { preco, variacaoDia: preco != null && typeof anterior === "number" && anterior > 0 ? preco / anterior - 1 : null };
}

async function yahoo(ticker: string, simbolo = `${ticker}.SA`) {
  const [h, d] = await Promise.allSettled([historicoYahoo(simbolo), precoYahoo(simbolo)]);
  if (h.status === "rejected" && d.status === "rejected") throw h.reason;
  const hist = h.status === "fulfilled" ? h.value : null;
  const dia = d.status === "fulfilled" ? d.value : null;
  // Preço: o de agora; se o pedido leve falhar, o do histórico só se ele acabou de ser buscado
  const preco = dia?.preco ?? (hist?.fresco ? hist.preco : null);
  return {
    preco,
    variacaoDia: dia?.variacaoDia ?? null,
    nome: hist?.nome ?? null,
    proventos: (hist?.proventos ?? []).map((p) => ({ valor: p.valor, data: new Date(p.data) })),
    historico: hist ? calcularHistorico(hist.meses, preco) : null,
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
  volumeMedio?: number | null; // R$ negociados por dia (média de 2 meses)
  valorMercado?: number | null;
  divLiquida?: number | null; // dívida líquida em R$ (negativa = caixa líquido)
  ebit12m?: number | null;
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
    volumeMedio: n("volmed2m"),
    valorMercado: n("valordemercado"),
    divLiquida: n("divliquida"),
    ebit12m: n("ebit"), // a primeira ocorrência é a dos últimos 12 meses
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
    ultBalanco: t("ultbalancoprocessado"), // dd/mm/aaaa
    fundamentos: ehFii ? null : fundamentos,
  };
}

type Fundamentus = ReturnType<typeof extrairFundamentus>;

/**
 * Busca de novo no Fundamentus só quando pode ter dado novo:
 * - ações: a cada 30 dias, ou a cada 3 dias quando já passaram 90 dias do último balanço (temporada de resultado);
 * - FIIs: por semana (relatórios mensais).
 */
export function precisaAtualizarFundamentus(f: Fundamentus, idadeDias: number, hoje = new Date()): boolean {
  if (!f.encontrado) return idadeDias >= 7;
  if (f.fii) return idadeDias >= 7;
  if (idadeDias >= 30) return true;
  const m = f.ultBalanco?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return idadeDias >= 7;
  const balanco = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return hoje.getTime() - balanco > 90 * DIA && idadeDias >= 3;
}

async function fundamentus(ticker: string): Promise<Fundamentus> {
  const chave = `fundamentus2:${ticker}`; // 2: com liquidez, valor de mercado, dívida líquida e EBIT
  const c = await lerCache<Fundamentus>(chave);
  if (c && !precisaAtualizarFundamentus(c.dados, c.idadeDias)) {
    usoFontes.fundamentusCache++;
    return { ...c.dados, variacaoDia: null }; // a variação do dia guardada é velha
  }
  try {
    const res = await fetch(`https://www.fundamentus.com.br/detalhes.php?papel=${ticker}`, { headers: UA });
    if (!res.ok) throw new Error(`Fundamentus ${ticker}: HTTP ${res.status}`);
    const f = extrairFundamentus(new TextDecoder("latin1").decode(await res.arrayBuffer()));
    usoFontes.fundamentus++;
    await salvarCache(chave, f);
    return f;
  } catch (err) {
    if (c) return { ...c.dados, variacaoDia: null };
    throw err;
  }
}

/** Indicadores que dependem do preço (P/L, P/VP, DY...) acompanham o preço de hoje quando o balanço veio do cache. */
export function ajustarAoPreco(f: Fundamentus, precoHoje: number | null): Fundamentus {
  if (!precoHoje || !f.preco || f.preco === precoHoje) return f;
  const k = precoHoje / f.preco;
  const vezes = (v: number | null) => (v == null ? null : v * k);
  const dividido = (v: number | null) => (v == null ? null : v / k);
  return {
    ...f,
    preco: precoHoje,
    dy: dividido(f.dy),
    fundamentos: f.fundamentos ? { ...f.fundamentos, pl: vezes(f.fundamentos.pl), pvp: vezes(f.fundamentos.pvp) } : null,
    fii: f.fii
      ? { ...f.fii, pvp: vezes(f.fii.pvp), dy: dividido(f.fii.dy), ffoYield: dividido(f.fii.ffoYield), valorMercado: vezes(f.fii.valorMercado) }
      : null,
  };
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
  const fv = f.status === "fulfilled" ? ajustarAoPreco(f.value, yv?.preco ?? null) : null;
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
