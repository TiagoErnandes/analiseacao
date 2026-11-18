"use server";

import { revalidatePath } from "next/cache";
import { importarB3, type NegocioImportado, type ResultadoB3 } from "@/lib/b3";
import { migrar, pool, query, type Carteira } from "@/lib/db";
import { carregarSeriesRf, descreverTaxa, fatorPosicao } from "@/lib/rendafixa";
import { brl, dataBr } from "@/lib/format";
import { infoTipo, type Tipo } from "@/lib/tipos";
import { usuarioOuErro } from "@/lib/auth";
import { cotacaoUsdtBrl } from "@/lib/cripto";

const numero = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); // aceita 1.234,56 e 1234.56
};

export async function salvarAtivo(form: FormData) {
  const { id: dono } = await usuarioOuErro();
  const info = infoTipo(String(form.get("tipo") ?? "acao"));
  if (!info) throw new Error("Tipo de ativo inválido");
  const ticker = String(form.get("ticker") ?? "").trim().toUpperCase();
  if (!info.formato.test(ticker)) throw new Error(`Código inválido para ${info.nome} (ex.: ${info.exemplo})`);
  const quantidade = numero(form.get("quantidade"));
  const preco_medio = numero(form.get("preco_medio"));
  if (!(quantidade >= 0) || !(preco_medio >= 0)) throw new Error("Quantidade e preço médio devem ser números");

  await query(
    `insert into carteira (usuario_id, ticker, quantidade, preco_medio, tipo) values ($5, $1, $2, $3, $4)
     on conflict (usuario_id, ticker) do update set quantidade = excluded.quantidade, preco_medio = excluded.preco_medio, tipo = excluded.tipo`,
    [ticker, quantidade, preco_medio, info.id, dono],
  );
  revalidatePath("/carteira");
  revalidatePath("/");
}

export async function removerAtivo(form: FormData) {
  const { id: dono } = await usuarioOuErro();
  const ticker = String(form.get("ticker") ?? "");
  await query("delete from carteira where ticker = $1 and usuario_id is not distinct from $2", [ticker, dono]);
  revalidatePath("/carteira");
  revalidatePath("/");
}

// ---------- Renda fixa e outros bens ----------

/** CDB, caixinha, Tesouro, LCI, imóvel, negócio próprio: valor aplicado que rende % do CDI, prefixado ou IPCA+ (0% do CDI = fica parado). */
export async function salvarRendaFixa(form: FormData): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const { id: dono } = await usuarioOuErro();
    const info = infoTipo("renda_fixa")!;
    const nome = String(form.get("nome") ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!info.formato.test(nome)) return { ok: false, mensagem: "Dê um nome com 2 a 30 letras ou números, sem acento (ex.: CAIXINHA NUBANK)." };
    if (infoTipo("acao")!.formato.test(nome) || /^[A-Z]{1,5}$/.test(nome))
      return { ok: false, mensagem: "Esse nome parece código de ação. Use algo como “CDB INTER”." };
    const valor = numero(form.get("valor"));
    if (!(valor > 0)) return { ok: false, mensagem: "Informe o valor aplicado." };
    const indexador = String(form.get("indexador") ?? "cdi");
    if (!["cdi", "pre", "ipca"].includes(indexador)) return { ok: false, mensagem: "Escolha como rende: % do CDI, prefixado ou IPCA+." };
    const vazio = form.get("taxa") == null || String(form.get("taxa")).trim() === "";
    let taxaCdi: number | null = null;
    let taxaAnual: number | null = null;
    if (indexador === "cdi") {
      const pct = vazio ? 100 : numero(form.get("taxa"));
      if (!(pct >= 0 && pct <= 300)) return { ok: false, mensagem: "O rendimento vai de 0% a 300% do CDI." };
      taxaCdi = pct / 100;
    } else {
      const pct = numero(form.get("taxa"));
      if (vazio || !(pct >= 0 && pct <= 50)) return { ok: false, mensagem: "Informe a taxa ao ano (de 0% a 50%), ex.: 12,5." };
      taxaAnual = pct / 100;
    }
    const data = String(form.get("data") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, mensagem: "Data inválida." };
    const vencimento = String(form.get("vencimento") ?? "").trim() || null;
    if (vencimento && (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || vencimento <= data))
      return { ok: false, mensagem: "O vencimento precisa ser depois da data da aplicação." };
    const isento = form.get("isento") === "on";
    await migrar();
    await query(
      `insert into carteira (usuario_id, ticker, quantidade, preco_medio, tipo, taxa_cdi, data_aplicacao, indexador, taxa_anual, vencimento, isento_ir)
       values ($1, $2, $3, 1, 'renda_fixa', $4, $5, $6, $7, $8, $9)
       on conflict (usuario_id, ticker) do update set quantidade = excluded.quantidade, preco_medio = 1, tipo = 'renda_fixa',
         taxa_cdi = excluded.taxa_cdi, data_aplicacao = excluded.data_aplicacao, indexador = excluded.indexador,
         taxa_anual = excluded.taxa_anual, vencimento = excluded.vencimento, isento_ir = excluded.isento_ir`,
      [dono, nome, valor, taxaCdi, data, indexador, taxaAnual, vencimento, isento],
    );
    revalidatePath("/carteira");
    revalidatePath("/");
    const como = descreverTaxa({ tipo: "renda_fixa", indexador, taxa_cdi: taxaCdi, taxa_anual: taxaAnual });
    return { ok: true, mensagem: `${nome} salvo: ${brl(valor)} rendendo ${como} desde ${dataBr(data)}.` };
  } catch (err) {
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  }
}

/**
 * Aplicar mais ou resgatar parte de uma renda fixa já cadastrada (ex.: guardar ou tirar dinheiro da caixinha).
 * O valor vira cotas pelo fator do dia: aplicar soma ao investido; resgatar tira o investido na proporção (como uma venda pelo preço médio).
 */
export async function movimentarRendaFixa(form: FormData): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const { id: dono } = await usuarioOuErro();
    const nome = String(form.get("nome") ?? "");
    const operacao = String(form.get("operacao") ?? "");
    if (operacao !== "aplicar" && operacao !== "resgatar") return { ok: false, mensagem: "Escolha aplicar ou resgatar." };
    const valor = numero(form.get("valor"));
    if (!(valor > 0)) return { ok: false, mensagem: "Informe o valor." };
    const hojeSp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const data = String(form.get("data") ?? "") || hojeSp;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hojeSp) return { ok: false, mensagem: "Data inválida (não pode ser no futuro)." };

    const [p] = await query<Carteira>(
      `select ticker, quantidade, preco_medio, tipo, taxa_cdi, data_aplicacao::text, indexador, taxa_anual, vencimento::text, isento_ir
         from carteira where usuario_id is not distinct from $1 and ticker = $2 and tipo = 'renda_fixa'`,
      [dono, nome],
    );
    if (!p) return { ok: false, mensagem: "Aplicação não encontrada." };
    if (p.data_aplicacao && data < p.data_aplicacao) return { ok: false, mensagem: `A data precisa ser a partir de ${dataBr(p.data_aplicacao)}.` };
    const fator = fatorPosicao(await carregarSeriesRf([p]), p, data);
    const cotas = valor / fator;
    const investido = p.quantidade * p.preco_medio;

    if (operacao === "aplicar") {
      const novas = p.quantidade + cotas;
      await query("update carteira set quantidade = $3, preco_medio = $4 where usuario_id is not distinct from $1 and ticker = $2", [
        dono, nome, novas, (investido + valor) / novas,
      ]);
    } else {
      const saldo = p.quantidade * fator;
      if (valor > saldo * 1.005) return { ok: false, mensagem: `O saldo em ${dataBr(data)} era de ${brl(saldo)}; não dá para resgatar ${brl(valor)}.` };
      if (valor >= saldo * 0.995) {
        await query("delete from carteira where usuario_id is not distinct from $1 and ticker = $2", [dono, nome]);
        revalidatePath("/carteira");
        revalidatePath("/");
        return { ok: true, mensagem: `${nome} resgatado por inteiro (${brl(valor)}) e retirado da carteira.` };
      }
      await query("update carteira set quantidade = $3 where usuario_id is not distinct from $1 and ticker = $2", [dono, nome, p.quantidade - cotas]);
    }
    revalidatePath("/carteira");
    revalidatePath("/");
    return { ok: true, mensagem: `${operacao === "aplicar" ? "Aplicação" : "Resgate"} de ${brl(valor)} em ${nome} registrado.` };
  } catch (err) {
    return { ok: false, mensagem: `Erro: ${(err as Error).message}` };
  }
}

// ---------- Importação da B3 ----------

const TAMANHO_MAXIMO = 8 * 1024 * 1024;

export async function lerArquivosB3(form: FormData): Promise<{ ok: true; resultado: ResultadoB3 } | { ok: false; erro: string }> {
  try {
    const { id: dono } = await usuarioOuErro();
    const arquivos = form.getAll("arquivos").filter((f): f is File => f instanceof File && f.size > 0);
    if (arquivos.length === 0) return { ok: false, erro: "Escolha pelo menos um arquivo." };
    if (arquivos.length > 5) return { ok: false, erro: "Envie no máximo 5 arquivos por vez." };
    if (arquivos.some((f) => f.size > TAMANHO_MAXIMO)) return { ok: false, erro: "Arquivo grande demais (máximo 8 MB)." };
    if (arquivos.some((f) => !/\.xlsx$/i.test(f.name))) {
      return { ok: false, erro: "Use o arquivo em Excel (.xlsx) baixado da B3." };
    }

    const carteira = await query<{ ticker: string; preco_medio: number }>(
      "select ticker, preco_medio from carteira where usuario_id is not distinct from $1",
      [dono],
    );
    const resultado = importarB3(
      await Promise.all(arquivos.map(async (f) => ({ nome: f.name, dados: new Uint8Array(await f.arrayBuffer()) }))),
      new Map(carteira.map((c) => [c.ticker, c.preco_medio])),
    );
    return { ok: true, resultado };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}

export async function aplicarImportacaoB3(
  itens: { ticker: string; quantidade: number; preco_medio: number; tipo: Tipo | null }[],
  modo: "substituir" | "atualizar",
  negocios: NegocioImportado[] = [],
): Promise<{ ok: boolean; mensagem: string }> {
  const validos = itens.filter(
    (i) => /^[A-Z]{4}\d{1,2}$/.test(i.ticker) && Number.isFinite(i.quantidade) && i.quantidade > 0 && Number.isFinite(i.preco_medio) && i.preco_medio >= 0,
  );
  if (validos.length !== itens.length) return { ok: false, mensagem: "Há linhas com código, quantidade ou preço médio inválidos." };
  if (validos.length === 0) return { ok: false, mensagem: "Nenhum ativo para importar." };
  const negociosValidos = negocios.filter(
    (n) => /^\d{4}-\d{2}-\d{2}$/.test(n.data) && (n.tipo === "C" || n.tipo === "V") && /^[A-Z]{4}\d{1,2}$/.test(n.ticker) &&
      Number.isFinite(n.quantidade) && n.quantidade > 0 && Number.isFinite(n.preco) && n.preco > 0,
  );
  const { id: dono } = await usuarioOuErro();
  await migrar();

  const client = await pool().connect();
  try {
    await client.query("begin");
    const novas = await guardarNegocios(client, negociosValidos, dono);
    let removidas = 0;
    if (modo === "substituir") {
      const r = await client.query("delete from carteira where usuario_id is not distinct from $2 and coalesce(tipo, '') <> 'renda_fixa' and not (ticker = any($1::text[]))", [
        validos.map((i) => i.ticker),
        dono,
      ]);
      removidas = r.rowCount ?? 0;
    }
    for (const i of validos) {
      await client.query(
        `insert into carteira (usuario_id, ticker, quantidade, preco_medio, tipo) values ($5, $1, $2, $3, $4)
         on conflict (usuario_id, ticker) do update set quantidade = excluded.quantidade, preco_medio = excluded.preco_medio,
           tipo = coalesce(excluded.tipo, carteira.tipo)`,
        [i.ticker, i.quantidade, i.preco_medio, infoTipo(i.tipo)?.id ?? null, dono],
      );
    }
    await client.query("commit");
    revalidatePath("/carteira");
    revalidatePath("/");
    return {
      ok: true,
      mensagem:
        `${validos.length} ativos importados${removidas ? `, ${removidas} removidos` : ""}. Eles entram na próxima análise.` +
        (negociosValidos.length ? ` ${novas} negociações novas no histórico (${negociosValidos.length - novas} já estavam lá); elas alimentam a página do IR.` : ""),
    };
  } catch (err) {
    await client.query("rollback");
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}

/**
 * Grava as negociações da B3 no histórico de operações, sem duplicar: para cada data, ativo, tipo, quantidade e preço,
 * só entra a diferença entre o que o arquivo tem e o que já está lançado (duas execuções iguais no mesmo dia contam duas).
 */
async function guardarNegocios(client: import("pg").PoolClient, negocios: NegocioImportado[], dono: number | null): Promise<number> {
  const grupos = new Map<string, { n: NegocioImportado; vezes: number }>();
  for (const n of negocios) {
    const chave = [n.data, n.ticker, n.tipo, n.quantidade, n.preco].join("|");
    const g = grupos.get(chave);
    if (g) g.vezes++;
    else grupos.set(chave, { n, vezes: 1 });
  }
  let novas = 0;
  for (const { n, vezes } of grupos.values()) {
    const { rows } = await client.query<{ total: number }>(
      `select count(*)::int as total from operacoes
        where usuario_id is not distinct from $1 and data = $2 and ticker = $3 and tipo = $4 and quantidade = $5 and round(preco, 4) = round($6::numeric, 4)`,
      [dono, n.data, n.ticker, n.tipo, n.quantidade, n.preco],
    );
    for (let i = rows[0]?.total ?? 0; i < vezes; i++) {
      await client.query(
        "insert into operacoes (data, ticker, tipo, quantidade, preco, custos, tipo_ativo, usuario_id) values ($1, $2, $3, $4, $5, 0, $6, $7)",
        [n.data, n.ticker, n.tipo, n.quantidade, n.preco, n.tipoAtivo, dono],
      );
      novas++;
    }
  }
  return novas;
}

// ---------- Compra e venda ----------

/** Reais por 1 USDT agora na Binance (para lançar compra de cripto paga em USDT). */
export async function cotacaoUsdt(): Promise<number | null> {
  await usuarioOuErro();
  return cotacaoUsdtBrl().catch(() => null);
}

export async function registrarOperacao(dados: {
  ticker: string;
  tipoAtivo: Tipo;
  tipo: "C" | "V";
  quantidade: number;
  preco: number;
  custos: number;
  data: string;
  /** Só cripto: pago em USDT. Preço e custos chegam em USDT e são guardados em reais pela cotação informada. */
  moedaPaga?: "BRL" | "USDT";
  cotacaoUsdt?: number;
}): Promise<{ ok: boolean; mensagem: string }> {
  const info = infoTipo(dados.tipoAtivo);
  let conversao = "";
  if (dados.moedaPaga === "USDT") {
    if (info?.id !== "cripto") return { ok: false, mensagem: "Pagamento em USDT só vale para criptomoedas." };
    const taxa = Number(dados.cotacaoUsdt);
    if (!(taxa > 0)) return { ok: false, mensagem: "Informe a cotação do USDT em reais." };
    conversao = ` (pago em USDT a R$ ${taxa.toFixed(4).replace(".", ",")})`;
    dados = { ...dados, preco: dados.preco * taxa, custos: (Number.isFinite(dados.custos) ? dados.custos : 0) * taxa };
  }
  if (!info) return { ok: false, mensagem: "Escolha o tipo de ativo." };
  const ticker = dados.ticker.trim().toUpperCase().replace(/^([A-Z]{4}\d{1,2})F$/, "$1");
  if (!info.formato.test(ticker)) return { ok: false, mensagem: `Código inválido para ${info.nome} (ex.: ${info.exemplo}).` };
  if (!(dados.quantidade > 0)) return { ok: false, mensagem: "Informe a quantidade." };
  if (!(dados.preco > 0)) return { ok: false, mensagem: "Informe o preço por unidade." };
  const custos = Number.isFinite(dados.custos) && dados.custos > 0 ? dados.custos : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) return { ok: false, mensagem: "Data inválida." };
  const simbolo = info.moeda === "USD" ? "US$" : "R$";
  const fmt = (v: number) => `${simbolo} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
  const { id: dono } = await usuarioOuErro();
  await migrar();

  const client = await pool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ quantidade: string; preco_medio: string; tipo: string | null }>(
      "select quantidade::text, preco_medio::text, tipo from carteira where ticker = $1 and usuario_id is not distinct from $2 for update",
      [ticker, dono],
    );
    const qtdAtual = rows[0] ? Number(rows[0].quantidade) : 0;
    const pmAtual = rows[0] ? Number(rows[0].preco_medio) : 0;
    if (rows[0]?.tipo && rows[0].tipo !== info.id) {
      await client.query("rollback");
      return { ok: false, mensagem: `${ticker} já está na carteira como ${infoTipo(rows[0].tipo)?.nome ?? rows[0].tipo}.` };
    }
    let mensagem: string;

    if (dados.tipo === "C") {
      const qtd = qtdAtual + dados.quantidade;
      // Os custos (corretagem, taxas) entram no preço médio
      const pm = (qtdAtual * pmAtual + dados.quantidade * dados.preco + custos) / qtd;
      await client.query(
        `insert into carteira (usuario_id, ticker, quantidade, preco_medio, tipo) values ($5, $1, $2, $3, $4)
         on conflict (usuario_id, ticker) do update set quantidade = excluded.quantidade, preco_medio = excluded.preco_medio,
           tipo = coalesce(carteira.tipo, excluded.tipo)`,
        [ticker, qtd, pm, info.id, dono],
      );
      mensagem = `Compra registrada${conversao}. ${ticker}: ${fmtQtd(qtd)} a preço médio de ${fmt(pm)}.`;
    } else {
      if (dados.quantidade > qtdAtual) {
        await client.query("rollback");
        return { ok: false, mensagem: `Você tem ${fmtQtd(qtdAtual)} de ${ticker}; não dá para vender ${fmtQtd(dados.quantidade)}.` };
      }
      const qtd = qtdAtual - dados.quantidade;
      if (qtd === 0) await client.query("delete from carteira where ticker = $1 and usuario_id is not distinct from $2", [ticker, dono]);
      else await client.query("update carteira set quantidade = $2 where ticker = $1 and usuario_id is not distinct from $3", [ticker, qtd, dono]);
      const resultado = dados.preco * dados.quantidade - custos - pmAtual * dados.quantidade;
      mensagem = `Venda registrada${conversao}. ${resultado >= 0 ? "Lucro" : "Prejuízo"} de ${fmt(Math.abs(resultado))} sobre o preço médio.`;
    }
    await client.query(
      `insert into operacoes (data, ticker, tipo, quantidade, preco, custos, tipo_ativo, usuario_id, moeda_paga, cambio_pago, preco_medio_venda)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [dados.data, ticker, dados.tipo, dados.quantidade, dados.preco, custos, info.id, dono, dados.moedaPaga === "USDT" ? "USDT" : null,
        dados.moedaPaga === "USDT" ? dados.cotacaoUsdt : null, dados.tipo === "V" ? pmAtual : null],
    );
    await client.query("commit");
    revalidatePath("/carteira");
    revalidatePath("/");
    return { ok: true, mensagem };
  } catch (err) {
    await client.query("rollback");
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}

/**
 * Corrige o preço médio de um ativo direto na tabela da carteira.
 * O valor investido passa a ser quantidade × novo preço médio; as operações lançadas não mudam.
 */
export async function editarPrecoMedio(ticker: string, novoPreco: number): Promise<{ ok: boolean; mensagem: string }> {
  if (!(novoPreco > 0)) return { ok: false, mensagem: "Informe um preço maior que zero." };
  try {
    const { id: dono } = await usuarioOuErro();
    const r = await query<{ ticker: string }>(
      "update carteira set preco_medio = $2 where ticker = $1 and usuario_id is not distinct from $3 returning ticker",
      [ticker, novoPreco, dono],
    );
    if (!r[0]) return { ok: false, mensagem: `${ticker} não está na carteira.` };
    revalidatePath("/carteira");
    revalidatePath("/");
    return { ok: true, mensagem: `Preço médio de ${ticker} agora é ${novoPreco.toFixed(2).replace(".", ",")}.` };
  } catch (err) {
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  }
}
