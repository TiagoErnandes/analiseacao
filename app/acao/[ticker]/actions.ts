"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { usuarioAtual, usuarioOuErro } from "@/lib/auth";
import { marcarVisto, removerPrecoAlvo, salvarPrecoAlvo, type PrecoAlvo } from "@/lib/precoAlvo";
import { precoYahoo } from "@/lib/mercado";
import { simboloYahoo, TIPOS, type Tipo } from "@/lib/tipos";

/** Coloca o ativo na lista da análise diária (tabela universo): a partir da próxima análise ele ganha nota da IA e entra no ranking. */
export async function acompanhar(ticker: string): Promise<{ ok: boolean; mensagem: string }> {
  if (!(await usuarioAtual())?.admin) return { ok: false, mensagem: "Só o dono do site escolhe a lista da análise diária." };
  const t = ticker.toUpperCase();
  if (!/^[A-Z0-9.]{1,12}$/.test(t)) return { ok: false, mensagem: "Código inválido." };
  await query("insert into universo (ticker, ativo) values ($1, true) on conflict (ticker) do update set ativo = true", [t]);
  revalidatePath(`/acao/${t}`);
  return { ok: true, mensagem: `${t} entra na próxima análise.` };
}

const TICKER = /^[A-Z0-9.-]{1,12}$/;

/** Cria ou troca o preço-alvo do ativo (cada pessoa tem o seu). */
export async function definirPrecoAlvo(d: {
  ticker: string;
  tipo: string | null;
  moeda: string;
  precoAlvo: number;
  viaSite: boolean;
  viaWhatsapp: boolean;
  viaEmail: boolean;
}): Promise<{ ok: boolean; mensagem: string; alvo?: PrecoAlvo }> {
  const u = await usuarioOuErro();
  const t = d.ticker.toUpperCase();
  if (!TICKER.test(t)) return { ok: false, mensagem: "Código inválido." };
  if (!Number.isFinite(d.precoAlvo) || d.precoAlvo <= 0) return { ok: false, mensagem: "Digite um preço-alvo maior que zero." };
  if (!d.viaSite && !d.viaWhatsapp && !d.viaEmail) return { ok: false, mensagem: "Escolha pelo menos um jeito de receber o alerta." };
  const tipo = d.tipo && TIPOS.some((x) => x.id === d.tipo) ? (d.tipo as Tipo) : null;
  // Cotação de agora (não a da análise das 7h): define se o alvo é de compra (abaixo) ou de venda (acima)
  const agora = (await precoYahoo(simboloYahoo(t, tipo)).catch(() => null))?.preco ?? null;
  const alvo = await salvarPrecoAlvo(u.id, {
    ticker: t,
    tipo,
    moeda: d.moeda === "USD" ? "USD" : "BRL",
    precoAlvo: Math.round(d.precoAlvo * 100) / 100,
    precoAtual: agora,
    viaSite: d.viaSite,
    viaWhatsapp: d.viaWhatsapp && u.admin,
    viaEmail: d.viaEmail,
  });
  revalidatePath(`/acao/${t}`);
  revalidatePath("/");
  const quando = alvo.direcao === "compra" ? "cair até" : "subir até";
  return { ok: true, mensagem: `Pronto: você será avisado quando ${t} ${quando} o seu preço-alvo.`, alvo };
}

export async function excluirPrecoAlvo(ticker: string): Promise<void> {
  const u = await usuarioOuErro();
  await removerPrecoAlvo(u.id, ticker.toUpperCase());
  revalidatePath(`/acao/${ticker.toUpperCase()}`);
  revalidatePath("/");
}

/** Fecha o aviso de preço-alvo atingido no painel. */
export async function dispensarAvisoAlvo(ticker: string): Promise<void> {
  const u = await usuarioOuErro();
  await marcarVisto(u.id, ticker.toUpperCase());
  revalidatePath("/");
}

/** Manda um email de teste para a conta de quem está logado (confere o SMTP_USUARIO e o SMTP_SENHA). */
export async function testarEmail(): Promise<{ ok: boolean; mensagem: string }> {
  const u = await usuarioOuErro();
  const para = u.email || process.env.ADMIN_EMAIL;
  if (!para) return { ok: false, mensagem: "Sua conta não tem email (entre com o Google ou preencha ADMIN_EMAIL)." };
  const { emailConfigurado, enviarEmail } = await import("@/lib/email");
  if (!emailConfigurado()) return { ok: false, mensagem: "O servidor não tem SMTP_USUARIO e SMTP_SENHA. Preencha no .env.production e faça o deploy." };
  const ok = await enviarEmail(para, {
    assunto: "🎯 Teste do alerta de preço-alvo",
    titulo: "Teste do alerta de preço-alvo",
    linhas: ["Se você recebeu este email, os avisos de preço-alvo vão chegar aqui."],
    link: process.env.SITE_URL || null,
  });
  return ok
    ? { ok, mensagem: `Email de teste enviado para ${para}. Confira também o spam.` }
    : { ok, mensagem: "O Gmail recusou o envio. Confira a senha de app (16 letras, sem espaços) e veja o motivo no log do site." };
}
