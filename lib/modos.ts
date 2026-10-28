// Modos da IA (sem dependências de servidor, para o seletor no navegador).
export type ModoIa = "sem_ia" | "economico" | "completo";
export const MODOS: { id: ModoIa; nome: string; descricao: string; custo: string }[] = [
  { id: "sem_ia", nome: "Sem IA", descricao: "Só o cálculo (preço teto, qualidade, score). Não usa créditos.", custo: "grátis" },
  { id: "economico", nome: "Econômico", descricao: "Claude Haiku dá nota e sinal aos seus ativos e aos melhores de fora. Sem pesquisa na web.", custo: "≈ R$ 0,05 por análise" },
  { id: "completo", nome: "Completo", descricao: "Claude Sonnet pesquisa notícias e resultados na web (até 5 buscas) e decide.", custo: "≈ R$ 1 a 2 por análise" },
];


// Estratégia da carteira: no começo, foco em oportunidades; depois, balancear por setor e peso ideal.
export type Estrategia = "oportunidade" | "balanceamento";
export type EscolhaEstrategia = "auto" | Estrategia;
/** No modo automático, por quantos meses (a partir do início da carteira) vale a estratégia Oportunidade. */
export const MESES_OPORTUNIDADE = 6;
/** Limite de concentração por setor em cada estratégia. */
export const LIMITE_SETOR: Record<Estrategia, number> = { oportunidade: 0.5, balanceamento: 0.3 };
export const ESTRATEGIAS: { id: Estrategia; nome: string; descricao: string }[] = [
  {
    id: "oportunidade",
    nome: "Oportunidade",
    descricao: "Prioriza as ações mais baratas (abaixo do teto) e de boa qualidade, sem buscar o peso ideal. Só barra um setor acima de 50%.",
  },
  {
    id: "balanceamento",
    nome: "Balanceamento",
    descricao: "Completa o peso ideal de cada ativo e segura setores acima de 30%.",
  },
];
