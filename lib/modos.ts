// Modos da IA (sem dependências de servidor, para o seletor no navegador).
export type ModoIa = "sem_ia" | "economico" | "completo";
export const MODOS: { id: ModoIa; nome: string; descricao: string; custo: string }[] = [
  { id: "sem_ia", nome: "Sem IA", descricao: "Só o cálculo (preço teto, qualidade, score). Não usa créditos.", custo: "grátis" },
  { id: "economico", nome: "Econômico", descricao: "Claude Haiku dá nota e sinal aos seus ativos e aos melhores de fora. Sem pesquisa na web.", custo: "≈ R$ 0,05 por análise" },
  { id: "completo", nome: "Completo", descricao: "Claude Sonnet pesquisa notícias e resultados na web (até 5 buscas) e decide.", custo: "≈ R$ 1 a 2 por análise" },
];

