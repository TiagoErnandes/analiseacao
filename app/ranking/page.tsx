import type { Metadata } from "next";
import { dataBr } from "@/lib/format";
import { query, type Analise, type Relatorio } from "@/lib/db";
import { ultimaExecucao } from "@/lib/analise";
import { Vazio } from "../ui";
import { TabelaRanking } from "./TabelaRanking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ranking" };

export default async function Ranking({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await ultimaExecucao(); // garante as colunas novas
  const [rel] = await query<Pick<Relatorio, "data">>("select data from relatorio_diario order by data desc limit 1");
  const analises = rel ? await query<Analise>("select * from analises where data = $1", [rel.data]) : [];
  const { filtro } = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">{rel ? `Análise de ${dataBr(rel.data)}` : "Sem análise"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ranking do dia</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Score de 0 a 100: 40% desconto em relação ao preço teto, 25% qualidade do balanço, 25% nota da IA e 10% peso
          faltando na sua carteira. Preço teto: ações por Bazin (dividendo conservador ÷ 6%) ou Graham; FIIs pelo rendimento
          sustentável ÷ 8%; ETFs por Bazin ou pela média de preço de 12 meses. Clique numa linha para ver o comentário da IA.
        </p>
      </div>
      {analises.length ? <TabelaRanking analises={analises} filtroInicial={filtro} /> : <Vazio>Ainda não há análise.</Vazio>}
    </div>
  );
}
