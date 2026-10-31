import { NextResponse } from "next/server";
import { cotacaoHistorica, ehPeriodo } from "@/lib/cotacao";
import { simboloYahoo, TIPOS, type Tipo } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** GET /api/cotacao/PETR4?tipo=acao&periodo=1a */
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = (await params).ticker.toUpperCase();
  const u = new URL(req.url);
  const periodo = u.searchParams.get("periodo") ?? "1a";
  const tipo = (u.searchParams.get("tipo") ?? "acao") as Tipo;
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker) || !ehPeriodo(periodo) || !TIPOS.some((t) => t.id === tipo)) {
    return NextResponse.json({ erro: "Parâmetros inválidos" }, { status: 400 });
  }
  try {
    return NextResponse.json(await cotacaoHistorica(simboloYahoo(ticker, tipo), periodo));
  } catch {
    return NextResponse.json({ erro: "Cotação indisponível agora" }, { status: 502 });
  }
}
