import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Lista para a busca do topo: todo ativo que já foi analisado, com nome e tipo. */
export async function GET() {
  try {
    const linhas = await query<{ ticker: string; nome: string | null; tipo: string | null; logo: string | null }>(
      `select distinct on (ticker) ticker, nome, tipo, logo from analises order by ticker, data desc`,
    );
    return NextResponse.json(linhas);
  } catch {
    return NextResponse.json([]);
  }
}
