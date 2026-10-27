import { Pool, types } from "pg";

// NUMERIC vem como texto no driver; aqui vira número. DATE fica como texto "AAAA-MM-DD".
types.setTypeParser(1700, (v) => (v == null ? null : Number.parseFloat(v)));
types.setTypeParser(1082, (v) => v);

const globalPool = globalThis as unknown as { __pool?: Pool };

export function pool(): Pool {
  if (!globalPool.__pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Defina DATABASE_URL (ex.: postgres://usuario:senha@postgres:5432/analiseacao)");
    globalPool.__pool = new Pool({ connectionString: url, max: 5 });
  }
  return globalPool.__pool;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(sql, params);
  return res.rows as T[];
}

export type Carteira = { ticker: string; quantidade: number; preco_medio: number };

export type Analise = {
  data: string;
  ticker: string;
  nome: string | null;
  logo: string | null;
  preco: number | null;
  variacao_dia: number | null;
  lpa: number | null;
  vpa: number | null;
  dpa_12m: number | null;
  dpa_medio: number | null;
  dy_12m: number | null;
  roe: number | null;
  teto_bazin: number | null;
  teto_graham: number | null;
  preco_teto: number | null;
  margem: number | null;
  nota_ia: number | null;
  recomendacao: string | null;
  resumo_ia: string | null;
  riscos_ia: string | null;
  score: number | null;
  na_carteira: boolean;
};

export type Relatorio = {
  data: string;
  contexto_mercado: string | null;
  acao_do_dia_carteira: string | null;
  justificativa_carteira: string | null;
  acao_do_dia_geral: string | null;
  justificativa_geral: string | null;
};

const COLUNAS_ANALISE = [
  "data", "ticker", "nome", "logo", "preco", "variacao_dia", "lpa", "vpa", "dpa_12m", "dpa_medio", "dy_12m", "roe",
  "teto_bazin", "teto_graham", "preco_teto", "margem", "nota_ia", "recomendacao", "resumo_ia", "riscos_ia", "score",
  "na_carteira",
] as const satisfies readonly (keyof Analise)[];

export async function salvarAnalises(linhas: Analise[]) {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const cols = COLUNAS_ANALISE.join(", ");
    const marcadores = COLUNAS_ANALISE.map((_, i) => `$${i + 1}`).join(", ");
    const update = COLUNAS_ANALISE.filter((c) => c !== "data" && c !== "ticker")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    for (const l of linhas) {
      await client.query(
        `insert into analises (${cols}) values (${marcadores}) on conflict (data, ticker) do update set ${update}`,
        COLUNAS_ANALISE.map((c) => l[c]),
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function salvarRelatorio(r: Relatorio) {
  await query(
    `insert into relatorio_diario (data, contexto_mercado, acao_do_dia_carteira, justificativa_carteira, acao_do_dia_geral, justificativa_geral)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (data) do update set contexto_mercado = excluded.contexto_mercado,
       acao_do_dia_carteira = excluded.acao_do_dia_carteira, justificativa_carteira = excluded.justificativa_carteira,
       acao_do_dia_geral = excluded.acao_do_dia_geral, justificativa_geral = excluded.justificativa_geral`,
    [r.data, r.contexto_mercado, r.acao_do_dia_carteira, r.justificativa_carteira, r.acao_do_dia_geral, r.justificativa_geral],
  );
}
