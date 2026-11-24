import type { Metadata } from "next";
import Link from "next/link";
import { brl, dataBr } from "@/lib/format";
import { ultimaExecucao } from "@/lib/analise";
import { exigirUsuario } from "@/lib/auth";
import { carregarPlacar, HORIZONTES, placarDoRanking, TOP_RANKING, type Grupo, type Horizonte, type Resultado } from "@/lib/placar";
import { Cartao, Sinal, Vazio, Variacao } from "../ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Placar" };

const NOME: Record<Grupo, { titulo: string; acerto: string }> = {
  acao_do_dia: { titulo: "Ação do dia", acerto: "bateram o Ibovespa" },
  comprar: { titulo: "Sinal COMPRAR", acerto: "bateram o Ibovespa" },
  evitar: { titulo: "Sinal EVITAR", acerto: "ficaram abaixo do Ibovespa (acerto)" },
};
const ROTULO_H: Record<Horizonte, string> = { 0: "Até hoje", 3: "3 meses", 6: "6 meses", 12: "12 meses" };

function Celula({ r }: { r: Resultado }) {
  if (!r) return <span className="text-fraco">—</span>;
  if ("pendente" in r) return <span className="text-xs text-fraco" title="Ainda não deu o prazo">em {dataBr(r.pendente)}</span>;
  return (
    <span title={`Até ${dataBr(r.ate)}${r.ibov != null ? `; Ibovespa no período: ${(r.ibov * 100).toFixed(1)}%` : ""}`}>
      <Variacao v={r.retorno} />
      {r.ibov != null && <span className="ml-1 text-[11px] text-fraco">({r.retorno > r.ibov ? "+" : ""}{((r.retorno - r.ibov) * 100).toFixed(1).replace(".", ",")} p.p.)</span>}
    </span>
  );
}

export default async function Placar() {
  await exigirUsuario();
  await ultimaExecucao(); // garante as tabelas
  const [{ resumos, sinais, inicio }, ranking] = await Promise.all([carregarPlacar(), placarDoRanking().catch(() => null)]);

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">{inicio ? `Recomendações desde ${dataBr(inicio)}` : "Sem análises ainda"}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Placar das recomendações</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          As recomendações passadas deram certo? Para cada sinal (um por ativo e por mês), o retorno inclui os proventos e é comparado com o
          Ibovespa no mesmo período. Um placar bom em 12 meses vale mais que em 3: o foco é longo prazo. Os resultados de 3, 6 e 12 meses
          aparecem conforme o prazo chega.
        </p>
      </div>

      <Cartao titulo={`Top ${TOP_RANKING} do ranking`}>
        <div className="space-y-3 p-4">
          <p className="text-xs leading-relaxed text-suave">
            Todo mês, as {TOP_RANKING} primeiras do ranking pela Nota (perfil Equilibrado, teto pela mediana, só boas empresas, uma classe por empresa)
            viram uma carteira com peso igual. O retorno usa a cotação de cada dia do ranking (e os proventos das ações analisadas) e é comparado com o
            Ibovespa. É o teste de que a Nota escolhe bem.
          </p>
          {!ranking?.carteiras.length ? (
            <p className="text-sm text-suave">A primeira carteira entra quando o ranking for aberto depois da próxima análise; os resultados aparecem conforme os prazos chegam.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Prazo</th>
                      <th className="!text-right">Retorno médio</th>
                      <th className="!text-right">Ibovespa</th>
                      <th className="!text-right">Bateu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.resumos.map((r) => (
                      <tr key={r.horizonte}>
                        <td>
                          {ROTULO_H[r.horizonte]}
                          <span className="block text-[11px] text-fraco">
                            {r.avaliados} {r.avaliados === 1 ? "carteira" : "carteiras"}
                            {r.pendentes > 0 && r.proximoResultado ? ` · próxima em ${dataBr(r.proximoResultado)}` : ""}
                          </span>
                        </td>
                        <td className="text-right"><Variacao v={r.retornoMedio} /></td>
                        <td className="text-right"><Variacao v={r.ibovMedio} /></td>
                        <td className="text-right tabular-nums">{r.avaliados ? `${r.acertos} de ${r.avaliados}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th>Ações</th>
                      {HORIZONTES.map((h) => <th key={h} className="!text-right">{ROTULO_H[h]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.carteiras.map((c) => (
                      <tr key={c.data}>
                        <td>{dataBr(c.data)}</td>
                        <td className="!whitespace-normal text-xs text-suave">{c.tickers.join(", ")}</td>
                        {HORIZONTES.map((h) => <td key={h} className="text-right"><Celula r={c.resultados[h]} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Cartao>

      {!sinais.length ? (
        <Vazio>Ainda não há recomendações para medir. O placar começa a encher depois das primeiras análises.</Vazio>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            {(["acao_do_dia", "comprar", "evitar"] as Grupo[]).map((g) => (
              <Cartao key={g} titulo={NOME[g].titulo}>
                <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Prazo</th>
                      <th className="!text-right">Retorno médio</th>
                      <th className="!text-right">Ibovespa</th>
                      <th className="!text-right">Acerto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HORIZONTES.map((h) => {
                      const r = resumos.find((x) => x.grupo === g && x.horizonte === h)!;
                      return (
                        <tr key={h}>
                          <td>
                            {ROTULO_H[h]}
                            <span className="block text-[11px] text-fraco">
                              {r.avaliados} {r.avaliados === 1 ? "sinal" : "sinais"}
                              {r.pendentes > 0 && r.proximoResultado ? ` · próximo em ${dataBr(r.proximoResultado)}` : ""}
                            </span>
                          </td>
                          <td className="text-right"><Variacao v={r.retornoMedio} /></td>
                          <td className="text-right"><Variacao v={r.ibovMedio} /></td>
                          <td className="text-right tabular-nums" title={NOME[g].acerto}>
                            {r.avaliados ? `${r.acertos} de ${r.avaliados}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </Cartao>
            ))}
          </div>

          <Cartao titulo="Sinais (os mais recentes primeiro)">
            <div className="max-h-[32rem] overflow-auto">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Ativo</th>
                    <th>Sinal</th>
                    <th className="!text-right">Preço</th>
                    {HORIZONTES.map((h) => (
                      <th key={h} className="!text-right">{ROTULO_H[h]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sinais.slice(0, 200).map((s) => (
                    <tr key={`${s.grupo}-${s.ticker}-${s.data}`}>
                      <td>{dataBr(s.data)}</td>
                      <td><Link href={`/acao/${s.ticker}`} className="font-medium hover:text-marca">{s.ticker}</Link></td>
                      <td>{s.grupo === "acao_do_dia" ? <span className="text-xs font-semibold text-marca">AÇÃO DO DIA</span> : <Sinal r={s.grupo === "comprar" ? "COMPRAR" : "EVITAR"} />}</td>
                      <td className="text-right">{brl(s.preco)}</td>
                      {HORIZONTES.map((h) => (
                        <td key={h} className="text-right"><Celula r={s.resultados[h]} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      )}
    </div>
  );
}
