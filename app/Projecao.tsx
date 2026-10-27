"use client";
// Projeção para a aposentadoria: quanto o patrimônio pode chegar com aportes mensais e juros compostos,
// e quanta renda passiva isso pagaria. Tudo em valores de hoje (rentabilidade acima da inflação).
import { useMemo, useState } from "react";
import { brl, brlCompacto, pct } from "@/lib/format";

const num = (t: string) => Math.max(0, Number(t.replace(/\./g, "").replace(",", ".")) || 0);

function Campo({ rotulo, valor, mudar, prefixo, sufixo, dica }: { rotulo: string; valor: string; mudar: (v: string) => void; prefixo?: string; sufixo?: string; dica?: string }) {
  return (
    <label className="flex flex-col gap-1" title={dica}>
      <span className="rotulo">{rotulo}</span>
      <div className="flex items-center rounded-lg border border-borda bg-fundo focus-within:border-marca">
        {prefixo && <span className="pl-3 text-sm text-fraco">{prefixo}</span>}
        <input value={valor} onChange={(e) => mudar(e.target.value)} inputMode="decimal" className="w-full min-w-0 bg-transparent px-2 py-2 text-sm tabular-nums outline-none" />
        {sufixo && <span className="pr-3 text-sm text-fraco">{sufixo}</span>}
      </div>
    </label>
  );
}

export function Projecao({ patrimonio }: { patrimonio: number }) {
  const [inicial, setInicial] = useState(String(Math.round(patrimonio)));
  const [aporte, setAporte] = useState("1000");
  const [anos, setAnos] = useState("25");
  const [taxa, setTaxa] = useState("6");
  const [meta, setMeta] = useState("5000");
  const [dy, setDy] = useState("6");

  const r = useMemo(() => {
    const p0 = num(inicial);
    const a = num(aporte);
    const n = Math.min(60, Math.round(num(anos)));
    const im = Math.pow(1 + num(taxa) / 100, 1 / 12) - 1;
    const y = num(dy) / 100;
    const alvo = y > 0 ? (num(meta) * 12) / y : Infinity; // patrimônio que paga a renda desejada
    const serie: { ano: number; valor: number; aportado: number }[] = [{ ano: 0, valor: p0, aportado: p0 }];
    let v = p0;
    let aportado = p0;
    let mesesMeta: number | null = v >= alvo ? 0 : null;
    for (let m = 1; m <= 60 * 12; m++) {
      v = v * (1 + im) + a;
      aportado += a;
      if (mesesMeta == null && v >= alvo) mesesMeta = m;
      if (m % 12 === 0 && m / 12 <= n) serie.push({ ano: m / 12, valor: v, aportado });
      if (m >= n * 12 && mesesMeta != null) break;
    }
    const final = serie[serie.length - 1];
    // Aporte mensal necessário para chegar ao alvo no prazo
    const fator = Math.pow(1 + im, n * 12);
    const necessario = Number.isFinite(alvo) && n > 0 ? Math.max(0, im > 0 ? ((alvo - p0 * fator) * im) / (fator - 1) : (alvo - p0) / (n * 12)) : null;
    return { serie, final, alvo, mesesMeta, renda: (final.valor * y) / 12, necessario, n };
  }, [inicial, aporte, anos, taxa, meta, dy]);

  const W = 600;
  const H = 180;
  const max = Math.max(r.final.valor, Number.isFinite(r.alvo) ? Math.min(r.alvo, r.final.valor * 2) : 0, 1);
  const x = (ano: number) => (r.n > 0 ? (ano / r.n) * W : 0);
  const y = (v: number) => H - (v / max) * (H - 10);
  const linha = (k: "valor" | "aportado") => r.serie.map((p, i) => `${i ? "L" : "M"}${x(p.ano).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo rotulo="Patrimônio hoje" valor={inicial} mudar={setInicial} prefixo="R$" />
        <Campo rotulo="Aporte por mês" valor={aporte} mudar={setAporte} prefixo="R$" />
        <Campo rotulo="Prazo" valor={anos} mudar={setAnos} sufixo="anos" />
        <Campo rotulo="Rentab. real ao ano" valor={taxa} mudar={setTaxa} sufixo="%" dica="Acima da inflação. Histórico de carteiras de dividendos no Brasil: algo entre 4% e 8% ao ano." />
        <Campo rotulo="Renda desejada/mês" valor={meta} mudar={setMeta} prefixo="R$" />
        <Campo rotulo="Dividend yield na aposentadoria" valor={dy} mudar={setDy} sufixo="%" dica="Quanto a carteira paga por ano, sobre o valor dela, quando você parar de aportar" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-center lg:grid-cols-4">
        {[
          [`Patrimônio em ${r.n} anos`, brlCompacto(r.final.valor)],
          ["Renda passiva/mês", brl(r.renda)],
          ["Meta atingida em", r.mesesMeta == null ? "mais de 60 anos" : r.mesesMeta === 0 ? "já atingida" : `${Math.floor(r.mesesMeta / 12)} anos e ${r.mesesMeta % 12} meses`],
          [`Aporte p/ meta em ${r.n} anos`, r.necessario == null ? "—" : `${brl(r.necessario)}/mês`],
        ].map(([rot, val]) => (
          <div key={rot} className="rounded-lg bg-painel2 px-2 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-fraco">{rot}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{val}</p>
          </div>
        ))}
      </div>

      {r.n > 0 && (
        <div>
          <div className="relative h-44">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Projeção do patrimônio">
              {Number.isFinite(r.alvo) && r.alvo <= max && (
                <line x1={0} x2={W} y1={y(r.alvo)} y2={y(r.alvo)} stroke="#c98500" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              )}
              <path d={`${linha("valor")} L${x(r.n)},${H} L0,${H} Z`} fill="#199e70" opacity={0.15} />
              <path d={linha("valor")} fill="none" stroke="#199e70" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <path d={linha("aportado")} fill="none" stroke="#7b8794" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            </svg>
            {Number.isFinite(r.alvo) && r.alvo <= max && (
              <span className="absolute left-1 text-[11px] text-[#c98500]" style={{ top: `calc(${(y(r.alvo) / H) * 100}% - 16px)` }}>
                meta {brlCompacto(r.alvo)}
              </span>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-fraco">
            <span>hoje</span>
            <span>{Math.round(r.n / 2)} anos</span>
            <span>{r.n} anos</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-suave">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#199e70]" /> Patrimônio</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-[#7b8794]" /> Total aportado</span>
            <span>Juros compostos: {brlCompacto(Math.max(0, r.final.valor - r.final.aportado))} ({pct(r.final.aportado > 0 ? r.final.valor / r.final.aportado - 1 : null, 0)} sobre o aportado)</span>
          </div>
        </div>
      )}
      <p className="text-xs text-fraco">Valores em reais de hoje, com dividendos reinvestidos até a aposentadoria. É uma simulação, não uma garantia.</p>
    </div>
  );
}
