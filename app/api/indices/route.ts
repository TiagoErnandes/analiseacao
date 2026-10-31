import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { indicesMercado } from "@/lib/cotacao";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await usuarioAtual())) return NextResponse.json({ erro: "Entre com sua conta Google." }, { status: 401 });
  return NextResponse.json(await indicesMercado());
}
