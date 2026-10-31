// BESST (método Barsi): Bancos, Energia elétrica, Saneamento, Seguros e Telecomunicações.
// Setores perenes, de demanda estável e dividendo previsível. É deles que saem as oportunidades fora da carteira,
// junto com as holdings de banco e os FIIs.
const SETORES_BESST = /banco|intermedi[áa]rios financeiros|energia el|saneamento|[áa]gua e|segur|previd|telecom|telefon/i;
/** Holdings cujo negócio principal é banco ou seguro (o setor oficial é "Holdings Diversificadas"). */
const HOLDINGS_DE_BANCO = /^(ITSA|BRSR)\d{1,2}$/;

/** `setor` como a análise guarda (subsetor do Fundamentus, ex.: "Energia Elétrica"). */
export function ehBesst(a: { ticker?: string; tipo?: string | null; setor: string | null }): boolean {
  const tipo = a.tipo ?? "acao";
  if (tipo === "fii") return true;
  if (tipo !== "acao") return false;
  return SETORES_BESST.test(a.setor ?? "") || HOLDINGS_DE_BANCO.test(a.ticker ?? "");
}
