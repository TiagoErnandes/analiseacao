import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { lerCache } from "@/lib/mercado";

export const dynamic = "force-dynamic";

type Ativo = { ticker: string; nome: string | null; tipo: string | null; logo: string | null; analisado: boolean };

/**
 * Lista para a busca do topo: os ativos já analisados (com nome e logo) e, depois, todos os outros da B3
 * que estão na tabela pública do Fundamentus (guardada pelo garimpo), que são analisados na hora ao abrir.
 */
export async function GET() {
  const lista: Ativo[] = [];
  try {
    const linhas = await query<Omit<Ativo, "analisado">>(
      `select distinct on (ticker) ticker, nome, tipo, logo from analises order by ticker, data desc`,
    );
    lista.push(...linhas.map((l) => ({ ...l, analisado: true })));
  } catch {
    /* sem banco */
  }
  const ja = new Set(lista.map((a) => a.ticker));
  const tabela = await lerCache<{ acoes: Record<string, string>[]; fiis: Record<string, string>[] }>("garimpo");
  for (const [linhas, tipo] of [[tabela?.dados.acoes ?? [], "acao"], [tabela?.dados.fiis ?? [], "fii"]] as const) {
    for (const l of linhas) {
      const t = (l.Papel ?? "").toUpperCase();
      if (!/^[A-Z]{4}\d{1,2}$/.test(t) || ja.has(t)) continue;
      ja.add(t);
      lista.push({ ticker: t, nome: tipo === "fii" ? (l.Segmento ?? null) : null, tipo, logo: `https://icons.brapi.dev/icons/${t}.svg`, analisado: false });
    }
  }
  return NextResponse.json(lista, { headers: { "Cache-Control": "private, max-age=300" } });
}
