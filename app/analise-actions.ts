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

/** Pedido em andamento: cliques ao mesmo tempo (de qualquer conta) esperam o mesmo pedido ao Yahoo. */
let atualizandoPrecos: Promise<number> | null = null;

/**
 * Só os preços: um pedido em lote ao Yahoo (e à Binance, nas criptos) para todos os ativos da última análise.
 * Sem IA, sem balanços e sem recalcular notas: nota, teto e recomendação continuam os da análise. Leva poucos segundos.
 */
export async function atualizarSoPrecos(): Promise<{ ok: boolean; mensagem: string }> {
  if (!(await usuarioAtual())) return { ok: false, mensagem: "Entre com sua conta Google para continuar." };
  const { atualizarPrecosDoDia } = await import("@/lib/precosAoVivo");
  try {
    atualizandoPrecos ??= atualizarPrecosDoDia(1).finally(() => (atualizandoPrecos = null));
    const n = await atualizandoPrecos;
    revalidatePath("/", "layout");
    return n
      ? { ok: true, mensagem: `Preços de ${n} ativos atualizados. Notas e recomendações continuam as da última análise.` }
      : { ok: false, mensagem: "Nenhum preço novo: ainda não há análise ou o Yahoo não respondeu." };
  } catch (err) {
    return { ok: false, mensagem: `Não deu para atualizar os preços: ${(err as Error).message}` };
  }
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

/** Manda um alerta de teste para o celular (confere se o Telegram, o ntfy ou o WhatsApp estão configurados). */
export async function testarAlerta(): Promise<{ ok: boolean; mensagem: string }> {
  if (!(await usuarioAtual())?.admin) return { ok: false, mensagem: "Os alertas no celular são só do dono do site." };
  const { enviarCelular } = await import("@/lib/alertas");
  // No WhatsApp da Meta, o teste usa o modelo do preço-alvo (o único obrigatório)
  const ok = await enviarCelular({
    cabecalho: "⚠️ Teste do alerta",
    titulo: "Teste do alerta da carteira",
    motivo: "Se você recebeu isto, os alertas da sua carteira e do preço-alvo vão chegar aqui.",
    link: null,
    modelo: { nome: process.env.WHATSAPP_META_MODELO, parametros: ["TESTE chegou no ponto de compra", "R$ 10,00", "R$ 10,00"] },
  });
  return ok
    ? { ok, mensagem: "Alerta de teste enviado. Confira o celular." }
    : { ok, mensagem: "Não foi enviado. Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID, NTFY_TOPICO ou o WhatsApp (WHATSAPP_NUMERO com EVOLUTION_API_KEY, WHATSAPP_META_* ou CALLMEBOT_WHATSAPP_APIKEY) no .env.production; na Evolution, conecte o chip no card “WhatsApp dos alertas”. Se já configurou, veja o motivo no log do agendador." };
}

/** WhatsApp próprio (Evolution API): situação, QR code para conectar o chip e desconectar. Só o dono. */
export async function whatsappEstado() {
  if (!(await usuarioAtual())?.admin) return { estado: "erro" as const, mensagem: "Só o dono do site." };
  const { estadoEvolution } = await import("@/lib/whatsapp");
  return estadoEvolution();
}

export async function whatsappConectar() {
  if (!(await usuarioAtual())?.admin) return { estado: "erro" as const, mensagem: "Só o dono do site." };
  const { conectarEvolution } = await import("@/lib/whatsapp");
  return conectarEvolution();
}

export async function whatsappDesconectar() {
  if (!(await usuarioAtual())?.admin) return;
  const { desconectarEvolution } = await import("@/lib/whatsapp");
  await desconectarEvolution();
}
