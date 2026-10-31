// Peças visuais reaproveitadas pelas páginas (sem estado, rodam no servidor ou no cliente).
import type { ReactNode } from "react";
import { brl, num, pctSinal } from "@/lib/format";

export function Cartao({
  titulo,
  acao,
  children,
  className = "",
  id,
}: {
  titulo?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`cartao scroll-mt-32 ${className}`}>
      {(titulo || acao) && (
        <div className="flex items-center justify-between gap-3 border-b border-borda px-4 py-3">
          {titulo && <h2 className="text-sm font-semibold">{titulo}</h2>}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ rotulo, valor, detalhe, dica }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; dica?: string }) {
  return (
    <div className="cartao p-4" title={dica}>
      <p className="rotulo">{rotulo}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
      {detalhe && <div className="mt-1 text-xs text-suave tabular-nums">{detalhe}</div>}
    </div>
  );
}

/** Número colorido: verde se positivo, vermelho se negativo. */
export function Variacao({ v, casas = 1, seta = false }: { v: number | null | undefined; casas?: number; seta?: boolean }) {
  if (v == null) return <span className="text-fraco">—</span>;
  const cor = v > 0 ? "text-alta" : v < 0 ? "text-baixa" : "text-suave";
  return (
    <span className={`tabular-nums ${cor}`}>
      {seta && (v > 0 ? "▲ " : v < 0 ? "▼ " : "")}
      {pctSinal(v, casas)}
    </span>
  );
}

const SINAIS: Record<string, { txt: string; cls: string }> = {
  COMPRAR: { txt: "Comprar", cls: "bg-alta/15 text-alta ring-alta/30" },
  AGUARDAR: { txt: "Aguardar", cls: "bg-amber-400/10 text-amber-300 ring-amber-300/30" },
  EVITAR: { txt: "Evitar", cls: "bg-baixa/15 text-baixa ring-baixa/30" },
};

export function Sinal({ r }: { r: string | null | undefined }) {
  const s = r ? SINAIS[r] : null;
  if (!s) return <span className="text-fraco">—</span>;
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.cls}`}>{s.txt}</span>;
}

/** Nota de 0 a 10 em pílula colorida. */
export function Nota({ v, rotulo }: { v: number | null | undefined; rotulo?: string }) {
  if (v == null) return <span className="text-fraco">—</span>;
  const cls = v >= 7 ? "text-alta bg-alta/10" : v >= 5 ? "text-amber-300 bg-amber-400/10" : "text-baixa bg-baixa/10";
  return (
    <span className={`inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cls}`} title={rotulo}>
      {num(v, 1)}
    </span>
  );
}

export function Score({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-fraco">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-borda">
        <div className="h-full rounded-full bg-marca" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{v}</span>
    </div>
  );
}

/**
 * Régua do preço contra o preço teto: a barra vai até o preço atual,
 * a linha marca o teto. Verde abaixo do teto (com desconto), vermelho acima.
 */
export function ReguaTeto({ preco, teto }: { preco: number | null; teto: number | null }) {
  if (preco == null || teto == null || teto <= 0) return <p className="text-xs text-fraco">Sem preço teto calculado.</p>;
  const max = Math.max(teto, preco) * 1.15;
  const abaixo = preco <= teto;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-borda">
        <div className={`h-full rounded-full ${abaixo ? "bg-alta" : "bg-baixa"}`} style={{ width: `${(preco / max) * 100}%` }} />
        <div className="absolute -top-1 h-4 w-0.5 rounded bg-texto" style={{ left: `${(teto / max) * 100}%` }} title={`Preço teto ${brl(teto)}`} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-suave tabular-nums">
        <span>Preço {brl(preco)}</span>
        <span>Teto {brl(teto)}</span>
      </div>
    </div>
  );
}

export function Alertas({ txt }: { txt: string | null | undefined }) {
  if (!txt) return null;
  return (
    <ul className="space-y-1 text-xs text-amber-300/90">
      {txt.split("; ").map((t) => (
        <li key={t} className="flex gap-1.5">
          <span aria-hidden>⚠</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="cartao p-8 text-center text-sm text-suave">{children}</div>;
}


/** Ícone (i) com explicação ao passar o mouse ou focar com o teclado. */
export function Dica({ texto }: { texto: string }) {
  return (
    <span className="group/dica relative inline-flex normal-case tracking-normal">
      <span
        tabIndex={0}
        aria-label={texto}
        className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-fraco/60 text-[9px] font-bold leading-none text-fraco outline-none hover:border-suave hover:text-suave focus:border-marca"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-52 -translate-x-1/2 rounded-lg border border-borda bg-fundo px-3 py-2 text-[11px] font-normal leading-snug text-texto opacity-0 shadow-xl transition group-hover/dica:opacity-100 group-focus-within/dica:opacity-100"
      >
        {texto}
      </span>
    </span>
  );
}
