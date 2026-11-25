// Foto diária do ranking: os fatores da Nota de cada ação, por método de preço teto. Serve para a seta de posição
// (quantas posições a ação subiu ou caiu desde a análise anterior, com os mesmos filtros e o mesmo perfil) e para o
// placar do ranking (o top 10 da Nota bateu o Ibovespa?).
import { query, type Analise } from "./db";
import { fatoresNota, motivoForaDasBoas, type FatoresNota } from "./boaEmpresa";

/** O que fica guardado de cada ação: os fatores da Nota, a cotação do dia e se passou no filtro "Só boas empresas". */
export type Foto = FatoresNota & { preco: number | null; boa: boolean };

/** Por quanto tempo as fotos ficam (o placar olha até 12 meses para trás). */
const DIAS_GUARDADOS = 420;

export function fotoDe(a: Analise): Foto {
  return { ...fatoresNota(a), preco: a.preco, boa: !motivoForaDasBoas(a) };
}

/** Guarda a foto do dia uma vez por data e método (a primeira do dia vale). */
export async function salvarFotoRanking(data: string, metodo: string, linhas: Analise[]): Promise<void> {
  const [ja] = await query<{ ok: number }>("select 1 as ok from ranking_historico where data = $1 and metodo = $2 limit 1", [data, metodo]);
  if (ja || !linhas.length) return;
  const validas = linhas.filter((a) => a.preco != null && a.preco > 0);
  await query(
    `insert into ranking_historico (data, metodo, ticker, fatores)
     select $1::date, $2, t, f from unnest($3::text[], $4::jsonb[]) as x(t, f)
     on conflict do nothing`,
    [data, metodo, validas.map((a) => a.ticker), validas.map((a) => JSON.stringify(fotoDe(a)))],
  );
  await query("delete from ranking_historico where data < current_date - $1::int", [DIAS_GUARDADOS]);
}

/** A foto mais recente antes de `data` para o método (null: ainda não há). */
export async function fotoAnterior(data: string, metodo: string): Promise<{ data: string; fotos: Record<string, Foto> } | null> {
  const [d] = await query<{ data: string }>(
    "select max(data)::text as data from ranking_historico where data < $1 and metodo = $2",
    [data, metodo],
  );
  if (!d?.data) return null;
  const linhas = await query<{ ticker: string; fatores: Foto }>(
    "select ticker, fatores from ranking_historico where data = $1 and metodo = $2",
    [d.data, metodo],
  );
  return { data: d.data, fotos: Object.fromEntries(linhas.map((l) => [l.ticker, l.fatores])) };
}
