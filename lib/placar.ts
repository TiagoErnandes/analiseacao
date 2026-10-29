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
