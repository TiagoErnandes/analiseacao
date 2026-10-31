"use server";

import { revalidatePath } from "next/cache";
import { importarB3, type ResultadoB3 } from "@/lib/b3";
import { pool, query } from "@/lib/db";
import { infoTipo, type Tipo } from "@/lib/tipos";
import { usuarioOuErro } from "@/lib/auth";

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
): Promise<{ ok: boolean; mensagem: string }> {
  const validos = itens.filter(
    (i) => /^[A-Z]{4}\d{1,2}$/.test(i.ticker) && Number.isFinite(i.quantidade) && i.quantidade > 0 && Number.isFinite(i.preco_medio) && i.preco_medio >= 0,
  );
  if (validos.length !== itens.length) return { ok: false, mensagem: "Há linhas com código, quantidade ou preço médio inválidos." };
  if (validos.length === 0) return { ok: false, mensagem: "Nenhum ativo para importar." };
  const { id: dono } = await usuarioOuErro();

  const client = await pool().connect();
  try {
    await client.query("begin");
    let removidas = 0;
    if (modo === "substituir") {
      const r = await client.query("delete from carteira where usuario_id is not distinct from $2 and not (ticker = any($1::text[]))", [
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
      mensagem: `${validos.length} ativos importados${removidas ? `, ${removidas} removidos` : ""}. Eles entram na próxima análise.`,
    };
  } catch (err) {
    await client.query("rollback");
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}

// ---------- Compra e venda ----------

export async function registrarOperacao(dados: {
  ticker: string;
  tipoAtivo: Tipo;
  tipo: "C" | "V";
  quantidade: number;
  preco: number;
  custos: number;
  data: string;
}): Promise<{ ok: boolean; mensagem: string }> {
  const info = infoTipo(dados.tipoAtivo);
  if (!info) return { ok: false, mensagem: "Escolha o tipo de ativo." };
  const ticker = dados.ticker.trim().toUpperCase().replace(/^([A-Z]{4}\d{1,2})F$/, "$1");
  if (!info.formato.test(ticker)) return { ok: false, mensagem: `Código inválido para ${info.nome} (ex.: ${info.exemplo}).` };
  if (!(dados.quantidade > 0)) return { ok: false, mensagem: "Informe a quantidade." };
  if (!(dados.preco > 0)) return { ok: false, mensagem: "Informe o preço por unidade." };
  const custos = Number.isFinite(dados.custos) && dados.custos > 0 ? dados.custos : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) return { ok: false, mensagem: "Data inválida." };
  const simbolo = info.moeda === "USD" ? "US$" : "R$";
  const fmt = (v: number) => `${simbolo} ${v.toFixed(2).replace(".", ",")}`;
  const { id: dono } = await usuarioOuErro();

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
      mensagem = `Compra registrada. ${ticker}: ${qtd} a preço médio de ${fmt(pm)}.`;
    } else {
      if (dados.quantidade > qtdAtual) {
        await client.query("rollback");
        return { ok: false, mensagem: `Você tem ${qtdAtual} de ${ticker}; não dá para vender ${dados.quantidade}.` };
      }
      const qtd = qtdAtual - dados.quantidade;
      if (qtd === 0) await client.query("delete from carteira where ticker = $1 and usuario_id is not distinct from $2", [ticker, dono]);
      else await client.query("update carteira set quantidade = $2 where ticker = $1 and usuario_id is not distinct from $3", [ticker, qtd, dono]);
      const resultado = dados.preco * dados.quantidade - custos - pmAtual * dados.quantidade;
      mensagem = `Venda registrada. ${resultado >= 0 ? "Lucro" : "Prejuízo"} de ${fmt(Math.abs(resultado))} sobre o preço médio.`;
    }
    await client.query(
      "insert into operacoes (data, ticker, tipo, quantidade, preco, custos, tipo_ativo, usuario_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [dados.data, ticker, dados.tipo, dados.quantidade, dados.preco, custos, info.id, dono],
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
