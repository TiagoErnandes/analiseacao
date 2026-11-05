// WhatsApp do dono do site, por um destes caminhos (use um só):
// - Evolution API (grátis, na própria VPS): um segundo chip conectado pelo QR code do painel manda as mensagens
//   para o seu número. EVOLUTION_API_KEY no .env.production liga o container "evolution" no deploy.
// - API oficial da Meta (WhatsApp Cloud API) com o número de teste: WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_ID
//   e os modelos de mensagem aprovados: WHATSAPP_META_MODELO (preço-alvo, 3 campos) e WHATSAPP_META_MODELO_ALERTA
//   (alertas de venda, 1 campo; opcional). Chega de outro número, então toca a notificação.
// - CallMeBot (uso pessoal): CALLMEBOT_WHATSAPP_APIKEY, a chave que o robô manda.
// Nos dois, WHATSAPP_NUMERO é o seu número, com o código do país. Passo a passo no DEPLOY.md.

const meta = () => !!(process.env.WHATSAPP_NUMERO && process.env.WHATSAPP_META_TOKEN && process.env.WHATSAPP_META_PHONE_ID);
const callmebot = () => !!(process.env.WHATSAPP_NUMERO && process.env.CALLMEBOT_WHATSAPP_APIKEY);

const evolution = () => !!(process.env.WHATSAPP_NUMERO && process.env.EVOLUTION_API_KEY);
export const evolutionAtiva = () => !!process.env.EVOLUTION_API_KEY;

export const whatsappConfigurado = () => evolution() || meta() || callmebot();

/** Só os dígitos, com o código do país (ex.: 5531999999999). */
const soDigitos = (n: string) => n.replace(/\D/g, "");

const limpar = (corpo: string) => corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);

/** Modelo aprovado na Meta e os valores de cada {{n}}, na ordem. */
export type ModeloMeta = { nome: string | undefined; parametros?: string[] };

/**
 * API oficial da Meta. Fora da janela de 24 horas (você não mandou mensagem para o número nas últimas 24 h),
 * a Meta só entrega um modelo aprovado. Sem os parâmetros, o texto vai inteiro no {{1}}.
 * Sem modelo, manda texto livre (só chega dentro da janela de 24 horas).
 */
async function enviarMeta(texto: string, m?: ModeloMeta): Promise<boolean> {
  const versao = process.env.WHATSAPP_META_VERSAO || "v25.0";
  const modelo = m?.nome;
  // O parâmetro do modelo não aceita quebra de linha nem mais de 4 espaços seguidos
  const umaLinha = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).join(" · ").replace(/\s{4,}/g, " ").slice(0, 1000);
  const parametros = (m?.parametros ?? [texto]).map((t) => ({ type: "text", text: umaLinha(t) }));
  const mensagem = modelo
    ? {
        type: "template",
        template: {
          name: modelo,
          language: { code: process.env.WHATSAPP_META_IDIOMA || "pt_BR" },
          components: [{ type: "body", parameters: parametros }],
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

// ---------- Evolution API ----------
const evoUrl = () => (process.env.EVOLUTION_URL || "http://evolution:8080").replace(/\/$/, "");
const instancia = () => process.env.EVOLUTION_INSTANCIA || "precoteto";

async function evo(caminho: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; dados: any }> {
  const res = await fetch(`${evoUrl()}${caminho}`, {
    ...init,
    headers: { apikey: process.env.EVOLUTION_API_KEY ?? "", "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let dados: any = texto;
  try {
    dados = JSON.parse(texto);
  } catch {}
  return { ok: res.ok, status: res.status, dados };
}

export type EstadoWhatsapp = { estado: "conectado" | "desconectado" | "conectando" | "erro"; numero?: string | null; qr?: string | null; mensagem?: string };

/** Situação do chip conectado na Evolution API. */
export async function estadoEvolution(): Promise<EstadoWhatsapp> {
  try {
    const r = await evo(`/instance/connectionState/${instancia()}`);
    if (r.status === 404) return { estado: "desconectado" };
    if (!r.ok) return { estado: "erro", mensagem: `Evolution respondeu HTTP ${r.status}` };
    const st = r.dados?.instance?.state ?? r.dados?.state;
    if (st !== "open") return { estado: st === "connecting" ? "conectando" : "desconectado" };
    const info = await evo(`/instance/fetchInstances?instanceName=${instancia()}`).catch(() => null);
    const dono = Array.isArray(info?.dados) ? info!.dados[0]?.ownerJid ?? info!.dados[0]?.owner : null;
    return { estado: "conectado", numero: typeof dono === "string" ? dono.split("@")[0] : null };
  } catch (e) {
    return { estado: "erro", mensagem: `Não achei a Evolution API (${(e as Error).message}). Ela está no ar? Veja o DEPLOY.md.` };
  }
}

/** Cria a instância (se ainda não existe) e devolve o QR code para ler com o WhatsApp do chip. */
export async function conectarEvolution(): Promise<EstadoWhatsapp> {
  try {
    const atual = await estadoEvolution();
    if (atual.estado === "conectado" || atual.estado === "erro") return atual;
    let r = await evo(`/instance/connect/${instancia()}`);
    if (r.status === 404) {
      r = await evo("/instance/create", {
        method: "POST",
        body: JSON.stringify({ instanceName: instancia(), integration: "WHATSAPP-BAILEYS", qrcode: true }),
      });
      if (!r.ok) return { estado: "erro", mensagem: `Não consegui criar a conexão: HTTP ${r.status} ${limpar(JSON.stringify(r.dados))}` };
      return { estado: "conectando", qr: r.dados?.qrcode?.base64 ?? null };
    }
    if (!r.ok) return { estado: "erro", mensagem: `HTTP ${r.status} ${limpar(JSON.stringify(r.dados))}` };
    return { estado: "conectando", qr: r.dados?.base64 ?? null };
  } catch (e) {
    return { estado: "erro", mensagem: `Não achei a Evolution API (${(e as Error).message}).` };
  }
}

export async function desconectarEvolution(): Promise<void> {
  await evo(`/instance/logout/${instancia()}`, { method: "DELETE" }).catch(() => null);
}

async function enviarEvolution(texto: string): Promise<boolean> {
  const r = await evo(`/message/sendText/${instancia()}`, {
    method: "POST",
    body: JSON.stringify({ number: soDigitos(process.env.WHATSAPP_NUMERO!), text: texto }),
  }).catch((e: Error) => (console.warn(`  WhatsApp (Evolution): ${e.message}`), null));
  if (!r) return false;
  if (!r.ok) console.warn(`  WhatsApp (Evolution): HTTP ${r.status} ${limpar(JSON.stringify(r.dados))}`);
  return r.ok;
}

/** Envia o texto para o WhatsApp do dono: Evolution API, depois Meta, depois CallMeBot (o primeiro que funcionar). */
export async function enviarWhatsapp(texto: string, modelo?: ModeloMeta): Promise<boolean> {
  if (evolution() && (await enviarEvolution(texto))) return true;
  if (meta() && (await enviarMeta(texto, modelo))) return true;
  if (callmebot()) return enviarCallmebot(texto);
  return false;
}
