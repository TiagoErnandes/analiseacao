// "Meus ativos": a carteira separada por tipo, com totais de cada grupo (no estilo dos apps de carteira).
import Link from "next/link";
import { brl, pct } from "@/lib/format";
import type { Posicao } from "@/lib/painel";
import { TIPOS } from "@/lib/tipos";
import { Logo } from "./Logo";
import { Nota, Variacao } from "./ui";

const dinheiro = (v: number | null | undefined, moeda: "BRL" | "USD") =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda });

function Comprar({ p }: { p: Posicao }) {
  const sim = p.a?.recomendacao === "COMPRAR" && (p.a?.margem ?? -1) > 0;
  const titulo = p.a?.recomendacao ? `Sinal da IA: ${p.a.recomendacao.toLowerCase()}; margem ${pct(p.a.margem)}` : "Sem análise ainda";
  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${sim ? "bg-alta/10 text-alta ring-alta/30" : "bg-painel2 text-suave ring-borda"}`}
    >
      {sim ? "✓ Sim" : "✕ Não"}
    </span>
  );
}

export function MeusAtivos({
  posicoes,
  patrimonio,
  pesoIdeal,
}: {
  posicoes: Posicao[];
  patrimonio: number;
  pesoIdeal: number;
}) {
  const grupos = TIPOS.map((t) => ({
    t,
    itens: posicoes
      .filter((p) => (p.a?.tipo ?? p.tipo ?? "acao") === t.id)
      .sort((x, y) => y.valor - x.valor),
  })).filter((g) => g.itens.length > 0);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        Meus ativos <span className="font-normal text-fraco">({posicoes.length})</span>
      </h2>
      {grupos.map(({ t, itens }) => {
        const valor = itens.reduce((s, p) => s + p.valor, 0);
        const investido = itens.reduce((s, p) => s + p.investido, 0);
        const comVar = itens.filter((p) => p.a?.variacao_dia != null);
        const pesoVar = comVar.reduce((s, p) => s + p.valor, 0);
        const variacao = pesoVar > 0 ? comVar.reduce((s, p) => s + p.a!.variacao_dia! * p.valor, 0) / pesoVar : null;
        // DY do grupo ponderado pelo valor de cada posição (renda de 12 meses ÷ valor de hoje)
        const renda = itens.reduce((s, p) => s + (p.renda12m ?? 0), 0);
        const dyGrupo = valor > 0 && renda > 0 ? renda / valor : null;
        return (
          <details key={t.id} open className="cartao group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
              <span className="flex min-w-36 items-center gap-2 text-base font-semibold">
                <span className="text-fraco transition group-open:rotate-90">›</span>
                {t.nome}
              </span>
              <span className="ml-auto grid grid-cols-3 gap-x-8 gap-y-2 text-right text-xs sm:grid-cols-6">
                <span><span className="block text-fraco">Ativos</span><b className="text-sm">{itens.length}</b></span>
                <span><span className="block text-fraco">Valor total</span><b className="text-sm tabular-nums">{brl(valor)}</b></span>
                <span><span className="block text-fraco">Variação</span><b className="text-sm"><Variacao v={variacao} casas={2} seta /></b></span>
                <span><span className="block text-fraco">Rentabilidade</span><b className="text-sm"><Variacao v={investido > 0 ? valor / investido - 1 : null} casas={2} /></b></span>
                <span title="Dividendos dos últimos 12 meses ÷ valor de hoje, ponderado pelo tamanho de cada posição">
                  <span className="block text-fraco">DY médio</span>
                  <b className="text-sm tabular-nums text-alta">{pct(dyGrupo)}</b>
                </span>
                <span><span className="block text-fraco">% na carteira</span><b className="text-sm tabular-nums">{pct(patrimonio > 0 ? valor / patrimonio : null)}</b></span>
              </span>
            </summary>
            <div className="overflow-x-auto border-t border-borda">
              <table className="tabela">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1]">Ativo</th>
                    <th className="!text-right">Quant.</th>
                    <th className="!text-right">Preço médio</th>
                    <th className="!text-right">Preço atual</th>
                    <th className="!text-right">Variação</th>
                    <th className="!text-right">Rentabilidade</th>
                    <th className="!text-right">Saldo</th>
                    <th className="!text-right">% Carteira</th>
                    <th className="!text-right">% Ideal</th>
                    <th className="!text-right" title="Dividendos dos últimos 12 meses ÷ preço de hoje">DY 12m</th>
                    <th className="!text-right" title="Yield on cost: dividendos dos últimos 12 meses ÷ seu preço médio">DY s/ PM</th>
                    <th className="!text-right">Preço teto</th>
                    <th className="!text-center">Nota</th>
                    <th className="!text-center">Comprar?</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((p) =>
                    p.tipo === "renda_fixa" ? (
                      <tr key={p.ticker}>
                        <td className="sticky left-0 z-[1] bg-painel">
                          <span className="flex items-center gap-2.5 font-medium">
                            <Logo ticker={p.ticker} src={null} />
                            {p.ticker}
                          </span>
                        </td>
                        <td colSpan={3} className="text-right text-xs text-suave">
                          {p.taxa_cdi ? `${Math.round(p.taxa_cdi * 1000) / 10}% do CDI` : "sem rendimento"}
                          {p.data_aplicacao ? ` desde ${p.data_aplicacao.split("-").reverse().join("/")}` : ""} · aplicado {brl(p.investido)}
                        </td>
                        <td className="text-right text-fraco">—</td>
                        <td className="text-right"><Variacao v={p.rentabilidade} casas={2} /></td>
                        <td className="text-right font-medium">{brl(p.valor)}</td>
                        <td className="text-right">{pct(p.peso, 2)}</td>
                        <td colSpan={6} className="text-center text-xs text-fraco">sem preço teto (renda fixa ou bem sem cotação)</td>
                      </tr>
                    ) : (
                    <tr key={p.ticker}>
                      <td className="sticky left-0 z-[1] bg-painel">
                        <Link href={`/acao/${p.ticker}`} className="flex items-center gap-2.5 font-medium hover:text-marca">
                          <Logo ticker={p.ticker} src={p.a?.logo} />
                          {p.ticker}
                        </Link>
                      </td>
                      <td className="text-right">{p.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</td>
                      <td className="text-right">{dinheiro(p.preco_medio, p.moeda)}</td>
                      <td className="text-right">{dinheiro(p.a?.preco, p.moeda)}</td>
                      <td className="text-right"><Variacao v={p.a?.variacao_dia} casas={2} seta /></td>
                      <td className="text-right"><Variacao v={p.rentabilidade} casas={2} /></td>
                      <td className="text-right font-medium">{brl(p.valor)}</td>
                      <td className="text-right">{pct(p.peso, 2)}</td>
                      <td className="text-right text-suave">{pct(pesoIdeal, 2)}</td>
                      <td className="text-right">{p.a?.dy_12m ? pct(p.a.dy_12m) : <span className="text-fraco">—</span>}</td>
                      <td className="text-right text-suave">
                        {p.a?.dpa_12m && p.preco_medio > 0 ? pct(p.a.dpa_12m / p.preco_medio) : <span className="text-fraco">—</span>}
                      </td>
                      <td className="text-right">{dinheiro(p.a?.preco_teto, p.moeda)}</td>
                      <td className="text-center"><Nota v={p.a?.qualidade} rotulo="Qualidade (0 a 10)" /></td>
                      <td className="text-center"><Comprar p={p} /></td>
                    </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-borda px-4 py-2.5">
              <Link href="/carteira" className="text-xs text-marca hover:underline">Lançar compra ou venda na Carteira →</Link>
            </div>
          </details>
        );
      })}
    </section>
  );
}
