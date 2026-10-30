// Baixa o ranking do dia: ?formato=md (padrão, pronto para colar numa IA), json ou csv. ?baixar=1 salva como arquivo.
import { montarRanking, rankingCsv, rankingMarkdown } from "@/lib/exportar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") ?? "md";
  const e = await montarRanking();
  const [corpo, tipo, ext] =
    formato === "json"
      ? [JSON.stringify(e, null, 2), "application/json", "json"]
      : formato === "csv"
        ? [rankingCsv(e), "text/csv", "csv"]
        : [rankingMarkdown(e), "text/markdown", "md"];
  const headers: Record<string, string> = { "content-type": `${tipo}; charset=utf-8`, "cache-control": "no-store" };
  if (url.searchParams.get("baixar")) headers["content-disposition"] = `attachment; filename="ranking-${e.data_da_analise ?? "sem-data"}.${ext}"`;
  return new Response(corpo, { headers });
}
