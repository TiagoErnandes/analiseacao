// Análise com o Claude, pensada para custar pouco:
// - só os ativos que importam e que MUDARAM vão para a IA (os outros reaproveitam a nota anterior, ver lib/analise.ts);
// - modo "economico": Claude Haiku, uma chamada só, sem busca na web (centavos por análise);
// - modo "completo": pesquisa na web com o Haiku (barato para ler resultados de busca) e decisão final com o Sonnet;
// - análise automática (agendador): pela Batch API, que cobra metade do preço dos tokens;
// - modo "sem_ia": nenhuma chamada (o app decide só pelo cálculo).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

import type { Estrategia, ModoIa } from "./modos";
export type { ModoIa };

const CONFIG = {
  economico: { modelo: "claude-haiku-5-5", esforco: "low" as const, buscas: 0 },
  completo: { modelo: "claude-sonnet-5-5", esforco: "medium" as const, buscas: 5 },
};
/** Modelo da pesquisa na web (lê muitos tokens de resultados de busca: o Haiku custa 20x menos que o Sonnet). */
const MODELO_PESQUISA = "claude-haiku-5-5";
/** Quanto esperar a Batch API antes de desistir e chamar do jeito normal. */
const ESPERA_LOTE_MIN = 60;
// Preço por milhão de tokens (entrada, saída) em dólar, e por busca na web
const PRECO: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };
const PRECO_BUSCA = 10 / 1000;
/** O que a IA deve priorizar em cada estratégia da carteira. */
const REGRAS: Record<Estrategia, string> = {
  oportunidade: `Estratégia OPORTUNIDADE (carteira no começo): priorize as melhores oportunidades de preço com qualidade: maior margem até o teto,
qualidade >= 6, sem alerta grave. NÃO dê preferência a quem está abaixo do peso ideal e não segure uma compra boa só para balancear setores;
evite apenas setor acima de 50% da carteira. Considere quedas de preço por ruído político ou macro do Brasil em empresas sólidas como chance de compra.`,
  balanceamento: `Estratégia BALANCEAMENTO: prefira margem > 0, qualidade >= 6, sem alerta grave; na carteira, prefira quem está abaixo do peso ideal
(falta_para_ideal > 0) e de setor até 30%.`,
};

/** Quantos ativos de fora da carteira vão para a IA (os de melhor score pelo cálculo). */
export const MAX_FORA_DA_CARTEIRA = 8;

/** Os ativos que interessam à IA: toda a carteira + os melhores de fora pelo cálculo. */
export function selecionarParaIa<T extends LinhaParaIa>(linhas: T[]): T[] {
  return [
    ...linhas.filter((l) => l.na_carteira),
    ...linhas.filter((l) => !l.na_carteira).sort((a, b) => b.score_sem_ia - a.score_sem_ia).slice(0, MAX_FORA_DA_CARTEIRA),
  ];
}

/** Nota já dada pela IA a um ativo que não mudou (vai como referência, sem pedir nova análise). */
export type NotaReaproveitada = { ticker: string; na_carteira: boolean; nota: number | null; recomendacao: string | null; score_sem_ia: number; margem: unknown };

/** Uma linha da tabela enviada à IA (números em R$ ou US$ conforme "moeda"; dy, margem, roe e pesos em fração). */
export type LinhaParaIa = { ticker: string; na_carteira: boolean; score_sem_ia: number; [campo: string]: unknown };

const SYSTEM = `Você é um analista de investimentos focado em previdência privada e buy and hold (ações, FIIs, ETFs, BDRs, ações e REITs americanos e cripto).
O investidor compra todo mês, reinveste dividendos e pensa em décadas. Ele valoriza empresas perenes, lucro consistente, dividendos estáveis,
comprar abaixo do preço teto e diversificação ao longo do tempo.
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
export type CustoIa = { usd: number; modelo: string; entrada: number; saida: number; buscas: number; lote: boolean };

function textoDe(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function somarCusto(custo: CustoIa, msg: Anthropic.Beta.BetaMessage, modelo: string, lote: boolean) {
  const u = msg.usage;
  const [pe, ps] = PRECO[modelo] ?? [2, 10];
  const desconto = lote ? 0.5 : 1; // Batch API: metade do preço dos tokens (a busca na web é cobrada igual)
  const entrada = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const buscas = u.server_tool_use?.web_search_requests ?? 0;
  custo.entrada += u.input_tokens ?? 0;
  custo.saida += u.output_tokens ?? 0;
  custo.buscas += buscas;
  custo.usd += ((entrada * pe + (u.output_tokens ?? 0) * ps) / 1e6) * desconto + buscas * PRECO_BUSCA;
}

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/**
 * Faz uma chamada. Com `lote`, vai pela Batch API (50% mais barato, pode levar alguns minutos);
 * se o lote não terminar em ESPERA_LOTE_MIN, cancela e chama do jeito normal.
 */
async function chamar(client: Anthropic, params: Params, lote: boolean): Promise<{ msg: Anthropic.Beta.BetaMessage; lote: boolean }> {
  if (lote) {
    try {
      // O fallback automático de modelo não é aceito em lote: vai sem ele
      const { betas, fallbacks, ...semExtras } = params as Params & { fallbacks?: unknown };
      void betas;
      void fallbacks;
      const b = await client.beta.messages.batches.create({ requests: [{ custom_id: "analise", params: semExtras }] });
      const limite = Date.now() + ESPERA_LOTE_MIN * 60_000;
      let estado = b;
      while (estado.processing_status !== "ended" && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 20_000));
        estado = await client.beta.messages.batches.retrieve(b.id);
      }
      if (estado.processing_status === "ended") {
        for await (const r of await client.beta.messages.batches.results(b.id)) {
          if (r.result.type === "succeeded") return { msg: r.result.message, lote: true };
          console.warn(`  Lote ${b.id}: ${r.result.type}; chamando do jeito normal.`);
        }
      } else {
        console.warn(`  Lote ${b.id} não terminou em ${ESPERA_LOTE_MIN} min; cancelando e chamando do jeito normal.`);
        await client.beta.messages.batches.cancel(b.id).catch(() => {});
      }
    } catch (err) {
      console.warn(`  Batch API falhou (${(err as Error).message}); chamando do jeito normal.`);
    }
  }
  return { msg: await client.beta.messages.stream(params).finalMessage(), lote: false };
}

/**
 * Envia à IA só os ativos que mudaram desde a última análise, com os campos essenciais.
 * `reaproveitadas`: notas anteriores dos que não mudaram (a IA usa só para escolher a ação do dia).
 * `pesquisaGuardada`: pesquisa já feita hoje (modo completo), para não pagar de novo.
 * `lote`: usar a Batch API (análise automática, que pode esperar alguns minutos).
 */
export async function analisarComIa(
  selecao: LinhaParaIa[],
  hoje: string,
  modo: Exclude<ModoIa, "sem_ia">,
  pesquisaGuardada: string | null,
  estrategia: Estrategia = "balanceamento",
  opcoes: { reaproveitadas?: NotaReaproveitada[]; lote?: boolean } = {},
): Promise<{ saida: SaidaIa; custo: CustoIa; pesquisa: string | null }> {
  const cfg = CONFIG[modo];
  const lote = !!opcoes.lote;
  const reaproveitadas = opcoes.reaproveitadas ?? [];
  const client = new Anthropic({ timeout: 15 * 60 * 1000 });
  const custo: CustoIa = { usd: 0, modelo: cfg.modelo, entrada: 0, saida: 0, buscas: 0, lote: false };
  const fallback = cfg.modelo.startsWith("claude-sonnet")
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const tabela = JSON.stringify(selecao);
  console.log(`  IA (${modo}, ${cfg.modelo}${lote ? ", lote" : ""}): ${selecao.length} ativos novos ou alterados, ${reaproveitadas.length} reaproveitados`);

  // 1) Pesquisa curta na web (só no modo completo, uma vez por dia, com o Haiku)
  let pesquisa = pesquisaGuardada;
  if (cfg.buscas > 0 && !pesquisa) {
    const foco = [...selecao.map((l) => l.ticker), ...reaproveitadas.filter((r) => r.na_carteira).map((r) => r.ticker)].join(", ");
    const r = await chamar(
      client,
      {
        model: MODELO_PESQUISA,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: cfg.buscas, user_location: { type: "approximate", country: "BR" } }],
        messages: [
          {
            role: "user",
            content: `Hoje é ${hoje}. Use no máximo ${cfg.buscas} buscas, agrupando vários ativos por busca.
Procure: (1) Selic, Ibovespa e dólar hoje; (2) fatos relevantes, resultados e proventos anunciados nos últimos 30 dias para: ${foco}.
Responda em tópicos curtos, um por ticker com novidade (com data e fonte). Tickers sem novidade: não mencione.`,
          },
        ],
      },
      lote,
    );
    somarCusto(custo, r.msg, MODELO_PESQUISA, r.lote);
    if (r.msg.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa do dia.");
    pesquisa = textoDe(r.msg.content) || null;
  }

  // 2) Decisão com saída JSON validada
  const ref = reaproveitadas.length
    ? `\n\nAtivos sem mudança desde a última análise (NÃO precisam de nota; use só para escolher a ação do dia):\n${JSON.stringify(reaproveitadas)}`
    : "";
  const r = await chamar(
    client,
    {
      model: cfg.modelo,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: cfg.esforco, format: betaZodOutputFormat(Decisao) },
      ...fallback,
      messages: [
        {
          role: "user",
          content: `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia (entre a tabela e os ativos sem mudança).
${REGRAS[estrategia]}
Não recomende COMPRAR com prejuízo, payout insustentável ou dado claramente errado. Se nenhum atender, escolha o mais próximo e diga isso.

Tabela (ordenada pela nota do cálculo, score_sem_ia):
${tabela}${ref}
${pesquisa ? `\nPesquisa do dia:\n${pesquisa}` : "\n(Sem pesquisa na web hoje: decida só pelos números.)"}`,
        },
      ],
    } as Params,
    lote,
  );
  const msg = r.msg;
  somarCusto(custo, msg, cfg.modelo, r.lote);
  custo.lote = r.lote;
  if (msg.stop_reason === "refusal") throw new Error("A IA recusou a decisão.");
  if (msg.stop_reason === "max_tokens") throw new Error("A resposta da IA foi cortada (max_tokens).");
  let saida: z.infer<typeof Decisao>;
  try {
    saida = Decisao.parse(JSON.parse(textoDe(msg.content)));
  } catch (err) {
    throw new Error(`JSON inválido da IA: ${(err as Error).message}`.slice(0, 500));
  }
  console.log(`  IA: US$ ${custo.usd.toFixed(4)} (${custo.entrada} tokens de entrada, ${custo.saida} de saída, ${custo.buscas} buscas${r.lote ? ", via lote" : ""})`);
  return { saida: { ...saida, revisao: null }, custo, pesquisa };
}
