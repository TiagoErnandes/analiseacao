import Link from "next/link";
import { brl, brlCompacto, dataBr, pct } from "@/lib/format";
import { carregarPainel, LIMITE_SETOR, type Posicao } from "@/lib/painel";
import type { Analise } from "@/lib/db";
import { BotaoAnalise } from "./BotaoAnalise";
import { Logo } from "./Logo";
import { Rosca } from "./Rosca";
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

function LinhaCarteira({ p, pesoIdeal }: { p: Posicao; pesoIdeal: number }) {
  const a = p.a;
  const desvio = p.peso != null ? p.peso - pesoIdeal : null;
  return (
    <tr>
      <td>
        <Link href={`/acao/${p.ticker}`} className="flex items-center gap-2.5 hover:text-marca">
          <Logo ticker={p.ticker} src={a?.logo} />
          <div>
            <p className="font-medium">{p.ticker}</p>
            <p className="max-w-36 truncate text-[11px] text-fraco">{a?.setor ?? ""}</p>
          </div>
        </Link>
      </td>
      <td className="text-right">{p.quantidade}</td>
      <td className="text-right">{brl(p.preco_medio)}</td>
      <td className="text-right">
        <p>{brl(a?.preco)}</p>
        <p className="text-[11px]"><Variacao v={a?.variacao_dia} casas={2} /></p>
      </td>
      <td className="text-right">
        <p className="font-medium">{brl(p.valor)}</p>
        <p className="text-[11px]"><Variacao v={p.rentabilidade} /></p>
      </td>
      <td>
        <div className="flex items-center gap-2" title={`Ideal ${pct(pesoIdeal)}`}>
          <div className="relative h-1.5 w-20 rounded-full bg-borda">
            <div className="h-full rounded-full bg-[#3987e5]" style={{ width: `${Math.min(100, ((p.peso ?? 0) / (pesoIdeal * 2)) * 100)}%` }} />
            <div className="absolute -top-0.5 left-1/2 h-2.5 w-px bg-suave" />
          </div>
          <span className="w-12 text-right text-xs">{pct(p.peso)}</span>
        </div>
        <p className={`text-[11px] ${desvio != null && desvio < 0 ? "text-[#6da7ec]" : "text-fraco"}`}>
          {desvio == null ? "" : desvio < 0 ? `faltam ${pct(-desvio)}` : `acima ${pct(desvio)}`}
        </p>
      </td>
      <td className="text-right">{brl(a?.preco_teto)}</td>
      <td className="text-right"><Variacao v={a?.margem} /></td>
      <td className="text-right">{brl(p.renda12m)}</td>
      <td className="text-center"><Nota v={a?.qualidade} /></td>
      <td><Sinal r={a?.recomendacao} /></td>
    </tr>
  );
}

export default async function Painel() {
  const { exec, rel, analises, porTicker, posicoes, resumo, setores } = await carregarPainel();
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
  const ordenadas = [...posicoes].sort((x, y) => (y.a?.score ?? -1) - (x.a?.score ?? -1));
  const pesoSetor = Object.fromEntries(setores.map((s) => [s.nome, s.peso]));
  const itensAporte: ItemAporte[] = posicoes.map((p) => ({
    ticker: p.ticker,
    logo: p.a?.logo ?? null,
    preco: p.a?.preco ?? null,
    valor: p.valor,
    margem: p.a?.margem ?? null,
    recomendacao: p.a?.recomendacao ?? null,
    score: p.a?.score ?? null,
    setor: p.a?.setor ?? null,
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
        {botao}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          rotulo="Patrimônio"
          valor={brlCompacto(resumo.patrimonio)}
          detalhe={<>Hoje <Variacao v={resumo.variacaoDia} casas={2} seta /></>}
        />
        <Kpi
          rotulo="Rentabilidade"
          valor={<Variacao v={resumo.rentabilidade} />}
          detalhe={<>{resumo.lucro >= 0 ? "Lucro" : "Prejuízo"} de {brl(Math.abs(resumo.lucro))} sobre {brl(resumo.investido)}</>}
        />
        <Kpi
          rotulo="Renda passiva (12m)"
          valor={brl(resumo.renda12m)}
          detalhe={<>≈ {brl(resumo.renda12m / 12)}/mês · Yield on cost {pct(resumo.yieldOnCost)}</>}
          dica="Dividendos e JCP pagos nos últimos 12 meses pela quantidade que você tem hoje"
        />
        <Kpi
          rotulo="Dividend yield"
          valor={pct(resumo.dy)}
          detalhe={<>Margem de segurança média <Variacao v={resumo.margemMedia} /></>}
          dica="Dividendos dos últimos 12 meses sobre o valor atual da carteira"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <AcaoDoDia titulo="Ação do dia na sua carteira" a={porTicker.get(rel.acao_do_dia_carteira ?? "")} justificativa={rel.justificativa_carteira} />
        <AcaoDoDia titulo="Ação do dia no Ibovespa" a={porTicker.get(rel.acao_do_dia_geral ?? "")} justificativa={rel.justificativa_geral} />
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
          <SimuladorAporte itens={itensAporte} pesoSetor={pesoSetor} limiteSetor={LIMITE_SETOR} />
        </Cartao>
        <Cartao titulo="Alocação por setor" className="lg:col-span-2">
          <div className="p-4">
            <Rosca fatias={setores} centro="setores" limite={LIMITE_SETOR} />
            <p className="mt-4 text-xs text-fraco">Para previdência, o ideal é nenhum setor passar de {pct(LIMITE_SETOR, 0)} da carteira.</p>
          </div>
        </Cartao>
      </section>

      <Cartao
        titulo={<>Minha carteira <span className="ml-1 font-normal text-fraco">{posicoes.length} ativos</span></>}
        acao={<Link href="/carteira" className="text-xs text-marca hover:underline">Editar carteira</Link>}
      >
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Ativo</th>
                <th className="!text-right">Qtd.</th>
                <th className="!text-right">Preço médio</th>
                <th className="!text-right">Cotação</th>
                <th className="!text-right">Posição</th>
                <th>Peso (ideal {pct(pesoIdeal)})</th>
                <th className="!text-right">Preço teto</th>
                <th className="!text-right">Margem</th>
                <th className="!text-right">Renda 12m</th>
                <th className="!text-center">Qualidade</th>
                <th>Sinal</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((p) => <LinhaCarteira key={p.ticker} p={p} pesoIdeal={pesoIdeal} />)}
            </tbody>
          </table>
        </div>
      </Cartao>

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
