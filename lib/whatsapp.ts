// WhatsApp grátis pelo CallMeBot (uso pessoal): manda mensagem só para o número que pediu a chave ao bot.
// Configuração no .env.production: CALLMEBOT_WHATSAPP_NUMERO e CALLMEBOT_WHATSAPP_APIKEY (passo a passo no DEPLOY.md).

export const whatsappConfigurado = () => !!(process.env.CALLMEBOT_WHATSAPP_NUMERO && process.env.CALLMEBOT_WHATSAPP_APIKEY);

/** Só os dígitos, com o código do país (ex.: 5531999999999). */
const soDigitos = (n: string) => n.replace(/\D/g, "");

/** Envia o texto para o WhatsApp do dono. Devolve true se o CallMeBot aceitou. */
export async function enviarWhatsapp(texto: string): Promise<boolean> {
  const numero = process.env.CALLMEBOT_WHATSAPP_NUMERO;
  const chave = process.env.CALLMEBOT_WHATSAPP_APIKEY;
  if (!numero || !chave) return false;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${soDigitos(numero)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(chave)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e: Error) => (console.warn(`  WhatsApp: ${e.message}`), null));
  if (!res) return false;
  const corpo = await res.text().catch(() => "");
  // O CallMeBot às vezes responde 200 com o erro no texto (chave errada, número não autorizado)
  if (!res.ok || /invalid|error|not (allowed|authorized)/i.test(corpo)) {
    console.warn(`  WhatsApp: HTTP ${res.status} ${corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`);
    return false;
  }
  return true;
}
