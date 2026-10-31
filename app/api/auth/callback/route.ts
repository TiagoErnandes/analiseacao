// Volta do Google: confere o estado, troca o código pelo perfil, cria a sessão e entra no painel.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_ESTADO, COOKIE_SESSAO, entrar, loginAtivo, opcoesCookie, perfilDoCodigo, SEGUNDOS_SESSAO, urlDoSite } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const site = urlDoSite(req);
  const erro = (msg: string) => {
    const r = NextResponse.redirect(`${site}/login?erro=${encodeURIComponent(msg)}`);
    r.cookies.delete(COOKIE_ESTADO);
    return r;
  };
  if (!loginAtivo()) return NextResponse.redirect(`${site}/`);
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return erro("Login cancelado.");
  const codigo = u.searchParams.get("code");
  const estado = u.searchParams.get("state");
  const esperado = (await cookies()).get(COOKIE_ESTADO)?.value;
  if (!codigo || !estado || !esperado || estado !== esperado) return erro("O login expirou. Tente de novo.");
  try {
    const perfil = await perfilDoCodigo(req, codigo);
    const { token } = await entrar(perfil);
    const r = NextResponse.redirect(`${site}/`);
    r.cookies.delete(COOKIE_ESTADO);
    r.cookies.set(COOKIE_SESSAO, token, opcoesCookie(req, SEGUNDOS_SESSAO));
    return r;
  } catch (e) {
    console.warn(`Login Google: ${(e as Error).message}`);
    return erro((e as Error).message.slice(0, 200));
  }
}
