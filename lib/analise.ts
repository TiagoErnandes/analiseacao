// A análise do dia. Use rodarAnalise() (registra a execução e impede duas ao mesmo tempo).
import { atualizarIndices } from "./indices";
import { estrategiaAtual } from "./estrategia";
import { analisarComIa, type CustoIa, type LinhaParaIa, type ModoIa, type SaidaIa } from "./ai";
import { buscarAcao, buscarExterior, cotacaoDolar, type DadosAcao } from "./mercado";
import { SO_YAHOO, infoTipo } from "./tipos";
import { migrar, query, salvarAnalises, salvarRelatorio, type Analise, type Carteira } from "./db";
import { calcularQualidade, calcularQualidadeEtf, calcularQualidadeFii, type Qualidade } from "./qualidade";
import { calcularIndicadores, calcularIndicadoresEtf, calcularIndicadoresFii, scoreFinal, type Indicadores } from "./valuation";


function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Preço teto e qualidade conforme o tipo de ativo. */
function avaliar(d: DadosAcao): { ind: Indicadores; qual: Qualidade } {
  if (d.tipo === "fii") {
    const ind = calcularIndicadoresFii({
      preco: d.preco,
      dividendoCota: d.fii?.dividendoCota ?? null,
      ffoCota: d.fii?.ffoCota ?? null,
      dyFundamentus: d.dyFundamentus,
      proventos: d.proventos,
    });
    return { ind, qual: calcularQualidadeFii(d.fii, ind.dpa12m) };
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
    const ind = calcularIndicadoresEtf({ preco: d.preco, media12m: d.historico?.media12m ?? null, proventos: d.proventos });
    return { ind, qual: calcularQualidadeEtf(d.historico, ind.dy12m) };
  }
  const ind = calcularIndicadores(d);
  return { ind, qual: calcularQualidade({ roe: d.roe, lpa: d.lpa, dpa12m: ind.dpa12m, fundamentos: d.fundamentos }) };
}

let custoDaExecucao: CustoIa | null = null;
let pesquisaDoDia: string | null = null;

export async function modoIa(): Promise<ModoIa> {
  const [c] = await query<{ valor: string }>("select valor from config where chave = 'modo_ia'");
  const v = c?.valor ?? process.env.MODO_IA ?? "economico";
  return v === "sem_ia" || v === "completo" ? v : "economico";
}

/** Sinal sem IA: comprar abaixo do teto com qualidade boa; evitar bem acima do teto ou com qualidade baixa. */
function sinalPorCalculo(l: { margem: number | null; qualidade: number | null; tipo: string }): string | null {
  if (l.tipo === "cripto" || l.margem == null) return null;
  if (l.margem > 0 && (l.qualidade ?? 0) >= 6) return "COMPRAR";
  if (l.margem < -0.2 || (l.qualidade != null && l.qualidade < 4)) return "EVITAR";
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

export async function executarAnalise() {
  custoDaExecucao = null;
  pesquisaDoDia = null;
  const hoje = hojeSaoPaulo();
  await migrar();

  const [carteira, universo] = await Promise.all([
    query<Carteira>("select ticker, quantidade, preco_medio, tipo from carteira"),
    query<{ ticker: string }>("select ticker from universo where ativo"),
  ]);

  const minha = new Map(carteira.map((c) => [c.ticker.toUpperCase(), c]));
  const tickers = [...new Set([...minha.keys(), ...universo.map((u) => u.ticker.toUpperCase())])];
  console.log(`Analisando ${tickers.length} ações em ${hoje}`);

  // 1) Dados de mercado (em sequência, para não sobrecarregar as fontes)
  const dados: DadosAcao[] = [];
  const precisaDolar = carteira.some((c) => c.tipo && SO_YAHOO.includes(c.tipo) && c.tipo !== "bdr");
  const dolar = precisaDolar ? await cotacaoDolar().catch((e) => (console.warn(`  ${e.message}`), null)) : null;
  for (const t of tickers) {
    const tipo = minha.get(t)?.tipo;
    try {
      dados.push(tipo && SO_YAHOO.includes(tipo) ? await buscarExterior(t, tipo, dolar) : await buscarAcao(t));
    } catch (err) {
      console.warn(`  pulando ${t}: ${(err as Error).message}`);
    }
  }
  if (dados.length === 0) throw new Error("Nenhum dado de mercado obtido. Yahoo/Fundamentus podem estar fora do ar.");

  // 2) Preço teto, qualidade e pesos da carteira (por ação e por setor)
  // Na estratégia Oportunidade não há bônus por "peso faltando" e o limite por setor é mais folgado.
  const estrategia = await estrategiaAtual();
  const LIMITE_SETOR = estrategia.limiteSetor;
  const balancear = estrategia.atual === "balanceamento";
  console.log(`Estratégia: ${estrategia.atual} (setor até ${LIMITE_SETOR * 100}%)`);
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

  const linhas = dados.map((d) => {
    const { ind, qual } = avaliar(d);
    const pos = minha.get(d.ticker);
    const setor = setorDe(d);
    const pesoAtual = pos && totalCarteira > 0 ? valorPos(d) / totalCarteira : null;
    const pesoDoSetor = pesoSetor.get(setor) ?? 0;
    const alertas = [...ind.alertas, ...qual.alertas];
    if (pesoDoSetor > LIMITE_SETOR) {
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
      peso_atual: pesoAtual,
      falta_para_ideal: falta,
      preco: d.preco,
      lpa: d.lpa,
      vpa: d.vpa,
      dpa_12m: ind.dpa12m,
      dy_12m: ind.dy12m,
      dpa_medio: ind.dpaMedio,
      roe: d.roe,
      indicadores: d.tipo === "fii" ? d.fii : d.tipo === "acao" ? d.fundamentos : d.historico,
      qualidade: qual.nota,
      pontos_fortes: qual.pontos,
      teto_bazin: ind.bazin,
      teto_graham: ind.graham,
      preco_teto: ind.teto,
      margem: ind.margem,
      score_sem_ia: scoreFinal({ margem: ind.margem, qualidade: qual.nota, notaIa: null, faltaParaIdeal: falta, balancear }),
      alertas,
    };
  });

  // 3) IA (opcional e barata). Sem créditos ou com erro, o app decide só pelo cálculo.
  const paraIa: LinhaParaIa[] = linhas
    .map(({ logo, variacao_dia, indicadores, pontos_fortes, nome, ...resto }) => resto)
    .sort((a, b) => b.score_sem_ia - a.score_sem_ia);
  const modo = await modoIa();
  let ia: SaidaIa;
  let custo: CustoIa | null = null;
  if (modo === "sem_ia") {
    ia = decisaoPorCalculo(linhas, "Análise feita só pelo cálculo (modo sem IA).");
  } else {
    try {
      const [guardada] = await query<{ pesquisa: string | null }>("select pesquisa from relatorio_diario where data = $1", [hoje]);
      const r = await analisarComIa(paraIa, hoje, modo, guardada?.pesquisa ?? null, estrategia.atual);
      ia = r.saida;
      custo = r.custo;
      pesquisaDoDia = r.pesquisa;
    } catch (err) {
      const bruto = (err as Error).message ?? String(err);
      const motivo = /credit balance/i.test(bruto) ? "sem créditos na conta da Anthropic" : bruto;
      console.warn(`  IA indisponível, usando só o cálculo: ${motivo}`);
      ia = decisaoPorCalculo(linhas, `A IA não respondeu (${motivo.slice(0, 160)}). Análise feita só pelo cálculo.`);
    }
  }
  custoDaExecucao = custo;
  const porTicker = new Map(ia.acoes.map((a) => [a.ticker.toUpperCase(), a]));

  // 4) Salva
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
      recomendacao: a?.recomendacao ?? sinalPorCalculo(l),
      resumo_ia: a?.resumo ?? null,
      riscos_ia: a?.riscos ?? null,
      score: scoreFinal({ margem: l.margem, qualidade: l.qualidade, notaIa: a?.nota ?? null, faltaParaIdeal: l.falta_para_ideal, balancear }),
      na_carteira: l.na_carteira,
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
  custo_brl: number | null; // custo da IA em reais (dólar do dia da análise)
  custo_mes_brl: number;
  modo: ModoIa;
};

/** Intervalo mínimo entre duas análises disparadas pelo botão. */
export const INTERVALO_MINIMO_MIN = 15;
/** Uma execução "rodando" há mais que isso é considerada travada (container reiniciou, etc.). */
const TIMEOUT_MIN = 60; // a coleta de dados e a IA levam alguns minutos

const garantirTabela = migrar;
/** Dólar usado para converter o custo quando a cotação do dia não foi obtida. */
const DOLAR_PADRAO = 5.5;

export async function ultimaExecucao(): Promise<Execucao | null> {
  await garantirTabela();
  const [e] = await query<Execucao>(
    `select id, origem,
            case when status = 'rodando' and inicio < now() - interval '${TIMEOUT_MIN} minutes' then 'erro' else status end as status,
            inicio::text, fim::text, erro, custo_usd * coalesce(dolar, ${DOLAR_PADRAO}) as custo_brl,
            (select coalesce(sum(custo_usd * coalesce(dolar, ${DOLAR_PADRAO})), 0)
               from execucoes where inicio >= date_trunc('month', now())) as custo_mes_brl
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
  const intervalo = origem === "botao" && (await modoIa()) !== "sem_ia" ? INTERVALO_MINIMO_MIN : 0;
  const [r] = await query<{ id: number }>(
    `insert into execucoes (origem, status)
     select $1, 'rodando'
     where not exists (
       select 1 from execucoes
        where (status = 'rodando' and inicio > now() - interval '${TIMEOUT_MIN} minutes')
           or (status <> 'erro' and modelo is not null and inicio > now() - make_interval(mins => $2::int))
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
       from execucoes where status <> 'erro' and modelo is not null`,
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

  const termino = executarAnalise()
    .then(() =>
      (async () =>
        query("update execucoes set status = 'ok', fim = now(), custo_usd = $2, modelo = $3, dolar = $4 where id = $1", [
          reserva.id,
          custoDaExecucao?.usd ?? 0,
          custoDaExecucao?.modelo ?? null,
          custoDaExecucao?.usd ? await cotacaoDolar().catch(() => null) : null,
        ]))(),
    )
    .catch(async (err) => {
      console.error("Falha na análise:", err);
      await query("update execucoes set status = 'erro', fim = now(), erro = $2 where id = $1", [
        reserva.id,
        String((err as Error)?.message ?? err).slice(0, 1000),
      ]);
    });
  return { id: reserva.id, termino };
}
