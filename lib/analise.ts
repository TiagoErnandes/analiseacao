// A análise do dia. Use rodarAnalise() (registra a execução e impede duas ao mesmo tempo).
import { atualizarIndices } from "./indices";
import { analisarComIa, type LinhaParaIa } from "./ai";
import { buscarAcao, buscarExterior, cotacaoDolar, type DadosAcao } from "./mercado";
import { SO_YAHOO, infoTipo } from "./tipos";
import { migrar, query, salvarAnalises, salvarRelatorio, type Analise, type Carteira } from "./db";
import { calcularQualidade, calcularQualidadeEtf, calcularQualidadeFii, type Qualidade } from "./qualidade";
import { calcularIndicadores, calcularIndicadoresEtf, calcularIndicadoresFii, scoreFinal, type Indicadores } from "./valuation";

/** Acima disso, um setor é considerado concentrado e não recebe bônus de "peso faltando". */
const LIMITE_SETOR = 0.3;

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

export async function executarAnalise() {
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
    // Peso faltando só conta se o setor ainda não estiver concentrado
    const falta = pos && pesoAtual != null && pesoDoSetor <= LIMITE_SETOR ? pesoIdeal - pesoAtual : null;
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
      score_sem_ia: scoreFinal({ margem: ind.margem, qualidade: qual.nota, notaIa: null, faltaParaIdeal: falta }),
      alertas,
    };
  });

  // 3) IA: pesquisa, decisão e revisão
  const paraIa: LinhaParaIa[] = linhas
    .map(({ logo, variacao_dia, ...resto }) => resto)
    .sort((a, b) => b.score_sem_ia - a.score_sem_ia);
  const ia = await analisarComIa(paraIa, hoje);
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
      recomendacao: a?.recomendacao ?? null,
      resumo_ia: a?.resumo ?? null,
      riscos_ia: a?.riscos ?? null,
      score: scoreFinal({ margem: l.margem, qualidade: l.qualidade, notaIa: a?.nota ?? null, faltaParaIdeal: l.falta_para_ideal }),
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
};

/** Intervalo mínimo entre duas análises disparadas pelo botão. */
export const INTERVALO_MINIMO_MIN = 15;
/** Uma execução "rodando" há mais que isso é considerada travada (container reiniciou, etc.). */
const TIMEOUT_MIN = 90; // a análise completa (3 etapas de IA) pode levar uns 20 a 40 minutos

const garantirTabela = migrar;

export async function ultimaExecucao(): Promise<Execucao | null> {
  await garantirTabela();
  const [e] = await query<Execucao>(
    `select id, origem,
            case when status = 'rodando' and inicio < now() - interval '${TIMEOUT_MIN} minutes' then 'erro' else status end as status,
            inicio::text, fim::text, erro
       from execucoes order by inicio desc limit 1`,
  );
  return e ?? null;
}

/**
 * Registra o início se não houver outra análise rodando (e, para o botão, se a última que não falhou
 * começou há mais de INTERVALO_MINIMO_MIN). Devolve o id, ou um motivo quando não pode rodar.
 */
async function reservar(origem: "agendador" | "botao" | "manual"): Promise<{ id: number } | { motivo: string }> {
  await garantirTabela();
  const intervalo = origem === "botao" ? INTERVALO_MINIMO_MIN : 0;
  const [r] = await query<{ id: number }>(
    `insert into execucoes (origem, status)
     select $1, 'rodando'
     where not exists (
       select 1 from execucoes
        where (status = 'rodando' and inicio > now() - interval '${TIMEOUT_MIN} minutes')
           or (status <> 'erro' and inicio > now() - make_interval(mins => $2::int))
     )
     returning id`,
    [origem, intervalo],
  );
  if (r) return { id: r.id };
  const ultima = await ultimaExecucao();
  return {
    motivo:
      ultima?.status === "rodando"
        ? "Já tem uma análise rodando. Aguarde terminar."
        : `Aguarde ${INTERVALO_MINIMO_MIN} minutos entre uma análise e outra.`,
  };
}

/** Roda a análise registrando início, fim e erro. Usado pelo agendador, pelo botão e pelo `npm run analise`. */
export async function rodarAnalise(origem: "agendador" | "botao" | "manual") {
  const reserva = await reservar(origem);
  if ("motivo" in reserva) return reserva;

  const termino = executarAnalise()
    .then(() => query("update execucoes set status = 'ok', fim = now() where id = $1", [reserva.id]))
    .catch(async (err) => {
      console.error("Falha na análise:", err);
      await query("update execucoes set status = 'erro', fim = now(), erro = $2 where id = $1", [
        reserva.id,
        String((err as Error)?.message ?? err).slice(0, 1000),
      ]);
    });
  return { id: reserva.id, termino };
}
