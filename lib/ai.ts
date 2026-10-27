// Análise diária com o Claude, em 3 etapas (prioriza acertar, não velocidade):
// 1) pesquisa na web: resultados, proventos, fatos relevantes e cenário, com fonte e data;
// 2) decisão: nota e sinal por ação + ação do dia;
// 3) revisão: confere a decisão contra os números e a pesquisa e devolve a versão final.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const MODELO = "claude-opus-5-5";
// Se o modelo recusar por política, a própria API tenta outro modelo.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** Uma linha da tabela enviada à IA (números em R$; dy, margem, roe e pesos em fração). */
export type LinhaParaIa = {
  ticker: string;
  na_carteira: boolean;
  score_sem_ia: number;
  [campo: string]: unknown;
};

const SYSTEM = `Você é um analista de investimentos (ações, FIIs, ETFs, BDRs, ações e REITs americanos e cripto), focado em previdência privada e buy and hold.
O investidor compra todo mês, reinveste dividendos e pensa em décadas. Ele valoriza:
- empresas perenes, com lucro consistente, boa governança e dividendos estáveis;
- comprar abaixo do preço teto. Cada linha tem um "tipo", e o preço teto já vem calculado de forma conservadora:
  - acao: Bazin = o MENOR entre o dividendo dos últimos 12 meses e a média de 5 anos, dividido por 6%;
    sem dividendos relevantes, Graham = raiz(22,5 x LPA x VPA). "qualidade" vem do balanço (ROE, payout, dívida, margem, crescimento).
  - fii: o MENOR entre o rendimento de 12 meses, o FFO por cota e a média de 5 anos, dividido por 8%. "vpa" é o valor
    patrimonial por cota. "qualidade" vem de P/VP, rendimento coberto pelo FFO, vacância, nº de imóveis, liquidez e tamanho.
    Pese também segmento (tijolo, papel, híbrido), gestão, inadimplência dos recebíveis, vencimento de contratos e efeito dos juros.
  - etf: se paga dividendos relevantes, Bazin a 6%; senão a referência é a média de preço dos últimos 12 meses.
    "qualidade" vem do retorno de 5 anos, das quedas sofridas, da liquidez e da renda. Pese o índice que replica,
    a taxa de administração e se faz sentido como base de carteira de longo prazo.
  - bdr, stock, etf_int, reit: mesma regra dos ETFs (Bazin se pagam dividendos, senão média de 12 meses), qualidade pelo histórico.
    Stocks, REITs e ETFs internacionais estão em dólar (campo "moeda"; "cambio" = reais por dólar): pese também o câmbio.
  - cripto: sem preço teto (não gera lucro nem renda). Para previdência, trate como parcela pequena e de alto risco.
  Os detalhes de cada tipo estão no campo "indicadores".
- diversificação: nenhum setor deve passar de 30% da carteira;
- setores perenes (energia, saneamento, seguros, telecom, bancos), sem descartar outros.
Seja direto, em português do Brasil, e não invente números: use os dados fornecidos e o que encontrar na pesquisa.
O campo "alertas" de cada ação lista problemas de dados ou de qualidade já detectados; leve-os em conta.
Ao citar números da pesquisa (resultado de eleição, Selic, cotações, lucros), use a fonte original e diga a data.`;

const Acao = z.object({
  ticker: z.string(),
  nota: z.number().describe("0 a 10: qualidade do negócio + momento para compra de longo prazo"),
  recomendacao: z.enum(["COMPRAR", "AGUARDAR", "EVITAR"]),
  resumo: z.string().describe("1 a 2 frases: por que essa nota, citando os números decisivos"),
  riscos: z.string().describe("principal risco em 1 frase"),
});

const Decisao = z.object({
  contexto_mercado: z.string().describe("2 a 4 frases sobre o mercado hoje (Ibovespa, juros, dólar, notícias relevantes), com datas"),
  acoes: z.array(Acao).describe("uma entrada para CADA ticker da tabela"),
  acao_do_dia_carteira: z.string().describe("ticker da carteira mais indicado para aporte hoje"),
  justificativa_carteira: z.string(),
  acao_do_dia_geral: z.string().describe("ticker mais indicado hoje entre todos os ativos analisados"),
  justificativa_geral: z.string(),
});

const Final = Decisao.extend({
  revisao: z
    .string()
    .describe("2 a 4 frases: o que a revisão conferiu, o que mudou em relação à decisão inicial e por quê (ou que nada mudou)"),
});
export type SaidaIa = z.infer<typeof Final>;

function textoDe(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Chamada com saída JSON validada. Usa streaming porque, com esforço alto, pode levar vários minutos. */
async function chamarEstruturado<T extends z.ZodType>(
  client: Anthropic,
  schema: T,
  conteudo: string,
  etapa: string,
): Promise<z.infer<T>> {
  const msg = await client.beta.messages
    .stream({
      model: MODELO,
      max_tokens: 64000,
      system: SYSTEM,
      output_config: { effort: "xhigh", format: betaZodOutputFormat(schema) },
      ...FALLBACK,
      messages: [{ role: "user", content: conteudo }],
    })
    .finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`A IA recusou a etapa de ${etapa}.`);
  if (msg.stop_reason === "max_tokens") throw new Error(`A resposta da etapa de ${etapa} foi cortada (max_tokens).`);
  const texto = textoDe(msg.content);
  try {
    return schema.parse(JSON.parse(texto));
  } catch (err) {
    throw new Error(`JSON inválido na etapa de ${etapa}: ${(err as Error).message}`.slice(0, 500));
  }
}

export async function analisarComIa(linhas: LinhaParaIa[], hoje: string): Promise<SaidaIa> {
  const client = new Anthropic({ timeout: 30 * 60 * 1000 });
  const tabela = JSON.stringify(linhas);
  const foco = [
    ...linhas.filter((l) => l.na_carteira).map((l) => l.ticker),
    ...linhas.filter((l) => !l.na_carteira).slice(0, 12).map((l) => l.ticker),
  ];
  console.log(`  IA 1/3: pesquisa (foco em ${foco.join(", ")})`);

  // 1) Pesquisa
  const pesquisa = await client.beta.messages
    .stream({
      model: MODELO,
      max_tokens: 64000,
      system: SYSTEM,
      output_config: { effort: "high" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 30, user_location: { type: "approximate", country: "BR" } },
      ],
      ...FALLBACK,
      messages: [
        {
          role: "user",
          content: `Hoje é ${hoje}. Faça uma pesquisa cuidadosa na web para apoiar a decisão de aporte de hoje.

1. Cenário: Ibovespa, Selic e próxima reunião do Copom, dólar, inflação e notícias que mexeram com a bolsa nos últimos dias.
2. Para CADA uma destas ações (${foco.join(", ")}), procure:
   - ações: o último resultado trimestral (data, lucro, variação no ano e o que surpreendeu);
   - FIIs: o último relatório gerencial (rendimento, vacância, inadimplência, emissões, vendas de imóveis, guidance);
   - ETFs: taxa de administração, índice de referência e desempenho recente;
   - proventos anunciados recentemente ou previstos, e mudanças na política de dividendos;
   - fatos relevantes, mudanças de governo/controle, regulação, processos;
   - mudanças recentes de recomendação ou preço-alvo dos analistas;
   - a data do próximo resultado (ações).
3. Confira se algum número da tabela parece errado (por exemplo LPA ou DY muito diferentes do que as fontes mostram) e diga qual.

Regras: cite a fonte e a data de cada fato; prefira fontes primárias (RI da empresa, B3, Banco Central) e grandes veículos;
se não encontrar nada recente, escreva "sem novidades relevantes". Termine com um resumo por ticker.

Tabela de hoje, já ordenada pela nota sem IA (score_sem_ia):
${tabela}`,
        },
      ],
    })
    .finalMessage();
  if (pesquisa.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa do dia.");
  const notas = textoDe(pesquisa.content) || "(sem resultados de pesquisa)";

  // 2) Decisão
  console.log("  IA 2/3: decisão");
  const decisao = await chamarEstruturado(
    client,
    Decisao,
    `Hoje é ${hoje}. Dê nota e recomendação para CADA ticker da tabela e escolha a ação do dia.
Regras:
- A ação do dia deve, de preferência, estar abaixo do preço teto (margem > 0), ter qualidade >= 6 e nota alta.
- Na carteira, prefira ações abaixo do peso ideal (falta_para_ideal > 0) e de setores que não passem de 30%.
- Não recomende COMPRAR ação com prejuízo, payout insustentável ou dado claramente errado sem dizer o motivo.
- Se nenhuma atender às regras, escolha a mais próxima e diga isso na justificativa.

Tabela:
${tabela}

Pesquisa do dia:
${notas}`,
    "decisão",
  );

  // 3) Revisão
  console.log("  IA 3/3: revisão");
  const final = await chamarEstruturado(
    client,
    Final,
    `Hoje é ${hoje}. Você é o revisor. Confira a decisão abaixo antes de ela ir para o investidor e devolva a versão final.
Verifique, um a um:
1. Todo ticker da tabela tem uma entrada em "acoes" (complete os que faltarem).
2. Cada número citado nos textos bate com a tabela ou com a pesquisa (corrija os que não baterem).
3. As ações do dia seguem as regras: margem > 0, qualidade >= 6, sem alerta grave e setor da carteira até 30%.
   Se não seguirem, troque pela melhor alternativa ou justifique claramente a exceção.
4. A nota e o sinal de cada ação são coerentes com margem, qualidade, alertas e pesquisa
   (por exemplo, COMPRAR com margem muito negativa ou qualidade baixa precisa de motivo forte).
5. O contexto de mercado não afirma nada que a pesquisa não sustente.
No campo "revisao", diga o que conferiu e o que mudou.

Tabela:
${tabela}

Pesquisa do dia:
${notas}

Decisão a revisar:
${JSON.stringify(decisao)}`,
    "revisão",
  );
  return final;
}
