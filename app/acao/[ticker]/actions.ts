"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

/** Coloca o ativo na lista da análise diária (tabela universo): a partir da próxima análise ele ganha nota da IA e entra no ranking. */
export async function acompanhar(ticker: string): Promise<{ ok: boolean; mensagem: string }> {
  const t = ticker.toUpperCase();
  if (!/^[A-Z0-9.]{1,12}$/.test(t)) return { ok: false, mensagem: "Código inválido." };
  await query("insert into universo (ticker, ativo) values ($1, true) on conflict (ticker) do update set ativo = true", [t]);
  revalidatePath(`/acao/${t}`);
  return { ok: true, mensagem: `${t} entra na próxima análise.` };
}
