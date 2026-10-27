"use client";

import { useState } from "react";
import { brl, dataBr } from "@/lib/format";

type Foto = { data: string; investido: number; patrimonio: number };

const COR_APLICADO = "#199e70";
const COR_GANHO = "#5fd3a5";
const COR_PERDA = "#e66767";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Barras do patrimônio: valor aplicado embaixo e ganho de capital em cima (um ponto por mês, ou por dia no início). */
export function GraficoEvolucao({ fotos }: { fotos: Foto[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  if (fotos.length === 0) {
    return <p className="grid h-56 place-items-center px-6 text-center text-sm text-suave">O gráfico começa na próxima análise. Cada dia útil adiciona um ponto.</p>;
  }
  // Mais de 2 meses de fotos: fica a última de cada mês
  const meses = new Set(fotos.map((f) => f.data.slice(0, 7)));
  const porMes = meses.size >= 2;
  const pontos = porMes
    ? [...meses].map((m) => fotos.filter((f) => f.data.startsWith(m)).at(-1)!).slice(-12)
    : fotos.slice(-30);
  const rotulo = (f: Foto) => (porMes ? `${MESES[Number(f.data.slice(5, 7)) - 1]}/${f.data.slice(2, 4)}` : `${f.data.slice(8, 10)}/${f.data.slice(5, 7)}`);

  const max = Math.max(...pontos.map((p) => Math.max(p.patrimonio, p.investido))) * 1.1 || 1;
  const L = 600, A = 220, m = { t: 10, b: 22, l: 0, r: 0 };
  const largura = (L - m.l - m.r) / pontos.length;
  const barra = Math.min(48, largura * 0.65);
  const y = (v: number) => m.t + (1 - v / max) * (A - m.t - m.b);
  const f = foco != null ? pontos[foco] : null;
  const passo = Math.max(1, Math.ceil(pontos.length / 8));

  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-suave">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_APLICADO }} />Valor aplicado</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_GANHO }} />Ganho de capital</span>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-56 w-full" preserveAspectRatio="none" onMouseLeave={() => setFoco(null)}>
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} x2={L} y1={y(max * p / 1.1)} y2={y(max * p / 1.1)} stroke="#222c38" vectorEffect="non-scaling-stroke" />
        ))}
        {pontos.map((p, i) => {
          const x = m.l + i * largura + (largura - barra) / 2;
          const base = Math.min(p.investido, p.patrimonio);
          const ganho = p.patrimonio - p.investido;
          return (
            <g key={p.data} onMouseEnter={() => setFoco(i)}>
              <rect x={m.l + i * largura} y={0} width={largura} height={A} fill="transparent" />
              <rect x={x} y={y(base)} width={barra} height={Math.max(0, y(0) - y(base))} fill={COR_APLICADO} opacity={foco == null || foco === i ? 1 : 0.55} />
              {ganho > 0 && <rect x={x} y={y(p.patrimonio)} width={barra} height={Math.max(0, y(base) - y(p.patrimonio) - 1)} rx={3} fill={COR_GANHO} opacity={foco == null || foco === i ? 1 : 0.55} />}
              {ganho < 0 && <rect x={x} y={y(p.investido)} width={barra} height={Math.max(0, y(p.patrimonio) - y(p.investido) - 1)} fill="none" stroke={COR_PERDA} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-fraco">
        {pontos.map((p, i) => (
          <span key={p.data} className="flex-1 text-center">{i % passo === 0 || i === pontos.length - 1 ? rotulo(p) : ""}</span>
        ))}
      </div>
      {f && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-borda bg-fundo/95 px-3 py-2 text-xs shadow-xl tabular-nums"
          style={{ left: `${Math.min(68, ((foco! + 0.5) / pontos.length) * 100)}%` }}
        >
          <p className="mb-1 font-medium">{porMes ? rotulo(f) : dataBr(f.data)}</p>
          <p className="text-suave">Patrimônio <b className="text-texto">{brl(f.patrimonio)}</b></p>
          <p className="text-suave">Valor aplicado <b className="text-texto">{brl(f.investido)}</b></p>
          <p className="text-suave">Ganho de capital <b className={f.patrimonio >= f.investido ? "text-alta" : "text-baixa"}>{brl(f.patrimonio - f.investido)}</b></p>
        </div>
      )}
    </div>
  );
}
