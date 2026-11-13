import type { Metadata } from "next";
import { dataBr, pct } from "@/lib/format";
import { yieldAtual } from "@/lib/juros";
import { query, type Analise, type Relatorio } from "@/lib/db";
import { ultimaExecucao } from "@/lib/analise";
import { exigirUsuario } from "@/lib/auth";
import { aplicarMetodoTetoEmTodas, carteiraDe, marcarCarteira } from "@/lib/painel";
import { estrategiaAtual, metodoTetoDe } from "@/lib/estrategia";
import { infoMetodo } from "@/lib/valuation";
import { comTodaABolsa } from "@/lib/bolsa";
import { SeletorMetodoTeto } from "../SeletorMetodoTeto";
import { Cartao, Vazio } from "../ui";
import { TabelaRanking } from "./TabelaRanking";
import { ExportarCarteira } from "../carteira/ExportarCarteira";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ranking" };

export default async function Ranking({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const usuario = await exigirUsuario();
  await ultimaExecucao(); // garante as colunas novas
  const [rel] = await query<Pick<Relatorio, "data">>("select data from relatorio_diario order by data desc limit 1");
  const meus = (await carteiraDe(usuario.id)).map((c) => c.ticker);
  const [estrategia, metodo] = await Promise.all([estrategiaAtual(usuario.id), metodoTetoDe(usuario.id)]);
  const y = await yieldAtual();
  // As analisadas do dia e todas as outras ações da bolsa (teto estimado pelo Fundamentus), pelo método escolhido
  const analises = rel
    ? aplicarMetodoTetoEmTodas(
        marcarCarteira(await comTodaABolsa(await query<Analise>("select * from analises where data = $1", [rel.data]), rel.data, y.acao), meus),
        metodo,
        estrategia.atual === "balanceamento",
      )
    : [];
  const { filtro } = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">{rel ? `Análise de ${dataBr(rel.data)}` : "Sem análise"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ranking do dia</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Todas as ações da B3, ordenadas pela Nota: 50% margem até o preço teto do método escolhido abaixo, 30% anos com lucro e
          20% anos com dividendo nos últimos 10 anos (balanços da CVM). O filtro "Só boas empresas" (ligado) deixa de fora quem
          não lucrou em 7 de 10 anos, não pagou dividendo em 5 de 10, tem ROE abaixo de 10%, dívida alta, pouco porte ou pouca
          liquidez. Clique numa coluna para mudar a ordem. As ações fora da análise diária aparecem com a etiqueta B3: o teto delas é estimado com os números do
          Fundamentus (cotação de fechamento, P/L, P/VP e dividend yield), sem histórico de dividendos, balanço e IA.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Score das analisadas de 0 a 100: 35% qualidade do balanço, 25% nota da IA e 40% desconto em relação ao preço teto (30% desconto e 10% peso
          faltando na carteira, na estratégia Balanceamento). Desconto acima de 40% não soma mais: costuma ser armadilha. Foco em ações: FIIs entram com 85% do score, e ativos com alerta grave com 75%.
          Preço teto: ações pelo método escolhido abaixo (agora: {infoMetodo(metodo).nome}); FIIs pelo rendimento
          sustentável ÷ {pct(y.fii)}; ETFs por Bazin ou pela média de preço de 12 meses. Clique numa linha para ver o comentário da IA.
          {y.juroReal && (
            <> O yield exigido segue o juro real do Tesouro IPCA+ ({pct(y.juroReal.taxa, 2)}), com mínimo de 6% nos ETFs e 8% nos FIIs (nas ações o Bazin pede 10%).</>
          )}
        </p>
      </div>
      <SeletorMetodoTeto metodo={metodo} />
      {analises.length > 0 && (
        <Cartao titulo="Exportar o ranking">
          <ExportarCarteira
            rota="/ranking/exportar"
            descricao="Leva o ranking inteiro para outra IA (ou para o Claude) avaliar: preço teto, margem, qualidade, lucro e dividendos de 10 anos, porte, alertas e o comentário da IA de cada ativo."
          />
        </Cartao>
      )}
      {analises.length ? <TabelaRanking analises={analises} filtroInicial={filtro} metodoNome={infoMetodo(metodo).nome} /> : <Vazio>Ainda não há análise.</Vazio>}
    </div>
  );
}
