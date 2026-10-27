import { createClient } from "@supabase/supabase-js";

// Só use no servidor: a service role key ignora o RLS.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
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
