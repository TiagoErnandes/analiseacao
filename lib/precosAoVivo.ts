// Atualiza só os preços da análise do dia ao longo do pregão (sem refazer a análise nem chamar a IA).
// Roda no agendador: um pedido em lote ao Yahoo para todos os ativos, guardado no banco e visto por todos os usuários.
import { query } from "./db";
import { precosYahoo } from "./mercado";
import { simboloYahoo, type Tipo } from "./tipos";

let colunaCriada = false;
async function garantirColuna() {
  if (colunaCriada) return;
  await query("alter table analises add column if not exists preco_atualizado_em timestamptz");
  colunaCriada = true;
}

/**
 * Busca o preço de agora de todos os ativos da última análise e grava preço, variação do dia,
 * margem até o teto e dividend yield (que dependem do preço). Nota, teto e recomendação continuam os da análise.
 */
export async function atualizarPrecosDoDia(): Promise<number> {
  await garantirColuna();
  const linhas = await query<{ ticker: string; tipo: string }>(
    "select ticker, tipo from analises where data = (select max(data) from analises)",
  );
  if (!linhas.length) return 0;
  const simbolo = (l: { ticker: string; tipo: string }) => simboloYahoo(l.ticker, l.tipo as Tipo);
  const precos = await precosYahoo([...linhas.map(simbolo), "BRL=X"], 2);
  const dolar = precos.get("BRL=X")?.preco ?? null;

  const tickers: string[] = [];
  const valores: number[] = [];
  const variacoes: (number | null)[] = [];
  for (const l of linhas) {
    const p = precos.get(simbolo(l));
    if (p?.preco == null) continue;
    if (l.tipo === "cripto" && !dolar) continue; // cripto vem em dólar e é guardada em reais
    tickers.push(l.ticker);
    valores.push(l.tipo === "cripto" ? p.preco * dolar! : p.preco);
    variacoes.push(p.variacaoDia);
  }
  if (!tickers.length) return 0;
  await query(
    `update analises a set
        preco = n.preco,
        variacao_dia = n.variacao,
        margem = case when a.preco_teto > 0 then a.preco_teto / n.preco - 1 else a.margem end,
        dy_12m = case when a.dpa_12m > 0 then a.dpa_12m / n.preco else a.dy_12m end,
        preco_atualizado_em = now()
       from unnest($1::text[], $2::numeric[], $3::numeric[]) as n(ticker, preco, variacao)
      where a.data = (select max(data) from analises) and a.ticker = n.ticker and n.preco > 0`,
    [tickers, valores, variacoes],
  );
  // Ativos em dólar: o câmbio também anda
  if (dolar) {
    await query(
      `update analises set cambio = $1 where data = (select max(data) from analises) and tipo in ('stock', 'etf_int', 'reit')`,
      [dolar],
    );
  }
  return tickers.length;
}

/** Quando os preços mudaram pela última vez (atualização do pregão ou análise nova). O site usa para saber se recarrega. */
export async function versaoPrecos(): Promise<string | null> {
  await garantirColuna();
  const [r] = await query<{ em: Date | null }>(
    `select greatest(max(preco_atualizado_em), max(criado_em)) as em from analises where data = (select max(data) from analises)`,
  );
  return r?.em ? new Date(r.em).toISOString() : null;
}
