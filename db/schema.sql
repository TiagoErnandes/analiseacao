-- Criado automaticamente pelo container do Postgres na primeira subida (docker-entrypoint-initdb.d).

-- Sua carteira
create table if not exists carteira (
  ticker       text primary key,
  quantidade   numeric not null default 0,
  preco_medio  numeric not null default 0,
  criado_em    timestamptz not null default now()
);

-- Ações acompanhadas (as ~30 maiores do Ibovespa). Edite à vontade.
create table if not exists universo (
  ticker  text primary key,
  ativo   boolean not null default true
);

-- Uma linha por ação por dia
create table if not exists analises (
  id              bigserial primary key,
  data            date not null,
  ticker          text not null,
  nome            text,
  logo            text,
  preco           numeric,
  variacao_dia    numeric,
  lpa             numeric,           -- lucro por ação
  vpa             numeric,           -- valor patrimonial por ação
  dpa_12m         numeric,           -- dividendos por ação, últimos 12 meses
  dpa_medio       numeric,           -- média anual de dividendos (até 5 anos)
  dy_12m          numeric,           -- dividend yield 12m (fração, 0.08 = 8%)
  roe             numeric,
  teto_bazin      numeric,
  teto_graham     numeric,
  preco_teto      numeric,
  margem          numeric,           -- (teto - preço) / teto
  nota_ia         numeric,           -- 0 a 10
  recomendacao    text,              -- COMPRAR | AGUARDAR | EVITAR
  resumo_ia       text,
  riscos_ia       text,
  score           numeric,           -- nota final usada no ranking
  na_carteira     boolean not null default false,
  criado_em       timestamptz not null default now(),
  unique (data, ticker)
);
create index if not exists analises_data_idx on analises (data desc);

-- Resumo do dia e a "ação do dia"
create table if not exists relatorio_diario (
  data                    date primary key,
  contexto_mercado        text,
  acao_do_dia_carteira    text,
  justificativa_carteira  text,
  acao_do_dia_geral       text,
  justificativa_geral     text,
  criado_em               timestamptz not null default now()
);

-- Carteira inicial (da sua foto)
insert into carteira (ticker, quantidade, preco_medio) values
  ('BBDC4', 140, 15.71),
  ('BBAS3', 57, 17.46),
  ('SAPR4', 100, 6.75),
  ('AXIA3', 8, 49.40),
  ('PETR4', 6, 52.30),
  ('CMIG4', 25, 10.20),
  ('TAEE3', 16, 13.15),
  ('VIVT3', 3, 29.80)
on conflict (ticker) do nothing;

-- 30 maiores do Ibovespa (aproximado; ajuste se a composição mudar)
insert into universo (ticker) values
  ('VALE3'),('PETR4'),('ITUB4'),('BBDC4'),('BBAS3'),('SBSP3'),('B3SA3'),('ITSA4'),
  ('AXIA3'),('WEGE3'),('ABEV3'),('BPAC11'),('EQTL3'),('RENT3'),('SUZB3'),('RDOR3'),
  ('PRIO3'),('EMBJ3'),('RADL3'),('UGPA3'),('VBBR3'),('BBSE3'),('CMIG4'),('ENEV3'),
  ('GGBR4'),('CPLE3'),('RAIL3'),('TIMS3'),('VIVT3'),('TAEE11')
on conflict (ticker) do nothing;
