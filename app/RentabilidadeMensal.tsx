// Rentabilidade mês a mês por cotas, com CDI e Ibovespa no mesmo período, e o gráfico do acumulado.
import { brl, dataBr, pct, pctSinal } from "@/lib/format";
import type { Rentabilidade } from "@/lib/rentabilidade";
import { Variacao } from "./ui";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const CORES = { carteira: "#10b981", cdi: "#6da7ec", ibov: "#e0a84e" } as const;

function Grafico({ serie }: { serie: Rentabilidade["serie"] }) {
  if (serie.length < 3) return null;
  const L = 600, A = 200, m = { t: 12, b: 12 };
  const valores = serie.flatMap((p) => [p.carteira, p.cdi, p.ibov]).filter((v): v is number => v != null);
  const min = Math.min(0, ...valores);
  const max = Math.max(0.01, ...valores);
  const y = (v: number) => m.t + (1 - (v - min) / (max - min || 1)) * (A - m.t - m.b);
  const x = (i: number) => (i / (serie.length - 1)) * L;
  const linha = (k: keyof typeof CORES) =>
    serie
      .map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k] as number).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const ultimo = serie.at(-1)!;
  return (
    <div className="px-4 pt-4">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-suave">
        {(["carteira", "cdi", "ibov"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: CORES[k] }} />
            {k === "carteira" ? "Sua carteira" : k === "cdi" ? "CDI" : "Ibovespa"}{" "}
            <b className="tabular-nums text-texto">{pctSinal(ultimo[k])}</b>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-48 w-full" preserveAspectRatio="none" role="img" aria-label="Rentabilidade acumulada">
        <line x1={0} x2={L} y1={y(0)} y2={y(0)} stroke="#222c38" vectorEffect="non-scaling-stroke" />
        {(["ibov", "cdi", "carteira"] as const).map((k) => (
          <polyline key={k} points={linha(k)} fill="none" stroke={CORES[k]} strokeWidth={k === "carteira" ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-fraco">
        <span>{dataBr(serie[0].data)}</span>
        <span>{dataBr(ultimo.data)}</span>
      </div>
    </div>
  );
}

export function RentabilidadeMensal({ dados }: { dados: Rentabilidade | null }) {
  if (!dados || dados.meses.length === 0) {
    return <p className="p-4 text-sm text-suave">A rentabilidade mês a mês aparece depois de duas análises com a carteira montada.</p>;
  }
  const { meses, acumulado } = dados;
  const vsCdi = (c: number, cdi: number | null) => (cdi != null && cdi > 0 ? c / cdi : null);
  return (
    <div>
      <Grafico serie={dados.serie} />
      <div className="overflow-x-auto">
        <table className="tabela mt-3">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="!text-right">Carteira</th>
              <th className="!text-right">CDI</th>
              <th className="!text-right">Ibovespa</th>
              <th className="!text-right">% do CDI</th>
              <th className="!text-right">Proventos</th>
            </tr>
          </thead>
          <tbody>
            {[...meses].reverse().map((m) => {
              const p = vsCdi(m.carteira, m.cdi);
              return (
                <tr key={m.mes}>
                  <td className="font-medium">{nomeMes(m.mes)}</td>
                  <td className="text-right font-semibold"><Variacao v={m.carteira} casas={2} /></td>
                  <td className="text-right text-suave">{pctSinal(m.cdi, 2)}</td>
                  <td className="text-right"><Variacao v={m.ibov} casas={2} /></td>
                  <td className="text-right text-suave">{p == null ? "—" : pct(p, 0)}</td>
                  <td className="text-right text-suave">{m.proventos > 0 ? brl(m.proventos) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          {acumulado && (
            <tfoot>
              <tr className="border-t border-borda font-semibold">
                <td className="px-3 py-2.5">Acumulado</td>
                <td className="px-3 py-2.5 text-right"><Variacao v={acumulado.carteira} casas={2} /></td>
                <td className="px-3 py-2.5 text-right">{pctSinal(acumulado.cdi, 2)}</td>
                <td className="px-3 py-2.5 text-right"><Variacao v={acumulado.ibov} casas={2} /></td>
                <td className="px-3 py-2.5 text-right">{(() => { const p = vsCdi(acumulado.carteira, acumulado.cdi); return p == null ? "—" : pct(p, 0); })()}</td>
                <td className="px-3 py-2.5 text-right">{brl(meses.reduce((s, m) => s + m.proventos, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="border-t border-borda px-4 py-3 text-xs text-fraco">
        Rentabilidade por cotas desde {acumulado ? dataBr(acumulado.desde) : "—"}: aportes e vendas não contam como ganho ou perda, e os
        proventos somam no mês do provento. CDI e Ibovespa medidos nos mesmos dias.
        {dados.ignorados > 0 && ` ${dados.ignorados} dia(s) com salto acima de 40% (ajuste de cadastro) contaram como 0%.`}
      </p>
    </div>
  );
}
