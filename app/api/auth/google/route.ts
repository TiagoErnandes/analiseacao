// Começa o login: manda para a tela do Google com um "estado" aleatório (protege contra login forjado).
import { NextResponse } from "next/server";
import { COOKIE_ESTADO, loginAtivo, novoEstado, opcoesCookie, urlDoSite, urlLoginGoogle } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!loginAtivo()) return NextResponse.redirect(`${urlDoSite(req)}/`);
  const estado = novoEstado();
  const r = NextResponse.redirect(urlLoginGoogle(req, estado));
  r.cookies.set(COOKIE_ESTADO, estado, opcoesCookie(req, 600));
  return r;
}
