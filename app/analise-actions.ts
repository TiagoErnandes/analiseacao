"use server";

import { revalidatePath } from "next/cache";
import { rodarAnalise } from "@/lib/analise";
import type { EscolhaEstrategia, ModoIa } from "@/lib/modos";
import { query } from "@/lib/db";
import { adminOuErro, usuarioAtual, usuarioOuErro } from "@/lib/auth";

/** Intervalo mínimo entre análises para quem não é o dono (elas são grátis, mas levam alguns minutos de servidor). */
const INTERVALO_OUTRAS_CONTAS_MIN = 30;

export async function iniciarAnalise(): Promise<{ ok: boolean; mensagem: string }> {
  const usuario = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Entre com sua conta Google para continuar." };
  if (!usuario.admin) {
    // As outras contas rodam sempre no modo grátis (Gemini), sem custo para o dono
    const [recente] = await query<{ libera: string }>(
      `select to_char((max(inicio) + make_interval(mins => $1::int)) at time zone 'America/Sao_Paulo', 'HH24:MI') as libera
         from execucoes where status <> 'erro' having max(inicio) > now() - make_interval(mins => $1::int)`,
      [INTERVALO_OUTRAS_CONTAS_MIN],
    );
    if (recente) return { ok: false, mensagem: `Uma análise rodou há pouco. A próxima libera às ${recente.libera}.` };
  }
  const r = await rodarAnalise("botao", usuario.admin ? undefined : "gratis");
  if ("motivo" in r) return { ok: false, mensagem: r.motivo };
  // Não espera terminar: a análise leva alguns minutos e continua rodando no servidor.
  void r.termino;
  return { ok: true, mensagem: "Análise iniciada. Leva alguns minutos; a página atualiza sozinha." };
}

export async function salvarModoIa(modo: ModoIa) {
  if (!["gratis", "gemini_busca", "sem_ia", "economico", "completo"].includes(modo)) return;
  await adminOuErro();
  await query("insert into config (chave, valor) values ('modo_ia', $1) on conflict (chave) do update set valor = excluded.valor", [modo]);
  revalidatePath("/");
}

export async function salvarEstrategia(escolha: EscolhaEstrategia) {
  if (!["auto", "oportunidade", "balanceamento"].includes(escolha)) return;
  const { id } = await usuarioOuErro();
  await query(
    "insert into config_usuario (usuario_id, chave, valor) values ($1, 'estrategia', $2) on conflict (usuario_id, chave) do update set valor = excluded.valor",
    [id, escolha],
  );
  revalidatePath("/");
}

/** Manda um alerta de teste para o celular (confere se o Telegram ou o ntfy estão configurados). */
export async function testarAlerta(): Promise<{ ok: boolean; mensagem: string }> {
  if (!(await usuarioAtual())?.admin) return { ok: false, mensagem: "Os alertas no celular são só do dono do site." };
  const { enviar } = await import("@/lib/alertas");
  const ok = await enviar({
    ticker: "TESTE",
    nivel: "ATENCAO",
    titulo: "Teste do alerta de venda",
    motivo: "Se você recebeu isto, os alertas da sua carteira vão chegar aqui.",
    link: null,
  });
  return ok
    ? { ok, mensagem: "Alerta de teste enviado. Confira o celular." }
    : { ok, mensagem: "Não foi enviado. Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (ou NTFY_TOPICO) no .env.production." };
}
