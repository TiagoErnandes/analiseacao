import { brlCompacto, dataBr } from "@/lib/format";
import type { Documento, HistoricoLucro, ProventoAnunciado } from "@/lib/cvm";
import type { ConsistenciaDividendos } from "@/lib/valuation";
import { Cartao } from "../../ui";

/** Lucro de cada ano (barras acima ou abaixo de zero), dividendos em 10 anos e as fontes oficiais recentes. */
export function Constancia({
  lucros,
  dividendos,
  documentos,
  proventos,
  ehAcao,
}: {
  lucros: HistoricoLucro | null;
  dividendos: ConsistenciaDividendos | null;
  documentos: Documento[];
  proventos: ProventoAnunciado[];
  ehAcao: boolean;
}) {
  const maior = Math.max(1, ...(lucros?.lucros ?? []).map((l) => Math.abs(l.lucro)));
  const temNegativo = (lucros?.lucros ?? []).some((l) => l.lucro < 0);
  const ALTURA = 72; // px de cada lado da linha do zero
  return (
    <Cartao titulo="Constância em 10 anos e fontes oficiais">
      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div className="space-y-4">
          {ehAcao && (
            <div>
              <p className="rotulo mb-1">Lucro líquido por ano (balanços na CVM)</p>
              {lucros && lucros.lucros.length ? (
                <>
                  <p className="mb-3 text-sm">
                    Lucro em <b>{lucros.anosComLucro} de {lucros.anos}</b> anos
                    {lucros.crescimentoAnual != null && (
                      <> · crescimento de <b>{(lucros.crescimentoAnual * 100).toFixed(1).replace(".", ",")}%</b> ao ano</>
                    )}
                  </p>
                  <div className="flex items-stretch gap-1" role="img" aria-label="Lucro líquido por ano">
                    {lucros.lucros.map((l) => {
                      const h = Math.max(2, (Math.abs(l.lucro) / maior) * ALTURA);
                      return (
                        <div key={l.ano} className="group flex min-w-0 flex-1 flex-col items-center" title={`${l.ano}: ${brlCompacto(l.lucro)}`}>
                          <div className="flex w-full flex-col justify-end" style={{ height: ALTURA }}>
                            {l.lucro >= 0 && <div className="mx-auto w-full max-w-6 rounded-t bg-alta/80 group-hover:bg-alta" style={{ height: h }} />}
                          </div>
                          <div className="h-px w-full bg-borda" />
                          {temNegativo && (
                            <div className="flex w-full flex-col justify-start" style={{ height: ALTURA / 2 }}>
                              {l.lucro < 0 && (
                                <div className="mx-auto w-full max-w-6 rounded-b bg-baixa/80 group-hover:bg-baixa" style={{ height: Math.min(h, ALTURA / 2) }} />
                              )}
                            </div>
                          )}
                          <span className="mt-1 text-[10px] tabular-nums text-fraco">{String(l.ano).slice(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-suave">Ainda sem os balanços da CVM para esta empresa (são baixados na próxima análise).</p>
              )}
            </div>
          )}
          <div>
            <p className="rotulo mb-1">{ehAcao ? "Dividendos" : "Rendimentos"} por ano</p>
            {dividendos ? (
              <p className="text-sm">
                Pagou em <b>{dividendos.anosPagos} de {dividendos.anos}</b> anos
                {dividendos.cortes > 0 ? (
                  <> · caiu mais da metade de um ano para o outro <b>{dividendos.cortes}</b> {dividendos.cortes === 1 ? "vez" : "vezes"}</>
                ) : (
                  " · nenhum corte pela metade"
                )}
              </p>
            ) : (
              <p className="text-sm text-suave">Sem histórico de pagamentos.</p>
            )}
          </div>
          {ehAcao && proventos.length > 0 && (
            <div>
              <p className="rotulo mb-1">Proventos anunciados (B3)</p>
              <ul className="space-y-1 text-sm">
                {proventos.map((p, i) => (
                  <li key={i}>
                    <b>{p.tipo}</b> {p.valor != null ? `R$ ${p.valor.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}` : ""}
                    <span className="text-suave">
                      {p.dataCom ? ` · data-com ${dataBr(p.dataCom)}` : ""}
                      {p.pagamento ? ` · paga em ${dataBr(p.pagamento)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {ehAcao && (
          <div>
            <p className="rotulo mb-1">Fatos relevantes e comunicados (CVM, 45 dias)</p>
            {documentos.length ? (
              <ul className="space-y-2 text-sm">
                {documentos.map((d, i) => (
                  <li key={i} className="leading-snug">
                    <span className="text-xs tabular-nums text-fraco">{dataBr(d.data)}</span> <b>{d.categoria}</b>
                    {d.assunto ? <span className="text-suave">: {d.assunto}</span> : null}
                    {d.link && (
                      <>
                        {" "}
                        <a href={d.link} target="_blank" rel="noreferrer" className="text-xs text-marca hover:underline">abrir</a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-suave">Nenhum documento oficial nos últimos 45 dias.</p>
            )}
          </div>
        )}
      </div>
    </Cartao>
  );
}
