// Preço-alvo: o controle de compra de cada pessoa. Ela define o preço em que quer comprar um ativo e, enquanto a
// cotação estiver nesse valor ou abaixo, o vigia do agendador avisa no site, no email da conta Google e, para o dono,
// no celular (WhatsApp, Telegram e/ou ntfy). No máximo 3 avisos por dia por ativo, com pelo menos 2 horas entre eles.
import { migrar, query } from "./db";
import { precoYahoo } from "./mercado";
import { simboloYahoo, type Tipo } from "./tipos";
import { celularConfigurado, enviarCelular } from "./alertas";
import { emailConfigurado, enviarEmail } from "./email";

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
  via_email: boolean;
  criado_em: string;
  atingido_em: string | null;
  preco_atingido: number | null;
  visto: boolean;
  avisos_hoje: number;
  ultimo_aviso_em: string | null;
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
    -- Quando o aviso chegou no celular (vazio: ainda não chegou; o vigia tenta de novo por até 24 horas)
    alter table precos_alvo add column if not exists celular_enviado_em timestamptz;
    -- Email para a conta Google da pessoa (mesma regra: tenta por até 24 horas)
    alter table precos_alvo add column if not exists via_email boolean not null default true;
    alter table precos_alvo add column if not exists email_enviado_em timestamptz;
    -- Avisos repetidos: quantos saíram no dia (horário de Brasília) e quando foi o último
    alter table precos_alvo add column if not exists avisos_dia date;
    alter table precos_alvo add column if not exists avisos_hoje int not null default 0;
    alter table precos_alvo add column if not exists ultimo_aviso_em timestamptz;
    -- O preço-alvo é sempre ponto de compra (avisa com a cotação no alvo ou abaixo)
    update precos_alvo set direcao = 'compra' where direcao <> 'compra';
    create unique index if not exists precos_alvo_usuario_ticker on precos_alvo (usuario_id, ticker) nulls not distinct;
  `);
  pronto = true;
}

const NUM = ["id", "preco_alvo", "preco_criacao", "preco_atingido", "avisos_hoje"] as const;
const normalizar = (r: PrecoAlvo): PrecoAlvo => {
  for (const k of NUM) if (r[k] != null) (r as Record<string, unknown>)[k] = Number(r[k]);
  return r;
};

/** As colunas lidas (com `p` = "p." quando a consulta junta outra tabela). Os avisos de ontem contam como zero. */
const campos = (p = "") =>
  ["id", "ticker", "tipo", "moeda", "preco_alvo", "preco_criacao", "direcao", "via_site", "via_whatsapp", "via_email", "criado_em::text as criado_em",
   "atingido_em::text as atingido_em", "preco_atingido", "visto", "ultimo_aviso_em::text as ultimo_aviso_em"]
    .map((c) => p + c)
    .concat(`case when ${p}avisos_dia = (now() at time zone 'America/Sao_Paulo')::date then ${p}avisos_hoje else 0 end as avisos_hoje`)
    .join(", ");
const CAMPOS = campos();

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

/** Cria ou troca o alvo (sempre ponto de compra: avisa com a cotação no alvo ou abaixo). Zera os avisos do dia. */
export async function salvarPrecoAlvo(
  usuarioId: number | null,
  d: { ticker: string; tipo: string | null; moeda: string; precoAlvo: number; precoAtual: number | null; viaSite: boolean; viaWhatsapp: boolean; viaEmail: boolean },
): Promise<PrecoAlvo> {
  await garantirTabela();
  const direcao: Direcao = "compra";
  const [r] = await query<PrecoAlvo>(
    `insert into precos_alvo (usuario_id, ticker, tipo, moeda, preco_alvo, preco_criacao, direcao, via_site, via_whatsapp, via_email)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (usuario_id, ticker) do update set
       tipo = excluded.tipo, moeda = excluded.moeda, preco_alvo = excluded.preco_alvo, preco_criacao = excluded.preco_criacao,
       direcao = excluded.direcao, via_site = excluded.via_site, via_whatsapp = excluded.via_whatsapp, via_email = excluded.via_email,
       criado_em = now(), atingido_em = null, preco_atingido = null, visto = false, celular_enviado_em = null, email_enviado_em = null,
       avisos_dia = null, avisos_hoje = 0, ultimo_aviso_em = null
     returning ${CAMPOS}`,
    [usuarioId, d.ticker, d.tipo, d.moeda, d.precoAlvo, d.precoAtual, direcao, d.viaSite, d.viaWhatsapp, d.viaEmail],
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

/** A mensagem do celular quando o preço chega no alvo. */
export function aviso(a: Pick<PrecoAlvo, "ticker" | "preco_alvo" | "moeda">, preco: number, site?: string, n?: number) {
  return {
    cabecalho: `🎯 ${a.ticker} está no ponto de COMPRA`,
    titulo: `Cotação: ${valor(preco, a.moeda)} | Seu preço-alvo: ${valor(a.preco_alvo, a.moeda)}`,
    contagem: n ? `Aviso ${n} de ${MAX_AVISOS_DIA} de hoje: enquanto a cotação estiver no alvo ou abaixo, você recebe até ${MAX_AVISOS_DIA} avisos por dia.` : "",
    motivo: "Confira a análise antes de decidir.",
    link: site ? `${site.replace(/\/$/, "")}/acao/${a.ticker}` : null,
    tag: "dart",
    // Modelo da Meta: "Seu alerta de preço-alvo foi acionado: {{1}}. Cotação atual: {{2}}. Seu preço-alvo: {{3}}. ..."
    modelo: {
      nome: process.env.WHATSAPP_META_MODELO,
      parametros: [
        `${a.ticker} chegou no ponto de compra`,
        valor(preco, a.moeda),
        valor(a.preco_alvo, a.moeda),
      ],
    },
  };
}

/** Quantos avisos cada alvo manda por dia (horário de Brasília) e o intervalo mínimo entre eles. */
export const MAX_AVISOS_DIA = Math.max(1, Number(process.env.PRECO_ALVO_MAX_DIA) || 3);
export const INTERVALO_AVISOS_HORAS = Math.max(0, Number(process.env.PRECO_ALVO_INTERVALO_HORAS ?? 2) || 0);

/** Pode mandar mais um aviso agora? (já mandou `hoje` avisos no dia; o último foi `horasDesdeUltimo` horas atrás) */
export function podeAvisar(hoje: number, horasDesdeUltimo: number | null, max = MAX_AVISOS_DIA, intervalo = INTERVALO_AVISOS_HORAS) {
  return hoje < max && (horasDesdeUltimo == null || horasDesdeUltimo >= intervalo);
}

const HOJE_SP = "(now() at time zone 'America/Sao_Paulo')::date";

/**
 * Confere todos os alvos (de todas as pessoas). Roda no vigia do agendador, a cada 10 minutos no pregão.
 * Enquanto a cotação estiver no alvo ou abaixo, avisa de novo: no máximo 3 vezes por dia por alvo, com pelo menos
 * 2 horas entre um aviso e outro (PRECO_ALVO_MAX_DIA e PRECO_ALVO_INTERVALO_HORAS no .env.production).
 * Se nenhum canal entregar (email recusado, WhatsApp desconectado e sem aviso no site), o aviso não conta e o vigia
 * tenta de novo na próxima rodada.
 */
export async function vigiarPrecosAlvo(): Promise<number> {
  await garantirTabela();
  const todos = await query<PrecoAlvo & { email: string | null; admin: boolean }>(
    `select ${campos("p.")},
            coalesce(u.email, nullif($1, '')) as email, coalesce(u.admin, p.usuario_id is null) as admin
       from precos_alvo p left join usuarios u on u.id = p.usuario_id`,
    [process.env.ADMIN_EMAIL ?? ""],
  );
  // Uma cotação por ativo, mesmo que várias pessoas tenham alvo nele
  const cotacoes = new Map<string, number | null>();
  for (const p of todos) {
    const simbolo = simboloYahoo(p.ticker, (p.tipo as Tipo | null) ?? null);
    if (!cotacoes.has(simbolo)) cotacoes.set(simbolo, (await precoYahoo(simbolo).catch(() => null))?.preco ?? null);
  }
  const celular = celularConfigurado();
  const email = emailConfigurado();
  let avisos = 0;
  for (const bruto of todos) {
    const p = normalizar(bruto);
    const preco = cotacoes.get(simboloYahoo(p.ticker, (p.tipo as Tipo | null) ?? null));
    if (preco == null || !atingiu("compra", preco, p.preco_alvo)) continue;
    const horas = p.ultimo_aviso_em ? (Date.now() - new Date(p.ultimo_aviso_em).getTime()) / 3_600_000 : null;
    if (!podeAvisar(p.avisos_hoje, horas)) continue;

    // Reserva o aviso antes de mandar (duas rodadas ao mesmo tempo não mandam em dobro)
    const [reservado] = await query<{ n: number; dia_antes: string | null; qtd_antes: number; ultimo_antes: string | null }>(
      `update precos_alvo p set
          avisos_hoje = case when p.avisos_dia = ${HOJE_SP} then p.avisos_hoje + 1 else 1 end,
          avisos_dia = ${HOJE_SP}, ultimo_aviso_em = now(),
          atingido_em = now(), preco_atingido = $2, visto = false
        from (select id, avisos_dia, avisos_hoje, ultimo_aviso_em from precos_alvo where id = $1) antes
       where p.id = antes.id
         and (p.avisos_dia is distinct from ${HOJE_SP} or p.avisos_hoje < $3)
         and (p.ultimo_aviso_em is null or p.ultimo_aviso_em <= now() - make_interval(mins => $4::int))
      returning p.avisos_hoje as n, antes.avisos_dia::text as dia_antes, antes.avisos_hoje as qtd_antes, antes.ultimo_aviso_em::text as ultimo_antes`,
      [p.id, preco, MAX_AVISOS_DIA, Math.round(INTERVALO_AVISOS_HORAS * 60)],
    );
    if (!reservado) continue;
    const m = aviso(p, preco, process.env.SITE_URL, Number(reservado.n));

    let entregue = p.via_site;
    if (p.via_whatsapp && bruto.admin && celular && (await enviarCelular(m))) {
      entregue = true;
      await query("update precos_alvo set celular_enviado_em = now() where id = $1", [p.id]);
    }
    if (p.via_email && email && bruto.email) {
      const ok = await enviarEmail(bruto.email, { assunto: m.cabecalho, titulo: m.cabecalho, linhas: [m.titulo, m.contagem, m.motivo], link: m.link });
      if (ok) {
        entregue = true;
        await query("update precos_alvo set email_enviado_em = now() where id = $1", [p.id]);
      }
    }
    if (!entregue) {
      // Nada chegou: devolve a reserva para tentar na próxima rodada
      await query("update precos_alvo set avisos_dia = $2::date, avisos_hoje = $3, ultimo_aviso_em = $4::timestamptz where id = $1", [
        p.id, reservado.dia_antes, reservado.qtd_antes, reservado.ultimo_antes,
      ]);
      continue;
    }
    avisos++;
    console.log(`  PREÇO-ALVO ${p.ticker}: cotação ${preco}, alvo ${p.preco_alvo} (aviso ${reservado.n} de ${MAX_AVISOS_DIA} hoje)`);
  }
  console.log(`Preço-alvo: ${todos.length} alvos conferidos, ${avisos} avisos enviados`);
  return avisos;
}

export { celularConfigurado, emailConfigurado };
