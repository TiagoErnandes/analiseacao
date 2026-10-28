// Baixa a carteira para outra IA analisar: ?formato=md (padrão), json ou csv. ?baixar=1 salva como arquivo.
import { montarExportacao, paraCsv, paraMarkdown } from "@/lib/exportar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") ?? "md";
  const e = await montarExportacao();
  const nome = `carteira-${e.gerado_em}`;
  const [corpo, tipo, ext] =
    formato === "json"
      ? [JSON.stringify(e, null, 2), "application/json", "json"]
      : formato === "csv"
        ? [paraCsv(e), "text/csv", "csv"]
        : [paraMarkdown(e), "text/markdown", "md"];
  const headers: Record<string, string> = { "content-type": `${tipo}; charset=utf-8`, "cache-control": "no-store" };
  if (url.searchParams.get("baixar")) headers["content-disposition"] = `attachment; filename="${nome}.${ext}"`;
  return new Response(corpo, { headers });
}
