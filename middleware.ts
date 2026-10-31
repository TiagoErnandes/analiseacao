// Sem cookie de sessão, as páginas mandam direto para a tela de entrar (a sessão em si é conferida no servidor, em lib/auth.ts).
// Roda no Node para ler o .env em tempo de execução: sem GOOGLE_CLIENT_ID o login fica desligado.
import { NextResponse, type NextRequest } from "next/server";

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!login|api/|_next/|icon.svg|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return NextResponse.next();
  if (req.cookies.get("sessao")?.value) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}
