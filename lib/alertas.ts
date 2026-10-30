// Alertas de venda: vigia os ativos da carteira ao longo do dia e avisa no celular (Telegram e/ou ntfy).
// Fontes: notícias do Google Notícias, fatos relevantes da CVM, queda forte no preço e a análise do dia.
// O Gemini (chave grátis) separa o que é grave do que é ruído; sem Gemini, palavras-chave fazem a triagem.
import { chaveGemini, gemini } from "./ai";
import { atualizarDocumentosCvm, infoB3 } from "./cvm";
import { query } from "./db";
import { precoYahoo } from "./mercado";

export type Nivel = "VENDER" | "ATENCAO";
export type Alerta = { chave: string; ticker: string; nivel: Nivel | "NADA"; titulo: string; motivo: string; link: string | null; criado_em?: string };
type Noticia = { chave: string; ticker: string; titulo: string; fonte: string; link: string | null; data: string };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
/** Queda no dia que pede uma olhada (ações e FIIs). */
const QUEDA_FORTE = -0.07;
/** Palavras que indicam risco sério (usadas sem Gemini, ou se ele falhar). */
const GRAVE = /recupera[çc][ãa]o judicial|fal[êe]ncia|fraude|inconsist[êe]ncia cont[áa]bil|rombo|opera[çc][ãa]o da pf|pol[íi]cia federal|cvm (abre|instaura)|calote|default|rebaixa|corta (os )?dividendos|suspende (os )?dividendos|preju[íi]zo bilion|renúncia do (ceo|presidente)|interven[çc][ãa]o|delist|fechamento de capital|OPA/i;

async function garantirTabela() {
  await query(`create table if not exists alertas (
    chave     text primary key,
    ticker    text not null,
    nivel     text not null,
    titulo    text not null,
    motivo    text not null,
    link      text,
    criado_em timestamptz not null default now()
  )`);
}

/** Últimos alertas enviados (para o painel). */
export async function alertasRecentes(dias = 7): Promise<Alerta[]> {
  try {
    return await query<Alerta>(
      `select chave, ticker, nivel, titulo, motivo, link, criado_em::text from alertas
        where criado_em > now() - make_interval(days => $1::int) and nivel <> 'NADA' order by criado_em desc limit 20`,
      [dias],
    );
  } catch {
    return []; // tabela ainda não criada
  }
}

/** Envia para o celular. Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) e/ou ntfy (NTFY_TOPICO). */
export async function enviar(a: Omit<Alerta, "chave"> & { nivel: Nivel }): Promise<boolean> {
  const icone = a.nivel === "VENDER" ? "🚨" : "⚠️";
  const cabecalho = `${icone} ${a.nivel === "VENDER" ? "VENDA URGENTE?" : "Atenção"} ${a.ticker}`;
  let enviado = false;
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, NTFY_TOPICO: topico } = process.env;
  if (token && chat) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const texto = `<b>${esc(cabecalho)}</b>\n${esc(a.titulo)}\n\n${esc(a.motivo)}${a.link ? `\n${esc(a.link)}` : ""}`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch((e: Error) => (console.warn(`  Telegram: ${e.message}`), null));
    if (res?.ok) enviado = true;
    else if (res) console.warn(`  Telegram: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  if (topico) {
    const res = await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topico,
        title: cabecalho,
        message: `${a.titulo}\n\n${a.motivo}`,
        priority: a.nivel === "VENDER" ? 5 : 4,
        tags: [a.nivel === "VENDER" ? "rotating_light" : "warning"],
        ...(a.link ? { click: a.link } : {}),
      }),
    }).catch((e: Error) => (console.warn(`  ntfy: ${e.message}`), null));
    if (res?.ok) enviado = true;
    else if (res) console.warn(`  ntfy: HTTP ${res.status}`);
  }
  if (!token && !topico) console.warn("  Alertas: configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID ou NTFY_TOPICO para receber no celular.");
  return enviado;
}

/** Registra e envia, uma vez só por chave. Devolve true se era novo. */
async function registrar(a: Alerta): Promise<boolean> {
  const [novo] = await query<{ chave: string }>(
    `insert into alertas (chave, ticker, nivel, titulo, motivo, link) values ($1, $2, $3, $4, $5, $6)
     on conflict (chave) do nothing returning chave`,
    [a.chave, a.ticker, a.nivel, a.titulo.slice(0, 500), a.motivo.slice(0, 1000), a.link],
  );
  if (!novo) return false;
  if (a.nivel !== "NADA") {
    console.log(`  ALERTA ${a.nivel} ${a.ticker}: ${a.titulo}`);
    await enviar({ ...a, nivel: a.nivel });
  }
  return true;
}

/** Notícias das últimas 24 horas no Google Notícias (RSS público). */
export function lerRss(xml: string, ticker: string): Noticia[] {
  const tag = (bloco: string, nome: string) =>
    bloco.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() ?? "";
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const titulo = tag(m[1], "title");
    const link = tag(m[1], "link") || null;
    return { chave: `noticia:${ticker}:${tag(m[1], "guid") || link || titulo}`.slice(0, 400), ticker, titulo, fonte: tag(m[1], "source"), link, data: tag(m[1], "pubDate") };
  });
}

async function noticias(ticker: string): Promise<Noticia[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${ticker} when:1d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Google Notícias ${ticker}: HTTP ${res.status}`);
  return lerRss(await res.text(), ticker).slice(0, 15);
}

const ESQUEMA_TRIAGEM = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { id: { type: "INTEGER" }, nivel: { type: "STRING", enum: ["VENDER", "ATENCAO", "NADA"] }, motivo: { type: "STRING" } },
    required: ["id", "nivel", "motivo"],
  },
};

/**
 * Triagem: o Gemini lê os títulos e diz o que é grave. VENDER só para fato que muda a tese de longo prazo
 * (fraude, recuperação judicial, corte de dividendo, intervenção...). Sem Gemini, usa palavras-chave.
 */
async function triar(itens: { id: number; ticker: string; texto: string }[]): Promise<Map<number, { nivel: Nivel | "NADA"; motivo: string }>> {
  const r = new Map<number, { nivel: Nivel | "NADA"; motivo: string }>();
  const porPalavra = () => {
    for (const i of itens) r.set(i.id, GRAVE.test(i.texto) ? { nivel: "ATENCAO", motivo: "Palavra de risco na notícia (triagem sem IA). Leia e confira." } : { nivel: "NADA", motivo: "" });
    return r;
  };
  if (!itens.length) return r;
  if (!chaveGemini(false) && !chaveGemini(true)) return porPalavra();
  try {
    const { texto } = await gemini(
      `Você vigia a carteira de um investidor de longo prazo (buy and hold, dividendos). Para cada notícia ou documento, diga:
VENDER: fato grave que pode destruir a tese de longo prazo (fraude, recuperação judicial, falência, corte ou suspensão de dividendos,
intervenção do governo, prejuízo enorme inesperado, investigação séria contra a empresa ou a gestão, OPA ou fechamento de capital abaixo do preço).
ATENCAO: notícia relevante e negativa que merece leitura, mas não pede venda imediata (resultado fraco, rebaixamento, processo, troca de CEO, dívida).
NADA: rotina, notícia positiva ou neutra, recomendação de corretora, cotação do dia, notícia de outra empresa.
Seja rigoroso: queda de preço sozinha não é motivo para vender. Responda só o JSON, em português, com motivo de uma frase.`,
      JSON.stringify(itens),
      { json: true, paga: !chaveGemini(false), esquema: ESQUEMA_TRIAGEM },
    );
    for (const x of JSON.parse(texto) as { id: number; nivel: Nivel | "NADA"; motivo: string }[]) r.set(x.id, { nivel: x.nivel, motivo: x.motivo });
    return r;
  } catch (err) {
    console.warn(`  Alertas: triagem com Gemini falhou (${(err as Error).message.slice(0, 200)}); usando palavras-chave`);
    return porPalavra();
  }
}

/** Vigia a carteira: notícias, fatos relevantes da CVM e queda forte. Roda várias vezes ao dia (agendador). */
export async function vigiarCarteira(): Promise<number> {
  await garantirTabela();
  const carteira = await query<{ ticker: string; tipo: string | null }>("select ticker, tipo from carteira where quantidade > 0");
  const tickers = carteira
    .filter((c) => !c.tipo || c.tipo === "acao" || c.tipo === "fii")
    .map((c) => c.ticker.toUpperCase());
  if (!tickers.length) return 0;
  let enviados = 0;

  // 1) Queda forte no dia
  for (const t of tickers) {
    const p = await precoYahoo(`${t}.SA`).catch(() => null);
    if (p?.variacaoDia != null && p.variacaoDia <= QUEDA_FORTE) {
      const hoje = new Date().toISOString().slice(0, 10);
      const pct = `${(-p.variacaoDia * 100).toFixed(1).replace(".", ",")}%`;
      if (
        await registrar({
          chave: `queda:${t}:${hoje}`,
          ticker: t,
          nivel: "ATENCAO",
          titulo: `${t} cai ${pct} hoje`,
          motivo: "Queda forte no dia. Veja se há notícia ou fato relevante antes de decidir; queda sozinha não é motivo para vender.",
          link: `https://news.google.com/search?q=${t}&hl=pt-BR`,
        })
      ) enviados++;
    }
  }

  // 2) Fatos relevantes e comunicados na CVM (o arquivo da CVM é atualizado ao longo do dia)
  await atualizarDocumentosCvm(new Date(), 0.12).catch((e) => console.warn(`  Alertas CVM: ${e.message}`));
  const codigos = new Map<number, string>();
  for (const t of tickers) {
    const info = await infoB3(t).catch(() => null);
    if (info?.codigoCvm) codigos.set(info.codigoCvm, codigos.get(info.codigoCvm) ?? t);
  }
  const docs = codigos.size
    ? await query<{ protocolo: string; cd_cvm: number; data: string; categoria: string; assunto: string | null; link: string | null }>(
        `select protocolo, cd_cvm, data::text, categoria, assunto, link from cvm_documentos
          where cd_cvm = any($1::int[]) and data >= current_date - 2
            and not exists (select 1 from alertas where chave = 'cvm:' || protocolo)`,
        [[...codigos.keys()]],
      )
    : [];

  // 3) Notícias das últimas 24 horas, só as que ainda não foram vistas
  const novas: Noticia[] = [];
  for (const t of tickers) {
    const lista = await noticias(t).catch((e) => (console.warn(`  Alertas: ${e.message}`), []));
    if (!lista.length) continue;
    const vistas = new Set(
      (await query<{ chave: string }>("select chave from alertas where chave = any($1::text[])", [lista.map((n) => n.chave)])).map((x) => x.chave),
    );
    novas.push(...lista.filter((n) => !vistas.has(n.chave)));
  }

  // Triagem de tudo que é novo, de uma vez
  const itens = [
    ...docs.map((d, i) => ({ id: i, ticker: codigos.get(d.cd_cvm)!, texto: `[CVM ${d.data}] ${d.categoria}: ${d.assunto ?? ""}` })),
    ...novas.map((n, i) => ({ id: docs.length + i, ticker: n.ticker, texto: `[${n.fonte}] ${n.titulo}` })),
  ];
  const triagem = await triar(itens);
  for (const [i, d] of docs.entries()) {
    const t = triagem.get(i) ?? { nivel: "NADA" as const, motivo: "" };
    if (
      await registrar({
        chave: `cvm:${d.protocolo}`,
        ticker: codigos.get(d.cd_cvm)!,
        nivel: t.nivel,
        titulo: `${d.categoria}: ${d.assunto ?? ""}`,
        motivo: t.motivo || "Documento oficial na CVM.",
        link: d.link,
      }) && t.nivel !== "NADA"
    ) enviados++;
  }
  for (const [i, n] of novas.entries()) {
    const t = triagem.get(docs.length + i) ?? { nivel: "NADA" as const, motivo: "" };
    // Notícias sem importância também são gravadas (como NADA) para não serem lidas de novo
    if (await registrar({ chave: n.chave, ticker: n.ticker, nivel: t.nivel, titulo: n.titulo, motivo: t.motivo, link: n.link }) && t.nivel !== "NADA") enviados++;
  }
  console.log(`Vigia: ${tickers.length} ativos, ${docs.length} documentos CVM e ${novas.length} notícias novas, ${enviados} alertas`);
  return enviados;
}

/** Depois da análise do dia: avisa quando um ativo da carteira passa a EVITAR. */
export async function alertasDaAnalise(): Promise<void> {
  await garantirTabela();
  const mudaram = await query<{ ticker: string; data: string; resumo_ia: string | null; alertas: string | null }>(
    `with ult as (select max(data) as d from analises),
          ant as (select max(data) as d from analises where data < (select d from ult))
     select a.ticker, a.data::text, a.resumo_ia, a.alertas from analises a
      where a.data = (select d from ult) and a.na_carteira and a.recomendacao = 'EVITAR'
        and not exists (select 1 from analises b where b.ticker = a.ticker and b.data = (select d from ant) and b.recomendacao = 'EVITAR')`,
  );
  for (const m of mudaram) {
    await registrar({
      chave: `evitar:${m.ticker}:${m.data}`,
      ticker: m.ticker,
      nivel: "ATENCAO",
      titulo: `${m.ticker} passou para EVITAR na análise de hoje`,
      motivo: (m.resumo_ia || m.alertas || "Veja a análise do ativo.").slice(0, 600),
      link: null,
    });
  }
}
