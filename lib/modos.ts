// Modos da IA (sem dependências de servidor, para o seletor no navegador).
export type ModoIa = "gratis" | "gemini_busca" | "sem_ia" | "economico" | "completo";
export const MODOS: { id: ModoIa; nome: string; descricao: string; custo: string }[] = [
  { id: "gratis", nome: "Grátis (Gemini)", descricao: "O Gemini do Google dá nota e sinal aos ativos com os números e as notícias oficiais da CVM e da B3. Sem Busca Google. Usa a chave grátis (GEMINI_API_KEY).", custo: "grátis" },
  { id: "gemini_busca", nome: "Gemini com Busca Google", descricao: "Igual ao Grátis, mas o Gemini também pesquisa as notícias do dia na Busca Google. Usa a chave paga (GEMINI_API_KEY_PAGO). Só reanalisa o que mudou.", custo: "≈ R$ 0,30 a 1 por análise (estimativa)" },
  { id: "sem_ia", nome: "Só cálculo", descricao: "Só o cálculo (preço teto, qualidade, score), sem nenhuma IA.", custo: "grátis" },
  { id: "economico", nome: "Econômico", descricao: "Claude Haiku dá nota e sinal aos seus ativos e aos melhores de fora. Sem pesquisa na web. Só reanalisa o que mudou.", custo: "≈ R$ 0,02 por análise" },
  { id: "completo", nome: "Completo", descricao: "Claude Haiku pesquisa notícias e resultados na web (até 5 buscas) e o Claude Sonnet decide. Só reanalisa o que mudou.", custo: "≈ R$ 0,30 a 0,70 por análise" },
];


// Estratégia da carteira: no começo, foco em oportunidades; depois, balancear por setor e peso ideal.
export type Estrategia = "oportunidade" | "balanceamento";
export type EscolhaEstrategia = "auto" | Estrategia;
/** No modo automático, por quantos meses (a partir do início da carteira) vale a estratégia Oportunidade. */
export const MESES_OPORTUNIDADE = 12;
/** Limite de concentração por setor em cada estratégia. */
/** 1 = sem limite (na Oportunidade, pode concentrar nas melhores chances). */
export const LIMITE_SETOR: Record<Estrategia, number> = { oportunidade: 1, balanceamento: 0.3 };
export const ESTRATEGIAS: { id: Estrategia; nome: string; descricao: string }[] = [
  {
    id: "oportunidade",
    nome: "Oportunidade",
    descricao: "Prioriza as ações mais baratas (abaixo do teto) e de boa qualidade, sem buscar o peso ideal e sem limite por setor.",
  },
  {
    id: "balanceamento",
    nome: "Balanceamento",
    descricao: "Completa o peso ideal de cada ativo e segura setores acima de 30%.",
  },
];
