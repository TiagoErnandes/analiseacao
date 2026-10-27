// Proventos recebidos: para cada dividendo pago (data com), quantas cotas você tinha naquele dia.
// A quantidade vem das compras e vendas lançadas; o que não tem lançamento (cadastro à mão ou importação)
// conta a partir da data em que o ativo entrou na carteira.
import { query } from "./db";

type Op = { ticker: string; data: string; tipo: "C" | "V"; quantidade: number };

export type ProventosRecebidos = {
  total: number; // em reais
  ultimos12m: number;
  porTicker: Map<string, { total: number; ultimos12m: number }>;
  porMes: { mes: string; valor: number; itens: { ticker: string; valor: number }[] }[]; // últimos 12 meses, "AAAA-MM" pela data com
};

export async function proventosRecebidos(
  posicoes: { ticker: string; quantidade: number; cambio: number; desde: string }[],
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
  const [ops, divs] = await Promise.all([
    query<Op>("select ticker, data::text, tipo, quantidade from operacoes where ticker = any($1) order by data, id", [tickers]),
    query<{ ticker: string; data: string; valor: number }>(
      "select ticker, data::text, valor from proventos where ticker = any($1) order by data",
      [tickers],
    ),
  ]);
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
      // Tem direito quem tinha a cota antes da data com
      const qtd = lotes.filter((l) => l.data < d.data).reduce((s, l) => s + l.qtd, 0);
      if (qtd <= 0) continue;
      const v = qtd * d.valor * p.cambio;
      t += v;
      if (d.data >= limite12m) t12 += v;
      const m = porMes.find((x) => x.mes === d.data.slice(0, 7));
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
