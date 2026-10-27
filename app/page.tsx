import Link from "next/link";
import { brl, dataBr, pct } from "@/lib/format";
import { carregarPainel, LIMITE_SETOR } from "@/lib/painel";
import type { Analise } from "@/lib/db";
import { BotaoAnalise } from "./BotaoAnalise";
import { Logo } from "./Logo";
import { TipoAtivo } from "./TipoAtivo";
import { Rosca } from "./Rosca";
import { GraficoEvolucao } from "./GraficoEvolucao";
import { BotaoLancamento, type PosicaoLancamento } from "./Lancamento";
import { MeusAtivos } from "./MeusAtivos";
import { SimuladorAporte, type ItemAporte } from "./SimuladorAporte";
import { Alertas, Cartao, Kpi, Nota, ReguaTeto, Score, Sinal, Variacao, Vazio } from "./ui";

export const dynamic = "force-dynamic";

function AcaoDoDia({ titulo, a, justificativa }: { titulo: string; a?: Analise; justificativa: string | null }) {
  return (
    <div className="cartao relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-marca/10 blur-3xl" />
      <p className="rotulo !text-marca">{titulo}</p>
      {a ? (
        <>
          <Link href={`/acao/${a.ticker}`} className="group mt-3 flex items-center gap-3">
            <Logo ticker={a.ticker} src={a.logo} tamanho={40} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold group-hover:text-marca">{a.ticker}</span>
                <TipoAtivo tipo={a.tipo} />
                <Sinal r={a.recomendacao} />
              </div>
              <p className="truncate text-xs text-suave">{a.nome}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-lg font-semibold tabular-nums">{brl(a.preco)}</p>
              <p className="text-xs"><Variacao v={a.variacao_dia} casas={2} seta /></p>
            </div>
          </Link>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            {[
              ["Margem", <Variacao key="m" v={a.margem} />],
              ["DY 12m", <span key="d" className="tabular-nums">{pct(a.dy_12m)}</span>],
              ["Qualidade", <Nota key="q" v={a.qualidade} />],
              ["Nota IA", <Nota key="n" v={a.nota_ia} />],
            ].map(([r, v]) => (
              <div key={r as string} className="rounded-lg bg-painel2 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-fraco">{r}</p>
                <div className="mt-1 text-sm font-medium">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-4"><ReguaTeto preco={a.preco} teto={a.preco_teto} /></div>
        </>
      ) : (
        <p className="mt-3 text-suave">—</p>
      )}
      {justificativa && <p className="mt-4 text-sm leading-relaxed text-suave">{justificativa}</p>}
    </div>
  );
}

export default async function Painel() {
  const { exec, rel, analises, porTicker, posicoes, evolucao, resumo, setores, classes } = await carregarPainel();
  const botao = <BotaoAnalise status={exec?.status ?? null} inicio={exec?.inicio ?? null} erro={exec?.erro ?? null} />;

  if (!rel) {
    return (
      <Vazio>
        <p className="mb-4">Ainda não há análise. Ela roda sozinha às 7h em dias úteis, ou clique para rodar agora.</p>
        <div className="flex justify-center">{botao}</div>
      </Vazio>
    );
  }

  const pesoIdeal = posicoes.length ? 1 / posicoes.length : 0;
  const paraLancamento: PosicaoLancamento[] = posicoes.map((p) => ({
    ticker: p.ticker,
    tipo: p.a?.tipo ?? p.tipo,
    quantidade: p.quantidade,
    preco_medio: p.preco_medio,
    preco: p.a?.preco ?? null,
  }));
  const pesoSetor = Object.fromEntries(setores.map((s) => [s.nome, s.peso]));
  const itensAporte: ItemAporte[] = posicoes.map((p) => ({
    ticker: p.ticker,
    logo: p.a?.logo ?? null,
    preco: p.a?.preco != null ? p.a.preco * p.cambio : null, // em reais
    valor: p.valor,
    margem: p.a?.margem ?? null,
    recomendacao: p.a?.recomendacao ?? null,
    score: p.a?.score ?? null,
    setor: p.a?.setor ?? null,
  }));
  const novasAporte: ItemAporte[] = analises
    .filter((a) => !a.na_carteira && a.recomendacao === "COMPRAR" && (a.margem ?? -1) > 0 && (a.qualidade ?? 0) >= 6 && a.preco)
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
    .slice(0, 3)
    .map((a) => ({
      ticker: a.ticker,
      logo: a.logo,
      preco: a.preco! * (a.cambio ?? 1),
      valor: 0,
      margem: a.margem,
      recomendacao: a.recomendacao,
      score: a.score,
      setor: a.setor,
      nova: true,
    }));
  const oportunidades = analises
    .filter((a) => !a.na_carteira && a.recomendacao === "COMPRAR" && (a.margem ?? -1) > 0)
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="rotulo">Análise de {dataBr(rel.data)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Painel da carteira</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/carteira#b3" className="botao">Integração B3</Link>
          <BotaoLancamento posicoes={paraLancamento} />
          {botao}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Patrimônio total"
          valor={brl(resumo.patrimonio)}
          detalhe={
            <div className="space-y-0.5">
              <p>Hoje <Variacao v={resumo.variacaoDia} casas={2} seta /></p>
              <p>Valor investido <b className="text-texto">{brl(resumo.investido)}</b></p>
            </div>
          }
        />
        <Kpi
          rotulo="Lucro total"
          valor={<span className={resumo.lucroTotal >= 0 ? "text-alta" : "text-baixa"}>{brl(resumo.lucroTotal)}</span>}
          detalhe={
            <div className="space-y-0.5">
              <p>Ganho de capital <b className={resumo.lucro >= 0 ? "text-alta" : "text-baixa"}>{brl(resumo.lucro)}</b></p>
              <p>Dividendos recebidos <b className="text-alta">{brl(resumo.proventosTotal)}</b></p>
            </div>
          }
          dica="Ganho de capital (cotação hoje menos preço médio) mais os proventos recebidos desde a compra"
        />
        <Kpi
          rotulo="Proventos recebidos (12M)"
          valor={brl(resumo.proventos12m)}
          detalhe={
            <div className="space-y-0.5">
              <p>Total <b className="text-texto">{brl(resumo.proventosTotal)}</b></p>
              <p>Renda prevista ≈ {brl(resumo.renda12m / 12)}/mês · DY {pct(resumo.dy)}</p>
            </div>
          }
          dica="Dividendos, JCP e rendimentos pagos enquanto você tinha o ativo (estimado pela data de compra e pelo histórico do Yahoo)"
        />
        <Kpi
          rotulo="Rentabilidade (12M)"
          valor={<Variacao v={resumo.rentabilidade12m.valor} casas={2} />}
          detalhe={
            <div className="space-y-0.5">
              {resumo.rentabilidade12m.desde && <p>desde {dataBr(resumo.rentabilidade12m.desde)}</p>}
              <p>Rentabilidade total <Variacao v={resumo.rentabilidadeTotal} casas={2} /></p>
            </div>
          }
          dica="Inclui ganho de capital e proventos recebidos"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Cartao titulo="Evolução do patrimônio" className="lg:col-span-3">
          <GraficoEvolucao fotos={evolucao} />
        </Cartao>
        <Cartao titulo="Ativos na carteira" className="lg:col-span-2">
          <div className="p-4">
            <Rosca fatias={classes} centro="tipos" />
          </div>
        </Cartao>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <AcaoDoDia titulo="Melhor compra na sua carteira" a={porTicker.get(rel.acao_do_dia_carteira ?? "")} justificativa={rel.justificativa_carteira} />
        <AcaoDoDia titulo="Melhor compra entre todos os ativos" a={porTicker.get(rel.acao_do_dia_geral ?? "")} justificativa={rel.justificativa_geral} />
      </section>

      {(rel.contexto_mercado || rel.revisao) && (
        <Cartao titulo="Cenário do dia">
          <div className="space-y-3 p-4 text-sm leading-relaxed">
            {rel.contexto_mercado && <p className="text-suave">{rel.contexto_mercado}</p>}
            {rel.revisao && (
              <p className="rounded-lg border border-borda bg-painel2 p-3 text-xs text-suave">
                <span className="font-semibold text-texto">✓ Revisão da IA: </span>
                {rel.revisao}
              </p>
            )}
          </div>
        </Cartao>
      )}

      <section className="grid gap-4 lg:grid-cols-5">
        <Cartao titulo="Simulador de aporte" className="lg:col-span-3">
          <SimuladorAporte itens={itensAporte} novas={novasAporte} pesoSetor={pesoSetor} limiteSetor={LIMITE_SETOR} />
        </Cartao>
        <Cartao titulo="Alocação por setor" className="lg:col-span-2">
          <div className="p-4">
            <Rosca fatias={setores} centro="setores" limite={LIMITE_SETOR} />
            <p className="mt-4 text-xs text-fraco">Para previdência, o ideal é nenhum setor passar de {pct(LIMITE_SETOR, 0)} da carteira.</p>
          </div>
        </Cartao>
      </section>

      <MeusAtivos posicoes={posicoes} patrimonio={resumo.patrimonio} pesoIdeal={pesoIdeal} paraLancamento={paraLancamento} />

      {oportunidades.length > 0 && (
        <Cartao
          titulo="Oportunidades fora da carteira"
          acao={<Link href="/ranking" className="text-xs text-marca hover:underline">Ver ranking completo</Link>}
        >
          <ul className="divide-y divide-borda">
            {oportunidades.map((a) => (
              <li key={a.ticker}>
                <Link href={`/acao/${a.ticker}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-painel2/60 sm:grid-cols-[auto_1fr_auto_auto_auto]">
                  <Logo ticker={a.ticker} src={a.logo} />
                  <div className="min-w-0">
                    <p className="font-medium">{a.ticker} <span className="ml-1 text-xs font-normal text-fraco">{a.setor}</span></p>
                    <p className="truncate text-xs text-suave">{a.resumo_ia}</p>
                  </div>
                  <span className="hidden text-right text-xs sm:block">Margem <Variacao v={a.margem} /></span>
                  <span className="hidden sm:block"><Nota v={a.qualidade} rotulo="Qualidade" /></span>
                  <Score v={a.score} />
                </Link>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {posicoes.some((p) => p.a?.alertas) && (
        <Cartao titulo="Pontos de atenção na carteira">
          <ul className="divide-y divide-borda">
            {posicoes.filter((p) => p.a?.alertas).map((p) => (
              <li key={p.ticker} className="flex gap-3 px-4 py-3">
                <span className="w-16 shrink-0 text-sm font-medium">{p.ticker}</span>
                <Alertas txt={p.a!.alertas} />
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
