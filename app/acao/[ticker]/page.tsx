import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brl, dataBr, dinheiro, num, pct } from "@/lib/format";
import { carregarPainel, historicoDe } from "@/lib/painel";
import { query, type Analise } from "@/lib/db";
import { Logo } from "../../Logo";
import { TipoAtivo } from "../../TipoAtivo";
import type { DadosFii, Fundamentos, HistoricoPreco } from "@/lib/mercado";
import type { Documento, HistoricoLucro, ProventoAnunciado } from "@/lib/cvm";
import { yieldAtual } from "@/lib/juros";
import type { ConsistenciaDividendos } from "@/lib/valuation";
import { Constancia } from "./Constancia";
import { Alertas, Cartao, Nota, ReguaTeto, Score, Sinal, Variacao } from "../../ui";
import { GraficoHistorico } from "./GraficoHistorico";
import { GraficoCotacao } from "./GraficoCotacao";
import { Dica } from "../../ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: (await params).ticker.toUpperCase() };
}

function Indicador({ rotulo, valor, dica }: { rotulo: string; valor: React.ReactNode; dica?: string }) {
  return (
    <div className="rounded-lg bg-painel2 p-3 transition hover:bg-painel2/70 hover:ring-1 hover:ring-borda">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-fraco">
        {rotulo}
        {dica && <Dica texto={dica} />}
      </p>
      <div className="mt-1 text-base font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

export default async function AcaoPage({ params }: Params) {
  const ticker = (await params).ticker.toUpperCase();
  const { rel, porTicker, posicoes } = await carregarPainel();
  let a: Analise | undefined = porTicker.get(ticker);
  if (!a) {
    [a] = await query<Analise>("select * from analises where ticker = $1 order by data desc limit 1", [ticker]);
  }
  if (!a) notFound();

  const [historico, exigido] = await Promise.all([historicoDe(ticker), yieldAtual()]);
  const yAcao = pct(exigido.acao, 1);
  const yFii = pct(exigido.fii, 1);
  const textoJuro = exigido.juroReal
    ? `O yield exigido acompanha o juro real do Tesouro IPCA+ (${pct(exigido.juroReal.taxa, 2)} em ${dataBr(exigido.juroReal.data)}): se o título público sem risco paga mais, o dividendo da ação também precisa pagar.`
    : "Sem o juro real do Tesouro na última análise: valem os mínimos clássicos.";
  const pos = posicoes.find((p) => p.ticker === ticker);
  const pl = a.preco && a.lpa && a.lpa > 0 ? a.preco / a.lpa : null;
  const pvp = a.preco && a.vpa && a.vpa > 0 ? a.preco / a.vpa : null;
  const payout = a.dpa_12m && a.lpa && a.lpa > 0 ? a.dpa_12m / a.lpa : null;
  const tipo = a.tipo ?? "acao";
  const metodo =
    a.preco_teto == null
      ? null
      : a.teto_bazin != null && a.preco_teto === a.teto_bazin
        ? tipo === "fii" ? `Rendimento sustentável ÷ ${yFii}` : "Bazin"
        : tipo === "etf" ? "Média de preço de 12 meses" : "Graham";
  const fii = tipo === "fii" ? (a.indicadores as DadosFii | null) : null;
  const etf = tipo === "etf" ? (a.indicadores as HistoricoPreco | null) : null;
  const fund = tipo === "acao" ? (a.indicadores as Fundamentos | null) : null;
  const extras = (a.indicadores ?? {}) as {
    lucros10a?: HistoricoLucro | null;
    dividendos10a?: ConsistenciaDividendos | null;
    documentosCvm?: Documento[];
    proventosAnunciados?: ProventoAnunciado[];
  };
  const ehDoDia = rel && (rel.acao_do_dia_carteira === ticker || rel.acao_do_dia_geral === ticker);
  const moeda = a.moeda ?? "BRL";
  const temConstancia = tipo === "acao" || tipo === "fii";
  const secoes = [
    { id: "grafico", rotulo: "Gráfico" },
    { id: "valuation", rotulo: "Preço teto e IA" },
    { id: "indicadores", rotulo: "Indicadores" },
    ...(temConstancia ? [{ id: "dividendos", rotulo: tipo === "fii" ? "Rendimentos" : "Lucros e dividendos" }] : []),
    ...(pos ? [{ id: "posicao", rotulo: "Minha posição" }] : []),
    { id: "historico", rotulo: "Histórico" },
  ];

  return (
    <div className="space-y-5">
      <nav aria-label="Caminho" className="flex items-center gap-1.5 text-xs text-suave">
        <Link href="/" className="hover:text-texto">Painel</Link>
        <span className="text-fraco">/</span>
        <Link href="/ranking" className="hover:text-texto">Ranking</Link>
        <span className="text-fraco">/</span>
        <span className="text-texto">{a.ticker}</span>
      </nav>

      <section className="cartao flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Logo ticker={a.ticker} src={a.logo} tamanho={56} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{a.ticker}</h1>
              <TipoAtivo tipo={tipo} />
              <Sinal r={a.recomendacao} />
              {a.na_carteira && <span className="rounded bg-[#3987e5]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#6da7ec]">NA CARTEIRA</span>}
              {ehDoDia && <span className="rounded bg-marca/15 px-1.5 py-0.5 text-[10px] font-semibold text-marca">AÇÃO DO DIA</span>}
            </div>
            <p className="text-sm text-suave">{a.nome}</p>
            <p className="text-xs text-fraco">{a.setor} · análise de {dataBr(a.data)}</p>
          </div>
        </div>
        <div className="flex items-end gap-6">
          <div>
            <p className="rotulo">Cotação</p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{dinheiro(a.preco, moeda)}</p>
            <p className="text-sm"><Variacao v={a.variacao_dia} casas={2} seta /> <span className="text-xs text-fraco">no dia</span></p>
          </div>
          <div>
            <p className="rotulo mb-2">Score</p>
            <Score v={a.score} />
          </div>
        </div>
      </section>

      <nav
        aria-label="Seções"
        className="sticky top-[97px] z-10 flex gap-1 overflow-x-auto rounded-xl border border-borda bg-fundo/90 p-1 text-sm backdrop-blur md:top-[57px]"
      >
        {secoes.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="whitespace-nowrap rounded-md px-3 py-1.5 text-suave transition hover:bg-painel2 hover:text-texto">
            {s.rotulo}
          </a>
        ))}
      </nav>

      <Cartao titulo={`Cotação de ${a.ticker}`} id="grafico">
        <GraficoCotacao ticker={a.ticker} tipo={tipo} moeda={moeda} teto={a.preco_teto} precoMedio={pos?.preco_medio ?? null} />
      </Cartao>

      <section id="valuation" className="grid scroll-mt-32 gap-4 lg:grid-cols-3">
        <Cartao titulo="Preço teto" className="lg:col-span-1">
          <div className="space-y-4 p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-semibold tabular-nums">{dinheiro(a.preco_teto, moeda)}</p>
                <p className="text-xs text-suave">{metodo ?? "Sem dados suficientes"}</p>
              </div>
              <div className="text-right">
                <p className="rotulo">Margem</p>
                <p className="text-xl font-semibold"><Variacao v={a.margem} /></p>
              </div>
            </div>
            <ReguaTeto preco={a.preco} teto={a.preco_teto} />
            {tipo === "acao" ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className={`rounded-lg border p-3 ${metodo === "Bazin" ? "border-marca/40" : "border-borda"}`}>
                  <p className="text-xs text-suave">Bazin</p>
                  <p className="font-semibold tabular-nums">{brl(a.teto_bazin)}</p>
                  <p className="mt-1 text-[11px] leading-snug text-fraco">Dividendo conservador ÷ {yAcao}</p>
                </div>
                <div className={`rounded-lg border p-3 ${metodo === "Graham" ? "border-marca/40" : "border-borda"}`}>
                  <p className="text-xs text-suave">Graham</p>
                  <p className="font-semibold tabular-nums">{brl(a.teto_graham)}</p>
                  <p className="mt-1 text-[11px] leading-snug text-fraco">√(22,5 × LPA × VPA)</p>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-borda p-3 text-xs leading-relaxed text-suave">
                {tipo === "fii"
                  ? `Para FIIs: o menor entre o rendimento de 12 meses, o FFO por cota e a média de 5 anos, dividido por ${yFii} (o rendimento mínimo que compensa frente ao Tesouro IPCA+).`
                  : `Para ETFs: se paga dividendos relevantes, Bazin (÷ ${yAcao}); senão, a média de preço dos últimos 12 meses. Abaixo dela, você compra mais barato que a média do ano.`}
              </p>
            )}
            {(tipo === "acao" || tipo === "fii" || tipo === "etf") && <p className="text-[11px] leading-snug text-fraco">{textoJuro}</p>}
          </div>
        </Cartao>

        <Cartao titulo="Análise da IA" className="lg:col-span-2">
          <div className="space-y-4 p-4">
            <div className="flex gap-6">
              <div><p className="rotulo mb-1">Nota IA</p><Nota v={a.nota_ia} /></div>
              <div><p className="rotulo mb-1">Qualidade</p><Nota v={a.qualidade} /></div>
              <div><p className="rotulo mb-1">Sinal</p><Sinal r={a.recomendacao} /></div>
            </div>
            <p className="text-sm leading-relaxed">{a.resumo_ia ?? "Sem comentário da IA nesta análise."}</p>
            {a.riscos_ia && (
              <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200/90">
                <b>Principal risco:</b> {a.riscos_ia}
              </p>
            )}
            <Alertas txt={a.alertas} />
          </div>
        </Cartao>
      </section>

      <Cartao titulo="Indicadores" id="indicadores">
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {tipo === "fii" ? (
            <>
              <Indicador rotulo="Segmento" valor={<span className="text-sm">{fii?.segmento ?? "—"}</span>} />
              <Indicador rotulo="Gestão" valor={<span className="text-sm">{fii?.gestao ?? "—"}</span>} />
              <Indicador rotulo="DY 12m" valor={pct(a.dy_12m)} />
              <Indicador rotulo="Rendimento 12m" valor={brl(a.dpa_12m)} dica="Por cota, últimos 12 meses" />
              <Indicador rotulo="P/VP" valor={num(pvp)} dica="Preço sobre o valor patrimonial da cota" />
              <Indicador rotulo="VP por cota" valor={brl(a.vpa)} />
              <Indicador rotulo="FFO por cota" valor={brl(fii?.ffoCota)} dica="Quanto o fundo gera de caixa por cota em 12 meses" />
              <Indicador rotulo="FFO yield" valor={pct(fii?.ffoYield)} />
              <Indicador rotulo="Vacância" valor={pct(fii?.vacancia)} />
              <Indicador rotulo="Imóveis" valor={fii?.qtdImoveis ?? "—"} />
              <Indicador rotulo="Cap rate" valor={pct(fii?.capRate)} />
              <Indicador rotulo="Liquidez/dia" valor={brl(fii?.volumeMedio)} />
            </>
          ) : tipo === "etf" ? (
            <>
              <Indicador rotulo="Média 12m" valor={brl(etf?.media12m)} />
              <Indicador rotulo="Retorno anual" valor={<Variacao v={etf?.retornoAnual5a} />} dica={`Retorno de preço por ano em ${etf?.anos ?? "?"} anos`} />
              <Indicador rotulo="Maior queda" valor={pct(etf?.quedaMaxima5a ? -etf.quedaMaxima5a : null)} dica="Maior queda do topo ao fundo em até 5 anos" />
              <Indicador rotulo="Volume/mês" valor={brl(etf?.volumeMensalMedio)} />
              <Indicador rotulo="DY 12m" valor={pct(a.dy_12m)} />
              <Indicador rotulo="Dividendos 12m" valor={brl(a.dpa_12m)} />
            </>
          ) : (
            <>
              <Indicador rotulo="DY 12m" valor={pct(a.dy_12m)} dica="Dividendos e JCP dos últimos 12 meses sobre o preço" />
              <Indicador rotulo="DPA 12m" valor={brl(a.dpa_12m)} />
              <Indicador rotulo="DPA médio 5a" valor={brl(a.dpa_medio)} />
              <Indicador rotulo="Payout" valor={pct(payout, 0)} dica="Parte do lucro paga em dividendos" />
              <Indicador rotulo="P/L" valor={num(pl)} />
              <Indicador rotulo="P/VP" valor={num(pvp)} />
              <Indicador rotulo="ROE" valor={pct(a.roe)} />
              <Indicador rotulo="Margem líquida" valor={pct(fund?.margemLiquida)} />
              <Indicador rotulo="Dív. líq./PL" valor={num(fund?.divLiqPatrim)} />
              <Indicador rotulo="Cresc. receita 5a" valor={pct(fund?.crescReceita5a)} dica="Crescimento anual da receita em 5 anos" />
              <Indicador rotulo="LPA" valor={brl(a.lpa)} />
              <Indicador rotulo="VPA" valor={brl(a.vpa)} />
            </>
          )}
          <Indicador rotulo="Qualidade" valor={<Nota v={a.qualidade} />} />
          <Indicador rotulo="Nota IA" valor={<Nota v={a.nota_ia} />} />
          <Indicador rotulo="Score" valor={a.score ?? "—"} />
        </div>
      </Cartao>

      {temConstancia && (
        <div id="dividendos" className="scroll-mt-32">
        <Constancia
          lucros={extras.lucros10a ?? null}
          dividendos={extras.dividendos10a ?? null}
          documentos={extras.documentosCvm ?? []}
          proventos={extras.proventosAnunciados ?? []}
          ehAcao={tipo === "acao"}
        />
        </div>
      )}

      {pos && (
        <Cartao titulo="Minha posição" id="posicao" acao={<Link href="/carteira" className="text-xs text-marca hover:underline">Editar</Link>}>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Quantidade" valor={pos.quantidade} />
            <Indicador rotulo="Preço médio" valor={dinheiro(pos.preco_medio, moeda)} />
            <Indicador rotulo="Posição" valor={brl(pos.valor)} />
            <Indicador rotulo="Rentabilidade" valor={<Variacao v={pos.rentabilidade} />} />
            <Indicador rotulo="Peso na carteira" valor={pct(pos.peso)} />
            <Indicador rotulo="Renda 12m" valor={brl(pos.renda12m)} dica="Dividendos dos últimos 12 meses × sua quantidade" />
          </div>
        </Cartao>
      )}

      <Cartao titulo="Histórico das análises: cotação × preço teto" id="historico">
        <GraficoHistorico pontos={[...historico].reverse()} />
      </Cartao>

      {historico.length > 0 && (
        <Cartao titulo="Histórico das análises">
          <div className="max-h-96 overflow-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th className="!text-right">Cotação</th>
                  <th className="!text-right">Preço teto</th>
                  <th className="!text-right">Margem</th>
                  <th className="!text-center">Nota IA</th>
                  <th className="!text-right">Score</th>
                  <th>Sinal</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.data}>
                    <td>{dataBr(h.data)}</td>
                    <td className="text-right">{brl(h.preco)}</td>
                    <td className="text-right">{brl(h.preco_teto)}</td>
                    <td className="text-right"><Variacao v={h.margem} /></td>
                    <td className="text-center"><Nota v={h.nota_ia} /></td>
                    <td className="text-right">{h.score ?? "—"}</td>
                    <td><Sinal r={h.recomendacao} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}
    </div>
  );
}
