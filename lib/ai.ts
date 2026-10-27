// Análise diária com o Claude: 1) pesquisa notícias e resultados na web, 2) devolve notas estruturadas.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const MODELO = "claude-opus-5-5";
// Se o modelo recusar por política, a própria API tenta outro modelo.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export type LinhaParaIa = {
  ticker: string;
  nome: string | null;
  na_carteira: boolean;
  peso_atual: number | null; // % da carteira
  preco: number | null;
  lpa: number | null;
  vpa: number | null;
  dy_12m: number | null;
  dpa_medio: number | null;
  roe: number | null;
  teto_bazin: number | null;
  teto_graham: number | null;
  preco_teto: number | null;
  margem: number | null;
};

const SYSTEM = `Você é um analista de ações brasileiras focado em previdência privada e buy and hold.
O investidor compra todo mês, reinveste dividendos e pensa em décadas. Ele valoriza:
- empresas perenes, com lucro consistente, boa governança e dividendos estáveis;
- comprar abaixo do preço teto (Bazin: dividendo médio / 6%; Graham: raiz(22,5 x LPA x VPA));
- setores "à prova de crise" (bancos, energia, saneamento, seguros, telecom), sem descartar outros.
Seja direto, em português do Brasil, e não invente números: use os dados fornecidos e o que encontrar na pesquisa.`;

const Saida = z.object({
  contexto_mercado: z.string().describe("2 a 4 frases sobre o mercado hoje (Ibovespa, juros, dólar, notícias relevantes)"),
  acoes: z.array(
    z.object({
      ticker: z.string(),
      nota: z.number().describe("0 a 10: qualidade + momento para compra de longo prazo"),
      recomendacao: z.enum(["COMPRAR", "AGUARDAR", "EVITAR"]),
      resumo: z.string().describe("1 a 2 frases: por que essa nota"),
      riscos: z.string().describe("principal risco em 1 frase"),
    }),
  ),
  acao_do_dia_carteira: z.string().describe("ticker da carteira mais indicado para aporte hoje"),
  justificativa_carteira: z.string(),
  acao_do_dia_geral: z.string().describe("ticker mais indicado hoje entre todas as ações analisadas"),
  justificativa_geral: z.string(),
});
export type SaidaIa = z.infer<typeof Saida>;

function textoDe(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function analisarComIa(linhas: LinhaParaIa[], hoje: string): Promise<SaidaIa> {
  const client = new Anthropic();
  const tabela = JSON.stringify(linhas);

  // 1) Pesquisa: notícias, resultados trimestrais e fatos relevantes recentes.
  const pesquisa = await client.beta.messages
    .stream({
      model: MODELO,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 15, user_location: { type: "approximate", country: "BR" } }],
      ...FALLBACK,
      messages: [
        {
          role: "user",
          content: `Hoje é ${hoje}. Pesquise na web as notícias mais recentes (últimos dias e último trimestre) que afetam estas ações: resultados trimestrais, guidance, dividendos anunciados, fatos relevantes, mudanças regulatórias, e o cenário do Ibovespa, Selic e dólar.
Priorize as ações da carteira (na_carteira = true) e as que estão abaixo do preço teto (margem > 0).
Ao final, escreva um resumo objetivo por ticker com o que encontrou (pode ser "sem novidades").

Dados de hoje (preços em R$, dy e margem em fração):
${tabela}`,
        },
      ],
    })
    .finalMessage();

  if (pesquisa.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa do dia.");
  const notas = textoDe(pesquisa.content);

  // 2) Decisão estruturada a partir dos números + pesquisa.
  const resposta = await client.beta.messages.parse({
    model: MODELO,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(Saida) },
    ...FALLBACK,
    messages: [
      {
        role: "user",
        content: `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia.
Regras:
- A ação do dia deve estar, de preferência, abaixo do preço teto (margem > 0) e ter nota alta.
- Para a carteira, considere também a ação com menor peso atual em relação a um peso igual entre os ativos.
- Se nenhuma estiver abaixo do teto, escolha a mais próxima e diga isso na justificativa.

Tabela:
${tabela}

Pesquisa do dia:
${notas || "(sem resultados de pesquisa)"}`,
      },
    ],
  });

  if (resposta.stop_reason === "refusal") throw new Error("A IA recusou a análise do dia.");
  if (!resposta.parsed_output) throw new Error(`Resposta da IA sem JSON válido (stop_reason=${resposta.stop_reason})`);
  return resposta.parsed_output;
}
