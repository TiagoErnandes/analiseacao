// BESST (método Barsi): Bancos, Energia elétrica, Saneamento, Seguros e Telecomunicações.
// Setores perenes, de demanda estável e dividendo previsível. É deles que saem as oportunidades fora da carteira.
const SETORES_BESST = /banco|intermedi[áa]rios financeiros|energia el|saneamento|[áa]gua e|segur|previd|telecom|telefon/i;

/** `setor` como a análise guarda (subsetor do Fundamentus, ex.: "Energia Elétrica"). */
export function ehBesst(a: { tipo?: string | null; setor: string | null }): boolean {
  return (a.tipo ?? "acao") === "acao" && SETORES_BESST.test(a.setor ?? "");
}
