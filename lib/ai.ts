// Análise com o Claude, pensada para custar pouco:
// - só os ativos que importam e que MUDARAM vão para a IA (os outros reaproveitam a nota anterior, ver lib/analise.ts);
// - modo "economico": Claude Haiku, uma chamada só, sem busca na web (centavos por análise);
// - pesquisa de notícias: Gemini com Google Search (grátis, se houver GEMINI_API_KEY) nos modos econômico e completo;
//   no completo, se o Gemini falhar ou passar do limite grátis, a pesquisa é feita pelo Haiku (pago, barato);
// - modo "completo": decisão final com o Sonnet;
// - análise automática (agendador): pela Batch API, que cobra metade do preço dos tokens;
// - modo "gratis" (padrão): o Gemini pesquisa as notícias e dá as notas, sem custo (plano grátis do Google);
// - modo "sem_ia": nenhuma chamada (o app decide só pelo cálculo).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

import type { Estrategia, ModoIa } from "./modos";
export type { ModoIa };

const MODELO_GEMINI_PADRAO = "gemini-2.5-flash";
const CONFIG: Record<Exclude<ModoIa, "sem_ia">, { modelo: string; esforco: "low" | "medium"; buscas: number }> = {
  gratis: { modelo: MODELO_GEMINI_PADRAO, esforco: "low" as const, buscas: 0 },
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
/**
 * Gemini usado na pesquisa. O 2.5 Flash é o que tem Google Search no plano grátis (500 pesquisas por dia; usamos 1).
 * No plano grátis o Google pode usar o texto enviado para treinar: vão só tickers e perguntas públicas, nada da carteira.
 */
const MODELO_GEMINI = process.env.GEMINI_MODEL || MODELO_GEMINI_PADRAO;
/** O que a IA deve priorizar em cada estratégia da carteira. */
const REGRAS: Record<Estrategia, string> = {
  oportunidade: `Estratégia OPORTUNIDADE (carteira no começo): priorize as melhores oportunidades de preço com qualidade: maior margem até o teto,
qualidade >= 6, sem alerta grave. NÃO dê preferência a quem está abaixo do peso ideal e não segure uma compra boa só para balancear setores;
não há limite de concentração por setor nesta fase: se as melhores oportunidades estão no mesmo setor, pode concentrar. Considere quedas de preço por ruído político ou macro do Brasil em empresas sólidas como chance de compra.`,
  balanceamento: `Estratégia BALANCEAMENTO: prefira margem > 0, qualidade >= 6, sem alerta grave; na carteira, prefira quem está abaixo do peso ideal
(falta_para_ideal > 0) e de setor até 30%.`,
};

/** Quantos ativos de fora da carteira vão para a IA (os de melhor score pelo cálculo). */
export const MAX_FORA_DA_CARTEIRA = 8;

/** Os ativos que interessam à IA: toda a carteira + os melhores de fora pelo cálculo. */
export function selecionarParaIa<T extends LinhaParaIa>(linhas: T[], maxFora = MAX_FORA_DA_CARTEIRA): T[] {
  return [
    ...linhas.filter((l) => l.na_carteira),
    ...linhas.filter((l) => !l.na_carteira).sort((a, b) => b.score_sem_ia - a.score_sem_ia).slice(0, maxFora),
  ];
}

/** Nota já dada pela IA a um ativo que não mudou (vai como referência, sem pedir nova análise). */
export type NotaReaproveitada = { ticker: string; na_carteira: boolean; nota: number | null; recomendacao: string | null; score_sem_ia: number; margem: unknown };

/** Uma linha da tabela enviada à IA (números em R$ ou US$ conforme "moeda"; dy, margem, roe e pesos em fração). */
export type LinhaParaIa = { ticker: string; na_carteira: boolean; score_sem_ia: number; [campo: string]: unknown };

const SYSTEM = `Você é um analista de investimentos focado em previdência privada e buy and hold (ações, FIIs, ETFs, BDRs, ações e REITs americanos e cripto).
O investidor compra todo mês, reinveste dividendos e pensa em décadas. Ele valoriza empresas perenes, lucro consistente, dividendos estáveis,
comprar abaixo do preço teto e diversificação ao longo do tempo.
O preço teto já vem calculado de forma conservadora: ações por Bazin (dividendo ÷ yield exigido, ligado ao juro real do Tesouro IPCA+, mínimo 6%) ou Graham;
FIIs pelo menor entre rendimento, FFO e média de 5 anos ÷ yield exigido (mínimo 8%);
ETFs, BDRs, stocks e REITs por Bazin se pagam dividendos, senão pela média de 12 meses; cripto não tem teto (trate como parcela pequena e de alto risco).
"margem" é quanto o preço pode subir até o teto (> 0 = abaixo do teto). "qualidade" (0 a 10) vem do balanço ou do histórico. "alertas" lista problemas já detectados; leve-os em conta.
Ativos em dólar têm "moeda" USD e "cambio" em reais por dólar.
"lucro_10a" e "dividendos_10a" mostram a constância em até 10 anos. "documentos_cvm" são fatos relevantes e comunicados oficiais recentes,
e "proventos_anunciados" vêm da B3: são fontes oficiais, pese-as mais que notícias.
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
 * Pesquisa com o Gemini e a Busca Google (API generateContent). Devolve null sem chave; erro (ex.: limite grátis) sobe.
 * As fontes citadas vão no fim do texto.
 */
/** Esquema da decisão no formato do Gemini (responseSchema). */
const ESQUEMA_GEMINI = {
  type: "OBJECT",
  properties: {
    contexto_mercado: { type: "STRING" },
    acoes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ticker: { type: "STRING" },
          nota: { type: "NUMBER" },
          recomendacao: { type: "STRING", enum: ["COMPRAR", "AGUARDAR", "EVITAR"] },
          resumo: { type: "STRING" },
          riscos: { type: "STRING" },
        },
        required: ["ticker", "nota", "recomendacao", "resumo", "riscos"],
      },
    },
    acao_do_dia_carteira: { type: "STRING" },
    justificativa_carteira: { type: "STRING" },
    acao_do_dia_geral: { type: "STRING" },
    justificativa_geral: { type: "STRING" },
  },
  required: ["contexto_mercado", "acoes", "acao_do_dia_carteira", "justificativa_carteira", "acao_do_dia_geral", "justificativa_geral"],
};

/** Chamada ao Gemini (generateContent). Com `buscar`, usa a Busca Google; com `json`, devolve JSON no esquema da decisão. */
async function gemini(sistema: string, pergunta: string, opcoes: { buscar?: boolean; json?: boolean }): Promise<{ texto: string; fontes: string[] }> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new Error("GEMINI_API_KEY não configurada");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: "user", parts: [{ text: pergunta }] }],
      ...(opcoes.buscar ? { tools: [{ google_search: {} }] } : {}),
      ...(opcoes.json ? { generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA_GEMINI, maxOutputTokens: 32000 } } : {}),
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 300);
    throw new Error(`Gemini HTTP ${res.status}${res.status === 429 ? " (limite grátis do dia)" : ""}: ${corpo}`);
  }
  const j = (await res.json()) as any;
  const c = j?.candidates?.[0];
  const texto = ((c?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!texto) throw new Error(`Gemini sem resposta (${c?.finishReason ?? "vazio"})`);
  const fontes = [...new Set(((c?.groundingMetadata?.groundingChunks ?? []) as any[]).map((g) => g?.web?.title).filter(Boolean))] as string[];
  return { texto, fontes };
}

export async function pesquisarComGemini(pergunta: string): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const { texto, fontes } = await gemini(
    "Você é um pesquisador do mercado financeiro brasileiro. Responda em português do Brasil, com datas e fontes. Não invente.",
    pergunta,
    { buscar: true },
  );
  return fontes.length ? `${texto}\n\nFontes (Busca Google): ${fontes.slice(0, 15).join(", ")}` : texto;
}

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
  opcoes: { reaproveitadas?: NotaReaproveitada[]; lote?: boolean; yieldExigido?: { acao: number; fii: number; juroReal: number | null } } = {},
): Promise<{ saida: SaidaIa; custo: CustoIa; pesquisa: string | null }> {
  const cfg = CONFIG[modo];
  const lote = !!opcoes.lote;
  const reaproveitadas = opcoes.reaproveitadas ?? [];
  const client = modo === "gratis" ? (null as unknown as Anthropic) : new Anthropic({ timeout: 15 * 60 * 1000 });
  const custo: CustoIa = { usd: 0, modelo: cfg.modelo, entrada: 0, saida: 0, buscas: 0, lote: false };
  const fallback = cfg.modelo.startsWith("claude-sonnet")
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const tabela = JSON.stringify(selecao);
  console.log(`  IA (${modo}, ${cfg.modelo}${lote ? ", lote" : ""}): ${selecao.length} ativos novos ou alterados, ${reaproveitadas.length} reaproveitados`);

  // 1) Pesquisa de notícias, uma vez por dia: Gemini grátis primeiro; no completo, Haiku com busca se o Gemini falhar
  let pesquisa = pesquisaGuardada;
  let pesquisaPor: string | null = pesquisa ? "guardada" : null;
  const foco = [...selecao.map((l) => l.ticker), ...reaproveitadas.filter((r) => r.na_carteira).map((r) => r.ticker)].join(", ");
  const pedido = (buscas: number | null) => `Hoje é ${hoje}.${buscas ? ` Use no máximo ${buscas} buscas, agrupando vários ativos por busca.` : ""}
Pesquise: (1) Selic, IPCA, Ibovespa e dólar hoje, e as notícias de política e economia do Brasil que mais mexem com a bolsa;
(2) resultados, fatos relevantes, proventos, rebaixamentos, processos e mudanças de gestão nos últimos 30 dias para: ${foco}.
Responda em tópicos curtos: um de cenário e um por ticker com novidade (com data e fonte). Tickers sem novidade: não mencione.`;
  if (!pesquisa && (process.env.GEMINI_API_KEY || modo === "gratis")) {
    try {
      pesquisa = await pesquisarComGemini(pedido(null));
      if (pesquisa) pesquisaPor = `Gemini (${MODELO_GEMINI})`;
    } catch (err) {
      console.warn(`  Pesquisa com Gemini falhou: ${(err as Error).message}${cfg.buscas > 0 ? "; usando o Haiku" : ""}`);
    }
  }
  if (cfg.buscas > 0 && !pesquisa) {
    const r = await chamar(
      client,
      {
        model: MODELO_PESQUISA,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: cfg.buscas, user_location: { type: "approximate", country: "BR" } }],
        messages: [{ role: "user", content: pedido(cfg.buscas) }],
      },
      lote,
    );
    somarCusto(custo, r.msg, MODELO_PESQUISA, r.lote);
    if (r.msg.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa do dia.");
    pesquisa = textoDe(r.msg.content) || null;
    if (pesquisa) pesquisaPor = "Claude Haiku";
  }
  if (pesquisaPor) console.log(`  Pesquisa do dia: ${pesquisaPor}`);

  // 2) Decisão com saída JSON validada
  const ref = reaproveitadas.length
    ? `\n\nAtivos sem mudança desde a última análise (NÃO precisam de nota; use só para escolher a ação do dia):\n${JSON.stringify(reaproveitadas)}`
    : "";
  const pedidoDecisao = `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia (entre a tabela e os ativos sem mudança).
${REGRAS[estrategia]}${
            opcoes.yieldExigido
              ? `\nYield exigido hoje no preço teto: ações ${(opcoes.yieldExigido.acao * 100).toFixed(1)}%, FIIs ${(opcoes.yieldExigido.fii * 100).toFixed(1)}%` +
                (opcoes.yieldExigido.juroReal != null ? ` (juro real do Tesouro IPCA+: ${(opcoes.yieldExigido.juroReal * 100).toFixed(2)}%).` : ".")
              : ""
          }
Não recomende COMPRAR com prejuízo, payout insustentável ou dado claramente errado. Se nenhum atender, escolha o mais próximo e diga isso.

Tabela (ordenada pela nota do cálculo, score_sem_ia):
${tabela}${ref}
${pesquisa ? `\nPesquisa do dia:\n${pesquisa}` : "\n(Sem pesquisa na web hoje: decida só pelos números.)"}`;

  // Modo grátis: o Gemini decide (JSON no esquema da decisão), sem custo
  if (modo === "gratis") {
    const { texto } = await gemini(SYSTEM, pedidoDecisao, { json: true });
    let saida: z.infer<typeof Decisao>;
    try {
      saida = Decisao.parse(JSON.parse(texto));
    } catch (err) {
      throw new Error(`JSON inválido do Gemini: ${(err as Error).message}`.slice(0, 500));
    }
    console.log(`  IA: Gemini (${MODELO_GEMINI}), grátis`);
    return { saida: { ...saida, revisao: null }, custo: { ...custo, modelo: MODELO_GEMINI }, pesquisa };
  }

  const r = await chamar(
    client,
    {
      model: cfg.modelo,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: cfg.esforco, format: betaZodOutputFormat(Decisao) },
      ...fallback,
      messages: [{ role: "user", content: pedidoDecisao }],
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
