// Carteira contra CDI, IPCA e Ibovespa na mesma janela de tempo.
import { dataBr, pct, pctSinal } from "@/lib/format";
import type { Comparativo as Dados } from "@/lib/indices";

export function Comparativo({ carteira, dados }: { carteira: number | null; dados: Dados | null }) {
  if (!dados || (dados.cdi == null && dados.ipca == null && dados.ibov == null)) {
    return <p className="p-4 text-sm text-suave">Os índices de referência (CDI, IPCA e Ibovespa) aparecem depois da próxima análise.</p>;
  }
  const linhas = [
    { nome: "Sua carteira", v: carteira, destaque: true },
    { nome: "CDI", v: dados.cdi },
    { nome: "IPCA (inflação)", v: dados.ipca },
    { nome: "Ibovespa", v: dados.ibov },
  ];
  const max = Math.max(0.01, ...linhas.map((l) => Math.abs(l.v ?? 0)));
  const temNeg = linhas.some((l) => (l.v ?? 0) < 0);
  const real = carteira != null && dados.ipca != null ? (1 + carteira) / (1 + dados.ipca) - 1 : null;
  const vsCdi = carteira != null && dados.cdi != null && dados.cdi > 0 ? carteira / dados.cdi : null;

  return (
    <div className="space-y-4 p-4">
      <ul className="space-y-3">
        {linhas.map((l) => {
          const largura = l.v == null ? 0 : (Math.abs(l.v) / max) * (temNeg ? 50 : 100);
          return (
            <li key={l.nome} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
              <span className={l.destaque ? "font-semibold" : "text-suave"}>{l.nome}</span>
              <div className="relative h-2.5 rounded-full bg-painel2">
                {temNeg && <div className="absolute left-1/2 top-[-3px] h-4 w-px bg-borda" />}
                {l.v != null && (
                  <div
                    className="absolute top-0 h-full rounded-full"
                    style={{
                      width: `${largura}%`,
                      left: temNeg ? (l.v < 0 ? `${50 - largura}%` : "50%") : 0,
                      background: l.v < 0 ? "#e66767" : l.destaque ? "#199e70" : "#7b8794",
                    }}
                  />
                )}
              </div>
              <span className={`text-right tabular-nums ${l.v == null ? "text-fraco" : l.v < 0 ? "text-baixa" : l.destaque ? "font-semibold text-alta" : ""}`}>
                {l.v == null ? "—" : pctSinal(l.v)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-painel2 px-2 py-2" title="Quanto a carteira rendeu acima da inflação">
          <p className="text-[10px] uppercase tracking-wider text-fraco">Ganho real</p>
          <p className={`mt-1 text-sm font-semibold tabular-nums ${real == null ? "" : real >= 0 ? "text-alta" : "text-baixa"}`}>{real == null ? "—" : pctSinal(real)}</p>
        </div>
        <div className="rounded-lg bg-painel2 px-2 py-2" title="Rendimento da carteira dividido pelo do CDI">
          <p className="text-[10px] uppercase tracking-wider text-fraco">% do CDI</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{vsCdi == null ? "—" : pct(vsCdi, 0)}</p>
        </div>
      </div>
      <p className="text-xs text-fraco">Desde {dataBr(dados.desde)}. A carteira inclui ganho de capital e proventos. Fontes: Banco Central e Yahoo.</p>
    </div>
  );
}
