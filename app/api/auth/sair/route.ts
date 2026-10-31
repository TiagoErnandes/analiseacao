// Sai da conta: apaga a sessão no banco e o cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_SESSAO, sair, urlDoSite } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await sair((await cookies()).get(COOKIE_SESSAO)?.value);
  const r = NextResponse.redirect(`${urlDoSite(req)}/login`, 303);
  r.cookies.delete(COOKIE_SESSAO);
  return r;
}
