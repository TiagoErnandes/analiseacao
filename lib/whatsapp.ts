// WhatsApp do dono do site, por um destes dois caminhos (os dois são grátis; use um só):
// - API oficial da Meta (WhatsApp Cloud API) com o número de teste: WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_ID
//   e WHATSAPP_META_MODELO (o modelo de mensagem aprovado). Chega de outro número, então toca a notificação.
// - CallMeBot (uso pessoal): CALLMEBOT_WHATSAPP_APIKEY, a chave que o robô manda.
// Nos dois, WHATSAPP_NUMERO é o seu número, com o código do país. Passo a passo no DEPLOY.md.

const meta = () => !!(process.env.WHATSAPP_NUMERO && process.env.WHATSAPP_META_TOKEN && process.env.WHATSAPP_META_PHONE_ID);
const callmebot = () => !!(process.env.WHATSAPP_NUMERO && process.env.CALLMEBOT_WHATSAPP_APIKEY);

export const whatsappConfigurado = () => meta() || callmebot();

/** Só os dígitos, com o código do país (ex.: 5531999999999). */
const soDigitos = (n: string) => n.replace(/\D/g, "");

const limpar = (corpo: string) => corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);

/**
 * API oficial da Meta. Fora da janela de 24 horas (você não mandou mensagem para o número nas últimas 24 h),
 * a Meta só entrega um modelo aprovado: o texto vai inteiro no {{1}} do modelo WHATSAPP_META_MODELO.
 * Sem modelo, manda texto livre (só chega dentro da janela de 24 horas).
 */
async function enviarMeta(texto: string): Promise<boolean> {
  const versao = process.env.WHATSAPP_META_VERSAO || "v25.0";
  const modelo = process.env.WHATSAPP_META_MODELO;
  // O parâmetro do modelo não aceita quebra de linha nem mais de 4 espaços seguidos
  const umaLinha = texto.split("\n").map((l) => l.trim()).filter(Boolean).join(" · ").replace(/\s{4,}/g, " ").slice(0, 1000);
  const mensagem = modelo
    ? {
        type: "template",
        template: {
          name: modelo,
          language: { code: process.env.WHATSAPP_META_IDIOMA || "pt_BR" },
          components: [{ type: "body", parameters: [{ type: "text", text: umaLinha }] }],
        },
      }
    : { type: "text", text: { body: texto.slice(0, 4000), preview_url: false } };
  const res = await fetch(`https://graph.facebook.com/${versao}/${process.env.WHATSAPP_META_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: soDigitos(process.env.WHATSAPP_NUMERO!), ...mensagem }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => (console.warn(`  WhatsApp (Meta): ${e.message}`), null));
  if (!res) return false;
  if (!res.ok) {
    console.warn(`  WhatsApp (Meta): HTTP ${res.status} ${limpar(await res.text().catch(() => ""))}`);
    return false;
  }
  return true;
}

async function enviarCallmebot(texto: string): Promise<boolean> {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${soDigitos(process.env.WHATSAPP_NUMERO!)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(process.env.CALLMEBOT_WHATSAPP_APIKEY!)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e: Error) => (console.warn(`  WhatsApp (CallMeBot): ${e.message}`), null));
  if (!res) return false;
  const corpo = await res.text().catch(() => "");
  // O CallMeBot às vezes responde 200 com o erro no texto (chave errada, número não autorizado)
  if (!res.ok || /invalid|error|not (allowed|authorized)/i.test(corpo)) {
    console.warn(`  WhatsApp (CallMeBot): HTTP ${res.status} ${limpar(corpo)}`);
    return false;
  }
  return true;
}

/** Envia o texto para o WhatsApp do dono. Tenta a Meta e, se falhar ou não estiver configurada, o CallMeBot. */
export async function enviarWhatsapp(texto: string): Promise<boolean> {
  if (meta() && (await enviarMeta(texto))) return true;
  if (callmebot()) return enviarCallmebot(texto);
  return false;
}
