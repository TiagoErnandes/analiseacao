import type { Metadata } from "next";
import { dataBr, pct } from "@/lib/format";
import { yieldAtual } from "@/lib/juros";
import { query, type Analise } from "@/lib/db";
import { ultimaExecucao } from "@/lib/analise";
import { exigirUsuario } from "@/lib/auth";
import { aplicarMetodoTetoEmTodas, carteiraDe, marcarCarteira } from "@/lib/painel";
import { estrategiaAtual, metodoTetoDe } from "@/lib/estrategia";
import { infoMetodo } from "@/lib/valuation";
import { comTodaABolsa } from "@/lib/bolsa";
import { fotoAnterior, salvarFotoRanking } from "@/lib/rankingHistorico";
import { SeletorMetodoTeto } from "../SeletorMetodoTeto";
import { Cartao, Vazio } from "../ui";
import { TabelaRanking, type InicialRanking } from "./TabelaRanking";
import { ExportarCarteira } from "../carteira/ExportarCarteira";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ranking" };

export default async function Ranking({ searchParams }: { searchParams: Promise<InicialRanking> }) {
  const usuario = await exigirUsuario();
  await ultimaExecucao(); // garante as colunas novas
  const [rel] = await query<{ data: string }>("select data::text as data from relatorio_diario order by data desc limit 1");
  const meus = (await carteiraDe(usuario.id)).map((c) => c.ticker);
  const [estrategia, metodo] = await Promise.all([estrategiaAtual(usuario.id), metodoTetoDe(usuario.id)]);
  const y = await yieldAtual();
  // As analisadas do dia e todas as outras ações da bolsa (teto estimado pelo Fundamentus e pela CVM), pela mediana
  const base = rel ? await comTodaABolsa(await query<Analise>("select * from analises where data = $1", [rel.data]), rel.data, y.acao) : [];
  // Pelo método escolhido
  const analises = rel ? aplicarMetodoTetoEmTodas(marcarCarteira(base, meus), metodo, estrategia.atual === "balanceamento") : [];
  // Foto do dia (para a seta de posição e o placar): a mediana sempre, e o método escolhido quando é outro
  let anterior: Awaited<ReturnType<typeof fotoAnterior>> = null;
  if (rel) {
    await salvarFotoRanking(rel.data, "mediana", base).catch((e) => console.warn(`Ranking: foto do dia não salva (${(e as Error).message})`));
    if (metodo !== "mediana") await salvarFotoRanking(rel.data, metodo, analises).catch(() => {});
    anterior = await fotoAnterior(rel.data, metodo).catch(() => null);
  }
  const inicial = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">{rel ? `Análise de ${dataBr(rel.data)}` : "Sem análise"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ranking do dia</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Todas as ações da B3 (uma classe por empresa), ordenadas pela Nota de 0 a 100: desconto até o preço teto, constância de lucro e
          dividendo em 10 anos, ROE, crescimento do lucro e dívida, com os pesos do perfil escolhido na tabela. O filtro "Só boas empresas"
          deixa de fora quem não passa no mínimo. Clique numa linha para ver por que a Nota é aquela.
        </p>
        <details className="mt-2 max-w-3xl text-sm text-suave">
          <summary className="cursor-pointer text-marca hover:underline">Preço teto, score e fontes</summary>
          <p className="mt-2 leading-relaxed">
            Preço teto: ações pelo método escolhido abaixo (agora: {infoMetodo(metodo).nome}), com o lucro limitado à média de 5 anos da CVM;
            FIIs pelo rendimento sustentável ÷ {pct(y.fii)}; ETFs por Bazin ou pela média de preço de 12 meses.
            {y.juroReal && (
              <> O yield exigido segue o juro real do Tesouro IPCA+ ({pct(y.juroReal.taxa, 2)}), com mínimo de 6% nos ETFs e 8% nos FIIs (nas ações o Bazin pede 10%).</>
            )}
          </p>
          <p className="mt-2 leading-relaxed">
            As ações fora da análise diária aparecem com a etiqueta B3: o teto delas é estimado com os números do Fundamentus (cotação de fechamento,
            P/L, P/VP e dividend yield) e os balanços da CVM (lucro e dividendo médios de 5 anos, setor), sem a nota de qualidade e a IA. O Score
            das analisadas (35% qualidade, 25% IA, 40% desconto) continua no painel; aqui ele entra na Nota pela qualidade e pela nota da IA.
          </p>
        </details>
      </div>
      <SeletorMetodoTeto metodo={metodo} />
      {analises.length > 0 && (
        <Cartao titulo="Exportar o ranking">
          <ExportarCarteira
            rota="/ranking/exportar"
            descricao="Leva o ranking das analisadas para outra IA (ou para o Claude) avaliar: preço teto, margem, Nota, qualidade, lucro e dividendos de 10 anos, porte, alertas e o comentário da IA de cada ativo."
          />
        </Cartao>
      )}
      {analises.length ? (
        <TabelaRanking analises={analises} inicial={inicial} metodoNome={infoMetodo(metodo).nome} anterior={anterior} />
      ) : (
        <Vazio>Ainda não há análise.</Vazio>
      )}
    </div>
  );
}
