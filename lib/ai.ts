// Análise com o Claude, pensada para custar pouco:
// - só os ativos que importam e que MUDARAM vão para a IA (os outros reaproveitam a nota anterior, ver lib/analise.ts);
// - modo "economico": Claude Haiku, uma chamada só, sem busca na web (centavos por análise);
// - pesquisa de notícias: Gemini com Google Search (grátis, se houver GEMINI_API_KEY) nos modos econômico e completo;
//   no completo, se o Gemini falhar ou passar do limite grátis, a pesquisa é feita pelo Haiku (pago, barato);
// - modo "completo": decisão final com o Sonnet;
// - análise automática (agendador): pela Batch API, que cobra metade do preço dos tokens;
// - modo "gratis" (padrão): o Gemini dá as notas sem Busca Google, com a chave grátis (GEMINI_API_KEY);
// - modo "gemini_busca": o Gemini pesquisa na Busca Google e dá as notas, com a chave paga (GEMINI_API_KEY_PAGO);
// - modo "sem_ia": nenhuma chamada (o app decide só pelo cálculo).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

import type { Estrategia, ModoIa } from "./modos";
export type { ModoIa };

const MODELO_GEMINI_PADRAO = "gemini-3.8-flash";
const CONFIG: Record<Exclude<ModoIa, "sem_ia">, { modelo: string; esforco: "low" | "medium"; buscas: number }> = {
  gratis: { modelo: MODELO_GEMINI_PADRAO, esforco: "low" as const, buscas: 0 },
  gemini_busca: { modelo: MODELO_GEMINI_PADRAO, esforco: "low" as const, buscas: 0 },
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
 * Gemini: o 2.5 Flash foi desativado para contas novas; o padrão é o 3.8 Flash (nota e sinal grátis).
 * A Busca Google nos modelos 3.x exige faturamento ativo no Google (5.000 buscas por mês sem custo); sem isso, segue sem notícias.
 * No plano grátis o Google pode usar o texto enviado para treinar: vão só tickers e perguntas públicas, nada da carteira.
 */
/** Modelos tentados em ordem (o Google desativa os antigos para contas novas). GEMINI_MODEL fixa um. */
const MODELOS_GEMINI = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [MODELO_GEMINI_PADRAO, "gemini-3.6-flash", "gemini-3.5-flash-lite"];
let modeloGemini = MODELOS_GEMINI[0];
/** Ativos por chamada na decisão do Gemini (as partes vão em paralelo). */
const GEMINI_POR_CHAMADA = 20;
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
"lucro_10a" e "dividendos_10a" mostram a constância em até 10 anos ("crescimento_anual" do dividendo por ação). "documentos_cvm" são fatos relevantes e comunicados oficiais recentes,
e "proventos_anunciados" vêm da B3: são fontes oficiais, pese-as mais que notícias.
Critérios clássicos para pesar a nota (empresa sólida, que paga bem, comprada a preço justo e com margem de segurança):
- perenidade (Barsi): bancos, energia, saneamento, seguros e telecom têm dividendo mais previsível que commodities, construção e varejo;
- armadilha de dividendo: DY alto porque o preço caiu por um problema, lucro extraordinário (venda de ativo), payout acima do lucro ou dividendo caindo;
- dívida: dívida líquida acima de 3 anos de EBIT ou EBIT negativo pesa contra, salvo bancos e seguradoras;
- aristocratas de dividendos: lucro em todos os anos e dividendo crescendo acima da inflação valem mais que um DY alto num ano só;
- governança: Novo Mercado e tag along de 100% ajudam; estatal tem risco de interferência política no dividendo;
- margem de segurança (Graham): quanto maior a margem com qualidade alta, melhor; margem muito alta com qualidade baixa costuma ser armadilha.
FOCO DO INVESTIDOR: ações. FIIs são complemento: só recomende COMPRAR um FII de fora da carteira se ele for claramente melhor que as ações disponíveis,
e prefira sempre uma ação como ação do dia quando houver uma boa opção.
Seja direto, em português do Brasil, e não invente números: use a tabela e, quando houver, a pesquisa.`

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
/**
 * Duas chaves: GEMINI_API_KEY (projeto sem faturamento: grátis, sem Busca Google) e GEMINI_API_KEY_PAGO
 * (projeto com faturamento: cobra os tokens e libera a Busca Google). No Google, quem é grátis ou pago é o projeto da chave.
 */
export const chaveGemini = (paga: boolean) => (paga ? process.env.GEMINI_API_KEY_PAGO : process.env.GEMINI_API_KEY) || undefined;

export async function gemini(
  sistema: string,
  pergunta: string,
  opcoes: { buscar?: boolean; json?: boolean; paga?: boolean; esquema?: object },
): Promise<{ texto: string; fontes: string[]; entrada: number; saida: number }> {
  const nomeChave = opcoes.paga ? "GEMINI_API_KEY_PAGO" : "GEMINI_API_KEY";
  const chave = chaveGemini(!!opcoes.paga);
  if (!chave) throw new Error(`${nomeChave} não configurada`);
  // Tenta o modelo que já funcionou; se o Google desativar um (HTTP 404), passa para o próximo da lista
  const ordem = [...new Set([modeloGemini, ...MODELOS_GEMINI])];
  let ultimoErro: Error | null = null;
  for (const modelo of ordem) {
    // Se o Google recusar uma opção (HTTP 400), tenta de novo sem ela: primeiro o pensamento curto, depois o esquema
    const variantes = opcoes.json
      ? [{ esquema: true, pensarPouco: true }, { esquema: true, pensarPouco: false }, { esquema: false, pensarPouco: false }]
      : [{ esquema: false, pensarPouco: false }];
    for (const { esquema: comEsquema, pensarPouco } of variantes) {
      const pedir = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: "user", parts: [{ text: pergunta }] }],
          ...(opcoes.buscar ? { tools: [{ google_search: {} }] } : {}),
          ...(opcoes.json
            ? {
                generationConfig: {
                  responseMimeType: "application/json",
                  ...(comEsquema ? { responseSchema: opcoes.esquema ?? ESQUEMA_GEMINI } : {}),
                  // Nota e sinal não precisam de raciocínio longo: pensar pouco deixa a resposta bem mais rápida
                  ...(pensarPouco ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
                  maxOutputTokens: 32000,
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(600_000),
      });
      // Demorou demais: tenta mais uma vez antes de desistir (mais vale esperar que perder a pesquisa)
      const res = await pedir().catch((err: Error) => {
        if (err.name !== "TimeoutError" && err.name !== "AbortError") throw err;
        console.warn(`  Gemini ${modelo} passou de 10 minutos; tentando de novo.`);
        return pedir();
      });
      if (!res.ok) {
        const corpo = (await res.text()).slice(0, 300);
        ultimoErro = new Error(`Gemini ${modelo} HTTP ${res.status}${res.status === 429 ? " (limite grátis do dia)" : ""}: ${corpo}`);
        if (res.status === 404) break; // modelo desativado: próximo modelo
        if (res.status === 400 && (comEsquema || pensarPouco)) continue; // opção recusada: tenta sem ela
        throw ultimoErro;
      }
      const j = (await res.json()) as any;
      const c = j?.candidates?.[0];
      const texto = ((c?.content?.parts ?? []) as { text?: string; thought?: boolean }[])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("")
        .trim()
        .replace(/^```(?:json)?\s*|\s*```$/g, "");
      if (!texto) throw new Error(`Gemini sem resposta (${c?.finishReason ?? "vazio"})`);
      if (modelo !== modeloGemini) console.log(`  Gemini: usando ${modelo}`);
      modeloGemini = modelo;
      const fontes = [...new Set(((c?.groundingMetadata?.groundingChunks ?? []) as any[]).map((g) => g?.web?.title).filter(Boolean))] as string[];
      const uso = j?.usageMetadata ?? {};
      return { texto, fontes, entrada: Number(uso.promptTokenCount) || 0, saida: (Number(uso.candidatesTokenCount) || 0) + (Number(uso.thoughtsTokenCount) || 0) };
    }
  }
  throw ultimoErro ?? new Error("Gemini: nenhum modelo disponível");
}

/** Tickers por chamada na pesquisa: poucos por vez, para a Busca Google trazer detalhes de cada um. */
const PESQUISA_POR_CHAMADA = 10;
const SISTEMA_PESQUISA = "Você é um pesquisador do mercado financeiro brasileiro. Responda em português do Brasil, com datas e fontes. Não invente.";

/**
 * Pesquisa detalhada em partes paralelas (cenário + grupos de tickers), cada ticker sob um título "### TICKER".
 * Uma parte que falha não derruba as outras. Devolve o texto juntado (ou null se todas falharem).
 */
export async function pesquisaDetalhada(
  hoje: string,
  tickers: string[],
  soPaga: boolean,
): Promise<{ texto: string | null; entrada: number; saida: number; partes: number; partesOk: number; erros: string[] }> {
  const pedidos = [
    `Hoje é ${hoje}. Escreva sob o título "### CENÁRIO": Selic, IPCA, Ibovespa e dólar hoje; as decisões e expectativas do Copom;
as notícias de política, fiscal e economia do Brasil e do exterior que mais mexem com a bolsa nos últimos 7 dias; e os setores em alta ou em baixa.
Seja detalhado, com números, datas e fontes.`,
  ];
  for (let i = 0; i < tickers.length; i += PESQUISA_POR_CHAMADA) {
    const grupo = tickers.slice(i, i + PESQUISA_POR_CHAMADA);
    pedidos.push(`Hoje é ${hoje}. Pesquise cada ativo da bolsa brasileira abaixo (ações, FIIs ou ETFs): ${grupo.join(", ")}.
Para CADA um, escreva sob o título "### TICKER" (ex.: "### ${grupo[0]}") o que houve nos últimos 90 dias:
último resultado trimestral (lucro, receita, dívida, comparação com o ano anterior), proventos anunciados (valor, data-com),
fatos relevantes, guidance, mudanças de gestão ou controle, processos, rebaixamentos ou elevações de rating, recomendações de analistas
e preço-alvo, riscos do setor e de regulação. Para FIIs: vacância, inadimplência, emissões, rendimento mensal e mudanças no portfólio.
Seja detalhado, com números, datas e fontes. Se não achar nada sobre um ativo, escreva "sem novidades encontradas".`);
  }
  const res = await Promise.allSettled(pedidos.map((p) => pesquisarComGemini(p, soPaga)));
  const ok = res.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  return {
    texto: ok.length ? ok.map((r) => r.texto).join("\n\n") : null,
    entrada: ok.reduce((s, r) => s + r.entrada, 0),
    saida: ok.reduce((s, r) => s + r.saida, 0),
    partes: pedidos.length,
    partesOk: ok.length,
    erros: res.flatMap((r) => (r.status === "rejected" ? [(r.reason as Error).message] : [])),
  };
}

/**
 * Da pesquisa, só o cenário e os trechos dos tickers pedidos (para cada parte da decisão não receber a pesquisa inteira).
 * Pesquisa sem títulos "### " (formato antigo ou do Haiku) vai inteira.
 */
export function trechosDaPesquisa(pesquisa: string, tickers: string[]): string {
  const blocos = pesquisa.split(/\n(?=#{2,3} )/);
  if (blocos.length < 2) return pesquisa;
  const quero = new Set(tickers.map((t) => t.toUpperCase()));
  const manter = blocos.filter((b) => {
    const titulo = b.match(/^#{2,3} ([^\n]*)/)?.[1]?.toUpperCase();
    if (!titulo) return true; // texto antes do primeiro título (cabeçalho da pesquisa)
    return /CEN[AÁ]RIO|FONTES/.test(titulo) || [...quero].some((t) => titulo.includes(t));
  });
  return manter.join("\n");
}

/** Pesquisa com a Busca Google. Usa a chave paga se houver (a Busca Google exige faturamento); senão, tenta a grátis. */
export async function pesquisarComGemini(pergunta: string, soPaga = false): Promise<{ texto: string; entrada: number; saida: number } | null> {
  const paga = !!chaveGemini(true);
  if (!paga && (soPaga || !chaveGemini(false))) return null;
  const r = await gemini(SISTEMA_PESQUISA, pergunta, { buscar: true, paga });
  return { ...r, texto: r.fontes.length ? `${r.texto}\n\nFontes (Busca Google): ${r.fontes.slice(0, 15).join(", ")}` : r.texto };
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
 * Junta as respostas do Gemini dadas em partes: as notas de todas, e a ação do dia entre as escolhidas em cada parte
 * (a de maior nota; na carteira, só entre os ativos da carteira).
 */
export function juntarDecisoes(respostas: z.infer<typeof Decisao>[], selecao: LinhaParaIa[], reaproveitadas: NotaReaproveitada[]): z.infer<typeof Decisao> {
  const acoes = respostas.flatMap((r) => r.acoes);
  const nota = (t: string) =>
    acoes.find((a) => a.ticker.toUpperCase() === t.toUpperCase())?.nota ?? reaproveitadas.find((r) => r.ticker === t.toUpperCase())?.nota ?? -1;
  const naCarteira = new Set([...selecao.filter((l) => l.na_carteira).map((l) => l.ticker), ...reaproveitadas.filter((r) => r.na_carteira).map((r) => r.ticker)]);
  const melhor = (candidatas: z.infer<typeof Decisao>[]) => candidatas.reduce<z.infer<typeof Decisao> | null>((m, r) => (!m || nota(r.acao_do_dia_geral) > nota(m.acao_do_dia_geral) ? r : m), null);
  const melhorCarteira = (candidatas: z.infer<typeof Decisao>[]) =>
    candidatas.reduce<z.infer<typeof Decisao> | null>((m, r) => (!m || nota(r.acao_do_dia_carteira) > nota(m.acao_do_dia_carteira) ? r : m), null);
  const geral = melhor(respostas) ?? respostas[0];
  const carteira = melhorCarteira(respostas.filter((r) => naCarteira.has(r.acao_do_dia_carteira.toUpperCase()))) ?? respostas[0];
  return {
    contexto_mercado: respostas[0].contexto_mercado,
    acoes,
    acao_do_dia_geral: geral.acao_do_dia_geral,
    justificativa_geral: geral.justificativa_geral,
    acao_do_dia_carteira: carteira.acao_do_dia_carteira,
    justificativa_carteira: carteira.justificativa_carteira,
  };
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
  opcoes: {
    reaproveitadas?: NotaReaproveitada[];
    lote?: boolean;
    yieldExigido?: { acao: number; fii: number; juroReal: number | null };
    /** Chamado assim que a pesquisa termina (antes da decisão), para ela não se perder se a decisão falhar. */
    salvarPesquisa?: (texto: string, por: string) => Promise<void>;
  } = {},
): Promise<{ saida: SaidaIa; custo: CustoIa; pesquisa: string | null }> {
  const cfg = CONFIG[modo];
  const lote = !!opcoes.lote;
  const reaproveitadas = opcoes.reaproveitadas ?? [];
  const ehGemini = modo === "gratis" || modo === "gemini_busca";
  const client = ehGemini ? (null as unknown as Anthropic) : new Anthropic({ timeout: 15 * 60 * 1000 });
  const custo: CustoIa = { usd: 0, modelo: cfg.modelo, entrada: 0, saida: 0, buscas: 0, lote: false };
  const fallback = cfg.modelo.startsWith("claude-sonnet")
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const tabela = JSON.stringify(selecao);
  console.log(`  IA (${modo}, ${cfg.modelo}${lote ? ", lote" : ""}): ${selecao.length} ativos novos ou alterados, ${reaproveitadas.length} reaproveitados`);

  // 1) Pesquisa de notícias, uma vez por dia (guardada assim que termina, para o modo grátis reaproveitar)
  let pesquisa = pesquisaGuardada;
  let pesquisaPor: string | null = pesquisa ? "guardada" : null;
  const todos = [...new Set([...selecao.map((l) => l.ticker), ...reaproveitadas.map((r) => r.ticker)])];
  const foco = todos.join(", ");
  const pedido = (buscas: number | null) => `Hoje é ${hoje}.${buscas ? ` Use no máximo ${buscas} buscas, agrupando vários ativos por busca.` : ""}
Pesquise: (1) Selic, IPCA, Ibovespa e dólar hoje, e as notícias de política e economia do Brasil que mais mexem com a bolsa;
(2) resultados, fatos relevantes, proventos, rebaixamentos, processos e mudanças de gestão nos últimos 30 dias para: ${foco}.
Responda em tópicos curtos: um de cenário e um por ticker com novidade (com data e fonte). Tickers sem novidade: não mencione.`;
  // No modo grátis não pesquisa: a Busca Google não funciona sem faturamento e só gastaria tempo
  if (!pesquisa && modo === "gemini_busca" && !chaveGemini(true)) {
    console.warn("  Modo Gemini com Busca Google sem GEMINI_API_KEY_PAGO: seguindo sem notícias da internet.");
  } else if (!pesquisa && modo !== "gratis" && (chaveGemini(true) || chaveGemini(false))) {
    const r = await pesquisaDetalhada(hoje, todos, modo === "gemini_busca");
    custo.entrada += r.entrada;
    custo.saida += r.saida;
    if (r.texto) {
      pesquisa = r.texto;
      pesquisaPor = `Gemini (${modeloGemini}, ${r.partesOk} de ${r.partes} partes, ${r.entrada} tokens de entrada, ${r.saida} de saída)`;
      await opcoes.salvarPesquisa?.(pesquisa, pesquisaPor);
    }
    for (const e of r.erros) console.warn(`  Pesquisa com Gemini falhou em uma parte: ${e}`);
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
    if (pesquisa) {
      pesquisaPor = "Claude Haiku";
      await opcoes.salvarPesquisa?.(pesquisa, pesquisaPor);
    }
  }
  if (pesquisaPor) console.log(`  Pesquisa do dia: ${pesquisaPor}`);

  // 2) Decisão com saída JSON validada
  const ref = reaproveitadas.length
    ? `\n\nAtivos sem mudança desde a última análise (NÃO precisam de nota; use só para escolher a ação do dia):\n${JSON.stringify(reaproveitadas)}`
    : "";
  const montarPedido = (tabela: string, tickers?: string[]) => `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia (entre a tabela e os ativos sem mudança).
${REGRAS[estrategia]}${
            opcoes.yieldExigido
              ? `\nYield exigido hoje no preço teto: ações ${(opcoes.yieldExigido.acao * 100).toFixed(1)}%, FIIs ${(opcoes.yieldExigido.fii * 100).toFixed(1)}%` +
                (opcoes.yieldExigido.juroReal != null ? ` (juro real do Tesouro IPCA+: ${(opcoes.yieldExigido.juroReal * 100).toFixed(2)}%).` : ".")
              : ""
          }
Não recomende COMPRAR com prejuízo, payout insustentável ou dado claramente errado. Se nenhum atender, escolha o mais próximo e diga isso.

Tabela (ordenada pela nota do cálculo, score_sem_ia):
${tabela}${ref}
${pesquisa ? `\nPesquisa:\n${tickers ? trechosDaPesquisa(pesquisa, tickers) : pesquisa}` : "\n(Sem pesquisa na web hoje: decida só pelos números.)"}`;
  const pedidoDecisao = montarPedido(tabela);

  // Modos do Gemini: ele decide (JSON no esquema da decisão). Grátis com a chave grátis; no gemini_busca, com a paga
  if (ehGemini) {
    const paga = modo === "gemini_busca" && !!chaveGemini(true);
    // Em partes de até GEMINI_POR_CHAMADA ativos, em paralelo: com 60+ ativos numa chamada só, o Gemini passava de 5 minutos
    const partes: LinhaParaIa[][] = [];
    for (let i = 0; i < selecao.length; i += GEMINI_POR_CHAMADA) partes.push(selecao.slice(i, i + GEMINI_POR_CHAMADA));
    const respostas = await Promise.all(
      partes.map(async (parte) => {
        const r = await gemini(SYSTEM, montarPedido(JSON.stringify(parte), parte.map((l) => l.ticker)), { json: true, paga });
        custo.entrada += r.entrada;
        custo.saida += r.saida;
        try {
          return Decisao.parse(JSON.parse(r.texto));
        } catch (err) {
          throw new Error(`JSON inválido do Gemini: ${(err as Error).message}`.slice(0, 500));
        }
      }),
    );
    const saida = juntarDecisoes(respostas, selecao, reaproveitadas);
    console.log(
      `  IA: Gemini (${modeloGemini}), ${paga ? "chave paga (o custo aparece no AI Studio)" : "grátis"}: ${custo.entrada} tokens de entrada, ${custo.saida} de saída`,
    );
    return { saida: { ...saida, revisao: null }, custo: { ...custo, modelo: modeloGemini }, pesquisa };
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
