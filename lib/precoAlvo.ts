// Preço-alvo: cada pessoa define o preço em que quer comprar (ou vender) um ativo.
// O vigia do agendador confere a cotação ao longo do dia; quando o preço chega no alvo, o aviso aparece no site
// e, para o dono, vai para o WhatsApp (CallMeBot, número e chave no .env.production).
import { migrar, query } from "./db";
import { precoYahoo } from "./mercado";
import { simboloYahoo, type Tipo } from "./tipos";
import { enviarWhatsapp, whatsappConfigurado } from "./whatsapp";

/** compra: avisa quando o preço CAI até o alvo. venda: avisa quando SOBE até o alvo. */
export type Direcao = "compra" | "venda";

export type PrecoAlvo = {
  id: number;
  ticker: string;
  tipo: string | null;
  moeda: string;
  preco_alvo: number;
  preco_criacao: number | null;
  direcao: Direcao;
  via_site: boolean;
  via_whatsapp: boolean;
  criado_em: string;
  atingido_em: string | null;
  preco_atingido: number | null;
  visto: boolean;
};

let pronto = false;
async function garantirTabela() {
  if (pronto) return;
  await migrar();
  await query(`
    create table if not exists precos_alvo (
      id              bigserial primary key,
      usuario_id      int references usuarios (id) on delete cascade,
      ticker          text not null,
      tipo            text,
      moeda           text not null default 'BRL',
      preco_alvo      numeric not null check (preco_alvo > 0),
      preco_criacao   numeric,
      direcao         text not null check (direcao in ('compra', 'venda')),
      via_site        boolean not null default true,
      via_whatsapp    boolean not null default true,
      criado_em       timestamptz not null default now(),
      atingido_em     timestamptz,
      preco_atingido  numeric,
      visto           boolean not null default false
    );
    create unique index if not exists precos_alvo_usuario_ticker on precos_alvo (usuario_id, ticker) nulls not distinct;
  `);
  pronto = true;
}

const NUM = ["id", "preco_alvo", "preco_criacao", "preco_atingido"] as const;
const normalizar = (r: PrecoAlvo): PrecoAlvo => {
  for (const k of NUM) if (r[k] != null) (r as Record<string, unknown>)[k] = Number(r[k]);
  return r;
};

const CAMPOS = "id, ticker, tipo, moeda, preco_alvo, preco_criacao, direcao, via_site, via_whatsapp, criado_em::text, atingido_em::text, preco_atingido, visto";

/** O alvo de um ativo para a pessoa (ou null). */
export async function precoAlvoDe(usuarioId: number | null, ticker: string): Promise<PrecoAlvo | null> {
  await garantirTabela();
  const [r] = await query<PrecoAlvo>(`select ${CAMPOS} from precos_alvo where usuario_id is not distinct from $1 and ticker = $2`, [usuarioId, ticker]);
  return r ? normalizar(r) : null;
}

/** Todos os alvos da pessoa (os atingidos primeiro). */
export async function precosAlvoDoUsuario(usuarioId: number | null): Promise<PrecoAlvo[]> {
  try {
    await garantirTabela();
    const linhas = await query<PrecoAlvo>(
      `select ${CAMPOS} from precos_alvo where usuario_id is not distinct from $1
        order by atingido_em desc nulls last, ticker`,
      [usuarioId],
    );
    return linhas.map(normalizar);
  } catch {
    return [];
  }
}

/** Cria ou troca o alvo. A direção sai do preço de agora: alvo abaixo = ponto de compra; acima = ponto de venda. */
export async function salvarPrecoAlvo(
  usuarioId: number | null,
  d: { ticker: string; tipo: string | null; moeda: string; precoAlvo: number; precoAtual: number | null; viaSite: boolean; viaWhatsapp: boolean },
): Promise<PrecoAlvo> {
  await garantirTabela();
  const direcao: Direcao = d.precoAtual != null && d.precoAlvo > d.precoAtual ? "venda" : "compra";
  const [r] = await query<PrecoAlvo>(
    `insert into precos_alvo (usuario_id, ticker, tipo, moeda, preco_alvo, preco_criacao, direcao, via_site, via_whatsapp)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (usuario_id, ticker) do update set
       tipo = excluded.tipo, moeda = excluded.moeda, preco_alvo = excluded.preco_alvo, preco_criacao = excluded.preco_criacao,
       direcao = excluded.direcao, via_site = excluded.via_site, via_whatsapp = excluded.via_whatsapp,
       criado_em = now(), atingido_em = null, preco_atingido = null, visto = false
     returning ${CAMPOS}`,
    [usuarioId, d.ticker, d.tipo, d.moeda, d.precoAlvo, d.precoAtual, direcao, d.viaSite, d.viaWhatsapp],
  );
  return normalizar(r);
}

export async function removerPrecoAlvo(usuarioId: number | null, ticker: string) {
  await garantirTabela();
  await query("delete from precos_alvo where usuario_id is not distinct from $1 and ticker = $2", [usuarioId, ticker]);
}

/** Some com o aviso do site (o alvo continua guardado, já atingido). */
export async function marcarVisto(usuarioId: number | null, ticker: string) {
  await garantirTabela();
  await query("update precos_alvo set visto = true where usuario_id is not distinct from $1 and ticker = $2", [usuarioId, ticker]);
}

/** O preço chegou no alvo? */
export const atingiu = (direcao: Direcao, preco: number, alvo: number) => (direcao === "compra" ? preco <= alvo : preco >= alvo);

const valor = (v: number, moeda: string) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: moeda === "USD" ? "USD" : "BRL" });

export function textoAviso(a: Pick<PrecoAlvo, "ticker" | "direcao" | "preco_alvo" | "moeda">, preco: number, site?: string) {
  const ponto = a.direcao === "compra" ? "está no ponto de COMPRA" : "chegou no seu preço de VENDA";
  return [
    `🎯 ${a.ticker} ${ponto}`,
    `Cotação: ${valor(preco, a.moeda)} | Seu preço-alvo: ${valor(a.preco_alvo, a.moeda)}`,
    ...(site ? [`${site.replace(/\/$/, "")}/acao/${a.ticker}`] : []),
    "Confira a análise antes de decidir.",
  ].join("\n");
}

/**
 * Confere todos os alvos ainda não atingidos (de todas as pessoas). Roda no vigia do agendador.
 * Cada alvo avisa uma vez só; para avisar de novo, a pessoa define o alvo outra vez.
 */
export async function vigiarPrecosAlvo(): Promise<number> {
  await garantirTabela();
  const pendentes = await query<PrecoAlvo & { dono: boolean }>(
    `select ${CAMPOS.split(", ").map((c) => `p.${c}`).join(", ")}, coalesce(u.admin, p.usuario_id is null) as dono
       from precos_alvo p left join usuarios u on u.id = p.usuario_id
      where p.atingido_em is null`,
  );
  if (!pendentes.length) return 0;
  // Uma cotação por ativo, mesmo que várias pessoas tenham alvo nele
  const cotacoes = new Map<string, number | null>();
  for (const p of pendentes) {
    const simbolo = simboloYahoo(p.ticker, (p.tipo as Tipo | null) ?? null);
    if (!cotacoes.has(simbolo)) cotacoes.set(simbolo, (await precoYahoo(simbolo).catch(() => null))?.preco ?? null);
  }
  let avisos = 0;
  for (const bruto of pendentes) {
    const p = normalizar(bruto);
    const preco = cotacoes.get(simboloYahoo(p.ticker, (p.tipo as Tipo | null) ?? null));
    if (preco == null || !atingiu(p.direcao, preco, p.preco_alvo)) continue;
    // Marca antes de enviar: se o envio falhar, não fica mandando de novo a cada 30 minutos
    const [marcado] = await query<{ id: number }>(
      "update precos_alvo set atingido_em = now(), preco_atingido = $2 where id = $1 and atingido_em is null returning id",
      [p.id, preco],
    );
    if (!marcado) continue;
    avisos++;
    console.log(`  PREÇO-ALVO ${p.ticker} (${p.direcao}): cotação ${preco}, alvo ${p.preco_alvo}`);
    // WhatsApp e celular: só o dono do site (o número e a chave ficam no .env.production)
    if (p.via_whatsapp && bruto.dono) await enviarWhatsapp(textoAviso(p, preco, process.env.SITE_URL));
  }
  console.log(`Preço-alvo: ${pendentes.length} alvos conferidos, ${avisos} atingidos`);
  return avisos;
}

export { whatsappConfigurado };
