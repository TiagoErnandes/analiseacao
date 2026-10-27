// Dados que as páginas do site usam: última análise, carteira e posições já calculadas.
import { ultimaExecucao } from "./analise";
import { query, type Analise, type Carteira, type Relatorio } from "./db";

/** Limite de concentração por setor usado no app inteiro. */
export const LIMITE_SETOR = 0.3;

export type Posicao = Carteira & {
  a: Analise | null;
  valor: number; // quantidade x preço atual
  investido: number; // quantidade x preço médio
  rentabilidade: number | null;
  peso: number | null;
  renda12m: number | null; // dividendos dos últimos 12 meses x quantidade
};

export async function carregarPainel() {
  const exec = await ultimaExecucao(); // também garante as colunas novas no banco
  const [rel] = await query<Relatorio>("select * from relatorio_diario order by data desc limit 1");
  const carteira = await query<Carteira>("select ticker, quantidade, preco_medio from carteira order by ticker");
  const analises = rel ? await query<Analise>("select * from analises where data = $1", [rel.data]) : [];
  const porTicker = new Map(analises.map((a) => [a.ticker, a]));

  const base = carteira.map((c) => {
    const a = porTicker.get(c.ticker) ?? null;
    const preco = a?.preco ?? null;
    return {
      ...c,
      a,
      valor: preco != null ? c.quantidade * preco : c.quantidade * c.preco_medio,
      investido: c.quantidade * c.preco_medio,
      rentabilidade: preco != null && c.preco_medio > 0 ? preco / c.preco_medio - 1 : null,
      renda12m: a?.dpa_12m != null ? a.dpa_12m * c.quantidade : null,
    };
  });
  const patrimonio = base.reduce((s, p) => s + p.valor, 0);
  const posicoes: Posicao[] = base.map((p) => ({ ...p, peso: patrimonio > 0 ? p.valor / patrimonio : null }));

  const investido = posicoes.reduce((s, p) => s + p.investido, 0);
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
    const c = p.a?.tipo === "fii" ? "FIIs" : p.a?.tipo === "etf" ? "ETFs" : "Ações";
    classes.set(c, (classes.get(c) ?? 0) + p.valor);
  }

  return {
    exec,
    classes: ["Ações", "FIIs", "ETFs"]
      .map((nome) => ({ nome, valor: classes.get(nome) ?? 0, peso: patrimonio > 0 ? (classes.get(nome) ?? 0) / patrimonio : 0 }))
      .filter((c) => c.valor > 0),
    rel: rel ?? null,
    analises,
    porTicker,
    posicoes,
    resumo: {
      patrimonio,
      investido,
      lucro: patrimonio - investido,
      rentabilidade: investido > 0 ? patrimonio / investido - 1 : null,
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
