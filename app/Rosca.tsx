// Gráfico de rosca da alocação (por setor ou por ativo), com legenda e valores.
import { brl, pct } from "@/lib/format";

// Paleta categórica validada para fundo escuro (ordem fixa, sem repetir cores).
export const CORES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

type Fatia = { nome: string; valor: number; peso: number; alerta?: boolean };

export function Rosca({ fatias, centro, limite }: { fatias: Fatia[]; centro: string; limite?: number }) {
  // Mais de 8 fatias: as menores viram "Outros"
  let lista = fatias.filter((f) => f.valor > 0);
  if (lista.length > CORES.length) {
    const resto = lista.slice(CORES.length - 1);
    lista = [
      ...lista.slice(0, CORES.length - 1),
      { nome: "Outros", valor: resto.reduce((s, f) => s + f.valor, 0), peso: resto.reduce((s, f) => s + f.peso, 0) },
    ];
  }
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = lista.length > 1 ? 2 : 0; // 2px de respiro entre as fatias
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label={`Alocação: ${lista.map((f) => `${f.nome} ${pct(f.peso)}`).join(", ")}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#222c38" strokeWidth="16" />
        {lista.map((f, i) => {
          const tam = f.peso * c;
          const el = (
            <circle
              key={f.nome}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={CORES[i]}
              strokeWidth="16"
              strokeDasharray={`${Math.max(0, tam - gap)} ${c}`}
              strokeDashoffset={-acumulado}
              className="transition-opacity hover:opacity-80"
            >
              <title>{`${f.nome}: ${pct(f.peso)} (${brl(f.valor)})`}</title>
            </circle>
          );
          acumulado += tam;
          return el;
        })}
        <text x="70" y="74" textAnchor="middle" className="fill-[#9aa6b2] text-[10px]" transform="rotate(90 70 70)">
          {lista.length} {centro}
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {lista.map((f, i) => {
          const acima = limite != null && f.peso > limite && f.nome !== "Outros";
          return (
            <li key={f.nome} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CORES[i] }} />
              <span className="min-w-0 flex-1 truncate text-suave" title={f.nome}>{f.nome}</span>
              {acima && <span className="rounded bg-amber-400/10 px-1.5 text-[10px] font-semibold text-amber-300" title={`Acima do limite de ${pct(limite, 0)}`}>⚠ concentrado</span>}
              <span className="font-medium tabular-nums">{pct(f.peso)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
