// Proventos recebidos: para cada dividendo pago (data com), quantas cotas você tinha naquele dia.
// A quantidade vem das compras e vendas lançadas; o que não tem lançamento (cadastro à mão ou importação)
// conta a partir da data em que o ativo entrou na carteira.
// O valor é o líquido: JCP tem IR retido na fonte (15% até 2025, 17,5% a partir de 2026); dividendos são isentos.
import { CLASSE } from "./cvm";
import { query } from "./db";

/** Feriados em que a B3 não abre (nacionais, Carnaval, Sexta-feira Santa, Corpus Christi, 24/12 e 31/12). */
function feriadosB3(ano: number): Set<string> {
  // Páscoa (algoritmo de Meeus/Butcher)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const pascoa = Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  const desloc = (dias: number) => new Date(pascoa + dias * 86_400_000).toISOString().slice(0, 10);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-24", "12-25", "12-31"];
  return new Set([...fixos.map((x) => `${ano}-${x}`), desloc(-48), desloc(-47), desloc(-2), desloc(60)]);
}

/** Data com: o último pregão antes da data ex (a data que o histórico de cotações traz). */
export function dataComDaEx(dataEx: string): string {
  let t = Date.parse(`${dataEx}T00:00:00Z`);
  for (;;) {
    t -= 86_400_000;
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !feriadosB3(d.getUTCFullYear()).has(iso)) return iso;
  }
}

/** IR retido no JCP pela data com. */
export function aliquotaJcp(dataCom: string): number {
  return dataCom >= "2026-01-01" ? 0.175 : 0.15;
}

const ehJcp = (tipo: string) => /JRS|JUROS|JCP/i.test(tipo);

type Op = { ticker: string; data: string; tipo: "C" | "V"; quantidade: number };

export type ProventosRecebidos = {
  total: number; // em reais
  ultimos12m: number;
  porTicker: Map<string, { total: number; ultimos12m: number }>;
  porMes: { mes: string; valor: number; itens: { ticker: string; valor: number }[] }[]; // últimos 12 meses, "AAAA-MM" pela data com
};

export async function proventosRecebidos(
  posicoes: { ticker: string; quantidade: number; cambio: number; desde: string }[],
  usuarioId: number | null,
  hoje = new Date(),
): Promise<ProventosRecebidos> {
  const porTicker = new Map<string, { total: number; ultimos12m: number }>();
  const meses: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  const porMes = meses.map((mes) => ({ mes, valor: 0, itens: [] as { ticker: string; valor: number }[] }));
  if (posicoes.length === 0) return { total: 0, ultimos12m: 0, porTicker, porMes };
  const tickers = posicoes.map((p) => p.ticker);
  const emissores = [...new Set(tickers.map((t) => `b3:${t.slice(0, 4).toUpperCase()}`))];
  const [ops, divs, b3] = await Promise.all([
    query<Op>("select ticker, data::text, tipo, quantidade from operacoes where ticker = any($1) and usuario_id is not distinct from $2 order by data, id",
      [tickers, usuarioId],),
    query<{ ticker: string; data: string; valor: number }>(
      "select ticker, data::text, valor from proventos where ticker = any($1) order by data",
      [tickers],
    ),
    // Proventos anunciados na B3 (guardados pela análise): dizem o que é JCP e o que é dividendo
    query<{ chave: string; dados: { proventos?: { isin?: string; tipo: string; valor: number | null; dataCom: string | null }[] } }>(
      "select chave, dados from cache_fontes where chave = any($1)",
      [emissores],
    ).catch(() => []),
  ]);
  const anunciados = new Map(b3.map((c) => [c.chave.slice(3), c.dados?.proventos ?? []]));
  // Parte do provento que fica com você depois do IR (1 = isento)
  const fatorLiquido = (ticker: string, dataCom: string) => {
    const classe = ticker.slice(4);
    const doDia = (anunciados.get(ticker.slice(0, 4).toUpperCase()) ?? []).filter(
      (x) => x.dataCom === dataCom && (x.valor ?? 0) > 0 && (!x.isin || !CLASSE[classe] || CLASSE[classe].some((k) => x.isin!.slice(6, 11) === k)),
    );
    const soma = doDia.reduce((s, x) => s + (x.valor ?? 0), 0);
    if (soma <= 0) return 1;
    const jcp = doDia.filter((x) => ehJcp(x.tipo)).reduce((s, x) => s + (x.valor ?? 0), 0);
    return 1 - (jcp / soma) * aliquotaJcp(dataCom);
  };
  const umAno = new Date(hoje);
  umAno.setFullYear(hoje.getFullYear() - 1);
  const limite12m = umAno.toISOString().slice(0, 10);
  const hojeIso = hoje.toISOString().slice(0, 10);

  let total = 0;
  let ultimos12m = 0;
  for (const p of posicoes) {
    const minhas = ops.filter((o) => o.ticker === p.ticker);
    const liquido = minhas.reduce((s, o) => s + (o.tipo === "C" ? o.quantidade : -o.quantidade), 0);
    // A diferença entre a posição e os lançamentos entra como um lote inicial
    const lotes = [...minhas.map((o) => ({ data: o.data, qtd: o.tipo === "C" ? o.quantidade : -o.quantidade }))];
    if (p.quantidade - liquido > 0) lotes.push({ data: p.desde, qtd: p.quantidade - liquido });
    let t = 0;
    let t12 = 0;
    for (const d of divs) {
      if (d.ticker !== p.ticker || d.data > hojeIso) continue;
      // d.data é a data ex: tem direito quem tinha a cota antes dela (até a data com)
      const qtd = lotes.filter((l) => l.data < d.data).reduce((s, l) => s + l.qtd, 0);
      if (qtd <= 0) continue;
      const dataCom = dataComDaEx(d.data);
      const v = qtd * d.valor * p.cambio * (p.cambio === 1 ? fatorLiquido(p.ticker, dataCom) : 1);
      t += v;
      if (dataCom >= limite12m) t12 += v;
      const m = porMes.find((x) => x.mes === dataCom.slice(0, 7));
      if (m) {
        m.valor += v;
        const it = m.itens.find((i) => i.ticker === p.ticker);
        if (it) it.valor += v;
        else m.itens.push({ ticker: p.ticker, valor: v });
      }
    }
    porTicker.set(p.ticker, { total: t, ultimos12m: t12 });
    total += t;
    ultimos12m += t12;
  }
  for (const m of porMes) m.itens.sort((a, b) => b.valor - a.valor);
  return { total, ultimos12m, porTicker, porMes };
}
