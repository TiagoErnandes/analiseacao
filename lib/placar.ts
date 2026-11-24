// Placar: as recomendações passadas deram certo? Compara o retorno (preço + proventos) de cada sinal com o Ibovespa
// no mesmo período, até hoje e depois de 3, 6 e 12 meses.
import { query } from "./db";

export const HORIZONTES = [0, 3, 6, 12] as const; // 0 = até hoje
export type Horizonte = (typeof HORIZONTES)[number];
export type Grupo = "acao_do_dia" | "comprar" | "evitar";

export type Resultado = { retorno: number; ibov: number | null; ate: string } | { pendente: string } | null;
export type Sinal = { grupo: Grupo; ticker: string; data: string; preco: number; resultados: Record<Horizonte, Resultado> };
export type Resumo = {
  grupo: Grupo;
  horizonte: Horizonte;
  avaliados: number;
  retornoMedio: number | null;
  ibovMedio: number | null;
  acertos: number; // COMPRAR/ação do dia: bateu o Ibovespa. EVITAR: ficou abaixo dele
  pendentes: number;
  proximoResultado: string | null;
};

const somarMeses = (iso: string, m: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};

/** Primeiro ponto em ou depois de `data` (até `folga` dias depois); ou o último antes, se `antes`. */
function pontoEm<T extends { data: string }>(serie: T[], data: string, modo: "depois" | "antes", folga = 20): T | null {
  if (modo === "antes") {
    for (let i = serie.length - 1; i >= 0; i--) if (serie[i].data <= data) return serie[i];
    return null;
  }
  const limite = new Date(Date.parse(data) + folga * 86_400_000).toISOString().slice(0, 10);
  return serie.find((p) => p.data >= data && p.data <= limite) ?? null;
}

export async function carregarPlacar(hoje = new Date().toISOString().slice(0, 10)): Promise<{ resumos: Resumo[]; sinais: Sinal[]; inicio: string | null }> {
  const [analises, relatorios, proventos, ibov] = await Promise.all([
    query<{ ticker: string; data: string; preco: number; recomendacao: string | null }>(
      "select ticker, data::text, preco, recomendacao from analises where preco > 0 order by data",
    ),
    query<{ data: string; ticker: string | null }>("select data::text, acao_do_dia_geral as ticker from relatorio_diario order by data"),
    query<{ ticker: string; data: string; valor: number }>("select ticker, data::text, valor from proventos order by data"),
    query<{ data: string; valor: number }>("select data::text, valor from indices where serie = 'ibov' order by data"),
  ]);
  const precos = new Map<string, { data: string; preco: number }[]>();
  for (const a of analises) precos.set(a.ticker, [...(precos.get(a.ticker) ?? []), { data: a.data, preco: a.preco }]);
  const provDe = new Map<string, { data: string; valor: number }[]>();
  for (const p of proventos) provDe.set(p.ticker, [...(provDe.get(p.ticker) ?? []), p]);

  // Um sinal por ativo e por mês (o primeiro), para não contar 20 vezes a mesma recomendação repetida todo dia
  const vistos = new Set<string>();
  const brutos: { grupo: Grupo; ticker: string; data: string }[] = [];
  const marcar = (grupo: Grupo, ticker: string, data: string) => {
    const k = `${grupo}|${ticker}|${data.slice(0, 7)}`;
    if (!vistos.has(k)) vistos.add(k), brutos.push({ grupo, ticker, data });
  };
  for (const r of relatorios) if (r.ticker) marcar("acao_do_dia", r.ticker.toUpperCase(), r.data);
  for (const a of analises) {
    if (a.recomendacao === "COMPRAR") marcar("comprar", a.ticker, a.data);
    else if (a.recomendacao === "EVITAR") marcar("evitar", a.ticker, a.data);
  }

  const sinais: Sinal[] = [];
  for (const b of brutos) {
    const serie = precos.get(b.ticker) ?? [];
    const inicio = pontoEm(serie, b.data, "depois", 0);
    if (!inicio) continue;
    const ibovIni = pontoEm(ibov, b.data, "antes");
    const resultados = {} as Record<Horizonte, Resultado>;
    for (const h of HORIZONTES) {
      const alvo = h === 0 ? null : somarMeses(b.data, h);
      if (alvo && alvo > hoje) {
        resultados[h] = { pendente: alvo };
        continue;
      }
      const fim = alvo ? pontoEm(serie, alvo, "depois") : serie[serie.length - 1];
      if (!fim || fim.data <= inicio.data) {
        resultados[h] = null;
        continue;
      }
      const prov = (provDe.get(b.ticker) ?? []).filter((p) => p.data > inicio.data && p.data <= fim.data).reduce((s, p) => s + p.valor, 0);
      const ibovFim = pontoEm(ibov, fim.data, "antes");
      resultados[h] = {
        retorno: (fim.preco + prov) / inicio.preco - 1,
        ibov: ibovIni && ibovFim && ibovFim.data > ibovIni.data ? ibovFim.valor / ibovIni.valor - 1 : null,
        ate: fim.data,
      };
    }
    sinais.push({ grupo: b.grupo, ticker: b.ticker, data: inicio.data, preco: inicio.preco, resultados });
  }

  const resumos: Resumo[] = [];
  for (const grupo of ["acao_do_dia", "comprar", "evitar"] as Grupo[]) {
    const doGrupo = sinais.filter((s) => s.grupo === grupo);
    for (const h of HORIZONTES) {
      const feitos = doGrupo.map((s) => s.resultados[h]).filter((r): r is { retorno: number; ibov: number | null; ate: string } => !!r && "retorno" in r);
      const pend = doGrupo.map((s) => s.resultados[h]).filter((r): r is { pendente: string } => !!r && "pendente" in r);
      const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
      const comIbov = feitos.filter((r) => r.ibov != null);
      resumos.push({
        grupo,
        horizonte: h,
        avaliados: feitos.length,
        retornoMedio: media(feitos.map((r) => r.retorno)),
        ibovMedio: media(comIbov.map((r) => r.ibov!)),
        acertos: comIbov.filter((r) => (grupo === "evitar" ? r.retorno < r.ibov! : r.retorno > r.ibov!)).length,
        pendentes: pend.length,
        proximoResultado: pend.map((p) => p.pendente).sort()[0] ?? null,
      });
    }
  }
  return { resumos, sinais: sinais.sort((a, b) => b.data.localeCompare(a.data)), inicio: analises[0]?.data ?? null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Placar do ranking: o top 10 da Nota (perfil Equilibrado, preço teto pela mediana, só boas empresas, uma classe por
// empresa) bateu o Ibovespa? Uma carteira por mês (a primeira foto do mês), com peso igual. O preço vem das fotos
// diárias do ranking (cotação de fechamento do dia); os proventos, quando a ação está na análise diária.

export const TOP_RANKING = 10;
export type CarteiraRanking = { data: string; tickers: string[]; resultados: Record<Horizonte, Resultado> };

export async function placarDoRanking(hoje = new Date().toISOString().slice(0, 10)): Promise<{ carteiras: CarteiraRanking[]; resumos: Omit<Resumo, "grupo">[]; inicio: string | null }> {
  const { notaDeFatores } = await import("./boaEmpresa");
  type Linha = { data: string; ticker: string; fatores: import("./rankingHistorico").Foto; empresa: number | null };
  const primeiras = await query<Linha>(
    `select h.data::text, h.ticker, h.fatores, t.cd_cvm as empresa
       from ranking_historico h left join tickers_cvm t on t.ticker = h.ticker
      where h.metodo = 'mediana'
        and h.data in (select min(data) from ranking_historico where metodo = 'mediana' group by date_trunc('month', data))`,
  );
  const porData = new Map<string, Linha[]>();
  for (const l of primeiras) porData.set(l.data, [...(porData.get(l.data) ?? []), l]);
  const tops: { data: string; tickers: string[] }[] = [];
  for (const [data, linhas] of [...porData].sort(([a], [b]) => a.localeCompare(b))) {
    const vistas = new Set<number>();
    const ordem = linhas
      .filter((l) => l.fatores.boa && l.fatores.preco)
      .map((l) => ({ ...l, nota: notaDeFatores(l.fatores)?.nota ?? null }))
      .filter((l) => l.nota != null)
      .sort((a, b) => b.nota! - a.nota!);
    const tickers: string[] = [];
    for (const l of ordem) {
      if (l.empresa != null) {
        if (vistas.has(l.empresa)) continue;
        vistas.add(l.empresa);
      }
      tickers.push(l.ticker);
      if (tickers.length === TOP_RANKING) break;
    }
    if (tickers.length) tops.push({ data, tickers });
  }
  const todos = [...new Set(tops.flatMap((t) => t.tickers))];
  const [precos, proventos, ibov] = todos.length
    ? await Promise.all([
        query<{ ticker: string; data: string; preco: number }>(
          "select ticker, data::text, (fatores->>'preco')::float8 as preco from ranking_historico where metodo = 'mediana' and ticker = any($1) order by data",
          [todos],
        ),
        query<{ ticker: string; data: string; valor: number }>("select ticker, data::text, valor from proventos where ticker = any($1) order by data", [todos]),
        query<{ data: string; valor: number }>("select data::text, valor from indices where serie = 'ibov' order by data"),
      ])
    : [[], [], []];
  const serieDe = new Map<string, { data: string; preco: number }[]>();
  for (const p of precos) if (p.preco > 0) serieDe.set(p.ticker, [...(serieDe.get(p.ticker) ?? []), p]);
  const provDe = new Map<string, { data: string; valor: number }[]>();
  for (const p of proventos) provDe.set(p.ticker, [...(provDe.get(p.ticker) ?? []), p]);

  const carteiras: CarteiraRanking[] = tops.map(({ data, tickers }) => {
    const resultados = {} as Record<Horizonte, Resultado>;
    const ultima = precos.length ? precos[precos.length - 1].data : data;
    for (const h of HORIZONTES) {
      const alvo = h === 0 ? ultima : somarMeses(data, h);
      if (h !== 0 && alvo > hoje) {
        resultados[h] = { pendente: alvo };
        continue;
      }
      // Peso igual: a média dos retornos das ações que têm cotação no começo e no fim
      const rets: number[] = [];
      let ate = data;
      for (const t of tickers) {
        const serie = serieDe.get(t) ?? [];
        const ini = pontoEm(serie, data, "depois", 0);
        const fim = h === 0 ? serie[serie.length - 1] : pontoEm(serie, alvo, "depois");
        if (!ini || !fim || fim.data <= ini.data) continue;
        const prov = (provDe.get(t) ?? []).filter((p) => p.data > ini.data && p.data <= fim.data).reduce((s, p) => s + p.valor, 0);
        rets.push((fim.preco + prov) / ini.preco - 1);
        if (fim.data > ate) ate = fim.data;
      }
      if (!rets.length) {
        resultados[h] = null;
        continue;
      }
      const ibovIni = pontoEm(ibov, data, "antes");
      const ibovFim = pontoEm(ibov, ate, "antes");
      resultados[h] = {
        retorno: rets.reduce((s, r) => s + r, 0) / rets.length,
        ibov: ibovIni && ibovFim && ibovFim.data > ibovIni.data ? ibovFim.valor / ibovIni.valor - 1 : null,
        ate,
      };
    }
    return { data, tickers, resultados };
  });

  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const resumos = HORIZONTES.map((h) => {
    const feitos = carteiras.map((c) => c.resultados[h]).filter((r): r is { retorno: number; ibov: number | null; ate: string } => !!r && "retorno" in r);
    const pend = carteiras.map((c) => c.resultados[h]).filter((r): r is { pendente: string } => !!r && "pendente" in r);
    const comIbov = feitos.filter((r) => r.ibov != null);
    return {
      horizonte: h,
      avaliados: feitos.length,
      retornoMedio: media(feitos.map((r) => r.retorno)),
      ibovMedio: media(comIbov.map((r) => r.ibov!)),
      acertos: comIbov.filter((r) => r.retorno > r.ibov!).length,
      pendentes: pend.length,
      proximoResultado: pend.map((p) => p.pendente).sort()[0] ?? null,
    };
  });
  return { carteiras: carteiras.reverse(), resumos, inicio: tops[0]?.data ?? null };
}
