// Email dos alertas (preço-alvo), por SMTP. O mais simples e grátis: uma conta do Gmail com "senha de app"
// (até 500 emails por dia). Configuração no .env.production: SMTP_USUARIO e SMTP_SENHA (passo a passo no DEPLOY.md).
import nodemailer, { type Transporter } from "nodemailer";

export const emailConfigurado = () => !!(process.env.SMTP_USUARIO && process.env.SMTP_SENHA);

let transporte: Transporter | null = null;
function smtp(): Transporter {
  if (!transporte) {
    const porta = Number(process.env.SMTP_PORTA || 465);
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: porta,
      secure: porta === 465,
      auth: { user: process.env.SMTP_USUARIO, pass: process.env.SMTP_SENHA },
    });
  }
  return transporte;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Envia um email simples (texto e HTML). Devolve true se o servidor aceitou. */
export async function enviarEmail(para: string, m: { assunto: string; titulo: string; linhas: string[]; link?: string | null }): Promise<boolean> {
  if (!emailConfigurado()) return false;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#111">
  <h2 style="margin:0 0 12px;font-size:18px">${esc(m.titulo)}</h2>
  ${m.linhas.map((l) => `<p style="margin:0 0 8px;font-size:15px">${esc(l)}</p>`).join("")}
  ${m.link ? `<p style="margin:16px 0"><a href="${esc(m.link)}" style="background:#10b981;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ver o ativo no site</a></p>` : ""}
  <p style="margin-top:20px;font-size:12px;color:#666">Você recebe este email porque criou este alerta de preço-alvo. Ferramenta de apoio à decisão, não é recomendação de investimento.</p>
</div>`;
  try {
    await smtp().sendMail({
      from: process.env.EMAIL_REMETENTE || `Preço Teto <${process.env.SMTP_USUARIO}>`,
      to: para,
      subject: m.assunto,
      text: [m.titulo, "", ...m.linhas, ...(m.link ? ["", m.link] : [])].join("\n"),
      html,
    });
    return true;
  } catch (e) {
    console.warn(`  Email para ${para}: ${(e as Error).message.slice(0, 200)}`);
    return false;
  }
}
