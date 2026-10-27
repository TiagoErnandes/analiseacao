import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brl, dataBr, num, pct } from "@/lib/format";
import { carregarPainel, historicoDe } from "@/lib/painel";
import { query, type Analise } from "@/lib/db";
import { Logo } from "../../Logo";
import { Alertas, Cartao, Nota, ReguaTeto, Score, Sinal, Variacao } from "../../ui";
import { GraficoHistorico } from "./GraficoHistorico";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: (await params).ticker.toUpperCase() };
}

function Indicador({ rotulo, valor, dica }: { rotulo: string; valor: React.ReactNode; dica?: string }) {
  return (
    <div className="rounded-lg bg-painel2 p-3" title={dica}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-fraco">{rotulo}</p>
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

  const historico = await historicoDe(ticker);
  const pos = posicoes.find((p) => p.ticker === ticker);
  const pl = a.preco && a.lpa && a.lpa > 0 ? a.preco / a.lpa : null;
  const pvp = a.preco && a.vpa && a.vpa > 0 ? a.preco / a.vpa : null;
  const payout = a.dpa_12m && a.lpa && a.lpa > 0 ? a.dpa_12m / a.lpa : null;
  const metodo = a.teto_bazin != null && a.preco_teto === a.teto_bazin ? "Bazin" : a.preco_teto != null ? "Graham" : null;
  const ehDoDia = rel && (rel.acao_do_dia_carteira === ticker || rel.acao_do_dia_geral === ticker);

  return (
    <div className="space-y-5">
      <Link href="/ranking" className="text-xs text-suave hover:text-texto">← Ranking</Link>

      <section className="cartao flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Logo ticker={a.ticker} src={a.logo} tamanho={56} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{a.ticker}</h1>
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
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{brl(a.preco)}</p>
            <p className="text-sm"><Variacao v={a.variacao_dia} casas={2} seta /> <span className="text-xs text-fraco">no dia</span></p>
          </div>
          <div>
            <p className="rotulo mb-2">Score</p>
            <Score v={a.score} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Cartao titulo="Preço teto" className="lg:col-span-1">
          <div className="space-y-4 p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-semibold tabular-nums">{brl(a.preco_teto)}</p>
                <p className="text-xs text-suave">{metodo ? `Método ${metodo}` : "Sem dados suficientes"}</p>
              </div>
              <div className="text-right">
                <p className="rotulo">Margem</p>
                <p className="text-xl font-semibold"><Variacao v={a.margem} /></p>
              </div>
            </div>
            <ReguaTeto preco={a.preco} teto={a.preco_teto} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className={`rounded-lg border p-3 ${metodo === "Bazin" ? "border-marca/40" : "border-borda"}`}>
                <p className="text-xs text-suave">Bazin</p>
                <p className="font-semibold tabular-nums">{brl(a.teto_bazin)}</p>
                <p className="mt-1 text-[11px] leading-snug text-fraco">Dividendo conservador ÷ 6%</p>
              </div>
              <div className={`rounded-lg border p-3 ${metodo === "Graham" ? "border-marca/40" : "border-borda"}`}>
                <p className="text-xs text-suave">Graham</p>
                <p className="font-semibold tabular-nums">{brl(a.teto_graham)}</p>
                <p className="mt-1 text-[11px] leading-snug text-fraco">√(22,5 × LPA × VPA)</p>
              </div>
            </div>
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

      <Cartao titulo="Indicadores">
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Indicador rotulo="DY 12m" valor={pct(a.dy_12m)} dica="Dividendos e JCP dos últimos 12 meses sobre o preço" />
          <Indicador rotulo="DPA 12m" valor={brl(a.dpa_12m)} />
          <Indicador rotulo="DPA médio 5a" valor={brl(a.dpa_medio)} />
          <Indicador rotulo="Payout" valor={pct(payout, 0)} dica="Parte do lucro paga em dividendos" />
          <Indicador rotulo="P/L" valor={num(pl)} />
          <Indicador rotulo="P/VP" valor={num(pvp)} />
          <Indicador rotulo="ROE" valor={pct(a.roe)} />
          <Indicador rotulo="LPA" valor={brl(a.lpa)} />
          <Indicador rotulo="VPA" valor={brl(a.vpa)} />
          <Indicador rotulo="Qualidade" valor={<Nota v={a.qualidade} />} />
          <Indicador rotulo="Nota IA" valor={<Nota v={a.nota_ia} />} />
          <Indicador rotulo="Score" valor={a.score ?? "—"} />
        </div>
      </Cartao>

      {pos && (
        <Cartao titulo="Minha posição" acao={<Link href="/carteira" className="text-xs text-marca hover:underline">Editar</Link>}>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Quantidade" valor={pos.quantidade} />
            <Indicador rotulo="Preço médio" valor={brl(pos.preco_medio)} />
            <Indicador rotulo="Posição" valor={brl(pos.valor)} />
            <Indicador rotulo="Rentabilidade" valor={<Variacao v={pos.rentabilidade} />} />
            <Indicador rotulo="Peso na carteira" valor={pct(pos.peso)} />
            <Indicador rotulo="Renda 12m" valor={brl(pos.renda12m)} dica="Dividendos dos últimos 12 meses × sua quantidade" />
          </div>
        </Cartao>
      )}

      <Cartao titulo="Cotação × preço teto">
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
