"use server";

import { revalidatePath } from "next/cache";
import { rodarAnalise } from "@/lib/analise";
import type { EscolhaEstrategia, ModoIa } from "@/lib/modos";
import { query } from "@/lib/db";

export async function iniciarAnalise(): Promise<{ ok: boolean; mensagem: string }> {
  const r = await rodarAnalise("botao");
  if ("motivo" in r) return { ok: false, mensagem: r.motivo };
  // Não espera terminar: a análise leva alguns minutos e continua rodando no servidor.
  void r.termino;
  return { ok: true, mensagem: "Análise iniciada. Leva alguns minutos; a página atualiza sozinha." };
}

export async function salvarModoIa(modo: ModoIa) {
  if (!["sem_ia", "economico", "completo"].includes(modo)) return;
  await query("insert into config (chave, valor) values ('modo_ia', $1) on conflict (chave) do update set valor = excluded.valor", [modo]);
  revalidatePath("/");
}

export async function salvarEstrategia(escolha: EscolhaEstrategia) {
  if (!["auto", "oportunidade", "balanceamento"].includes(escolha)) return;
  await query("insert into config (chave, valor) values ('estrategia', $1) on conflict (chave) do update set valor = excluded.valor", [escolha]);
  revalidatePath("/");
}
