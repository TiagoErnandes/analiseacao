"use server";

import { revalidatePath } from "next/cache";
import { importarB3, type ResultadoB3 } from "@/lib/b3";
import { pool, query } from "@/lib/db";

const numero = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(",", "."));

export async function salvarAtivo(form: FormData) {
  const ticker = String(form.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{4}\d{1,2}$/.test(ticker)) throw new Error("Código inválido (ex.: PETR4)");
  const quantidade = numero(form.get("quantidade"));
  const preco_medio = numero(form.get("preco_medio"));
  if (!(quantidade >= 0) || !(preco_medio >= 0)) throw new Error("Quantidade e preço médio devem ser números");

  await query(
    `insert into carteira (ticker, quantidade, preco_medio) values ($1, $2, $3)
     on conflict (ticker) do update set quantidade = excluded.quantidade, preco_medio = excluded.preco_medio`,
    [ticker, quantidade, preco_medio],
  );
  revalidatePath("/carteira");
  revalidatePath("/");
}

export async function removerAtivo(form: FormData) {
  const ticker = String(form.get("ticker") ?? "");
  await query("delete from carteira where ticker = $1", [ticker]);
  revalidatePath("/carteira");
  revalidatePath("/");
}

// ---------- Importação da B3 ----------

const TAMANHO_MAXIMO = 8 * 1024 * 1024;

export async function lerArquivosB3(form: FormData): Promise<{ ok: true; resultado: ResultadoB3 } | { ok: false; erro: string }> {
  try {
    const arquivos = form.getAll("arquivos").filter((f): f is File => f instanceof File && f.size > 0);
    if (arquivos.length === 0) return { ok: false, erro: "Escolha pelo menos um arquivo." };
    if (arquivos.length > 5) return { ok: false, erro: "Envie no máximo 5 arquivos por vez." };
    if (arquivos.some((f) => f.size > TAMANHO_MAXIMO)) return { ok: false, erro: "Arquivo grande demais (máximo 8 MB)." };
    if (arquivos.some((f) => !/\.xlsx$/i.test(f.name))) {
      return { ok: false, erro: "Use o arquivo em Excel (.xlsx) baixado da B3." };
    }

    const [carteira, universo] = await Promise.all([
      query<{ ticker: string; preco_medio: number }>("select ticker, preco_medio from carteira"),
      query<{ ticker: string }>("select ticker from universo"),
    ]);
    const resultado = importarB3(
      await Promise.all(arquivos.map(async (f) => ({ nome: f.name, dados: new Uint8Array(await f.arrayBuffer()) }))),
      new Map(carteira.map((c) => [c.ticker, c.preco_medio])),
      new Set(universo.map((u) => u.ticker)),
    );
    return { ok: true, resultado };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}

export async function aplicarImportacaoB3(
  itens: { ticker: string; quantidade: number; preco_medio: number }[],
  modo: "substituir" | "atualizar",
): Promise<{ ok: boolean; mensagem: string }> {
  const validos = itens.filter(
    (i) => /^[A-Z]{4}\d{1,2}$/.test(i.ticker) && Number.isFinite(i.quantidade) && i.quantidade > 0 && Number.isFinite(i.preco_medio) && i.preco_medio >= 0,
  );
  if (validos.length !== itens.length) return { ok: false, mensagem: "Há linhas com código, quantidade ou preço médio inválidos." };
  if (validos.length === 0) return { ok: false, mensagem: "Nenhuma ação para importar." };

  const client = await pool().connect();
  try {
    await client.query("begin");
    let removidas = 0;
    if (modo === "substituir") {
      const r = await client.query("delete from carteira where not (ticker = any($1::text[]))", [validos.map((i) => i.ticker)]);
      removidas = r.rowCount ?? 0;
    }
    for (const i of validos) {
      await client.query(
        `insert into carteira (ticker, quantidade, preco_medio) values ($1, $2, $3)
         on conflict (ticker) do update set quantidade = excluded.quantidade, preco_medio = excluded.preco_medio`,
        [i.ticker, i.quantidade, i.preco_medio],
      );
    }
    await client.query("commit");
    revalidatePath("/carteira");
    revalidatePath("/");
    return {
      ok: true,
      mensagem: `${validos.length} ações importadas${removidas ? `, ${removidas} removidas` : ""}. Elas entram na próxima análise.`,
    };
  } catch (err) {
    await client.query("rollback");
    return { ok: false, mensagem: `Erro ao salvar: ${(err as Error).message}` };
  } finally {
    client.release();
  }
}
