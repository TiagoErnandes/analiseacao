import { Pool, types } from "pg";
import type { Tipo } from "./tipos";

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

export type Carteira = { ticker: string; quantidade: number; preco_medio: number; tipo: Tipo | null };

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
  garimpo?: boolean; // achado pelo garimpo automático (fora da carteira e da lista)
  qualidade: number | null; // 0 a 10, só balanço
  setor: string | null;
  alertas: string | null; // problemas de dados e de qualidade, separados por "; "
  tipo: Tipo;
  moeda: "BRL" | "USD"; // moeda de preco, tetos e dividendos
  cambio: number; // reais por unidade da moeda no dia
  indicadores: Record<string, unknown> | null; // extras de cada tipo (balanço da ação, dados do FII, histórico do ETF)
};

export type Relatorio = {
  data: string;
  contexto_mercado: string | null;
  acao_do_dia_carteira: string | null;
  justificativa_carteira: string | null;
  acao_do_dia_geral: string | null;
  justificativa_geral: string | null;
  revisao: string | null; // o que a revisão final da IA mudou ou confirmou
  pesquisa?: string | null; // pesquisa na web do dia (modo completo), reaproveitada se rodar de novo
};

const COLUNAS_ANALISE = [
  "data", "ticker", "nome", "logo", "preco", "variacao_dia", "lpa", "vpa", "dpa_12m", "dpa_medio", "dy_12m", "roe",
  "teto_bazin", "teto_graham", "preco_teto", "margem", "nota_ia", "recomendacao", "resumo_ia", "riscos_ia", "score",
  "na_carteira", "garimpo", "qualidade", "setor", "alertas", "tipo", "indicadores", "moeda", "cambio",
] as const satisfies readonly (keyof Analise)[];

export async function salvarAnalises(linhas: Analise[]) {
  const client = await pool().connect();
  try {
    await client.query("begin");
    // Rodou de novo no mesmo dia: tira os ativos que saíram (ex.: garimpo que não passa mais nos filtros)
    for (const data of new Set(linhas.map((l) => l.data))) {
      await client.query("delete from analises where data = $1 and not (ticker = any($2::text[]))", [
        data,
        linhas.filter((l) => l.data === data).map((l) => l.ticker),
      ]);
    }
    const cols = COLUNAS_ANALISE.join(", ");
    const marcadores = COLUNAS_ANALISE.map((_, i) => `$${i + 1}`).join(", ");
    const update = COLUNAS_ANALISE.filter((c) => c !== "data" && c !== "ticker")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    for (const l of linhas) {
      await client.query(
        `insert into analises (${cols}) values (${marcadores}) on conflict (data, ticker) do update set ${update}`,
        COLUNAS_ANALISE.map((c) => (c === "garimpo" ? !!l.garimpo : l[c])),
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
    `insert into relatorio_diario (data, contexto_mercado, acao_do_dia_carteira, justificativa_carteira, acao_do_dia_geral, justificativa_geral, revisao, pesquisa)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (data) do update set contexto_mercado = excluded.contexto_mercado,
       acao_do_dia_carteira = excluded.acao_do_dia_carteira, justificativa_carteira = excluded.justificativa_carteira,
       acao_do_dia_geral = excluded.acao_do_dia_geral, justificativa_geral = excluded.justificativa_geral,
       revisao = excluded.revisao, pesquisa = coalesce(excluded.pesquisa, relatorio_diario.pesquisa)`,
    [r.data, r.contexto_mercado, r.acao_do_dia_carteira, r.justificativa_carteira, r.acao_do_dia_geral, r.justificativa_geral, r.revisao, r.pesquisa ?? null],
  );
}

/** Dono do site (quem tem a carteira original). Sem dono ainda: null, que é o "usuario_id" da carteira original. */
export async function idDoDono(): Promise<number | null> {
  await migrar();
  const [d] = await query<{ id: number }>("select id from usuarios where admin order by id limit 1");
  return d?.id ?? null;
}

let migrado = false;
/** Cria tabelas e colunas novas em bancos que já existiam antes delas (roda uma vez por processo). */
export async function migrar() {
  if (migrado) return;
  await query(`
    create table if not exists execucoes (
      id      bigserial primary key,
      origem  text not null,
      status  text not null,
      inicio  timestamptz not null default now(),
      fim     timestamptz,
      erro    text
    );
    alter table analises add column if not exists qualidade numeric;
    alter table analises add column if not exists setor text;
    alter table analises add column if not exists alertas text;
    alter table relatorio_diario add column if not exists revisao text;
    alter table analises add column if not exists tipo text not null default 'acao';
    alter table analises add column if not exists indicadores jsonb;
    create table if not exists operacoes (
      id          bigserial primary key,
      data        date not null default current_date,
      ticker      text not null,
      tipo        text not null check (tipo in ('C', 'V')),
      quantidade  numeric not null check (quantidade > 0),
      preco       numeric not null check (preco >= 0),
      criado_em   timestamptz not null default now()
    );
    alter table analises add column if not exists moeda text not null default 'BRL';
    alter table analises add column if not exists cambio numeric not null default 1;
    alter table carteira add column if not exists tipo text; -- vazio: detecta sozinho (ação, FII ou ETF da B3)
    alter table operacoes add column if not exists custos numeric not null default 0;
    alter table operacoes add column if not exists tipo_ativo text;
    -- Dividendos/JCP/rendimentos por ativo (Yahoo), para calcular os proventos recebidos
    create table if not exists proventos (
      ticker  text not null,
      data    date not null,
      valor   numeric not null,
      primary key (ticker, data)
    );
    -- Uma foto da carteira por dia de análise, para o gráfico de evolução do patrimônio
    create table if not exists patrimonio_diario (
      data        date primary key,
      investido   numeric not null,
      patrimonio  numeric not null,
      proventos   numeric not null default 0
    );
    -- CDI e IPCA (Banco Central) e Ibovespa, para comparar a carteira
    create table if not exists indices (
      serie  text not null,
      data   date not null,
      valor  numeric not null,
      primary key (serie, data)
    );
    -- Custo da IA por análise e configurações do app (modo da IA)
    alter table execucoes add column if not exists custo_usd numeric;
    alter table execucoes add column if not exists modelo text;
    alter table execucoes add column if not exists dolar numeric;
    alter table relatorio_diario add column if not exists pesquisa text;
    create table if not exists config (chave text primary key, valor text not null);
    -- Dados das fontes guardados (balanço, histórico) e notas da IA reaproveitadas quando nada mudou
    create table if not exists cache_fontes (chave text primary key, dados jsonb not null, buscado_em timestamptz not null default now());
    create table if not exists cache_ia (
      ticker      text primary key,
      assinatura  text not null,
      nota        numeric,
      recomendacao text,
      resumo      text,
      riscos      text,
      modelo      text,
      analisado_em timestamptz not null default now()
    );
    alter table execucoes add column if not exists economia_usd numeric;
    -- Sinal de vida da análise (a cada 30s) e etapa atual: uma execução sem sinal há minutos foi interrompida
    alter table execucoes add column if not exists batida timestamptz;
    alter table execucoes add column if not exists etapa text;
    -- Documentos oficiais da CVM (fatos relevantes, comunicados, avisos) e lucro anual dos balanços (DFP)
    create table if not exists cvm_documentos (
      protocolo text primary key,
      cd_cvm    int not null,
      data      date not null,
      categoria text not null,
      tipo      text,
      assunto   text,
      link      text
    );
    -- Modo grátis com o Gemini vira o padrão (uma vez; depois vale o que você escolher no painel)
    alter table analises add column if not exists garimpo boolean not null default false;
    -- Margem passou a ser o potencial até o teto (teto / preço - 1): recalcula o histórico uma vez
    with marca as (insert into config (chave, valor) values ('margem_potencial_aplicada', '1') on conflict (chave) do nothing returning 1)
    update analises set margem = preco_teto / preco - 1 where preco > 0 and preco_teto > 0 and exists (select 1 from marca);
    with marca as (insert into config (chave, valor) values ('modo_gratis_aplicado', '1') on conflict (chave) do nothing returning 1)
    insert into config (chave, valor) select 'modo_ia', 'gratis' from marca
    on conflict (chave) do update set valor = excluded.valor;
    create index if not exists cvm_documentos_cd on cvm_documentos (cd_cvm, data desc);
    create table if not exists lucros_anuais (
      cd_cvm int not null,
      ano    int not null,
      lucro  numeric not null, -- em reais
      primary key (cd_cvm, ano)
    );
    -- FIIs e ETFs mais negociados entram no universo analisado (uma vez; não volta se você desativar)
    insert into universo (ticker) values
      ('HGLG11'),('KNRI11'),('XPML11'),('BTLG11'),('VISC11'),('KNCR11'),('MXRF11'),('HGRU11'),('XPLG11'),('CPTS11'),
      ('BOVA11'),('IVVB11'),('DIVO11'),('SMAL11')
    on conflict (ticker) do nothing;
    -- Login com o Google: cada usuário tem a sua carteira. usuario_id vazio = carteira original, até o dono entrar.
    create table if not exists usuarios (
      id            serial primary key,
      google_sub    text not null unique,
      email         text not null,
      nome          text,
      foto          text,
      admin         boolean not null default false,
      criado_em     timestamptz not null default now(),
      ultimo_acesso timestamptz
    );
    create table if not exists sessoes (
      token_hash  text primary key,
      usuario_id  int not null references usuarios (id) on delete cascade,
      criado_em   timestamptz not null default now(),
      expira_em   timestamptz not null
    );
    alter table carteira add column if not exists usuario_id int references usuarios (id) on delete cascade;
    alter table carteira drop constraint if exists carteira_pkey;
    create unique index if not exists carteira_usuario_ticker on carteira (usuario_id, ticker) nulls not distinct;
    alter table operacoes add column if not exists usuario_id int references usuarios (id) on delete cascade;
    create index if not exists operacoes_usuario on operacoes (usuario_id, data desc);
    alter table patrimonio_diario add column if not exists usuario_id int references usuarios (id) on delete cascade;
    alter table patrimonio_diario drop constraint if exists patrimonio_diario_pkey;
    create unique index if not exists patrimonio_usuario_data on patrimonio_diario (usuario_id, data) nulls not distinct;
    create table if not exists config_usuario (
      usuario_id  int references usuarios (id) on delete cascade,
      chave       text not null,
      valor       text not null
    );
    create unique index if not exists config_usuario_chave on config_usuario (usuario_id, chave) nulls not distinct;
    -- A estratégia e o início da carteira passam a ser de cada usuário (uma vez: os atuais ficam com a carteira original)
    with marca as (insert into config (chave, valor) values ('config_usuario_migrada', '1') on conflict (chave) do nothing returning 1)
    insert into config_usuario (usuario_id, chave, valor)
    select null, chave, valor from config where chave in ('estrategia', 'inicio_carteira') and exists (select 1 from marca)
    on conflict do nothing;
  `);
  migrado = true;
}
