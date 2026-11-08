// Imposto de renda da carteira: apuração mensal do ganho nas vendas, DARF e a posição de 31/12 para "Bens e Direitos".
// Base: as compras e vendas lançadas (ou importadas da B3). O que está na carteira sem lançamento entra como um lote inicial
// com o preço médio cadastrado. Regras da Receita para pessoa física (swing trade):
// - Ações: isento se as vendas de ações no mês somam até R$ 20 mil; acima, 15% sobre o lucro.
// - ETFs e BDRs: 15%, sem isenção. Prejuízo de ações, ETFs e BDRs se compensam entre si ("operações comuns").
// - FIIs: 20%, sem isenção; prejuízo de FII só compensa lucro de FII.
// - Criptomoedas: isento se as vendas no mês somam até R$ 35 mil; acima, 15% (sem compensar prejuízo).
// - Exterior (stocks, ETFs internacionais e REITs): 15% na declaração anual (Lei 14.754/2023), sem DARF mensal.
// - IRRF "dedo-duro" de 0,005% sobre as vendas é descontado do imposto. DARF abaixo de R$ 10 fica para o mês seguinte.
import { migrar, query } from "./db";
import { infoTipo, type Tipo } from "./tipos";

export type Grupo = "acoes" | "comum" | "fii" | "cripto" | "exterior";

const ISENCAO_ACOES = 20_000;
const ISENCAO_CRIPTO = 35_000;
const DARF_MINIMO = 10;
const IRRF_FONTE = 0.00005;

type Op = {
  id: number;
  data: string;
  ticker: string;
  tipo: "C" | "V";
  quantidade: number;
  preco: number;
  custos: number;
  tipo_ativo: string | null;
  preco_medio_venda: number | null;
};

export type Venda = {
  data: string;
  ticker: string;
  tipo: Tipo;
  grupo: Grupo;
  quantidade: number;
  valor: number; // quantidade x preço, na moeda do ativo
  custo: number; // quantidade x preço médio
  lucro: number; // valor - custos da venda - custo
  estimado: boolean; // preço médio reconstruído (sem lançamento de todas as compras)
  moeda: "BRL" | "USD";
};

export type Mes = {
  mes: string; // AAAA-MM
  vendasAcoes: number;
  lucroAcoes: number;
  isentoAcoes: boolean;
  lucroComum: number; // ETFs e BDRs
  baseComum: number; // depois da isenção, antes do prejuízo
  prejuizoComumUsado: number;
  prejuizoComumFim: number;
  impostoComum: number;
  lucroFii: number;
  prejuizoFiiUsado: number;
  prejuizoFiiFim: number;
  impostoFii: number;
  vendasCripto: number;
  lucroCripto: number;
  impostoCripto: number;
  irrf: number;
  imposto: number; // devido no mês, já sem o IRRF
  darf: number; // a pagar (inclui o que ficou de meses abaixo de R$ 10)
  vencimento: string | null;
  vendas: Venda[];
};

export type Bem = {
  ticker: string;
  nome: string | null;
  tipo: Tipo;
  codigo: string; // grupo-código em Bens e Direitos
  quantidade: number;
  custo: number; // em reais (no exterior, na moeda do ativo)
  moeda: "BRL" | "USD";
  custoAnterior: number;
  quantidadeAnterior: number;
};

export type Apuracao = {
  meses: Mes[];
  vendas: Venda[];
  avisos: string[];
  prejuizoComum: number;
  prejuizoFii: number;
  anos: number[];
};

/** Grupo/código em "Bens e Direitos" (confira no programa da Receita do ano). */
export function codigoBem(tipo: Tipo, ticker: string): string {
  switch (tipo) {
    case "acao": return "03-01";
    case "fii": return "07-03";
    case "etf": return "07-09";
    case "bdr": return "04-04";
    case "cripto": return ticker === "BTC" ? "08-01" : /^(USDT|USDC|DAI|BUSD|FDUSD)$/.test(ticker) ? "08-03" : "08-02";
    case "renda_fixa": return /^(LCI|LCA|CRI|CRA)/.test(ticker) ? "04-03" : "04-02";
    default: return "exterior";
  }
}

function grupoDe(tipo: Tipo): Grupo | null {
  if (tipo === "acao") return "acoes";
  if (tipo === "etf" || tipo === "bdr") return "comum";
  if (tipo === "fii") return "fii";
  if (tipo === "cripto") return "cripto";
  if (tipo === "stock" || tipo === "etf_int" || tipo === "reit") return "exterior";
  return null;
}

/** Último dia útil (segunda a sexta) do mês seguinte a `mes`. Feriados não entram: confira se cair em um. */
export function vencimentoDarf(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m + 1, 0)); // último dia do mês seguinte
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const somaMes = (mes: string, n: number) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
};

type Lote = { quantidade: number; pm: number };

/**
 * Refaz a carteira pelas operações: preço médio de cada compra (com custos) e o lucro de cada venda.
 * Também guarda a posição no fim de cada ano, para "Bens e Direitos".
 */
async function refazer(usuarioId: number | null) {
  await migrar();
  const [ops, carteira] = await Promise.all([
    query<Op>(
      `select id, data::text, ticker, tipo, quantidade, preco, custos, tipo_ativo, preco_medio_venda
         from operacoes where usuario_id is not distinct from $1 order by data, id`,
      [usuarioId],
    ),
    query<{ ticker: string; quantidade: number; preco_medio: number; tipo: string | null; desde: string }>(
      `select ticker, quantidade, preco_medio, tipo, coalesce(data_aplicacao, criado_em::date)::text as desde
         from carteira where usuario_id is not distinct from $1`,
      [usuarioId],
    ),
  ]);
  const tickers = [...new Set([...ops.map((o) => o.ticker), ...carteira.map((c) => c.ticker)])];
  const analises = tickers.length
    ? await query<{ ticker: string; tipo: string; nome: string | null }>(
        "select distinct on (ticker) ticker, tipo, nome from analises where ticker = any($1) order by ticker, data desc",
        [tickers],
      )
    : [];
  const daCarteira = new Map(carteira.map((c) => [c.ticker, c]));
  const daAnalise = new Map(analises.map((a) => [a.ticker, a]));
  const avisos: string[] = [];

  const tipoDe = (ticker: string): Tipo => {
    const op = ops.find((o) => o.ticker === ticker && o.tipo_ativo);
    const t = infoTipo(daCarteira.get(ticker)?.tipo)?.id ?? infoTipo(op?.tipo_ativo)?.id ?? infoTipo(daAnalise.get(ticker)?.tipo)?.id;
    if (t) return t;
    if (/^[A-Z]{4}3[1-5]$/.test(ticker)) return "bdr";
    if (/^[A-Z]{4}11$/.test(ticker)) {
      avisos.push(`${ticker}: não sei se é FII, ETF ou unit; contei como ação. Lance o tipo certo na carteira para corrigir.`);
    }
    return "acao";
  };

  const vendas: Venda[] = [];
  // Posição no fim de cada ano: ano -> ticker -> lote
  const fimDeAno = new Map<number, Map<string, Lote>>();
  const primeiroAno = Math.min(
    new Date().getFullYear(),
    ...ops.map((o) => Number(o.data.slice(0, 4))),
    ...carteira.map((c) => Number(c.desde.slice(0, 4))),
  );
  const anoAtual = new Date().getFullYear();

  for (const ticker of tickers) {
    const tipo = tipoDe(ticker);
    const moeda = infoTipo(tipo)?.moeda ?? "BRL";
    const grupo = grupoDe(tipo);
    const minhas = ops.filter((o) => o.ticker === ticker);
    const c = daCarteira.get(ticker);
    const liquido = minhas.reduce((s, o) => s + (o.tipo === "C" ? o.quantidade : -o.quantidade), 0);
    // Cotas na carteira sem lançamento (cadastro à mão ou importação da posição): um lote antes de tudo
    const inicial = c ? c.quantidade - liquido : 0;
    const pmReserva = c?.preco_medio ?? null;
    const lote: Lote = { quantidade: 0, pm: 0 };
    let estimado = false;
    const eventos: { data: string; op: Op | null }[] = minhas.map((o) => ({ data: o.data, op: o }));
    if (inicial > 1e-9) {
      const dataInicial = [c!.desde, ...minhas.map((o) => o.data)].sort()[0];
      eventos.unshift({ data: dataInicial, op: null });
    }

    let e = 0;
    for (let ano = primeiroAno; ano <= anoAtual; ano++) {
      const limite = `${ano}-12-31`;
      for (; e < eventos.length && eventos[e].data <= limite; e++) {
        const { op } = eventos[e];
        if (!op) {
          lote.pm = pmReserva ?? 0;
          lote.quantidade = inicial;
          estimado = true;
          continue;
        }
        if (op.tipo === "C") {
          const qtd = lote.quantidade + op.quantidade;
          lote.pm = (lote.quantidade * lote.pm + op.quantidade * op.preco + (op.custos ?? 0)) / qtd;
          lote.quantidade = qtd;
          continue;
        }
        // Venda
        let pm = op.preco_medio_venda ?? lote.pm;
        let estimadoAqui = op.preco_medio_venda == null && estimado;
        if (op.preco_medio_venda == null && op.quantidade > lote.quantidade + 1e-9) {
          // Vendeu mais do que os lançamentos mostram: as cotas que faltam entram pelo preço médio cadastrado
          const falta = op.quantidade - lote.quantidade;
          const pmFalta = pmReserva ?? op.preco;
          pm = (lote.quantidade * lote.pm + falta * pmFalta) / op.quantidade;
          estimadoAqui = true;
          avisos.push(
            `${ticker} em ${op.data.split("-").reverse().join("/")}: a venda de ${op.quantidade} é maior que as compras lançadas; ` +
              (pmReserva != null ? "usei o preço médio cadastrado para o que faltava." : "sem preço médio, considerei lucro zero no que faltava."),
          );
        }
        const valor = op.quantidade * op.preco;
        const custo = op.quantidade * pm;
        if (grupo) {
          vendas.push({ data: op.data, ticker, tipo, grupo, quantidade: op.quantidade, valor, custo, lucro: valor - (op.custos ?? 0) - custo, estimado: estimadoAqui, moeda });
        }
        lote.quantidade = Math.max(0, lote.quantidade - op.quantidade);
        if (lote.quantidade < 1e-9) {
          lote.quantidade = 0;
          lote.pm = 0;
        }
      }
      if (lote.quantidade > 0) {
        if (!fimDeAno.has(ano)) fimDeAno.set(ano, new Map());
        fimDeAno.get(ano)!.set(ticker, { ...lote });
      }
    }

    // Compra e venda do mesmo ativo no mesmo dia: pode ser day trade (20%), que aqui é tratado como operação comum
    const dias = new Map<string, Set<string>>();
    for (const o of minhas) dias.set(o.data, (dias.get(o.data) ?? new Set()).add(o.tipo));
    for (const [d, t] of dias) {
      if (t.size === 2) avisos.push(`${ticker} em ${d.split("-").reverse().join("/")}: compra e venda no mesmo dia (day trade paga 20% e tem DARF separado); aqui entrou como operação comum.`);
    }
  }

  return { vendas, fimDeAno, avisos, tipoDe, nomeDe: (t: string) => daAnalise.get(t)?.nome ?? null };
}

/** Lucro de cada venda em reais, por data (para a rentabilidade por cotas). Vendas no exterior ficam de fora. */
export async function lucrosRealizados(usuarioId: number | null): Promise<{ data: string; lucro: number }[]> {
  const { vendas } = await refazer(usuarioId);
  return vendas.filter((v) => v.moeda === "BRL").map((v) => ({ data: v.data, lucro: v.lucro }));
}

export async function apurarIr(usuarioId: number | null): Promise<Apuracao> {
  const { vendas, fimDeAno, avisos } = await refazer(usuarioId);
  const mensais = vendas.filter((v) => v.grupo !== "exterior");
  const meses: Mes[] = [];
  let prejuizoComum = 0;
  let prejuizoFii = 0;
  let pendente = 0; // imposto abaixo de R$ 10 que passa para o mês seguinte

  if (mensais.length) {
    const ultimo = new Date().toISOString().slice(0, 7);
    for (let mes = mensais[0].data.slice(0, 7); mes <= ultimo; mes = somaMes(mes, 1)) {
      const doMes = mensais.filter((v) => v.data.startsWith(mes));
      const soma = (g: Grupo, campo: "valor" | "lucro") => doMes.filter((v) => v.grupo === g).reduce((s, v) => s + v[campo], 0);

      const vendasAcoes = soma("acoes", "valor");
      const lucroAcoes = soma("acoes", "lucro");
      const isentoAcoes = vendasAcoes <= ISENCAO_ACOES;
      const lucroComum = soma("comum", "lucro");
      // No mês isento, o lucro das ações não paga nem gasta prejuízo; o prejuízo das ações continua valendo
      const baseComum = (isentoAcoes ? Math.min(0, lucroAcoes) : lucroAcoes) + lucroComum;
      let prejuizoComumUsado = 0;
      let tributavelComum = 0;
      if (baseComum > 0) {
        prejuizoComumUsado = Math.min(prejuizoComum, baseComum);
        tributavelComum = baseComum - prejuizoComumUsado;
        prejuizoComum -= prejuizoComumUsado;
      } else prejuizoComum += -baseComum;

      const lucroFii = soma("fii", "lucro");
      let prejuizoFiiUsado = 0;
      let tributavelFii = 0;
      if (lucroFii > 0) {
        prejuizoFiiUsado = Math.min(prejuizoFii, lucroFii);
        tributavelFii = lucroFii - prejuizoFiiUsado;
        prejuizoFii -= prejuizoFiiUsado;
      } else prejuizoFii += -lucroFii;

      const vendasCripto = soma("cripto", "valor");
      const lucroCripto = soma("cripto", "lucro");
      const impostoCripto = vendasCripto > ISENCAO_CRIPTO && lucroCripto > 0 ? lucroCripto * 0.15 : 0;

      const impostoComum = tributavelComum * 0.15;
      const impostoFii = tributavelFii * 0.2;
      // Dedo-duro: retido pela corretora nas vendas tributáveis em bolsa (dispensado abaixo de R$ 1)
      const vendasBolsa = (isentoAcoes ? 0 : vendasAcoes) + soma("comum", "valor") + soma("fii", "valor");
      const irrf = vendasBolsa * IRRF_FONTE >= 1 ? vendasBolsa * IRRF_FONTE : 0;
      const imposto = Math.max(0, impostoComum + impostoFii - irrf) + impostoCripto;
      const acumulado = imposto + pendente;
      const darf = acumulado >= DARF_MINIMO ? acumulado : 0;
      pendente = acumulado >= DARF_MINIMO ? 0 : acumulado;

      if (doMes.length || darf > 0) {
        meses.push({
          mes, vendasAcoes, lucroAcoes, isentoAcoes, lucroComum, baseComum, prejuizoComumUsado, prejuizoComumFim: prejuizoComum,
          impostoComum, lucroFii, prejuizoFiiUsado, prejuizoFiiFim: prejuizoFii, impostoFii, vendasCripto, lucroCripto, impostoCripto,
          irrf, imposto, darf, vencimento: darf > 0 ? vencimentoDarf(mes) : null, vendas: doMes,
        });
      }
    }
  }
  if (pendente > 0) avisos.push(`R$ ${pendente.toFixed(2).replace(".", ",")} de imposto ficaram abaixo do mínimo do DARF (R$ 10) e somam no próximo mês com imposto.`);

  const anos = [...new Set([...fimDeAno.keys(), ...vendas.map((v) => Number(v.data.slice(0, 4)))])].sort((a, b) => b - a);
  return { meses: meses.reverse(), vendas, avisos: [...new Set(avisos)], prejuizoComum, prejuizoFii, anos };
}

/** Posição em 31/12 de `ano` e do ano anterior, com o custo de aquisição, para a ficha "Bens e Direitos". */
export async function bensEDireitos(usuarioId: number | null, ano: number): Promise<{ bens: Bem[]; rendaFixa: Bem[] }> {
  const { fimDeAno, tipoDe, nomeDe } = await refazer(usuarioId);
  const agora = fimDeAno.get(ano) ?? new Map<string, Lote>();
  const antes = fimDeAno.get(ano - 1) ?? new Map<string, Lote>();
  const bens: Bem[] = [];
  for (const ticker of new Set([...agora.keys(), ...antes.keys()])) {
    const tipo = tipoDe(ticker);
    if (tipo === "renda_fixa") continue;
    const a = agora.get(ticker);
    const b = antes.get(ticker);
    bens.push({
      ticker, nome: nomeDe(ticker), tipo, codigo: codigoBem(tipo, ticker), moeda: infoTipo(tipo)?.moeda ?? "BRL",
      quantidade: a?.quantidade ?? 0, custo: a ? a.quantidade * a.pm : 0,
      quantidadeAnterior: b?.quantidade ?? 0, custoAnterior: b ? b.quantidade * b.pm : 0,
    });
  }
  bens.sort((x, y) => x.codigo.localeCompare(y.codigo) || x.ticker.localeCompare(y.ticker));

  // Renda fixa e outros bens: declarados pelo valor aplicado
  const rf = await query<{ ticker: string; quantidade: number; data_aplicacao: string | null }>(
    `select ticker, quantidade, coalesce(data_aplicacao, criado_em::date)::text as data_aplicacao
       from carteira where usuario_id is not distinct from $1 and tipo = 'renda_fixa' order by ticker`,
    [usuarioId],
  );
  const rendaFixa = rf
    .filter((r) => (r.data_aplicacao ?? "") <= `${ano}-12-31`)
    .map((r) => ({
      ticker: r.ticker, nome: null, tipo: "renda_fixa" as Tipo, codigo: codigoBem("renda_fixa", r.ticker), moeda: "BRL" as const,
      quantidade: 1, custo: r.quantidade,
      quantidadeAnterior: (r.data_aplicacao ?? "") <= `${ano - 1}-12-31` ? 1 : 0,
      custoAnterior: (r.data_aplicacao ?? "") <= `${ano - 1}-12-31` ? r.quantidade : 0,
    }));
  return { bens, rendaFixa };
}
