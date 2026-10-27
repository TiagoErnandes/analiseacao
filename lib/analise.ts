// A análise do dia. Use rodarAnalise() (registra a execução e impede duas ao mesmo tempo).
import { analisarComIa, type LinhaParaIa } from "./ai";
import { buscarAcao, type DadosAcao } from "./mercado";
import { query, salvarAnalises, salvarRelatorio, type Analise, type Carteira } from "./db";
import { calcularDpa, margem, precoTeto, scoreFinal, tetoBazin, tetoGraham } from "./valuation";

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function executarAnalise() {
  const hoje = hojeSaoPaulo();

  const [carteira, universo] = await Promise.all([
    query<Carteira>("select ticker, quantidade, preco_medio from carteira"),
    query<{ ticker: string }>("select ticker from universo where ativo"),
  ]);

  const minha = new Map(carteira.map((c) => [c.ticker.toUpperCase(), c]));
  const tickers = [...new Set([...minha.keys(), ...universo.map((u) => u.ticker.toUpperCase())])];
  console.log(`Analisando ${tickers.length} ações em ${hoje}`);

  // 1) Dados de mercado (em sequência, para não sobrecarregar as fontes)
  const dados: DadosAcao[] = [];
  for (const t of tickers) {
    try {
      dados.push(await buscarAcao(t));
    } catch (err) {
      console.warn(`  pulando ${t}: ${(err as Error).message}`);
    }
  }
  if (dados.length === 0) throw new Error("Nenhum dado de mercado obtido. Yahoo/Fundamentus podem estar fora do ar.");

  // 2) Preço teto e pesos da carteira
  const totalCarteira = dados.reduce((s, d) => s + (minha.get(d.ticker)?.quantidade ?? 0) * (d.preco ?? 0), 0);
  const pesoIdeal = minha.size > 0 ? 1 / minha.size : 0;

  const linhas: (LinhaParaIa & { logo: string | null; variacao_dia: number | null; dpa_12m: number | null })[] =
    dados.map((d) => {
      const { dpa12m, dpaMedio } = calcularDpa(d.proventos);
      const bazin = tetoBazin(dpaMedio);
      const graham = tetoGraham(d.lpa, d.vpa);
      const teto = precoTeto(bazin, graham);
      const pos = minha.get(d.ticker);
      return {
        ticker: d.ticker,
        nome: d.nome,
        logo: d.logo,
        variacao_dia: d.variacaoDia,
        na_carteira: !!pos,
        peso_atual: pos && totalCarteira > 0 ? (pos.quantidade * (d.preco ?? 0)) / totalCarteira : null,
        preco: d.preco,
        lpa: d.lpa,
        vpa: d.vpa,
        dpa_12m: dpa12m,
        dy_12m: dpa12m && d.preco ? dpa12m / d.preco : null,
        dpa_medio: dpaMedio,
        roe: d.roe,
        teto_bazin: bazin,
        teto_graham: graham,
        preco_teto: teto,
        margem: margem(d.preco, teto),
      };
    });

  // 3) IA: pesquisa de notícias + nota por ação + ação do dia
  const ia = await analisarComIa(
    linhas.map(({ logo, variacao_dia, dpa_12m, ...resto }) => resto),
    hoje,
  );
  const porTicker = new Map(ia.acoes.map((a) => [a.ticker.toUpperCase(), a]));

  // 4) Salva
  const registros: Analise[] = linhas.map((l) => {
    const a = porTicker.get(l.ticker);
    const falta = l.na_carteira && l.peso_atual != null ? pesoIdeal - l.peso_atual : null;
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
      score: scoreFinal({ margem: l.margem, notaIa: a?.nota ?? null, faltaParaIdeal: falta }),
      na_carteira: l.na_carteira,
    };
  });

  await salvarAnalises(registros);
  await salvarRelatorio({
    data: hoje,
    contexto_mercado: ia.contexto_mercado,
    acao_do_dia_carteira: ia.acao_do_dia_carteira.toUpperCase(),
    justificativa_carteira: ia.justificativa_carteira,
    acao_do_dia_geral: ia.acao_do_dia_geral.toUpperCase(),
    justificativa_geral: ia.justificativa_geral,
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
const TIMEOUT_MIN = 30;

async function garantirTabela() {
  await query(`create table if not exists execucoes (
    id      bigserial primary key,
    origem  text not null,
    status  text not null,
    inicio  timestamptz not null default now(),
    fim     timestamptz,
    erro    text
  )`);
}

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
