"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

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
