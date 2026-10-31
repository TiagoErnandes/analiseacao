// Login com o Google e carteira por usuário.
// Sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET o login fica desligado e o site funciona como antes (uma carteira só, a do dono).
import { cache } from "react";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { idDoDono, migrar, pool, query } from "./db";

export type Usuario = {
  /** null: carteira ainda sem dono (login desligado e ninguém entrou ainda). */
  id: number | null;
  email: string | null;
  nome: string | null;
  foto: string | null;
  admin: boolean;
};

export const COOKIE_SESSAO = "sessao";
export const COOKIE_ESTADO = "oauth_estado";
const DIAS_SESSAO = 30;

export const loginAtivo = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Quem está usando o site agora (uma consulta por requisição). */
export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  await migrar();
  if (!loginAtivo()) {
    const id = await idDoDono();
    const [u] = id ? await query<Usuario>("select id, email, nome, foto, admin from usuarios where id = $1", [id]) : [];
    return u ?? { id: null, email: null, nome: null, foto: null, admin: true };
  }
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  const [u] = await query<Usuario>(
    `select u.id, u.email, u.nome, u.foto, u.admin from sessoes s join usuarios u on u.id = s.usuario_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hash(token)],
  );
  return u ?? null;
});

/** Para páginas: sem login, vai para a tela de entrar. */
export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  return u;
}

/** Para server actions e rotas: sem login, erro (não redireciona). */
export async function usuarioOuErro(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) throw new Error("Entre com sua conta Google para continuar.");
  return u;
}

export async function adminOuErro(): Promise<Usuario> {
  const u = await usuarioOuErro();
  if (!u.admin) throw new Error("Só o dono do site pode fazer isso.");
  return u;
}

// ---------- Google OAuth ----------

/** Endereço público do site (para o Google devolver o login). SITE_URL tem prioridade; senão vem dos cabeçalhos do Nginx. */
export function urlDoSite(req: Request): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const urlRetorno = (req: Request) => `${urlDoSite(req)}/api/auth/callback`;

export function novoEstado() {
  return randomBytes(24).toString("base64url");
}

export function urlLoginGoogle(req: Request, estado: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: urlRetorno(req),
    response_type: "code",
    scope: "openid email profile",
    state: estado,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type PerfilGoogle = { sub: string; email: string; nome: string | null; foto: string | null };

/** Troca o código pelo id_token. O token vem direto do Google (HTTPS), então basta conferir emissor, destino e validade. */
export async function perfilDoCodigo(req: Request, codigo: string): Promise<PerfilGoogle> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: codigo,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: urlRetorno(req),
      grant_type: "authorization_code",
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.id_token) throw new Error(`Google recusou o login: ${j.error_description ?? j.error ?? r.status}`);
  const payload = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("Login de outro aplicativo.");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") throw new Error("Emissor inválido.");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) throw new Error("Login expirado. Tente de novo.");
  if (!payload.email || payload.email_verified === false) throw new Error("A conta Google precisa ter e-mail verificado.");
  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    nome: typeof payload.name === "string" ? payload.name : null,
    foto: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/**
 * Cria ou atualiza o usuário. Enquanto o site não tem dono, o primeiro login (ou o e-mail de ADMIN_EMAIL, se definido)
 * vira o dono e herda a carteira que já existia (compras, histórico do patrimônio e estratégia).
 */
export async function entrar(perfil: PerfilGoogle): Promise<{ token: string; dono: boolean }> {
  await migrar();
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
  const client = await pool().connect();
  try {
    await client.query("begin");
    // Trava curta para dois primeiros logins ao mesmo tempo não disputarem a carteira
    await client.query("select pg_advisory_xact_lock(424242)");
    const { rows } = await client.query<{ id: number; admin: boolean }>(
      `insert into usuarios (google_sub, email, nome, foto, ultimo_acesso) values ($1, $2, $3, $4, now())
       on conflict (google_sub) do update set email = excluded.email, nome = excluded.nome, foto = excluded.foto, ultimo_acesso = now()
       returning id, admin`,
      [perfil.sub, perfil.email, perfil.nome, perfil.foto],
    );
    const u = rows[0];
    let dono = u.admin;
    if (!dono) {
      const { rows: adm } = await client.query("select 1 from usuarios where admin limit 1");
      if (adm.length === 0 && (!adminEmail || adminEmail === perfil.email)) {
        await client.query("update usuarios set admin = true where id = $1", [u.id]);
        for (const t of ["carteira", "operacoes", "patrimonio_diario", "config_usuario"]) {
          await client.query(`update ${t} set usuario_id = $1 where usuario_id is null`, [u.id]);
        }
        dono = true;
      }
    }
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `insert into sessoes (token_hash, usuario_id, expira_em) values ($1, $2, now() + make_interval(days => $3::int))`,
      [hash(token), u.id, DIAS_SESSAO],
    );
    await client.query("delete from sessoes where expira_em < now()");
    await client.query("commit");
    return { token, dono };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function sair(token: string | undefined) {
  if (token) await query("delete from sessoes where token_hash = $1", [hash(token)]);
}

export const opcoesCookie = (req: Request, maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: urlDoSite(req).startsWith("https://"),
  maxAge,
});
export const SEGUNDOS_SESSAO = DIAS_SESSAO * 24 * 3600;
