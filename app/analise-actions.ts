"use server";

import { rodarAnalise } from "@/lib/analise";

export async function iniciarAnalise(): Promise<{ ok: boolean; mensagem: string }> {
  const r = await rodarAnalise("botao");
  if ("motivo" in r) return { ok: false, mensagem: r.motivo };
  // Não espera terminar: a análise leva alguns minutos e continua rodando no servidor.
  void r.termino;
  return { ok: true, mensagem: "Análise iniciada. Leva alguns minutos; a página atualiza sozinha." };
}
