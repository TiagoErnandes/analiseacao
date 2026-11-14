// Alertas de venda: vigia os ativos da carteira ao longo do dia e avisa no celular (Telegram, ntfy e/ou WhatsApp).
// Fontes: notícias do Google Notícias, fatos relevantes da CVM, queda forte no preço e a análise do dia.
// O Gemini (chave grátis) separa o que é grave do que é ruído; sem Gemini, palavras-chave fazem a triagem.
import { chaveGemini, gemini } from "./ai";
import { atualizarDocumentosCvm, infoB3 } from "./cvm";
import { migrar, query } from "./db";
import { precoYahoo } from "./mercado";
import { enviarWhatsapp, whatsappConfigurado, type ModeloMeta } from "./whatsapp";

export type Nivel = "VENDER" | "ATENCAO";
export type Alerta = { chave: string; ticker: string; nivel: Nivel | "NADA"; titulo: string; motivo: string; link: string | null; criado_em?: string };
type Noticia = { chave: string; ticker: string; titulo: string; fonte: string; link: string | null; data: string };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
/** Queda no dia que pede uma olhada (ações e FIIs). */
const QUEDA_FORTE = -0.07;
/** Palavras que indicam risco sério (usadas sem Gemini, ou se ele falhar). */
const GRAVE = /recupera[çc][ãa]o judicial|fal[êe]ncia|fraude|inconsist[êe]ncia cont[áa]bil|rombo|opera[çc][ãa]o da pf|pol[íi]cia federal|cvm (abre|instaura)|calote|default|rebaixa|corta (os )?dividendos|suspende (os )?dividendos|preju[íi]zo bilion|renúncia do (ceo|presidente)|interven[çc][ãa]o|delist|fechamento de capital|OPA/i;

async function garantirTabela() {
  await migrar(); // usuarios e carteira por usuário
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

/** Algum canal do celular configurado no servidor (Telegram, ntfy ou WhatsApp)? */
export const celularConfigurado = () =>
  !!((process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.NTFY_TOPICO || whatsappConfigurado());

/** Envia para o celular do dono: Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID), ntfy (NTFY_TOPICO) e/ou WhatsApp (Meta ou CallMeBot). */
export async function enviarCelular(m: { cabecalho: string; titulo: string; motivo: string; link: string | null; urgente?: boolean; tag?: string; modelo?: ModeloMeta }): Promise<boolean> {
  let enviado = false;
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, NTFY_TOPICO: topico } = process.env;
  if (token && chat) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const texto = `<b>${esc(m.cabecalho)}</b>\n${esc(m.titulo)}\n\n${esc(m.motivo)}${m.link ? `\n${esc(m.link)}` : ""}`;
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
        title: m.cabecalho,
        message: `${m.titulo}\n\n${m.motivo}`,
        priority: m.urgente ? 5 : 4,
        tags: [m.tag ?? (m.urgente ? "rotating_light" : "warning")],
        ...(m.link ? { click: m.link } : {}),
      }),
    }).catch((e: Error) => (console.warn(`  ntfy: ${e.message}`), null));
    if (res?.ok) enviado = true;
    else if (res) console.warn(`  ntfy: HTTP ${res.status}`);
  }
  if (whatsappConfigurado() && (await enviarWhatsapp(`${m.cabecalho}\n${m.titulo}\n\n${m.motivo}${m.link ? `\n${m.link}` : ""}`, m.modelo ?? { nome: process.env.WHATSAPP_META_MODELO_ALERTA }))) enviado = true;
  if (!celularConfigurado()) console.warn("  Alertas: configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID, NTFY_TOPICO ou o WhatsApp (WHATSAPP_NUMERO + WHATSAPP_META_* ou CALLMEBOT_WHATSAPP_APIKEY) para receber no celular.");
  return enviado;
}

/** Alerta de venda no celular. */
export async function enviar(a: Omit<Alerta, "chave"> & { nivel: Nivel }): Promise<boolean> {
  const icone = a.nivel === "VENDER" ? "🚨" : "⚠️";
  const cabecalho = `${icone} ${a.nivel === "VENDER" ? "VENDA URGENTE?" : "Atenção"} ${a.ticker}`;
  return enviarCelular({ cabecalho, titulo: a.titulo, motivo: a.motivo, link: a.link, urgente: a.nivel === "VENDER" });
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

/** Apelidos que aparecem nas manchetes e nem sempre estão no nome oficial (por emissor, as 4 letras do código). */
const APELIDOS: Record<string, string[]> = {
  AXIA: ["axia", "eletrobras"],
  ELET: ["eletrobras", "axia"],
  BBAS: ["banco do brasil", "BB"],
  ITSA: ["itausa"],
  ITUB: ["itau unibanco", "itau"],
  PETR: ["petrobras"],
  BBDC: ["bradesco"],
  SAPR: ["sanepar"],
  SBSP: ["sabesp"],
  CMIG: ["cemig"],
  CPLE: ["copel"],
  TAEE: ["taesa"],
  TRPL: ["isa energia", "isa cteep", "cteep"],
  ISAE: ["isa energia", "isa cteep", "cteep"],
  CSMG: ["copasa"],
  BBSE: ["bb seguridade"],
  KLBN: ["klabin"],
  WEGE: ["weg"],
  ABEV: ["ambev"],
  EGIE: ["engie"],
};
/** Palavras comuns demais para identificar a empresa sozinhas. */
const GENERICAS = new Set(
  "companhia cia banco brasil brasileira brasileiro brasileiras brasileiros energia energetica eletrica eletricas centrais participacoes holding grupo fundo investimento investimentos imobiliario imobiliaria fii industria industrias comercio servicos sistemas seguros seguridade saneamento estado paulo parana minas gerais rio grande sul norte nordeste nacional geral gestao renda logistica shopping shoppings capital financeira tecnologia saude transmissao distribuicao petroleo".split(" "),
);
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Termos que identificam a empresa numa manchete: apelidos, nome oficial sem "S.A." e as palavras próprias do nome. */
export function termosDaEmpresa(ticker: string, nome: string | null | undefined): string[] {
  const termos = new Set<string>(APELIDOS[ticker.slice(0, 4).toUpperCase()] ?? []);
  for (const parte of semAcento(nome ?? "").split(/\s+-\s+|,|\(|\)/)) {
    const limpo = parte
      .toLowerCase()
      .replace(/\b(s\.?\/?a\.?|ltda|on|pn|pna|pnb|unt|nm|n1|n2|ed|ej|ex|em recuperacao judicial)\b\.?/g, " ")
      .replace(/[^a-z0-9& ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (limpo.length >= 4) termos.add(limpo);
    for (const p of limpo.split(" ")) if (p.length >= 4 && !GENERICAS.has(p) && !/^\d+$/.test(p)) termos.add(p);
  }
  return [...termos];
}

/**
 * A manchete é mesmo deste ativo? O Google Notícias devolve matérias que citam o código só no corpo
 * (listas de "quem paga dividendo", carteiras recomendadas), com manchete sobre outro ativo (ex.: ITSA4 -> "SPTW11 corta dividendo").
 * Vale se a manchete cita o código exato (SAPR4, não SAPR41) ou o nome da empresa.
 */
export function noticiaDoAtivo(titulo: string, ticker: string, termos: string[]): boolean {
  const t = ticker.toUpperCase();
  if (new RegExp(`(^|[^A-Z0-9])${escRe(t)}F?(?![A-Z0-9])`, "i").test(titulo)) return true; // PETR4 ou PETR4F, nunca SAPR41
  const manchete = semAcento(titulo.replace(/\s+-\s+[^-]+$/, "")); // tira o " - nome do site" do fim
  return termos.some((termo) =>
    termo === termo.toUpperCase() && /[A-Z]/.test(termo)
      ? new RegExp(`\\b${escRe(termo)}\\b`).test(manchete) // sigla (BB): só em maiúsculas
      : new RegExp(`\\b${escRe(semAcento(termo))}\\b`, "i").test(manchete),
  );
}

async function noticias(ticker: string, termos: string[]): Promise<Noticia[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${ticker}" when:1d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Google Notícias ${ticker}: HTTP ${res.status}`);
  return lerRss(await res.text(), ticker)
    .filter((n) => noticiaDoAtivo(n.titulo, ticker, termos))
    .slice(0, 15);
}

/** Nome de cada ativo, da análise mais recente. */
async function nomesDosAtivos(tickers: string[]): Promise<Map<string, string>> {
  const linhas = await query<{ ticker: string; nome: string | null }>(
    `select distinct on (ticker) ticker, nome from analises where ticker = any($1::text[]) and nome is not null order by ticker, data desc`,
    [tickers],
  ).catch(() => []);
  return new Map(linhas.map((l) => [l.ticker.toUpperCase(), l.nome ?? ""]));
}

/**
 * Alertas antigos de notícia cuja manchete fala de outro ativo (antes do filtro acima) viram NADA:
 * somem do painel e não são lidos de novo.
 */
export async function limparAlertasDeOutroAtivo(): Promise<number> {
  const antigos = await query<{ chave: string; ticker: string; titulo: string }>(
    `select chave, ticker, titulo from alertas where chave like 'noticia:%' and nivel <> 'NADA'`,
  );
  if (!antigos.length) return 0;
  const nomes = await nomesDosAtivos([...new Set(antigos.map((a) => a.ticker.toUpperCase()))]);
  const errados = antigos.filter((a) => !noticiaDoAtivo(a.titulo, a.ticker, termosDaEmpresa(a.ticker, nomes.get(a.ticker.toUpperCase()))));
  if (errados.length) {
    await query(`update alertas set nivel = 'NADA', motivo = 'Notícia de outro ativo (descartada).' where chave = any($1::text[])`, [errados.map((a) => a.chave)]);
    console.log(`  Alertas: ${errados.length} alertas de notícia de outro ativo descartados`);
  }
  return errados.length;
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
async function triar(itens: { id: number; ticker: string; empresa?: string; texto: string }[]): Promise<Map<number, { nivel: Nivel | "NADA"; motivo: string }>> {
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
Cada item traz o ticker (e a empresa) da carteira a que foi atribuído: se a notícia é sobre outro ativo ou outra empresa
(ex.: item do ITSA4 com manchete sobre o FII SPTW11), responda NADA, por mais grave que seja.
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
  const carteira = await query<{ ticker: string; tipo: string | null }>(
    // Os alertas no celular são do dono do site (Telegram/ntfy do servidor)
    "select ticker, tipo from carteira where quantidade > 0 and usuario_id is not distinct from (select id from usuarios where admin order by id limit 1)",
  );
  const tickers = carteira
    .filter((c) => !c.tipo || c.tipo === "acao" || c.tipo === "fii")
    .map((c) => c.ticker.toUpperCase());
  if (!tickers.length) return 0;
  let enviados = 0;
  await limparAlertasDeOutroAtivo().catch((e) => console.warn(`  Alertas: limpeza falhou (${e.message})`));
  const nomes = await nomesDosAtivos(tickers);
  const termos = new Map(tickers.map((t) => [t, termosDaEmpresa(t, nomes.get(t))]));

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
    const lista = await noticias(t, termos.get(t) ?? []).catch((e) => (console.warn(`  Alertas: ${e.message}`), []));
    if (!lista.length) continue;
    const vistas = new Set(
      (await query<{ chave: string }>("select chave from alertas where chave = any($1::text[])", [lista.map((n) => n.chave)])).map((x) => x.chave),
    );
    novas.push(...lista.filter((n) => !vistas.has(n.chave)));
  }

  // Triagem de tudo que é novo, de uma vez
  const itens = [
    ...docs.map((d, i) => ({ id: i, ticker: codigos.get(d.cd_cvm)!, texto: `[CVM ${d.data}] ${d.categoria}: ${d.assunto ?? ""}` })),
    ...novas.map((n, i) => ({ id: docs.length + i, ticker: n.ticker, empresa: nomes.get(n.ticker) ?? undefined, texto: `[${n.fonte}] ${n.titulo}` })),
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
