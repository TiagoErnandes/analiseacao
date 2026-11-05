import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { versaoPrecos } from "@/lib/precosAoVivo";

export const dynamic = "force-dynamic";

/** GET /api/precos: quando os preços do site mudaram pela última vez. Só lê o banco (não pede nada ao Yahoo). */
export async function GET() {
  if (!(await usuarioAtual())) return NextResponse.json({ erro: "Entre com sua conta Google." }, { status: 401 });
  return NextResponse.json({ em: await versaoPrecos().catch(() => null) });
}
