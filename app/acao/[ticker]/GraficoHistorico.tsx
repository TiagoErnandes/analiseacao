"use client";

import { useEffect, useRef, useState } from "react";
import { brl, dataBr, dataCurta, pctSinal } from "@/lib/format";

type Ponto = { data: string; preco: number | null; preco_teto: number | null; margem: number | null };

const COR_PRECO = "#3987e5";
const COR_TETO = "#d95926";

/** Linha do preço e do preço teto ao longo das análises, com régua e dica ao passar o mouse. */
export function GraficoHistorico({ pontos }: { pontos: Ponto[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  // Desenha na largura real do cartão, para o texto não esticar nem encolher
  const caixa = useRef<HTMLDivElement>(null);
  const [L, setL] = useState(640);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setL(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const validos = pontos.filter((p) => p.preco != null);
  if (validos.length < 2) {
    return <p className="p-6 text-center text-sm text-suave">O gráfico aparece a partir da segunda análise. Cada manhã adiciona um ponto.</p>;
  }

  const A = 240, m = { t: 12, r: 12, b: 24, l: 52 };
  const valores = validos.flatMap((p) => [p.preco!, p.preco_teto ?? p.preco!]);
  let min = Math.min(...valores), max = Math.max(...valores);
  const folga = (max - min) * 0.12 || max * 0.05;
  min -= folga; max += folga;
  const x = (i: number) => m.l + (i / (validos.length - 1)) * (L - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - min) / (max - min)) * (A - m.t - m.b);
  const linha = (f: (p: Ponto) => number | null) =>
    validos.map((p, i) => (f(p) == null ? null : `${x(i)},${y(f(p)!)}`)).filter(Boolean).join(" ");
  const marcas = Array.from({ length: 4 }, (_, i) => min + ((max - min) * (i + 0.5)) / 4);
  const passoX = Math.max(1, Math.ceil(validos.length / Math.max(2, Math.floor(L / 90))));
  const f = foco != null ? validos[foco] : null;

  return (
    <div ref={caixa} className="relative m-4">
      <div className="mb-2 flex gap-4 text-xs text-suave">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: COR_PRECO }} />Cotação</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded border-t-2 border-dashed" style={{ borderColor: COR_TETO }} />Preço teto</span>
      </div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        className="block w-full" style={{ height: A }}
        onMouseLeave={() => setFoco(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * L;
          const i = Math.round(((px - m.l) / (L - m.l - m.r)) * (validos.length - 1));
          setFoco(Math.max(0, Math.min(validos.length - 1, i)));
        }}
      >
        {marcas.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={L - m.r} y1={y(v)} y2={y(v)} stroke="#222c38" />
            <text x={m.l - 8} y={y(v) + 3} textAnchor="end" className="fill-[#66727f] text-[10px]">{v.toFixed(2).replace(".", ",")}</text>
          </g>
        ))}
        {validos.map((p, i) =>
          i % passoX === 0 || (i === validos.length - 1 && i % passoX >= passoX / 2) ? (
            <text key={p.data} x={x(i)} y={A - 6} textAnchor="middle" className="fill-[#66727f] text-[10px]">{dataCurta(p.data)}</text>
          ) : null,
        )}
        <polyline points={linha((p) => p.preco_teto)} fill="none" stroke={COR_TETO} strokeWidth="2" strokeDasharray="5 4" />
        <polyline points={linha((p) => p.preco)} fill="none" stroke={COR_PRECO} strokeWidth="2" strokeLinejoin="round" />
        {f && (
          <g>
            <line x1={x(foco!)} x2={x(foco!)} y1={m.t} y2={A - m.b} stroke="#9aa6b2" strokeDasharray="2 3" />
            <circle cx={x(foco!)} cy={y(f.preco!)} r="4.5" fill={COR_PRECO} stroke="#10161e" strokeWidth="2" />
            {f.preco_teto != null && <circle cx={x(foco!)} cy={y(f.preco_teto)} r="4.5" fill={COR_TETO} stroke="#10161e" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {f && (
        <div
          className="pointer-events-none absolute top-10 rounded-lg border border-borda bg-fundo/95 px-3 py-2 text-xs shadow-xl tabular-nums"
          style={{ left: `${Math.min(70, (x(foco!) / L) * 100)}%` }}
        >
          <p className="font-medium">{dataBr(f.data)}</p>
          <p className="text-suave">Cotação <b className="text-texto">{brl(f.preco)}</b></p>
          <p className="text-suave">Teto <b className="text-texto">{brl(f.preco_teto)}</b></p>
          <p className="text-suave">Margem <b className="text-texto">{pctSinal(f.margem)}</b></p>
        </div>
      )}
    </div>
  );
}
