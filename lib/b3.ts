// Importa a carteira a partir dos arquivos da Área do Investidor da B3 (investidor.b3.com.br):
// - "Posição" (Extratos > Posição > Baixar): quantidades por tipo de ativo, sem preço médio.
// - "Negociação" (Extratos > Negociação > Baixar): compras e vendas, usadas para calcular o preço médio.
import { numeroBr } from "./mercado";
import { lerXlsx, type Aba, type Celula } from "./xlsx";
import type { Tipo } from "./tipos";

export type OrigemPm = "negociacoes" | "carteira" | "fechamento";

export type ItemImportado = {
  ticker: string;
  tipo: Tipo | null; // pela aba do arquivo; vazio quando não dá para saber (o app detecta na análise)
  produto: string | null;
  quantidade: number;
  precoMedio: number | null;
  origemPm: OrigemPm | null;
  precoFechamento: number | null;
  aviso: string | null;
};

export type Ignorado = { codigo: string; motivo: string };

export type ResultadoB3 = { itens: ItemImportado[]; ignorados: Ignorado[]; arquivos: string[] };

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const numero = (v: Celula) => (typeof v === "number" ? v : typeof v === "string" ? numeroBr(v.replace(/R\$/g, "")) : null);

/** Fracionário (PETR4F) vira o código normal (PETR4). */
const codigoBase = (c: string) => c.trim().toUpperCase().replace(/^([A-Z]{4}\d{1,2})F$/, "$1");

/** Ações, units, FIIs e ETFs da B3. */
const ACAO = /^[A-Z]{4}(3|4|5|6|7|8|11)$/;
const BDR = /^[A-Z]{4}3[1-5]$/;

/** Acha a linha de cabeçalho e devolve as linhas como objetos { cabecalho normalizado: valor }. */
function tabela(aba: Aba, obrigatorias: string[]): Record<string, Celula>[] | null {
  const idx = aba.linhas.findIndex((l) => obrigatorias.every((o) => l.some((c) => norm(c) === o)));
  if (idx < 0) return null;
  const cab = aba.linhas[idx].map(norm);
  return aba.linhas.slice(idx + 1).map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i] ?? null])));
}

// Aba do arquivo de posição -> tipo de ativo (ou motivo para ficar de fora)
const CATEGORIAS: [RegExp, Tipo | null, string | null][] = [
  [/^acoes?$/, "acao", null],
  [/fundo|fii/, "fii", null],
  [/etf/, "etf", null],
  [/bdr/, "bdr", null],
  [/rendafixa|tesouro|cdb|lci|lca|debenture/, null, "renda fixa ou Tesouro: cadastre em “Renda fixa e outros”, na página Carteira"],
];

type Posicao = { ticker: string; tipo: Tipo | null; produto: string | null; quantidade: number; fechamento: number | null };
type Negocio = { data: string; tipo: "C" | "V"; ticker: string; quantidade: number; preco: number };

function lerPosicao(abas: Aba[], ignorados: Ignorado[]): Posicao[] | null {
  let achou = false;
  const mapa = new Map<string, Posicao>();
  for (const aba of abas) {
    const linhas = tabela(aba, ["quantidade"]);
    if (!linhas || !linhas.some((l) => "codigodenegociacao" in l || "produto" in l)) continue;
    if (linhas.some((l) => "tipodemovimentacao" in l || "entradasaida" in l)) continue; // é extrato, não posição
    achou = true;
    const categoria = CATEGORIAS.find(([re]) => re.test(norm(aba.nome)));
    for (const l of linhas) {
      const codigo = String(l.codigodenegociacao ?? "").trim();
      const produto = l.produto ? String(l.produto).trim() : null;
      const qtd = numero(l.quantidade);
      if ((!codigo && !produto) || qtd == null || qtd <= 0) continue; // linhas de total e vazias
      if (!categoria || !categoria[1]) {
        ignorados.push({ codigo: codigo || produto!, motivo: categoria?.[2] ?? `aba "${aba.nome}" não reconhecida` });
        continue;
      }
      const ticker = codigoBase(codigo);
      if (!(categoria[1] === "bdr" ? BDR : ACAO).test(ticker)) {
        ignorados.push({ codigo: codigo || produto!, motivo: "código de negociação não reconhecido" });
        continue;
      }
      const atual = mapa.get(ticker);
      mapa.set(ticker, {
        ticker,
        tipo: categoria[1],
        produto,
        quantidade: (atual?.quantidade ?? 0) + qtd, // soma a mesma ação em corretoras diferentes
        fechamento: numero(l.precodefechamento) ?? atual?.fechamento ?? null,
      });
    }
  }
  return achou ? [...mapa.values()] : null;
}

function lerNegociacoes(abas: Aba[]): Negocio[] | null {
  for (const aba of abas) {
    const linhas = tabela(aba, ["codigodenegociacao", "quantidade", "preco"]);
    if (!linhas || !linhas.some((l) => "tipodemovimentacao" in l)) continue;
    return linhas
      .map((l) => {
        const tipo = norm(l.tipodemovimentacao);
        const data = String(l.datadonegocio ?? "");
        const [d, m, a] = data.split("/");
        return {
          data: a ? `${a}-${m}-${d}` : data,
          tipo: tipo.startsWith("compra") ? "C" : tipo.startsWith("venda") ? "V" : null,
          ticker: codigoBase(String(l.codigodenegociacao ?? "")),
          quantidade: numero(l.quantidade) ?? 0,
          preco: numero(l.preco) ?? 0,
        };
      })
      .filter((n): n is Negocio => n.tipo != null && !!n.ticker && n.quantidade > 0 && n.preco > 0);
  }
  return null;
}

/** Preço médio contábil: compras entram na média; vendas só reduzem a quantidade. */
function precoMedio(negocios: Negocio[]) {
  const r = new Map<string, { quantidade: number; pm: number }>();
  for (const n of [...negocios].sort((x, y) => x.data.localeCompare(y.data) || (x.tipo === "C" ? -1 : 1))) {
    const p = r.get(n.ticker) ?? { quantidade: 0, pm: 0 };
    if (n.tipo === "C") {
      p.pm = (p.pm * p.quantidade + n.preco * n.quantidade) / (p.quantidade + n.quantidade);
      p.quantidade += n.quantidade;
    } else {
      p.quantidade = Math.max(0, p.quantidade - n.quantidade);
      if (p.quantidade === 0) p.pm = 0;
    }
    r.set(n.ticker, p);
  }
  return r;
}

/**
 * Lê um ou mais arquivos da B3 e monta a carteira (ações, FIIs e ETFs).
 * `carteiraAtual` dá o preço médio já cadastrado.
 */
export function importarB3(arquivos: { nome: string; dados: Uint8Array }[], carteiraAtual: Map<string, number>): ResultadoB3 {
  const ignorados: Ignorado[] = [];
  const descricao: string[] = [];
  let posicoes: Posicao[] | null = null;
  let negocios: Negocio[] = [];

  for (const arq of arquivos) {
    const abas = lerXlsx(arq.dados);
    const pos = lerPosicao(abas, ignorados);
    const neg = lerNegociacoes(abas);
    if (pos) {
      posicoes = [...(posicoes ?? []), ...pos];
      descricao.push(`${arq.nome}: posição`);
    } else if (neg) {
      negocios = negocios.concat(neg);
      descricao.push(`${arq.nome}: ${neg.length} negociações`);
    } else {
      throw new Error(`Não reconheci "${arq.nome}". Envie o arquivo de Posição ou de Negociação baixado da Área do Investidor da B3.`);
    }
  }

  const pms = precoMedio(negocios);
  const itens: ItemImportado[] = [];

  if (posicoes) {
    const somadas = new Map<string, Posicao>();
    for (const p of posicoes) {
      const a = somadas.get(p.ticker);
      somadas.set(p.ticker, a ? { ...a, quantidade: a.quantidade + p.quantidade } : p);
    }
    for (const p of somadas.values()) {
      const calc = pms.get(p.ticker);
      let precoMedioFinal: number | null = null;
      let origem: OrigemPm | null = null;
      let aviso: string | null = null;
      if (calc && calc.pm > 0) {
        precoMedioFinal = calc.pm;
        origem = "negociacoes";
        if (Math.abs(calc.quantidade - p.quantidade) > 0.001) {
          aviso = `as negociações somam ${calc.quantidade} ações e a posição tem ${p.quantidade} (desdobramento, bonificação ou histórico incompleto); confira o preço médio`;
        }
      } else if (carteiraAtual.has(p.ticker)) {
        precoMedioFinal = carteiraAtual.get(p.ticker)!;
        origem = "carteira";
      } else if (p.fechamento) {
        precoMedioFinal = p.fechamento;
        origem = "fechamento";
        aviso = "sem preço médio no arquivo; usei o preço de fechamento. Ajuste se souber o seu";
      }
      itens.push({ ticker: p.ticker, tipo: p.tipo, produto: p.produto, quantidade: p.quantidade, precoMedio: precoMedioFinal, origemPm: origem, precoFechamento: p.fechamento, aviso });
    }
  } else {
    for (const [ticker, calc] of pms) {
      if (calc.quantidade <= 0) continue;
      const bdr = BDR.test(ticker);
      if (!ACAO.test(ticker) && !bdr) {
        ignorados.push({ codigo: ticker, motivo: "código não reconhecido" });
        continue;
      }
      itens.push({ ticker, tipo: bdr ? "bdr" : null, produto: null, quantidade: calc.quantidade, precoMedio: calc.pm, origemPm: "negociacoes", precoFechamento: null, aviso: null });
    }
  }

  itens.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const vistos = new Set<string>();
  return {
    itens,
    ignorados: ignorados.filter((i) => (vistos.has(i.codigo) ? false : (vistos.add(i.codigo), true))),
    arquivos: descricao,
  };
}
