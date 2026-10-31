// Catálogo dos tipos de ativo aceitos na carteira.
export type Tipo = "acao" | "fii" | "etf" | "bdr" | "stock" | "etf_int" | "reit" | "cripto" | "renda_fixa";

export type InfoTipo = {
  id: Tipo;
  nome: string; // como aparece no seletor
  curto: string; // etiqueta curta
  moeda: "BRL" | "USD";
  /** Código no formato aceito (mensagem de ajuda quando não bate). */
  formato: RegExp;
  exemplo: string;
  /** Tem análise completa de preço teto pelos fundamentos (B3). */
  fundamentos: boolean;
  sugestoes: string[];
};

export const TIPOS: InfoTipo[] = [
  {
    id: "acao", nome: "Ações", curto: "Ação", moeda: "BRL", formato: /^[A-Z]{4}(3|4|5|6|7|8|11)$/, exemplo: "PETR4", fundamentos: true,
    sugestoes: ["PETR4", "VALE3", "ITUB4", "BBAS3", "BBDC4", "ITSA4", "BBSE3", "TAEE11", "CMIG4", "EGIE3", "SAPR11", "WEGE3", "VIVT3", "KLBN11", "CPLE6"],
  },
  {
    id: "fii", nome: "FIIs", curto: "FII", moeda: "BRL", formato: /^[A-Z]{4}11$/, exemplo: "MXRF11", fundamentos: true,
    sugestoes: ["MXRF11", "HGLG11", "KNRI11", "XPML11", "BTLG11", "VISC11", "KNCR11", "CPTS11", "XPLG11", "HGRU11", "TRXF11", "VGHF11", "KNIP11", "IRDM11"],
  },
  {
    id: "stock", nome: "Stocks", curto: "Stock", moeda: "USD", formato: /^[A-Z]{1,5}(\.[A-Z])?$/, exemplo: "AAPL", fundamentos: false,
    sugestoes: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "BRK.B", "JNJ", "KO", "PG", "JPM", "V", "PEP", "XOM", "MCD"],
  },
  {
    id: "bdr", nome: "BDRs", curto: "BDR", moeda: "BRL", formato: /^[A-Z]{4}3[1-5]$/, exemplo: "AAPL34", fundamentos: false,
    sugestoes: ["AAPL34", "MSFT34", "GOGL34", "AMZO34", "NVDC34", "M1TA34", "BERK34", "JNJB34", "COCA34", "DISB34"],
  },
  {
    id: "etf", nome: "ETFs", curto: "ETF", moeda: "BRL", formato: /^[A-Z]{4}11$/, exemplo: "BOVA11", fundamentos: true,
    sugestoes: ["BOVA11", "IVVB11", "SMAL11", "DIVO11", "HASH11", "NASD11", "GOLD11", "XFIX11", "B5P211"],
  },
  {
    id: "etf_int", nome: "ETFs Internacionais", curto: "ETF Int.", moeda: "USD", formato: /^[A-Z]{2,5}$/, exemplo: "VOO", fundamentos: false,
    sugestoes: ["VOO", "IVV", "VTI", "QQQ", "SCHD", "VYM", "VT", "VXUS", "BND", "VNQ"],
  },
  {
    id: "reit", nome: "REITs", curto: "REIT", moeda: "USD", formato: /^[A-Z]{1,5}$/, exemplo: "O", fundamentos: false,
    sugestoes: ["O", "PLD", "AMT", "SPG", "VICI", "STAG", "WPC", "DLR", "PSA", "EQIX"],
  },
  {
    id: "cripto", nome: "Criptomoedas", curto: "Cripto", moeda: "BRL", formato: /^[A-Z0-9]{2,10}$/, exemplo: "BTC", fundamentos: false,
    sugestoes: ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "USDT", "USDC", "LINK", "DOT"],
  },
  {
    // Sem cotação: o valor cresce pelo CDI (ex.: CDB a 100% do CDI). Com 0% fica parado (imóvel, negócio próprio, caixa).
    id: "renda_fixa", nome: "Renda fixa e outros", curto: "RF", moeda: "BRL", formato: /^[A-Z0-9][A-Z0-9 .\-%]{1,29}$/, exemplo: "CDB INTER",
    fundamentos: false,
    sugestoes: ["CDB INTER", "TESOURO SELIC", "LCI", "CAIXA", "NEGOCIO PROPRIO"],
  },
];

/** Tipos com cotação de mercado (os que dá para lançar compra e venda por preço). */
export const TIPOS_MERCADO = TIPOS.filter((t) => t.id !== "renda_fixa");

export const infoTipo = (t: string | null | undefined): InfoTipo | null => TIPOS.find((x) => x.id === t) ?? null;

/** Tipos negociados fora da B3 ou sem dados no Fundamentus: cotação só pelo Yahoo. */
export const SO_YAHOO: Tipo[] = ["bdr", "stock", "etf_int", "reit", "cripto"];

/** Código do Yahoo Finance para cada tipo. */
export function simboloYahoo(ticker: string, tipo: Tipo | null): string {
  if (tipo === "stock" || tipo === "etf_int" || tipo === "reit") return ticker.replace(".", "-");
  if (tipo === "cripto") return `${ticker}-USD`;
  return `${ticker}.SA`;
}
