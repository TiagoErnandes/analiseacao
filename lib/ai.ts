// Análise com o Claude, pensada para custar pouco:
// - só os ativos que importam vão para a IA (sua carteira + os melhores de fora pelo cálculo);
// - modo "economico": Claude Haiku, uma chamada só, sem busca na web (centavos por análise);
// - modo "completo": Claude Sonnet com poucas buscas na web + decisão (a pesquisa do dia fica guardada e é reaproveitada);
// - modo "sem_ia": nenhuma chamada (o app decide só pelo cálculo).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

import type { ModoIa } from "./modos";
export type { ModoIa };

const CONFIG = {
  economico: { modelo: "claude-haiku-5-5", esforco: "low" as const, buscas: 0 },
  completo: { modelo: "claude-sonnet-5-5", esforco: "medium" as const, buscas: 5 },
};
// Preço por milhão de tokens (entrada, saída) em dólar, e por busca na web
const PRECO: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };
const PRECO_BUSCA = 10 / 1000;
/** Quantos ativos de fora da carteira vão para a IA (os de melhor score pelo cálculo). */
export const MAX_FORA_DA_CARTEIRA = 8;

/** Uma linha da tabela enviada à IA (números em R$ ou US$ conforme "moeda"; dy, margem, roe e pesos em fração). */
export type LinhaParaIa = { ticker: string; na_carteira: boolean; score_sem_ia: number; [campo: string]: unknown };

const SYSTEM = `Você é um analista de investimentos focado em previdência privada e buy and hold (ações, FIIs, ETFs, BDRs, ações e REITs americanos e cripto).
O investidor compra todo mês, reinveste dividendos e pensa em décadas. Ele valoriza empresas perenes, lucro consistente, dividendos estáveis,
comprar abaixo do preço teto e diversificação (nenhum setor acima de 30%).
O preço teto já vem calculado de forma conservadora: ações por Bazin (dividendo ÷ 6%) ou Graham; FIIs pelo menor entre rendimento, FFO e média de 5 anos ÷ 8%;
ETFs, BDRs, stocks e REITs por Bazin se pagam dividendos, senão pela média de 12 meses; cripto não tem teto (trate como parcela pequena e de alto risco).
"margem" > 0 significa abaixo do teto. "qualidade" (0 a 10) vem do balanço ou do histórico. "alertas" lista problemas já detectados; leve-os em conta.
Ativos em dólar têm "moeda" USD e "cambio" em reais por dólar.
Seja direto, em português do Brasil, e não invente números: use a tabela e, quando houver, a pesquisa.`;

const Acao = z.object({
  ticker: z.string(),
  nota: z.number().describe("0 a 10: qualidade do negócio + momento para compra de longo prazo"),
  recomendacao: z.enum(["COMPRAR", "AGUARDAR", "EVITAR"]),
  resumo: z.string().describe("1 a 2 frases citando os números decisivos"),
  riscos: z.string().describe("principal risco em 1 frase"),
});
const Decisao = z.object({
  contexto_mercado: z.string().describe("2 a 3 frases sobre o momento (use a pesquisa se houver; sem pesquisa, comente a tabela e não cite notícias)"),
  acoes: z.array(Acao).describe("uma entrada para CADA ticker da tabela"),
  acao_do_dia_carteira: z.string().describe("ticker da carteira mais indicado para aporte hoje"),
  justificativa_carteira: z.string(),
  acao_do_dia_geral: z.string().describe("ticker mais indicado hoje entre todos da tabela"),
  justificativa_geral: z.string(),
});
export type SaidaIa = z.infer<typeof Decisao> & { revisao: string | null };
export type CustoIa = { usd: number; modelo: string; entrada: number; saida: number; buscas: number };

function textoDe(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function somarCusto(custo: CustoIa, msg: Anthropic.Beta.BetaMessage) {
  const u = msg.usage;
  const [pe, ps] = PRECO[custo.modelo] ?? [2, 10];
  const entrada = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const buscas = u.server_tool_use?.web_search_requests ?? 0;
  custo.entrada += u.input_tokens ?? 0;
  custo.saida += u.output_tokens ?? 0;
  custo.buscas += buscas;
  custo.usd += (entrada * pe + (u.output_tokens ?? 0) * ps) / 1e6 + buscas * PRECO_BUSCA;
}

/**
 * Envia à IA só os ativos da carteira e os melhores de fora, com os campos essenciais.
 * `pesquisaGuardada`: pesquisa já feita hoje (modo completo), para não pagar de novo.
 */
export async function analisarComIa(
  linhas: LinhaParaIa[],
  hoje: string,
  modo: Exclude<ModoIa, "sem_ia">,
  pesquisaGuardada: string | null,
): Promise<{ saida: SaidaIa; custo: CustoIa; pesquisa: string | null }> {
  const cfg = CONFIG[modo];
  const client = new Anthropic({ timeout: 15 * 60 * 1000 });
  const custo: CustoIa = { usd: 0, modelo: cfg.modelo, entrada: 0, saida: 0, buscas: 0 };
  const fallback = cfg.modelo.startsWith("claude-sonnet")
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const selecao = [
    ...linhas.filter((l) => l.na_carteira),
    ...linhas.filter((l) => !l.na_carteira).sort((a, b) => b.score_sem_ia - a.score_sem_ia).slice(0, MAX_FORA_DA_CARTEIRA),
  ];
  const tabela = JSON.stringify(selecao);
  console.log(`  IA (${modo}, ${cfg.modelo}): ${selecao.length} ativos`);

  // 1) Pesquisa curta na web (só no modo completo e só uma vez por dia)
  let pesquisa = pesquisaGuardada;
  if (cfg.buscas > 0 && !pesquisa) {
    const foco = selecao.map((l) => l.ticker).join(", ");
    const msg = await client.beta.messages
      .stream({
        model: cfg.modelo,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: cfg.buscas, user_location: { type: "approximate", country: "BR" } }],
        ...fallback,
        messages: [
          {
            role: "user",
            content: `Hoje é ${hoje}. Use no máximo ${cfg.buscas} buscas, agrupando vários ativos por busca.
Procure: (1) Selic, Ibovespa e dólar hoje; (2) fatos relevantes, resultados e proventos anunciados nos últimos 30 dias para: ${foco}.
Responda em tópicos curtos, um por ticker com novidade (com data e fonte). Tickers sem novidade: não mencione.`,
          },
        ],
      })
      .finalMessage();
    somarCusto(custo, msg);
    if (msg.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa do dia.");
    pesquisa = textoDe(msg.content) || null;
  }

  // 2) Decisão com saída JSON validada
  const msg = await client.beta.messages
    .stream({
      model: cfg.modelo,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: cfg.esforco, format: betaZodOutputFormat(Decisao) },
      ...fallback,
      messages: [
        {
          role: "user",
          content: `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia.
Regras: prefira margem > 0, qualidade >= 6, sem alerta grave; na carteira, prefira quem está abaixo do peso ideal (falta_para_ideal > 0)
e de setor até 30%. Não recomende COMPRAR com prejuízo, payout insustentável ou dado claramente errado. Se nenhum atender, escolha o mais próximo e diga isso.

Tabela (ordenada pela nota do cálculo, score_sem_ia):
${tabela}
${pesquisa ? `\nPesquisa do dia:\n${pesquisa}` : "\n(Sem pesquisa na web hoje: decida só pelos números.)"}`,
        },
      ],
    })
    .finalMessage();
  somarCusto(custo, msg);
  if (msg.stop_reason === "refusal") throw new Error("A IA recusou a decisão.");
  if (msg.stop_reason === "max_tokens") throw new Error("A resposta da IA foi cortada (max_tokens).");
  let saida: z.infer<typeof Decisao>;
  try {
    saida = Decisao.parse(JSON.parse(textoDe(msg.content)));
  } catch (err) {
    throw new Error(`JSON inválido da IA: ${(err as Error).message}`.slice(0, 500));
  }
  console.log(`  IA: US$ ${custo.usd.toFixed(4)} (${custo.entrada} tokens de entrada, ${custo.saida} de saída, ${custo.buscas} buscas)`);
  return { saida: { ...saida, revisao: null }, custo, pesquisa };
}
