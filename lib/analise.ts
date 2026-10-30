// A análise do dia. Use rodarAnalise() (registra a execução e impede duas ao mesmo tempo).
import { atualizarIndices } from "./indices";
import { estrategiaAtual } from "./estrategia";
import { createHash } from "node:crypto";
import { analisarComIa, selecionarParaIa, type CustoIa, type LinhaParaIa, type ModoIa, type NotaReaproveitada, type SaidaIa } from "./ai";
import { buscarAcao, lerCache, salvarCache, buscarExterior, cotacaoDolar, usoFontes, zerarUsoFontes, type DadosAcao } from "./mercado";
import { SO_YAHOO, infoTipo } from "./tipos";
import { garimpar } from "./garimpo";
import { alertasDaAnalise } from "./alertas";
import { migrar, query, salvarAnalises, salvarRelatorio, type Analise, type Carteira } from "./db";
import { calcularQualidade, calcularQualidadeEtf, calcularQualidadeFii, tipoDeSetor, type Qualidade } from "./qualidade";
import { calcularIndicadores, calcularIndicadoresEtf, calcularIndicadoresFii, consistenciaDividendos, scoreFinal, type Indicadores } from "./valuation";
import { juroReal, yieldExigido, type YieldExigido } from "./juros";
import {
  atualizarDocumentosCvm, atualizarLucrosCvm, documentosRecentes, historicoLucros, infoB3, proventosRecentes,
  type Documento, type HistoricoLucro, type ProventoAnunciado,
} from "./cvm";


function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Abaixo disso a empresa é pequena demais para o perfil (mais risco, menos liquidez, menos governança). */
const VALOR_MINIMO_ACAO = 2_000_000_000;
const PATRIMONIO_MINIMO_FII = 500_000_000;

/**
 * Padrão previdência para o garimpo (ativos de fora da sua lista). É mais exigente que a trava geral, porque
 * aqui não há motivo para aceitar risco: só empresas grandes, de setor previsível, com 10 anos de lucro e de dividendo
 * (o "lucro em cada um dos últimos 10 anos" e "dividendo contínuo" do Graham defensivo) e FIIs de tijolo grandes.
 */
const VALOR_MINIMO_GARIMPO = 5_000_000_000;
const PATRIMONIO_MINIMO_GARIMPO_FII = 1_000_000_000;
const SEGMENTOS_TIJOLO = /log[íi]st|shopping|lajes|escrit|corporat|renda urbana|varejo|hospital|educa/i;
function foraDoPadraoPrevidencia(
  d: DadosAcao,
  lucro: HistoricoLucro | null,
  div10: { anos: number; anosPagos: number; cortes: number } | null,
): string[] {
  const m: string[] = [];
  if (d.tipo === "fii") {
    const pl = d.fii?.patrimonio;
    if (pl == null || pl < PATRIMONIO_MINIMO_GARIMPO_FII) m.push(`patrimônio abaixo de R$ 1 bi`);
    if (!SEGMENTOS_TIJOLO.test(d.fii?.segmento ?? "")) m.push(`segmento ${d.fii?.segmento ?? "desconhecido"} (só FII de tijolo)`);
    if (!div10 || div10.anos < 5 || div10.anosPagos < div10.anos) m.push("menos de 5 anos pagando todo ano");
    return m;
  }
  if (d.tipo !== "acao") return m;
  const vm = d.fundamentos?.valorMercado;
  if (vm == null || vm < VALOR_MINIMO_GARIMPO) m.push(`valor de mercado abaixo de R$ 5 bi`);
  if (tipoDeSetor(d.fundamentos) === "ciclico") m.push(`setor cíclico (${d.fundamentos?.subsetor ?? d.fundamentos?.setor})`);
  if (!lucro || lucro.anos < 8 || lucro.anosComLucro < lucro.anos) m.push(`lucro em ${lucro?.anosComLucro ?? 0} de ${lucro?.anos ?? 0} anos (precisa de todos, 8 ou mais)`);
  if (!div10 || div10.anos < 8 || div10.anosPagos < div10.anos - 1 || div10.cortes > 1)
    m.push(div10 ? `dividendo inconstante (${div10.anosPagos} de ${div10.anos} anos, ${div10.cortes} corte(s) pela metade)` : "sem histórico de dividendos");
  return m;
}

/** Preço teto e qualidade conforme o tipo de ativo. `exigido`: yield do Bazin ligado ao juro real. */
function avaliar(d: DadosAcao, exigido: YieldExigido, lucros: HistoricoLucro | null): { ind: Indicadores; qual: Qualidade } {
  const hoje = new Date();
  if (d.tipo === "fii") {
    const ind = calcularIndicadoresFii({
      preco: d.preco,
      dividendoCota: d.fii?.dividendoCota ?? null,
      ffoCota: d.fii?.ffoCota ?? null,
      dyFundamentus: d.dyFundamentus,
      proventos: d.proventos,
    }, hoje, exigido.fii);
    const qual = calcularQualidadeFii(d.fii, ind.dpa12m);
    const pl = d.fii?.patrimonio;
    if (pl != null && pl > 0 && pl < PATRIMONIO_MINIMO_FII) qual.alertas.push(`fundo pequeno (patrimônio R$ ${Math.round(pl / 1e6)} mi)`);
    return { ind, qual };
  }
  if (d.tipo === "cripto") {
    const ind = calcularIndicadoresEtf({ preco: d.preco, media12m: null, proventos: [] });
    return {
      ind: { ...ind, teto: null, margem: null, alertas: ["criptomoeda: sem preço teto (não gera lucro nem renda), alta volatilidade"] },
      qual: { nota: null, pontos: [], alertas: [] },
    };
  }
  if (d.tipo !== "acao") {
    // ETF, BDR, stock, ETF internacional e REIT: Bazin se pagam dividendos, senão média de 12 meses
    const ind = calcularIndicadoresEtf({ preco: d.preco, media12m: d.historico?.media12m ?? null, proventos: d.proventos }, hoje, exigido.acao);
    return { ind, qual: calcularQualidadeEtf(d.historico, ind.dy12m) };
  }
  const ind = calcularIndicadores(d, hoje, exigido.acao);
  // Lucro de 12 meses do Fundamentus quase zero (ROE < 1%) mas a empresa lucrou no último balanço anual da CVM:
  // o dado do Fundamentus está errado (ex.: TIMS3 com P/L 1.914). A nota não usa ROE, P/L, payout e margem dele.
  const ultimoLucro = lucros?.lucros.at(-1)?.lucro ?? 0;
  // Também quando paga dividendo relevante (DY ≥ 4%): ninguém paga 8% de DY com ROE de 0,1% de verdade
  const lpaSuspeito =
    d.lpa != null && !!d.vpa && d.vpa > 0 && d.lpa / d.vpa < 0.01 && (ultimoLucro > 0 || (ind.dy12m ?? 0) >= 0.04);
  const qual = calcularQualidade({
    roe: lpaSuspeito ? null : d.roe,
    lpa: lpaSuspeito ? null : d.lpa,
    dpa12m: ind.dpa12m,
    fundamentos: lpaSuspeito && d.fundamentos ? { ...d.fundamentos, pl: null, margemLiquida: null } : d.fundamentos,
    lucros,
    dividendos: consistenciaDividendos(d.proventos, hoje),
  });
  if (lpaSuspeito) qual.alertas.push("lucro de 12 meses do Fundamentus parece errado (ROE quase zero): ROE, P/L e margem ignorados na nota");
  // Trava de segurança: lucro em todos os últimos 5 anos (balanços da CVM) e empresa de porte
  if (lucros && lucros.lucros.length) {
    const ult5 = lucros.lucros.slice(-5);
    const comPrejuizo = ult5.filter((l) => l.lucro <= 0).map((l) => l.ano);
    if (comPrejuizo.length) qual.alertas.push(`prejuízo em algum dos últimos 5 anos (${comPrejuizo.join(", ")})`);
    else if (ult5.length < 5) qual.alertas.push(`menos de 5 anos de balanço na CVM (${ult5.length})`);
  }
  const vm = d.fundamentos?.valorMercado;
  if (vm != null && vm > 0 && vm < VALOR_MINIMO_ACAO) qual.alertas.push(`empresa pequena (valor de mercado R$ ${(vm / 1e9).toFixed(1).replace(".", ",")} bi)`);
  return { ind, qual };
}

let custoDaExecucao: CustoIa | null = null;
let economiaDaExecucao = 0; // US$ que deixaram de ser gastos (notas reaproveitadas + desconto do lote)
let execucaoAtual: number | null = null;

/** Mostra no painel em que parte a análise está (e no log). */
function etapa(texto: string) {
  console.log(`Etapa: ${texto}`);
  if (execucaoAtual != null) void query("update execucoes set etapa = $2, batida = now() where id = $1", [execucaoAtual, texto]).catch(() => {});
}

/** Por quantos dias a nota da IA vale para um ativo cujos dados não mudaram. */
const VALIDADE_NOTA_DIAS: Record<Exclude<ModoIa, "sem_ia">, number> = { gratis: 1, gemini_busca: 1, economico: 7, completo: 3 };

/**
 * O que precisa mudar para a IA olhar o ativo de novo: balanço (LPA, VPA, dividendos), qualidade, alertas, setor
 * e o preço só quando ele anda o bastante para mudar a margem em 5 pontos.
 */
function assinatura(l: Record<string, unknown>, estrategia: string, modo: string): string {
  const r = (v: unknown, passo: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v / passo) : null);
  const base = [
    modo, estrategia, l.na_carteira, l.tipo, l.setor, r(l.margem, 0.05), r(l.qualidade, 0.5), r(l.dy_12m, 0.005),
    r(l.lpa, 0.01), r(l.vpa, 0.01), r(l.dpa_12m, 0.01), [...((l.alertas as string[]) ?? [])].sort().join("|"),
    // Documento novo na CVM ou provento anunciado na B3 também pede uma nova olhada
    JSON.stringify(l.documentos_cvm ?? null), JSON.stringify(l.proventos_anunciados ?? null),
  ];
  return createHash("sha1").update(JSON.stringify(base)).digest("hex");
}
let pesquisaDoDia: string | null = null;

/**
 * Pesquisa já feita hoje (guardada assim que termina, mesmo se a decisão falhou). No modo grátis, que não pesquisa,
 * vale também a mais recente dos últimos 7 dias, com a data avisando que pode estar desatualizada.
 */
async function pesquisaGuardada(hoje: string, modo: ModoIa): Promise<string | null> {
  const deHoje = await lerCache<{ texto: string }>(`pesquisa:${hoje}`);
  if (deHoje?.dados?.texto) return deHoje.dados.texto;
  const [rel] = await query<{ pesquisa: string | null }>("select pesquisa from relatorio_diario where data = $1", [hoje]);
  if (rel?.pesquisa) return rel.pesquisa;
  if (modo !== "gratis") return null; // os outros modos pesquisam de novo
  const [antiga] = await query<{ chave: string; texto: string }>(
    `select chave, dados->>'texto' as texto from cache_fontes
      where chave like 'pesquisa:%' and buscado_em > now() - interval '7 days' and dados->>'texto' <> ''
      order by chave desc limit 1`,
  );
  if (!antiga) return null;
  const data = antiga.chave.slice("pesquisa:".length).split("-").reverse().join("/");
  return `(Pesquisa feita em ${data}, reaproveitada no modo grátis: pode estar desatualizada.)\n${antiga.texto}`;
}

export async function modoIa(): Promise<ModoIa> {
  const [c] = await query<{ valor: string }>("select valor from config where chave = 'modo_ia'");
  const v = c?.valor ?? process.env.MODO_IA ?? "gratis";
  return v === "sem_ia" || v === "completo" || v === "economico" || v === "gemini_busca" ? v : "gratis";
}

/** Alertas que impedem o COMPRAR do cálculo, mesmo abaixo do teto: são os sinais clássicos de armadilha de dividendo. */
const ALERTA_GRAVE =
  /prejuízo nos últimos 12 meses|prejuízo em algum dos últimos 5 anos|menos de 5 anos de balanço|empresa pequena|fundo pequeno|insustentável|dívida líquida acima|anos de EBIT|EBIT negativo|acima do que gera|dividendo caindo/;
const temAlertaGrave = (alertas: string[]) => alertas.some((a) => ALERTA_GRAVE.test(a));
/** Ativo com alerta grave cai no ranking (score × 0,75): pode ser barato, mas não é o perfil "empresa sólida". */
const PENALIDADE_GRAVE = 0.75;
/** Foco em ações: FII entra no ranking com 85% do score (só passa uma ação boa se for claramente melhor). */
const PESO_FII = 0.85;
const fatorScore = (l: { tipo: string; alertas: string[] }) => (temAlertaGrave(l.alertas) ? PENALIDADE_GRAVE : 1) * (l.tipo === "fii" ? PESO_FII : 1);

/** Sinal sem IA: comprar abaixo do teto com qualidade boa e sem alerta grave; evitar bem acima do teto ou com qualidade baixa. */
function sinalPorCalculo(l: { margem: number | null; qualidade: number | null; tipo: string; alertas?: string[] }): string | null {
  if (l.tipo === "cripto" || l.margem == null) return null;
  if (l.margem > 0 && (l.qualidade ?? 0) >= 6 && !temAlertaGrave(l.alertas ?? [])) return "COMPRAR";
  if (l.margem < -0.17 || (l.qualidade != null && l.qualidade < 4)) return "EVITAR"; // preço 20% acima do teto
  return "AGUARDAR";
}

/** Escolhas do dia sem IA: maior score com margem positiva (na carteira e no geral). */
function decisaoPorCalculo(
  linhas: { ticker: string; na_carteira: boolean; score_sem_ia: number; margem: number | null; qualidade: number | null }[],
  contexto: string,
): SaidaIa {
  const ordem = [...linhas].sort((a, b) => b.score_sem_ia - a.score_sem_ia);
  const boas = ordem.filter((l) => (l.margem ?? -1) > 0 && (l.qualidade ?? 0) >= 6);
  const cart = boas.find((l) => l.na_carteira) ?? ordem.find((l) => l.na_carteira) ?? ordem[0];
  const geral = boas[0] ?? ordem[0];
  const porque = (l: typeof cart) =>
    l
      ? `Maior nota do cálculo (${l.score_sem_ia}): margem de ${Math.round((l.margem ?? 0) * 100)}% até o preço teto e qualidade ${l.qualidade ?? "—"}.` +
        ((l.margem ?? -1) > 0 && (l.qualidade ?? 0) >= 6 ? "" : " Nenhum ativo cumpre todas as regras hoje; este é o mais próximo.")
      : "";
  return {
    contexto_mercado: contexto,
    acoes: [],
    acao_do_dia_carteira: cart?.ticker ?? "",
    justificativa_carteira: porque(cart),
    acao_do_dia_geral: geral?.ticker ?? "",
    justificativa_geral: porque(geral),
    revisao: null,
  };
}

export async function executarAnalise(origem: "agendador" | "botao" | "manual" = "manual") {
  custoDaExecucao = null;
  economiaDaExecucao = 0;
  zerarUsoFontes();
  pesquisaDoDia = null;
  const hoje = hojeSaoPaulo();
  await migrar();

  const [carteira, universo] = await Promise.all([
    query<Carteira>("select ticker, quantidade, preco_medio, tipo from carteira"),
    query<{ ticker: string }>("select ticker from universo where ativo"),
  ]);

  const minha = new Map(carteira.map((c) => [c.ticker.toUpperCase(), c]));
  const tickers = [...new Set([...minha.keys(), ...universo.map((u) => u.ticker.toUpperCase())])];
  // Garimpo: boas ações e FIIs fora da lista, achados na tabela pública do Fundamentus
  const achados = await garimpar(new Set(tickers)).catch((e) => (console.warn(`  Garimpo: ${e.message}`), []));
  const doGarimpo = new Set(achados.map((a) => a.ticker));
  if (achados.length) console.log(`Garimpo: ${achados.map((a) => `${a.ticker} (${a.motivo})`).join("; ")}`);
  tickers.push(...doGarimpo);
  console.log(`Analisando ${tickers.length} ações em ${hoje}`);
  etapa(`buscando cotações e balanços (${tickers.length} ativos)`);

  // 1) Dados de mercado (em sequência, para não sobrecarregar as fontes)
  const dados: DadosAcao[] = [];
  const precisaDolar = carteira.some((c) => c.tipo && SO_YAHOO.includes(c.tipo) && c.tipo !== "bdr");
  const dolar = precisaDolar ? await cotacaoDolar().catch((e) => (console.warn(`  ${e.message}`), null)) : null;
  for (const [i, t] of tickers.entries()) {
    if (i && i % 10 === 0) etapa(`buscando cotações e balanços (${i} de ${tickers.length})`);
    const tipo = minha.get(t)?.tipo;
    try {
      dados.push(tipo && SO_YAHOO.includes(tipo) ? await buscarExterior(t, tipo, dolar) : await buscarAcao(t));
    } catch (err) {
      console.warn(`  pulando ${t}: ${(err as Error).message}`);
    }
  }
  if (dados.length === 0) throw new Error("Nenhum dado de mercado obtido. Yahoo/Fundamentus podem estar fora do ar.");
  console.log(
    `Fontes: Fundamentus ${usoFontes.fundamentus} buscados / ${usoFontes.fundamentusCache} do banco; ` +
      `histórico Yahoo ${usoFontes.historico} buscados / ${usoFontes.historicoCache} do banco`,
  );

  // 2) Fontes oficiais: juro real (preço teto), CVM (fatos relevantes e lucro de 10 anos) e B3 (proventos anunciados).
  // Qualquer uma pode falhar sem derrubar a análise.
  const juro = await juroReal().catch(() => null);
  const exigido = yieldExigido(juro);
  console.log(
    `Yield exigido: ações ${(exigido.acao * 100).toFixed(1)}%, FIIs ${(exigido.fii * 100).toFixed(1)}%` +
      (juro ? ` (juro real ${(juro.taxa * 100).toFixed(2)}%, ${juro.fonte}, ${juro.data})` : " (sem juro real: mínimos fixos)"),
  );
  await query("insert into config (chave, valor) values ('yield_exigido', $1) on conflict (chave) do update set valor = excluded.valor", [
    JSON.stringify(exigido),
  ]);
  etapa("lendo documentos e balanços da CVM");
  await atualizarDocumentosCvm()
    .then((n) => n && console.log(`CVM: ${n} documentos recentes lidos`))
    .catch((e) => console.warn(`  CVM documentos: ${e.message}`));
  await atualizarLucrosCvm()
    .then((f) => f.length && console.log(`CVM: lucros anuais de ${f.join(", ")}`))
    .catch((e) => console.warn(`  CVM balanços: ${e.message}`));
  etapa("lendo proventos anunciados na B3");
  const b3 = new Map<string, { codigoCvm: number | null; proventos: ProventoAnunciado[] }>();
  for (const d of dados.filter((x) => x.tipo === "acao")) {
    const info = await infoB3(d.ticker).catch(() => null);
    if (info) b3.set(d.ticker, info);
  }
  const codigos = [...new Set([...b3.values()].map((i) => i.codigoCvm).filter((c): c is number => !!c))];
  const [docs, lucros] = await Promise.all([
    documentosRecentes(codigos).catch(() => new Map<number, Documento[]>()),
    historicoLucros(codigos).catch(() => new Map<number, HistoricoLucro>()),
  ]);
  const cvmDe = (t: string) => b3.get(t)?.codigoCvm ?? null;

  // 3) Preço teto, qualidade e pesos da carteira (por ação e por setor)
  // Na estratégia Oportunidade não há bônus por "peso faltando" e o limite por setor é mais folgado.
  const estrategia = await estrategiaAtual();
  const LIMITE_SETOR = estrategia.limiteSetor;
  const balancear = estrategia.atual === "balanceamento";
  console.log(`Estratégia: ${estrategia.atual} (${LIMITE_SETOR < 1 ? `setor até ${LIMITE_SETOR * 100}%` : "sem limite por setor"})`);
  const valorPos = (d: DadosAcao) => (minha.get(d.ticker)?.quantidade ?? 0) * (d.preco ?? 0) * d.cambio; // em reais
  const totalCarteira = dados.reduce((s, d) => s + valorPos(d), 0);
  const pesoIdeal = minha.size > 0 ? 1 / minha.size : 0;
  const setorDe = (d: DadosAcao) =>
    d.tipo === "fii"
      ? `FII ${d.fii?.segmento ?? "sem segmento"}`
      : d.tipo === "acao"
        ? (d.fundamentos?.subsetor ?? d.fundamentos?.setor ?? "Sem setor")
        : (infoTipo(d.tipo)?.nome ?? "Outros");
  const pesoSetor = new Map<string, number>();
  for (const d of dados) {
    if (totalCarteira > 0 && valorPos(d) > 0) {
      pesoSetor.set(setorDe(d), (pesoSetor.get(setorDe(d)) ?? 0) + valorPos(d) / totalCarteira);
    }
  }

  const foraDoPadrao = new Map<string, string[]>(); // garimpo que não passa no padrão previdência
  const todas = dados.map((d) => {
    const cd = cvmDe(d.ticker);
    const lucro = cd ? (lucros.get(cd) ?? null) : null;
    const { ind, qual } = avaliar(d, exigido, lucro);
    const div10 = d.tipo === "acao" || d.tipo === "fii" ? consistenciaDividendos(d.proventos) : null;
    if (doGarimpo.has(d.ticker)) {
      const m = foraDoPadraoPrevidencia(d, lucro, div10);
      if (m.length) foraDoPadrao.set(d.ticker, m);
    }
    const documentos = cd ? (docs.get(cd) ?? []) : [];
    const anunciados = proventosRecentes(b3.get(d.ticker)?.proventos ?? [], hoje);
    const pos = minha.get(d.ticker);
    const setor = setorDe(d);
    const pesoAtual = pos && totalCarteira > 0 ? valorPos(d) / totalCarteira : null;
    const pesoDoSetor = pesoSetor.get(setor) ?? 0;
    const alertas = [...ind.alertas, ...qual.alertas];
    if (LIMITE_SETOR < 1 && pesoDoSetor > LIMITE_SETOR) {
      alertas.push(`setor ${setor} já é ${Math.round(pesoDoSetor * 100)}% da carteira (limite ${LIMITE_SETOR * 100}%)`);
    }
    // Peso faltando só conta no balanceamento e se o setor ainda não estiver concentrado
    const falta = balancear && pos && pesoAtual != null && pesoDoSetor <= LIMITE_SETOR ? pesoIdeal - pesoAtual : null;
    if (alertas.length) console.warn(`  ${d.ticker}: ${alertas.join("; ")}`);
    return {
      ticker: d.ticker,
      tipo: d.tipo,
      moeda: d.moeda,
      cambio: d.cambio,
      nome: d.nome,
      logo: d.logo,
      variacao_dia: d.variacaoDia,
      setor,
      peso_setor_na_carteira: pesoDoSetor || null,
      na_carteira: !!pos,
      garimpo: doGarimpo.has(d.ticker), // achado pelo garimpo (fora da sua lista)
      peso_atual: pesoAtual,
      falta_para_ideal: falta,
      preco: d.preco,
      lpa: d.lpa,
      vpa: d.vpa,
      dpa_12m: ind.dpa12m,
      dy_12m: ind.dy12m,
      dpa_medio: ind.dpaMedio,
      roe: d.roe,
      indicadores:
        d.tipo === "fii"
          ? { ...d.fii, dividendos10a: div10 }
          : d.tipo === "acao"
            ? { ...d.fundamentos, lucros10a: lucro, dividendos10a: div10, documentosCvm: documentos, proventosAnunciados: anunciados, yieldExigido: exigido.acao }
            : d.historico,
      // Para a IA: constância em 10 anos e fontes oficiais recentes (só o essencial, para gastar poucos tokens)
      lucro_10a: lucro ? { anos: lucro.anos, anos_com_lucro: lucro.anosComLucro, crescimento_anual: lucro.crescimentoAnual } : null,
      dividendos_10a: div10 ? { anos: div10.anos, anos_pagos: div10.anosPagos, cortes_pela_metade: div10.cortes, crescimento_anual: div10.crescimento ?? null } : null,
      documentos_cvm: documentos.length ? documentos.map((x) => `${x.data} ${x.categoria}${x.assunto ? `: ${x.assunto.slice(0, 160)}` : ""}`) : null,
      proventos_anunciados: anunciados.length
        ? anunciados.map((p) => `${p.tipo} ${p.valor != null ? `R$ ${p.valor}` : ""} aprovado ${p.aprovadoEm ?? "?"}, data-com ${p.dataCom ?? "?"}`)
        : null,
      qualidade: qual.nota,
      pontos_fortes: qual.pontos,
      teto_bazin: ind.bazin,
      teto_graham: ind.graham,
      preco_teto: ind.teto,
      margem: ind.margem,
      score_sem_ia: Math.round(
        scoreFinal({ margem: ind.margem, qualidade: qual.nota, notaIa: null, faltaParaIdeal: falta, balancear }) * fatorScore({ tipo: d.tipo, alertas }),
      ),
      alertas,
    };
  });
  // Garimpo só traz o que passa na trava de segurança (os da sua lista continuam, com o alerta)
  const barrados = todas.filter((l) => l.garimpo && (temAlertaGrave(l.alertas) || foraDoPadrao.has(l.ticker)));
  if (barrados.length)
    console.log(
      `Garimpo descartou: ${barrados
        .map((l) => `${l.ticker} (${[...l.alertas.filter((a) => ALERTA_GRAVE.test(a)), ...(foraDoPadrao.get(l.ticker) ?? [])].join("; ")})`)
        .join("; ")}`,
    );
  const linhas = todas.filter((l) => !barrados.includes(l));

  // 4) IA (opcional e barata). Sem créditos ou com erro, o app decide só pelo cálculo.
  const paraIa: LinhaParaIa[] = linhas
    .map(({ logo, variacao_dia, indicadores, pontos_fortes, nome, ...resto }) => resto)
    .sort((a, b) => b.score_sem_ia - a.score_sem_ia);
  const modo = await modoIa();
  const reaproveitadas = new Map<string, SaidaIa["acoes"][number]>();
  let ia: SaidaIa;
  let custo: CustoIa | null = null;
  if (modo === "sem_ia") {
    ia = decisaoPorCalculo(linhas, "Análise feita só pelo cálculo (modo sem IA).");
  } else {
    try {
      // Só vai para a IA o que mudou desde a última nota; o resto reaproveita a nota guardada
      // Nos modos do Gemini todos vão para a IA (grátis, ou centavos no pago)
      const selecao = selecionarParaIa(paraIa, modo === "gratis" || modo === "gemini_busca" ? Infinity : undefined);
      const guardadas = new Map(
        (
          await query<{ ticker: string; assinatura: string; nota: number | null; recomendacao: string | null; resumo: string | null; riscos: string | null }>(
            `select ticker, assinatura, nota, recomendacao, resumo, riscos from cache_ia
              where analisado_em > now() - make_interval(days => $1::int)`,
            [VALIDADE_NOTA_DIAS[modo]],
          )
        ).map((c) => [c.ticker, c]),
      );
      const assinaturas = new Map(selecao.map((l) => [l.ticker, assinatura(l, estrategia.atual, modo)]));
      const mudaram = selecao.filter((l) => guardadas.get(l.ticker)?.assinatura !== assinaturas.get(l.ticker));
      const iguais = selecao.filter((l) => guardadas.get(l.ticker)?.assinatura === assinaturas.get(l.ticker));
      for (const l of iguais) {
        const g = guardadas.get(l.ticker)!;
        reaproveitadas.set(l.ticker, { ticker: l.ticker, nota: g.nota ?? 0, recomendacao: (g.recomendacao ?? "AGUARDAR") as "COMPRAR", resumo: g.resumo ?? "", riscos: g.riscos ?? "" });
      }
      const [porAtivo] = await query<{ valor: string }>("select valor from config where chave = 'custo_ia_por_ativo_usd'");
      const custoPorAtivo = Number(porAtivo?.valor ?? 0) || 0;
      console.log(`  IA: ${mudaram.length} ativos mudaram, ${iguais.length} sem mudança (nota reaproveitada)`);

      if (mudaram.length === 0) {
        // Nada mudou: nenhuma chamada. A ação do dia sai da nota final, que já inclui as notas guardadas da IA.
        const comNota = linhas.map((l) => ({
          ...l,
          score_sem_ia: Math.round(
            scoreFinal({ margem: l.margem, qualidade: l.qualidade, notaIa: reaproveitadas.get(l.ticker)?.nota ?? null, faltaParaIdeal: l.falta_para_ideal, balancear }) *
              fatorScore(l),
          ),
        }));
        ia = decisaoPorCalculo(comNota, "Nenhum ativo mudou desde a última análise com IA: as notas foram reaproveitadas, sem custo.");
        ia.acoes = [...reaproveitadas.values()];
        economiaDaExecucao = custoPorAtivo * iguais.length;
      } else {
        const guardada = { pesquisa: await pesquisaGuardada(hoje, modo) };
        const ref: NotaReaproveitada[] = iguais.map((l) => ({
          ticker: l.ticker,
          na_carteira: l.na_carteira,
          nota: reaproveitadas.get(l.ticker)!.nota,
          recomendacao: reaproveitadas.get(l.ticker)!.recomendacao,
          score_sem_ia: l.score_sem_ia,
          margem: l.margem,
        }));
        etapa(`IA analisando ${mudaram.length} ativos`);
        const r = await analisarComIa(mudaram, hoje, modo, guardada?.pesquisa ?? null, estrategia.atual, {
          progresso: etapa,
          reaproveitadas: ref,
          lote: origem === "agendador", // a análise das 7h pode esperar: Batch API, metade do preço
          yieldExigido: { acao: exigido.acao, fii: exigido.fii, juroReal: juro?.taxa ?? null },
          salvarPesquisa: (texto, por) => salvarCache(`pesquisa:${hoje}`, { texto, por }),
        });
        ia = r.saida;
        ia.acoes = [...r.saida.acoes, ...[...reaproveitadas.values()].filter((a) => !r.saida.acoes.some((n) => n.ticker.toUpperCase() === a.ticker))];
        custo = r.custo;
        pesquisaDoDia = r.pesquisa;
        // Guarda as notas novas com a assinatura dos dados que as geraram
        for (const a of r.saida.acoes) {
          const t = a.ticker.toUpperCase();
          if (!assinaturas.has(t)) continue;
          await query(
            `insert into cache_ia (ticker, assinatura, nota, recomendacao, resumo, riscos, modelo, analisado_em)
             values ($1, $2, $3, $4, $5, $6, $7, now())
             on conflict (ticker) do update set assinatura = excluded.assinatura, nota = excluded.nota, recomendacao = excluded.recomendacao,
               resumo = excluded.resumo, riscos = excluded.riscos, modelo = excluded.modelo, analisado_em = now()`,
            [t, assinaturas.get(t), a.nota, a.recomendacao, a.resumo, a.riscos, r.custo.modelo],
          );
        }
        const porAtivoAgora = (r.custo.lote ? r.custo.usd * 2 : r.custo.usd) / mudaram.length; // preço cheio por ativo
        await query(
          "insert into config (chave, valor) values ('custo_ia_por_ativo_usd', $1) on conflict (chave) do update set valor = excluded.valor",
          [String(porAtivoAgora)],
        );
        economiaDaExecucao = porAtivoAgora * iguais.length + (r.custo.lote ? r.custo.usd : 0);
      }
    } catch (err) {
      const bruto = (err as Error).message ?? String(err);
      const motivo = /credit balance/i.test(bruto) ? "sem créditos na conta da Anthropic" : bruto;
      console.warn(`  IA indisponível, usando só o cálculo: ${motivo}`);
      ia = decisaoPorCalculo(linhas, `A IA não respondeu (${motivo.slice(0, 160)}). Análise feita só pelo cálculo.`);
      ia.acoes = [...reaproveitadas.values()]; // as notas guardadas continuam valendo
    }
  }
  custoDaExecucao = custo;
  const porTicker = new Map(ia.acoes.map((a) => [a.ticker.toUpperCase(), a]));

  // 5) Salva
  const registros: Analise[] = linhas.map((l) => {
    const a = porTicker.get(l.ticker);
    return {
      data: hoje,
      ticker: l.ticker,
      nome: l.nome,
      logo: l.logo,
      preco: l.preco,
      variacao_dia: l.variacao_dia,
      lpa: l.lpa,
      vpa: l.vpa,
      dpa_12m: l.dpa_12m,
      dpa_medio: l.dpa_medio,
      dy_12m: l.dy_12m,
      roe: l.roe,
      teto_bazin: l.teto_bazin,
      teto_graham: l.teto_graham,
      preco_teto: l.preco_teto,
      margem: l.margem,
      nota_ia: a?.nota ?? null,
      // Trava de segurança: a IA não consegue dar COMPRAR para ativo com alerta grave
      recomendacao: a?.recomendacao === "COMPRAR" && temAlertaGrave(l.alertas) ? "AGUARDAR" : (a?.recomendacao ?? sinalPorCalculo(l)),
      resumo_ia:
        a?.recomendacao === "COMPRAR" && temAlertaGrave(l.alertas)
          ? `Trava de segurança (COMPRAR virou AGUARDAR): ${l.alertas.filter((x) => ALERTA_GRAVE.test(x)).join("; ")}. ${a.resumo ?? ""}`.trim()
          : (a?.resumo ?? null),
      riscos_ia: a?.riscos ?? null,
      score: Math.round(
        scoreFinal({ margem: l.margem, qualidade: l.qualidade, notaIa: a?.nota ?? null, faltaParaIdeal: l.falta_para_ideal, balancear }) *
          fatorScore(l),
      ),
      na_carteira: l.na_carteira,
      garimpo: l.garimpo,
      qualidade: l.qualidade,
      setor: l.setor,
      alertas: l.alertas.length ? l.alertas.join("; ") : null,
      tipo: l.tipo,
      moeda: l.moeda,
      cambio: l.cambio,
      indicadores: (l.indicadores as Record<string, unknown> | null) ?? null,
    };
  });

  await salvarAnalises(registros);
  await alertasDaAnalise().catch((e) => console.warn(`  Alertas da análise: ${e.message}`));

  // Histórico de proventos (para "proventos recebidos") e a foto do patrimônio do dia
  for (const d of dados) {
    for (const p of d.proventos) {
      await query(
        "insert into proventos (ticker, data, valor) values ($1, $2, $3) on conflict (ticker, data) do update set valor = excluded.valor",
        [d.ticker, p.data.toISOString().slice(0, 10), p.valor],
      );
    }
  }
  const investido = dados.reduce((s, d) => {
    const c = minha.get(d.ticker);
    return s + (c ? c.quantidade * c.preco_medio * d.cambio : 0);
  }, 0);
  await query(
    `insert into patrimonio_diario (data, investido, patrimonio) values ($1, $2, $3)
     on conflict (data) do update set investido = excluded.investido, patrimonio = excluded.patrimonio`,
    [hoje, investido, totalCarteira],
  );
  etapa("salvando o resultado");
  const errosIndices = await atualizarIndices();
  if (errosIndices.length) console.warn(`  Índices de referência: ${errosIndices.join("; ")}`);
  await salvarRelatorio({
    data: hoje,
    contexto_mercado: ia.contexto_mercado,
    acao_do_dia_carteira: ia.acao_do_dia_carteira.toUpperCase(),
    justificativa_carteira: ia.justificativa_carteira,
    acao_do_dia_geral: ia.acao_do_dia_geral.toUpperCase(),
    justificativa_geral: ia.justificativa_geral,
    revisao: ia.revisao,
    pesquisa: pesquisaDoDia,
  });

  console.log(`Pronto. Ação do dia (carteira): ${ia.acao_do_dia_carteira} | (geral): ${ia.acao_do_dia_geral}`);
}

export type Execucao = {
  id: number;
  origem: string;
  status: "rodando" | "ok" | "erro";
  inicio: string;
  fim: string | null;
  erro: string | null;
  etapa: string | null; // em que parte a análise está
  custo_brl: number | null; // custo da IA em reais (dólar do dia da análise)
  custo_mes_brl: number;
  economia_brl: number | null; // quanto deixou de gastar (notas reaproveitadas + lote)
  economia_mes_brl: number;
  modo: ModoIa;
};

/** Intervalo mínimo entre duas análises disparadas pelo botão. */
export const INTERVALO_MINIMO_MIN = 15;
/** Uma execução "rodando" há mais que isso é considerada travada. */
const TIMEOUT_MIN = 60; // a coleta de dados e a IA levam alguns minutos
/** A análise dá sinal de vida a cada 30s. Sem sinal há mais que isso, o processo morreu (ex.: atualizar.bat reiniciou o container). */
const SEM_SINAL_MIN = 3;
const TRAVADA = `status = 'rodando' and (inicio < now() - interval '${TIMEOUT_MIN} minutes' or coalesce(batida, inicio) < now() - interval '${SEM_SINAL_MIN} minutes')`;

/** Fecha como erro as execuções que pararam no meio, para o botão liberar na hora. */
async function fecharTravadas() {
  await query(
    `update execucoes set status = 'erro', fim = coalesce(batida, now()),
            erro = case when coalesce(batida, inicio) < now() - interval '${SEM_SINAL_MIN} minutes'
                        then 'Interrompida' || coalesce(' em: ' || etapa, '') || '. O servidor provavelmente reiniciou (ex.: atualizar.bat durante a análise). Rode de novo.'
                        else 'Passou de ${TIMEOUT_MIN} minutos' || coalesce(' (parou em: ' || etapa || ')', '') || '. Rode de novo.' end
      where ${TRAVADA}`,
  );
}

const garantirTabela = migrar;
/** Dólar usado para converter o custo quando a cotação do dia não foi obtida. */
const DOLAR_PADRAO = 5.5;

export async function ultimaExecucao(): Promise<Execucao | null> {
  await garantirTabela();
  await fecharTravadas();
  const [e] = await query<Execucao>(
    `select id, origem, status, etapa,
            inicio::text, fim::text, erro, custo_usd * coalesce(dolar, ${DOLAR_PADRAO}) as custo_brl,
            (select coalesce(sum(custo_usd * coalesce(dolar, ${DOLAR_PADRAO})), 0)
               from execucoes where inicio >= date_trunc('month', now())) as custo_mes_brl,
            economia_usd * coalesce(dolar, ${DOLAR_PADRAO}) as economia_brl,
            (select coalesce(sum(economia_usd * coalesce(dolar, ${DOLAR_PADRAO})), 0)
               from execucoes where inicio >= date_trunc('month', now())) as economia_mes_brl
       from execucoes order by inicio desc limit 1`,
  );
  return e ? { ...e, modo: await modoIa() } : null;
}

/**
 * Registra o início se não houver outra análise rodando. Para o botão, uma análise com IA só roda se a última
 * que usou IA começou há mais de INTERVALO_MINIMO_MIN (a análise grátis não conta e não tem espera).
 * Devolve o id, ou um motivo quando não pode rodar.
 */
async function reservar(origem: "agendador" | "botao" | "manual"): Promise<{ id: number } | { motivo: string }> {
  await garantirTabela();
  await fecharTravadas();
  const modo = await modoIa();
  const intervalo = origem === "botao" && modo !== "sem_ia" && modo !== "gratis" && modo !== "gemini_busca" ? INTERVALO_MINIMO_MIN : 0;
  const [r] = await query<{ id: number }>(
    `insert into execucoes (origem, status)
     select $1, 'rodando'
     where not exists (
       select 1 from execucoes
        where (status = 'rodando' and not (${TRAVADA}))
           or (status <> 'erro' and modelo like 'claude%' and inicio > now() - make_interval(mins => $2::int))
     )
     returning id`,
    [origem, intervalo],
  );
  if (r) return { id: r.id };
  const ultima = await ultimaExecucao();
  if (ultima?.status === "rodando") return { motivo: "Já tem uma análise rodando. Aguarde terminar." };
  const [ia] = await query<{ ultima: string; libera: string }>(
    `select to_char(max(inicio) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') as ultima,
            to_char((max(inicio) + make_interval(mins => $1::int)) at time zone 'America/Sao_Paulo', 'HH24:MI') as libera
       from execucoes where status <> 'erro' and modelo like 'claude%'`,
    [INTERVALO_MINIMO_MIN],
  );
  return {
    motivo: `A última análise com IA foi em ${ia?.ultima ?? "—"}. Espere ${INTERVALO_MINIMO_MIN} minutos entre análises com IA: libera às ${ia?.libera ?? "—"}.`,
  };
}

/** Roda a análise registrando início, fim e erro. Usado pelo agendador, pelo botão e pelo `npm run analise`. */
export async function rodarAnalise(origem: "agendador" | "botao" | "manual") {
  const reserva = await reservar(origem);
  if ("motivo" in reserva) return reserva;

  // Sinal de vida: se o processo morrer no meio, o painel percebe em poucos minutos e libera o botão
  execucaoAtual = reserva.id;
  const sinal = setInterval(() => void query("update execucoes set batida = now() where id = $1", [reserva.id]).catch(() => {}), 30_000);
  const termino = executarAnalise(origem)
    .then(() =>
      (async () =>
        query("update execucoes set status = 'ok', fim = now(), custo_usd = $2, modelo = $3, dolar = $4, economia_usd = $5 where id = $1", [
          reserva.id,
          custoDaExecucao?.usd ?? 0,
          custoDaExecucao?.modelo ?? null,
          custoDaExecucao?.usd || economiaDaExecucao ? await cotacaoDolar().catch(() => null) : null,
          economiaDaExecucao || null,
        ]))(),
    )
    .catch(async (err) => {
      console.error("Falha na análise:", err);
      await query("update execucoes set status = 'erro', fim = now(), erro = $2 where id = $1", [
        reserva.id,
        String((err as Error)?.message ?? err).slice(0, 1000),
      ]);
    })
    .finally(() => {
      clearInterval(sinal);
      if (execucaoAtual === reserva.id) execucaoAtual = null;
    });
  return { id: reserva.id, termino };
}
