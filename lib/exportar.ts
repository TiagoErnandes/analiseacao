// Exporta a carteira com tudo o que o site sabe, para mandar a outra IA analisar (Markdown, JSON ou CSV).
import { carregarPainel } from "./painel";
import { query, type Analise } from "./db";
import { yieldAtual } from "./juros";
import { infoTipo } from "./tipos";
import { brl, dataBr, num, pct, pctSinal } from "./format";

const r2 = (v: number | null | undefined, casas = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** casas) / 10 ** casas);
const lista = (s: string | null | undefined) => (s ? s.split(/;\s*/).filter(Boolean) : []);
/** Tira campos vazios dos indicadores (cada tipo de ativo tem os seus). */
const limpar = (o: Record<string, unknown> | null) =>
  o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && (typeof v !== "number" || Number.isFinite(v)))) : {};

/** Nomes legíveis dos indicadores (os que não estão aqui saem com o nome técnico). */
const ROTULOS: Record<string, string> = {
  pl: "P/L", pvp: "P/VP", evEbitda: "EV/EBITDA", margemLiquida: "Margem líquida", roic: "ROIC", liquidezCorrente: "Liquidez corrente",
  divLiqPatrim: "Dív. líq./Patrim.", crescReceita5a: "Cresc. receita 5a", lucroLiquido12m: "Lucro líquido 12m", segmento: "Segmento",
  gestao: "Gestão", dy: "DY", ffoYield: "FFO yield", ffoCota: "FFO/cota", dividendoCota: "Dividendo/cota 12m", vpCota: "VP/cota",
  vacancia: "Vacância", qtdImoveis: "Imóveis", capRate: "Cap rate", volumeMedio: "Volume médio/dia", valorMercado: "Valor de mercado",
  patrimonio: "Patrimônio", media12m: "Média de preço 12m", retornoAnual5a: "Retorno anual 5a", quedaMaxima5a: "Queda máxima 5a",
  volumeMensalMedio: "Volume mensal médio", anos: "Anos de histórico", setor: "Setor", subsetor: "Subsetor",
  lucros10a: "Lucro (CVM)", dividendos10a: "Dividendos 10a", documentosCvm: "CVM recente", proventosAnunciados: "Proventos anunciados",
  ebit12m: "EBIT 12m", divLiquida: "Dívida líquida",
};
const EM_PCT = new Set(["margemLiquida", "roic", "crescReceita5a", "dy", "ffoYield", "vacancia", "capRate", "retornoAnual5a", "quedaMaxima5a"]);
const EM_REAIS = new Set(["lucroLiquido12m", "volumeMedio", "valorMercado", "patrimonio", "volumeMensalMedio"]);
const EM_REAIS_MI = new Set(["ebit12m", "divLiquida"]);
const bilhoes = (v: number) => (Math.abs(v) >= 1e9 ? `R$ ${num(v / 1e9, 1)} bi` : `R$ ${num(v / 1e6, 0)} mi`);
/** Texto legível de um indicador; null quando não há o que mostrar (vazio ou sem dado). */
export function fmtIndicador(k: string, v: unknown): string | null {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  const o = v as any;
  switch (k) {
    case "lucros10a": // balanços anuais da CVM
      return o?.anos
        ? `lucro em ${o.anosComLucro} de ${o.anos} anos` + (o.crescimentoAnual != null ? `, crescendo ${pct(o.crescimentoAnual)} ao ano` : "") +
            (Array.isArray(o.lucros) && o.lucros.length ? ` (${o.lucros.map((l: any) => `${l.ano}: ${bilhoes(l.lucro)}`).join(", ")})` : "")
        : null;
    case "dividendos10a":
      return o?.anos
        ? `pagou em ${o.anosPagos} de ${o.anos} anos, ${o.cortes} corte(s) pela metade` + (o.crescimento != null ? `, crescendo ${pct(o.crescimento)} ao ano` : "")
        : null;
    case "documentosCvm":
      return (o as any[]).slice(0, 3).map((d) => `${d.data} ${d.categoria}${d.assunto ? `: ${String(d.assunto).slice(0, 80)}` : ""}`).join(" | ");
    case "proventosAnunciados":
      return (o as any[]).map((p) => `${p.tipo ?? "provento"}${p.valor != null ? ` R$ ${num(p.valor, 4)}` : ""}${p.dataCom ? ` (data-com ${p.dataCom})` : ""}`).join("; ");
    case "yieldExigido":
      return null; // já explicado nas observações do fim
  }
  if (typeof v === "number") return EM_PCT.has(k) ? pct(v) : EM_REAIS.has(k) ? brl(v).replace(",00", "") : EM_REAIS_MI.has(k) ? bilhoes(v) : num(v);
  return typeof v === "object" ? null : String(v);
}

export async function montarExportacao() {
  const [p, y] = await Promise.all([carregarPainel(), yieldAtual()]);
  const yp = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  const posicoes = [...p.posicoes]
    .sort((a, b) => b.valor - a.valor)
    .map((x) => ({
      ticker: x.ticker,
      nome: x.a?.nome ?? null,
      tipo: infoTipo(x.a?.tipo ?? x.tipo)?.nome ?? x.tipo,
      setor: x.a?.setor ?? null,
      moeda: x.moeda,
      quantidade: x.quantidade,
      preco_medio: r2(x.preco_medio, 4),
      preco_atual: r2(x.a?.preco ?? null),
      variacao_dia: r2(x.a?.variacao_dia ?? null, 4),
      investido_brl: r2(x.investido),
      valor_atual_brl: r2(x.valor),
      lucro_brl: r2(x.valor - x.investido),
      rentabilidade: r2(x.rentabilidade, 4),
      peso_na_carteira: r2(x.peso, 4),
      proventos_recebidos_brl: r2(x.recebido),
      renda_12m_brl: r2(x.renda12m),
      dy_12m: r2(x.a?.dy_12m ?? null, 4),
      dpa_12m: r2(x.a?.dpa_12m ?? null, 4),
      dpa_medio_5a: r2(x.a?.dpa_medio ?? null, 4),
      lpa: r2(x.a?.lpa ?? null),
      vpa: r2(x.a?.vpa ?? null),
      roe: r2(x.a?.roe ?? null, 4),
      preco_teto: r2(x.a?.preco_teto ?? null),
      teto_bazin: r2(x.a?.teto_bazin ?? null),
      teto_graham: r2(x.a?.teto_graham ?? null),
      margem_ate_teto: r2(x.a?.margem ?? null, 4),
      qualidade_0a10: r2(x.a?.qualidade ?? null, 1),
      nota_ia_0a10: r2(x.a?.nota_ia ?? null, 1),
      recomendacao: x.a?.recomendacao ?? null,
      score_0a100: r2(x.a?.score ?? null, 0),
      resumo_ia: x.a?.resumo_ia ?? null,
      riscos_ia: x.a?.riscos_ia ?? null,
      alertas: lista(x.a?.alertas),
      indicadores: limpar(x.a?.indicadores ?? null),
    }));

  const oportunidades = p.analises
    .filter((a) => !a.na_carteira && (a.margem ?? -1) > 0 && a.recomendacao !== "EVITAR")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10)
    .map((a) => ({
      ticker: a.ticker,
      nome: a.nome,
      tipo: infoTipo(a.tipo)?.nome ?? a.tipo,
      setor: a.setor,
      moeda: a.moeda,
      preco: r2(a.preco),
      preco_teto: r2(a.preco_teto),
      margem_ate_teto: r2(a.margem, 4),
      dy_12m: r2(a.dy_12m, 4),
      roe: r2(a.roe, 4),
      qualidade_0a10: r2(a.qualidade, 1),
      nota_ia_0a10: r2(a.nota_ia, 1),
      recomendacao: a.recomendacao,
      score_0a100: r2(a.score, 0),
      resumo_ia: a.resumo_ia,
      riscos_ia: a.riscos_ia,
      alertas: lista(a.alertas),
      indicadores: limpar(a.indicadores),
    }));

  const r = p.resumo;
  return {
    gerado_em: hoje,
    data_da_analise: p.rel?.data ?? null,
    observacoes:
      `Percentuais em fração (0,12 = 12%). Valores *_brl em reais; preços na moeda do ativo. Preço teto: Bazin (dividendo ÷ ${yp(y.acao)}) ou Graham para ações; ` +
      `FIIs pelo menor entre rendimento, FFO e média de 5 anos ÷ ${yp(y.fii)}` +
      (y.juroReal ? ` (yield exigido ligado ao juro real do Tesouro IPCA+, ${yp(y.juroReal.taxa)})` : "") +
      ". margem_ate_teto > 0 = abaixo do teto. Qualidade 0-10 vem do balanço/histórico.",
    estrategia: {
      atual: p.estrategia.atual,
      limite_por_setor: p.estrategia.limiteSetor,
      muda_para_balanceamento_em: p.estrategia.escolha === "auto" ? p.estrategia.trocaEm : null,
    },
    resumo: {
      patrimonio_brl: r2(r.patrimonio),
      investido_brl: r2(r.investido),
      lucro_capital_brl: r2(r.lucro),
      rentabilidade_capital: r2(r.rentabilidade, 4),
      proventos_recebidos_brl: r2(r.proventosTotal),
      proventos_12m_brl: r2(r.proventos12m),
      lucro_total_com_proventos_brl: r2(r.lucroTotal),
      rentabilidade_total: r2(r.rentabilidadeTotal, 4),
      rentabilidade_12m: r2(r.rentabilidade12m.valor, 4),
      renda_passiva_12m_brl: r2(r.renda12m),
      dy_carteira: r2(r.dy, 4),
      yield_on_cost: r2(r.yieldOnCost, 4),
      margem_media_ate_teto: r2(r.margemMedia, 4),
      variacao_dia: r2(r.variacaoDia, 4),
      ativos: posicoes.length,
    },
    comparativo: p.comparativo
      ? { desde: p.comparativo.desde, cdi: r2(p.comparativo.cdi, 4), ipca: r2(p.comparativo.ipca, 4), ibovespa: r2(p.comparativo.ibov, 4) }
      : null,
    alocacao_por_tipo: p.classes.map((c) => ({ tipo: c.nome, valor_brl: r2(c.valor), peso: r2(c.peso, 4) })),
    alocacao_por_setor: p.setores.map((s) => ({ setor: s.nome, valor_brl: r2(s.valor), peso: r2(s.peso, 4) })),
    cenario_do_dia: p.rel?.contexto_mercado ?? null,
    acao_do_dia: p.rel
      ? {
          carteira: p.rel.acao_do_dia_carteira,
          por_que_carteira: p.rel.justificativa_carteira,
          geral: p.rel.acao_do_dia_geral,
          por_que_geral: p.rel.justificativa_geral,
        }
      : null,
    posicoes,
    oportunidades_fora_da_carteira: oportunidades,
  };
}

export type Exportacao = Awaited<ReturnType<typeof montarExportacao>>;

const PEDIDO = `Você é um analista de investimentos. Analise a minha carteira de previdência (buy and hold, aportes mensais, dividendos reinvestidos, horizonte de décadas) com base nos dados abaixo, exportados do meu app.

Quero:
1. Um diagnóstico geral: diversificação, concentração por setor e tipo, qualidade dos ativos e renda passiva.
2. Os principais riscos da carteira hoje, incluindo o cenário do Brasil.
3. Para cada ativo: manter, reforçar ou evitar novos aportes, e por quê (cite os números).
4. Onde colocar o próximo aporte, entre os ativos da carteira e as oportunidades de fora.
5. O que eu deveria acompanhar nos próximos meses.

Use só os dados daqui e o que você souber de fontes confiáveis; quando faltar informação, diga. Não é recomendação formal, é apoio à decisão.`;

export function paraMarkdown(e: Exportacao): string {
  const r = e.resumo;
  const linhas: string[] = [];
  linhas.push(PEDIDO, "", "---", "", `# Minha carteira (${dataBr(e.gerado_em)})`, "");
  if (e.data_da_analise) linhas.push(`Dados de mercado da análise de ${dataBr(e.data_da_analise)}.`, "");
  linhas.push(
    `Estratégia atual: **${e.estrategia.atual === "oportunidade" ? "Oportunidade" : "Balanceamento"}** (setor até ${pct(e.estrategia.limite_por_setor, 0)})` +
      (e.estrategia.muda_para_balanceamento_em ? `; passa para Balanceamento em ${dataBr(e.estrategia.muda_para_balanceamento_em)}.` : "."),
    "",
    "## Resumo",
    `- Patrimônio: ${brl(r.patrimonio_brl)} · Investido: ${brl(r.investido_brl)} · Lucro de capital: ${brl(r.lucro_capital_brl)} (${pctSinal(r.rentabilidade_capital)})`,
    `- Proventos recebidos: ${brl(r.proventos_recebidos_brl)} (12 meses: ${brl(r.proventos_12m_brl)}) · Lucro total: ${brl(r.lucro_total_com_proventos_brl)} (${pctSinal(r.rentabilidade_total)})`,
    `- Rentabilidade 12 meses: ${pctSinal(r.rentabilidade_12m)} · Renda passiva 12m: ${brl(r.renda_passiva_12m_brl)} · DY da carteira: ${pct(r.dy_carteira)} · Yield on cost: ${pct(r.yield_on_cost)}`,
    `- Margem média até o preço teto: ${pctSinal(r.margem_media_ate_teto)} · Variação do dia: ${pctSinal(r.variacao_dia, 2)} · ${r.ativos} ativos`,
  );
  if (e.comparativo) {
    linhas.push(
      `- Desde ${dataBr(e.comparativo.desde)}: CDI ${pctSinal(e.comparativo.cdi)} · IPCA ${pctSinal(e.comparativo.ipca)} · Ibovespa ${pctSinal(e.comparativo.ibovespa)}`,
    );
  }
  linhas.push("", "## Alocação", "Por tipo: " + e.alocacao_por_tipo.map((c) => `${c.tipo} ${pct(c.peso)}`).join(" · "));
  linhas.push("Por setor: " + e.alocacao_por_setor.map((s) => `${s.setor} ${pct(s.peso)}`).join(" · "), "");

  linhas.push(
    "## Posições",
    "| Ativo | Tipo | Setor | Qtd. | Preço médio | Preço atual | Investido | Valor | Rentab. | Peso | DY 12m | Preço teto | Margem | Qualidade | Sinal |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const x of e.posicoes) {
    const m = x.moeda === "USD" ? "US$ " : "R$ ";
    const pr = (v: number | null) => (v == null ? "—" : m + num(v));
    linhas.push(
      `| ${x.ticker} | ${x.tipo} | ${x.setor ?? "—"} | ${num(x.quantidade, x.quantidade % 1 ? 4 : 0)} | ${pr(x.preco_medio)} | ${pr(x.preco_atual)} | ${brl(x.investido_brl)} | ${brl(x.valor_atual_brl)} | ${pctSinal(x.rentabilidade)} | ${pct(x.peso_na_carteira)} | ${pct(x.dy_12m)} | ${pr(x.preco_teto)} | ${pctSinal(x.margem_ate_teto)} | ${num(x.qualidade_0a10, 1)} | ${x.recomendacao ?? "—"} |`,
    );
  }
  linhas.push("", "## Detalhes de cada ativo");
  for (const x of e.posicoes) linhas.push(...detalhe(x));

  if (e.oportunidades_fora_da_carteira.length) {
    linhas.push("", "## Oportunidades fora da carteira (abaixo do preço teto, pelo cálculo do app)");
    linhas.push("| Ativo | Tipo | Setor | Preço | Preço teto | Margem | DY 12m | ROE | Qualidade | Sinal | Nota |", "|---|---|---|---:|---:|---:|---:|---:|---:|---|---:|");
    for (const o of e.oportunidades_fora_da_carteira) {
      const m = o.moeda === "USD" ? "US$ " : "R$ ";
      linhas.push(
        `| ${o.ticker} | ${o.tipo} | ${o.setor ?? "—"} | ${o.preco == null ? "—" : m + num(o.preco)} | ${o.preco_teto == null ? "—" : m + num(o.preco_teto)} | ${pctSinal(o.margem_ate_teto)} | ${pct(o.dy_12m)} | ${pct(o.roe)} | ${num(o.qualidade_0a10, 1)} | ${o.recomendacao ?? "—"} | ${o.score_0a100 ?? "—"} |`,
      );
    }
    for (const o of e.oportunidades_fora_da_carteira) linhas.push(...detalhe(o));
  }

  if (e.cenario_do_dia || e.acao_do_dia) {
    linhas.push("", "## O que o app concluiu hoje");
    if (e.cenario_do_dia) linhas.push(`Cenário: ${e.cenario_do_dia}`);
    if (e.acao_do_dia?.carteira) linhas.push(`Ação do dia (carteira): ${e.acao_do_dia.carteira}. ${e.acao_do_dia.por_que_carteira ?? ""}`);
    if (e.acao_do_dia?.geral) linhas.push(`Ação do dia (geral): ${e.acao_do_dia.geral}. ${e.acao_do_dia.por_que_geral ?? ""}`);
  }
  linhas.push("", `_${e.observacoes}_`);
  return linhas.join("\n");
}

function detalhe(x: {
  ticker: string;
  nome: string | null;
  resumo_ia: string | null;
  riscos_ia: string | null;
  alertas: string[];
  indicadores: Record<string, unknown>;
  roe?: number | null;
  lpa?: number | null;
  vpa?: number | null;
  dpa_medio_5a?: number | null;
  nota_ia_0a10?: number | null;
  score_0a100?: number | null;
}): string[] {
  const out = ["", `### ${x.ticker}${x.nome ? ` (${x.nome})` : ""}`];
  const base: string[] = [];
  if (x.lpa != null) base.push(`LPA ${num(x.lpa)}`);
  if (x.vpa != null) base.push(`VPA ${num(x.vpa)}`);
  if (x.roe != null) base.push(`ROE ${pct(x.roe)}`);
  if (x.dpa_medio_5a != null) base.push(`Dividendo médio/ano ${num(x.dpa_medio_5a)}`);
  if (x.nota_ia_0a10 != null) base.push(`Nota da IA ${num(x.nota_ia_0a10, 1)}`);
  if (x.score_0a100 != null) base.push(`Nota final ${x.score_0a100}/100`);
  const ind = Object.entries(x.indicadores)
    .filter(([k]) => k !== "setor" && k !== "subsetor")
    .map(([k, v]) => [k, fmtIndicador(k, v)] as const)
    .filter(([, t]) => t != null)
    .map(([k, t]) => `${ROTULOS[k] ?? k} ${t}`);
  if (base.length || ind.length) out.push(`- Indicadores: ${[...base, ...ind].join(" · ")}`);
  if (x.resumo_ia) out.push(`- Análise: ${x.resumo_ia}`);
  if (x.riscos_ia) out.push(`- Risco: ${x.riscos_ia}`);
  if (x.alertas.length) out.push(`- Alertas: ${x.alertas.join("; ")}`);
  return out;
}

/** CSV para Excel em português: separador ";" e vírgula decimal. */
export function paraCsv(e: Exportacao): string {
  const cols = [
    "ticker", "nome", "tipo", "setor", "moeda", "quantidade", "preco_medio", "preco_atual", "variacao_dia", "investido_brl", "valor_atual_brl",
    "lucro_brl", "rentabilidade", "peso_na_carteira", "proventos_recebidos_brl", "renda_12m_brl", "dy_12m", "dpa_12m", "dpa_medio_5a", "lpa", "vpa",
    "roe", "preco_teto", "teto_bazin", "teto_graham", "margem_ate_teto", "qualidade_0a10", "nota_ia_0a10", "recomendacao", "score_0a100",
    "resumo_ia", "riscos_ia", "alertas",
  ] as const;
  const cel = (v: unknown) => {
    if (v == null) return "";
    if (Array.isArray(v)) v = v.join("; ");
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [cols.join(";"), ...e.posicoes.map((x) => cols.map((c) => cel(x[c])).join(";"))];
  return "﻿" + linhas.join("\r\n");
}

// ---------- Ranking do dia ----------

type Lucros10a = { anos: number; anosComLucro: number; crescimentoAnual: number | null; lucros: { ano: number; lucro: number }[] } | null;
type Div10a = { anos: number; anosPagos: number; cortes: number; crescimento?: number | null } | null;

/** O ranking inteiro do dia, com o que pesa na decisão: preço teto, qualidade, constância, porte, alertas e a IA. */
export async function montarRanking() {
  const [rel] = await query<{ data: string; contexto_mercado: string | null }>(
    "select data::text, contexto_mercado from relatorio_diario order by data desc limit 1",
  );
  const analises = rel ? await query<Analise>("select * from analises where data = $1 order by score desc nulls last", [rel.data]) : [];
  const y = await yieldAtual();
  const ativos = analises.map((a, i) => {
    const ind = (a.indicadores ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof ind[k] === "number" ? (ind[k] as number) : null);
    const luc = (ind.lucros10a ?? null) as Lucros10a;
    const div = (ind.dividendos10a ?? null) as Div10a;
    return {
      posicao: i + 1,
      ticker: a.ticker,
      nome: a.nome,
      tipo: infoTipo(a.tipo)?.nome ?? a.tipo,
      setor: a.setor,
      origem: a.na_carteira ? "carteira" : a.garimpo ? "garimpo" : "lista",
      preco: r2(a.preco),
      preco_teto: r2(a.preco_teto),
      metodo_teto: a.teto_bazin != null && a.preco_teto === a.teto_bazin ? "Bazin" : a.teto_graham != null && a.preco_teto === a.teto_graham ? "Graham" : null,
      margem_ate_teto: r2(a.margem, 4),
      dy_12m: r2(a.dy_12m, 4),
      pl: r2(n("pl")),
      pvp: r2(n("pvp") ?? n("pvpa")),
      roe: r2(a.roe, 4),
      div_liq_patrim: r2(n("divLiqPatrim")),
      valor_mercado_bi: r2((n("valorMercado") ?? 0) / 1e9 || null, 1),
      liquidez_dia_mi: r2((n("volumeMedio") ?? 0) / 1e6 || null, 1),
      anos_com_lucro: luc ? `${luc.anosComLucro}/${luc.anos}` : null,
      lucro_ultimos_5a: luc ? luc.lucros.slice(-5).map((l) => `${l.ano}: ${(l.lucro / 1e6).toFixed(0)} mi`).join(", ") : null,
      crescimento_lucro_10a: r2(luc?.crescimentoAnual ?? null, 4),
      anos_com_dividendo: div ? `${div.anosPagos}/${div.anos}` : null,
      cortes_dividendo: div?.cortes ?? null,
      crescimento_dividendo: r2(div?.crescimento ?? null, 4),
      qualidade_0a10: r2(a.qualidade, 1),
      nota_ia_0a10: r2(a.nota_ia, 1),
      score_0a100: r2(a.score, 0),
      recomendacao: a.recomendacao,
      alertas: lista(a.alertas),
      resumo_ia: a.resumo_ia,
      riscos_ia: a.riscos_ia,
    };
  });
  return {
    data_da_analise: rel?.data ?? null,
    yield_exigido: { acoes: y.acao, fiis: y.fii, juro_real: y.juroReal?.taxa ?? null },
    cenario_do_dia: rel?.contexto_mercado ?? null,
    ativos,
  };
}
export type ExportacaoRanking = Awaited<ReturnType<typeof montarRanking>>;

const PEDIDO_RANKING = `Analise o ranking do dia do meu app de ações (buy and hold, dividendos, previdência). O objetivo é comprar empresas sólidas,
que pagam bons dividendos, a um preço justo e com margem de segurança. Diga quais do topo são boas de verdade, quais são armadilhas
(lucro inconstante, empresa pequena, dívida, dividendo extraordinário) e se algum critério do cálculo parece errado.`;

export function rankingMarkdown(e: ExportacaoRanking): string {
  const L: string[] = [PEDIDO_RANKING, "", "---", "", `# Ranking de ${e.data_da_analise ? dataBr(e.data_da_analise) : "—"}`, ""];
  L.push(
    `Yield exigido: ações ${pct(e.yield_exigido.acoes)}, FIIs ${pct(e.yield_exigido.fiis)}` +
      (e.yield_exigido.juro_real != null ? ` (juro real ${pct(e.yield_exigido.juro_real, 2)})` : "") +
      ". Margem > 0 = abaixo do preço teto. Score: 35% qualidade, 25% IA, 40% desconto (até 40%); alerta grave multiplica por 0,75.",
  );
  if (e.cenario_do_dia) L.push("", `Cenário: ${e.cenario_do_dia}`);
  L.push(
    "",
    "| # | Ativo | Origem | Setor | Preço | Teto | Margem | DY | P/L | P/VP | ROE | Valor merc. | Lucro (anos) | Div. (anos) | Qual. | IA | Score | Sinal |",
    "|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const a of e.ativos) {
    L.push(
      `| ${a.posicao} | ${a.ticker} | ${a.origem} | ${a.setor ?? "—"} | ${num(a.preco)} | ${num(a.preco_teto)}${a.metodo_teto ? ` (${a.metodo_teto})` : ""} | ${pctSinal(a.margem_ate_teto)} | ${pct(a.dy_12m)} | ${num(a.pl)} | ${num(a.pvp)} | ${pct(a.roe)} | ${a.valor_mercado_bi != null ? `${num(a.valor_mercado_bi, 1)} bi` : "—"} | ${a.anos_com_lucro ?? "—"} | ${a.anos_com_dividendo ?? "—"} | ${num(a.qualidade_0a10, 1)} | ${num(a.nota_ia_0a10, 1)} | ${a.score_0a100 ?? "—"} | ${a.recomendacao ?? "—"} |`,
    );
  }
  L.push("", "## Detalhes");
  for (const a of e.ativos) {
    L.push("", `### ${a.posicao}. ${a.ticker}${a.nome ? ` (${a.nome})` : ""}`);
    if (a.lucro_ultimos_5a) L.push(`- Lucro dos últimos 5 anos (CVM): ${a.lucro_ultimos_5a}`);
    const extra = [
      a.crescimento_lucro_10a != null ? `lucro cresce ${pctSinal(a.crescimento_lucro_10a)} ao ano (início x fim de 10 anos)` : null,
      a.crescimento_dividendo != null ? `dividendo cresce ${pctSinal(a.crescimento_dividendo)} ao ano` : null,
      a.cortes_dividendo ? `${a.cortes_dividendo} cortes do dividendo pela metade` : null,
      a.div_liq_patrim != null ? `dív. líq./patrim. ${num(a.div_liq_patrim)}` : null,
      a.liquidez_dia_mi != null ? `liquidez R$ ${num(a.liquidez_dia_mi, 1)} mi/dia` : null,
    ].filter(Boolean);
    if (extra.length) L.push(`- ${extra.join(" · ")}`);
    if (a.alertas.length) L.push(`- Alertas: ${a.alertas.join("; ")}`);
    if (a.resumo_ia) L.push(`- IA: ${a.resumo_ia}`);
    if (a.riscos_ia) L.push(`- Riscos: ${a.riscos_ia}`);
  }
  return L.join("\n");
}

export function rankingCsv(e: ExportacaoRanking): string {
  const cols = Object.keys(e.ativos[0] ?? { posicao: 0 }) as (keyof ExportacaoRanking["ativos"][number])[];
  const cel = (v: unknown) => {
    if (v == null) return "";
    if (Array.isArray(v)) v = v.join("; ");
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(";"), ...e.ativos.map((a) => cols.map((c) => cel(a[c])).join(";"))].join("\r\n");
}
