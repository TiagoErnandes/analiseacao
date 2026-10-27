// Dados que as páginas do site usam: última análise, carteira e posições já calculadas.
import { modoIa, ultimaExecucao } from "./analise";
import { query, type Analise, type Carteira, type Relatorio } from "./db";
import { infoTipo } from "./tipos";
import { proventosRecebidos } from "./proventos";
import { compararDesde } from "./indices";

/** Limite de concentração por setor usado no app inteiro. */
export const LIMITE_SETOR = 0.3;

export type Posicao = Carteira & {
  a: Analise | null;
  valor: number; // quantidade x preço atual, em reais
  investido: number; // quantidade x preço médio, em reais (ativos em dólar pelo câmbio de hoje)
  moeda: "BRL" | "USD";
  cambio: number;
  rentabilidade: number | null;
  peso: number | null;
  renda12m: number | null; // dividendos dos últimos 12 meses x quantidade
  recebido: number; // proventos que você recebeu desde a compra (estimado), em reais
};

export async function carregarPainel() {
  const exec = await ultimaExecucao(); // também garante as colunas novas no banco
  const [rel] = await query<Relatorio>("select * from relatorio_diario order by data desc limit 1");
  const carteira = await query<Carteira & { desde: string }>("select ticker, quantidade, preco_medio, tipo, criado_em::date::text as desde from carteira order by ticker");
  const analises = rel ? await query<Analise>("select * from analises where data = $1", [rel.data]) : [];
  const porTicker = new Map(analises.map((a) => [a.ticker, a]));

  const base = carteira.map((c) => {
    const a = porTicker.get(c.ticker) ?? null;
    const preco = a?.preco ?? null;
    const moeda = a?.moeda ?? infoTipo(c.tipo)?.moeda ?? "BRL";
    const cambio = a?.cambio ?? 1;
    return {
      ...c,
      a,
      moeda,
      cambio,
      valor: (preco != null ? c.quantidade * preco : c.quantidade * c.preco_medio) * cambio,
      investido: c.quantidade * c.preco_medio * cambio,
      rentabilidade: preco != null && c.preco_medio > 0 ? preco / c.preco_medio - 1 : null,
      renda12m: a?.dpa_12m != null ? a.dpa_12m * c.quantidade * cambio : null,
    };
  });
  const patrimonio = base.reduce((s, p) => s + p.valor, 0);
  const recebidos = await proventosRecebidos(base.map((p) => ({ ticker: p.ticker, quantidade: p.quantidade, cambio: p.cambio, desde: p.desde })));
  const posicoes: Posicao[] = base.map((p) => ({
    ...p,
    peso: patrimonio > 0 ? p.valor / patrimonio : null,
    recebido: recebidos.porTicker.get(p.ticker)?.total ?? 0,
  }));
  const evolucao = await query<{ data: string; investido: number; patrimonio: number }>(
    "select data::text, investido, patrimonio from patrimonio_diario where data > current_date - 400 order by data",
  );

  const investido = posicoes.reduce((s, p) => s + p.investido, 0);
  const rent12 = rentabilidade12m(evolucao, patrimonio, investido, recebidos);
  // Mesma janela da rentabilidade: a foto mais antiga dos últimos 12 meses ou, sem fotos, a primeira compra
  const umAno = new Date();
  umAno.setFullYear(umAno.getFullYear() - 1);
  const primeira = carteira.map((c) => c.desde).sort()[0];
  const janela = rent12.desde ?? (primeira && primeira > umAno.toISOString().slice(0, 10) ? primeira : umAno.toISOString().slice(0, 10));
  const comparativo = await compararDesde(janela).catch(() => null);
  const renda12m = posicoes.reduce((s, p) => s + (p.renda12m ?? 0), 0);
  const comMargem = posicoes.filter((p) => p.a?.margem != null);
  const pesoMargem = comMargem.reduce((s, p) => s + p.valor, 0);

  const setores = new Map<string, number>();
  for (const p of posicoes) {
    const s = p.a?.setor ?? "Sem setor";
    setores.set(s, (setores.get(s) ?? 0) + p.valor);
  }

  const classes = new Map<string, number>();
  for (const p of posicoes) {
    const c = infoTipo(p.a?.tipo ?? p.tipo ?? "acao")?.nome ?? "Ações";
    classes.set(c, (classes.get(c) ?? 0) + p.valor);
  }

  return {
    exec,
    modo: await modoIa(),
    classes: [...classes.keys()]
      .map((nome) => ({ nome, valor: classes.get(nome) ?? 0, peso: patrimonio > 0 ? (classes.get(nome) ?? 0) / patrimonio : 0 }))
      .filter((c) => c.valor > 0)
      .sort((x, y) => y.valor - x.valor),
    rel: rel ?? null,
    analises,
    porTicker,
    posicoes,
    evolucao,
    comparativo,
    proventosPorMes: recebidos.porMes,
    resumo: {
      patrimonio,
      investido,
      lucro: patrimonio - investido, // ganho de capital
      rentabilidade: investido > 0 ? patrimonio / investido - 1 : null,
      proventosTotal: recebidos.total,
      proventos12m: recebidos.ultimos12m,
      lucroTotal: patrimonio - investido + recebidos.total,
      rentabilidadeTotal: investido > 0 ? (patrimonio + recebidos.total) / investido - 1 : null,
      rentabilidade12m: rent12,
      renda12m,
      dy: patrimonio > 0 ? renda12m / patrimonio : null,
      yieldOnCost: investido > 0 ? renda12m / investido : null,
      margemMedia: pesoMargem > 0 ? comMargem.reduce((s, p) => s + p.a!.margem! * p.valor, 0) / pesoMargem : null,
      variacaoDia:
        patrimonio > 0
          ? posicoes.reduce((s, p) => s + (p.a?.variacao_dia ?? 0) * p.valor, 0) / patrimonio
          : null,
    },
    setores: [...setores.entries()]
      .map(([nome, valor]) => ({ nome, valor, peso: patrimonio > 0 ? valor / patrimonio : 0 }))
      .sort((x, y) => y.valor - x.valor),
  };
}

export async function historicoDe(ticker: string) {
  return query<Pick<Analise, "data" | "preco" | "preco_teto" | "margem" | "nota_ia" | "score" | "recomendacao">>(
    `select data, preco, preco_teto, margem, nota_ia, score, recomendacao
       from analises where ticker = $1 order by data desc limit 120`,
    [ticker],
  );
}

/**
 * Rentabilidade dos últimos 12 meses (ou desde a primeira foto, se a carteira for mais nova):
 * compara o retorno total de hoje com o retorno total na foto mais antiga dentro da janela.
 */
function rentabilidade12m(
  evolucao: { data: string; investido: number; patrimonio: number }[],
  patrimonio: number,
  investido: number,
  recebidos: { total: number; ultimos12m: number },
): { valor: number | null; desde: string | null } {
  if (investido <= 0) return { valor: null, desde: null };
  const limite = new Date();
  limite.setFullYear(limite.getFullYear() - 1);
  const base = evolucao.find((e) => e.data >= limite.toISOString().slice(0, 10) && e.investido > 0);
  const agora = (patrimonio + recebidos.total) / investido;
  if (!base) return { valor: agora - 1, desde: null };
  const antes = (base.patrimonio + (recebidos.total - recebidos.ultimos12m)) / base.investido;
  return { valor: agora / antes - 1, desde: base.data };
}
