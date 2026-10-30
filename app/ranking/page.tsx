import type { Metadata } from "next";
import { dataBr, pct } from "@/lib/format";
import { yieldAtual } from "@/lib/juros";
import { query, type Analise, type Relatorio } from "@/lib/db";
import { ultimaExecucao } from "@/lib/analise";
import { Cartao, Vazio } from "../ui";
import { TabelaRanking } from "./TabelaRanking";
import { ExportarCarteira } from "../carteira/ExportarCarteira";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ranking" };

export default async function Ranking({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await ultimaExecucao(); // garante as colunas novas
  const [rel] = await query<Pick<Relatorio, "data">>("select data from relatorio_diario order by data desc limit 1");
  const analises = rel ? await query<Analise>("select * from analises where data = $1", [rel.data]) : [];
  const { filtro } = await searchParams;
  const y = await yieldAtual();

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">{rel ? `Análise de ${dataBr(rel.data)}` : "Sem análise"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ranking do dia</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Score de 0 a 100: 35% qualidade do balanço, 25% nota da IA e 40% desconto em relação ao preço teto (30% desconto e 10% peso
          faltando na carteira, na estratégia Balanceamento). Desconto acima de 40% não soma mais: costuma ser armadilha.
          Preço teto: ações por Bazin (dividendo conservador ÷ {pct(y.acao)}) ou Graham ajustado ao juro real; FIIs pelo rendimento
          sustentável ÷ {pct(y.fii)}; ETFs por Bazin ou pela média de preço de 12 meses. Clique numa linha para ver o comentário da IA.
          {y.juroReal && (
            <> O yield exigido segue o juro real do Tesouro IPCA+ ({pct(y.juroReal.taxa, 2)}), com mínimo de 6% nas ações e 8% nos FIIs.</>
          )}
        </p>
      </div>
      {analises.length > 0 && (
        <Cartao titulo="Exportar o ranking">
          <ExportarCarteira
            rota="/ranking/exportar"
            descricao="Leva o ranking inteiro para outra IA (ou para o Claude) avaliar: preço teto, margem, qualidade, lucro e dividendos de 10 anos, porte, alertas e o comentário da IA de cada ativo."
          />
        </Cartao>
      )}
      {analises.length ? <TabelaRanking analises={analises} filtroInicial={filtro} /> : <Vazio>Ainda não há análise.</Vazio>}
    </div>
  );
}
