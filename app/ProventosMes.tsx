// Proventos recebidos mês a mês (últimos 12 meses).
import { brl } from "@/lib/format";

type Mes = { mes: string; valor: number; itens: { ticker: string; valor: number }[] };
const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function ProventosMes({ meses }: { meses: Mes[] }) {
  const total = meses.reduce((s, m) => s + m.valor, 0);
  if (total <= 0) {
    return <p className="p-4 text-sm text-suave">Nenhum provento recebido nos últimos 12 meses (pela data de compra dos seus ativos).</p>;
  }
  const max = Math.max(...meses.map((m) => m.valor));
  const comValor = meses.filter((m) => m.valor > 0).length;
  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-1 text-xs text-suave">
        <span>Total <b className="text-sm text-texto tabular-nums">{brl(total)}</b></span>
        <span>Média por mês <b className="text-sm text-texto tabular-nums">{brl(total / 12)}</b></span>
        <span>Meses com renda <b className="text-sm text-texto">{comValor} de 12</b></span>
      </div>
      <div className="flex h-40 items-end gap-1.5">
        {meses.map((m) => {
          const [ano, mes] = m.mes.split("-");
          const dica = m.valor > 0
            ? `${NOMES[+mes - 1]}/${ano.slice(2)}: ${brl(m.valor)}\n${m.itens.map((i) => `${i.ticker} ${brl(i.valor)}`).join("\n")}`
            : `${NOMES[+mes - 1]}/${ano.slice(2)}: nada`;
          return (
            <div key={m.mes} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={dica}>
              <span className="hidden text-[10px] tabular-nums text-suave group-hover:block">{brl(m.valor).replace(",00", "")}</span>
              <div
                className="w-full max-w-8 rounded-t bg-[#5fd3a5] transition group-hover:bg-[#199e70]"
                style={{ height: `${max > 0 ? Math.max(m.valor > 0 ? 3 : 0, (m.valor / max) * 100) : 0}%` }}
              />
              <span className="text-[10px] text-fraco">{NOMES[+mes - 1]}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-fraco">Pela data com de cada provento. Passe o mouse para ver os ativos.</p>
    </div>
  );
}
