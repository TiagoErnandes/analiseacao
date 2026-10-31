"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dinheiro, pctSinal } from "@/lib/format";

type Cotacao = {
  pontos: { t: number; c: number }[];
  moeda: string | null;
  anterior: number | null;
  preco: number | null;
  minimo52s: number | null;
  maximo52s: number | null;
};

const PERIODOS = [
  { id: "1d", rotulo: "1D" },
  { id: "5d", rotulo: "5D" },
  { id: "1m", rotulo: "1M" },
  { id: "6m", rotulo: "6M" },
  { id: "ytd", rotulo: "No ano" },
  { id: "1a", rotulo: "1A" },
  { id: "5a", rotulo: "5A" },
  { id: "max", rotulo: "Máx" },
] as const;
type Periodo = (typeof PERIODOS)[number]["id"];

const COR_ALTA = "#22c55e";
const COR_BAIXA = "#f05252";
const COR_TETO = "#d95926";
const COR_PM = "#6da7ec";

function rotuloData(t: number, periodo: Periodo, longo = false) {
  const d = new Date(t);
  if (periodo === "1d") return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (periodo === "5d")
    return longo
      ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (longo) return d.toLocaleDateString("pt-BR", periodo === "max" ? { month: "short", year: "numeric" } : undefined);
  if (periodo === "5a" || periodo === "max") return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * Gráfico de cotação no estilo das plataformas de mercado: área colorida pela variação do período,
 * botões de período, régua com dica ao passar o mouse (ou o dedo) e linhas do preço teto e do seu preço médio.
 */
export function GraficoCotacao({
  ticker,
  tipo,
  moeda,
  teto,
  precoMedio,
}: {
  ticker: string;
  tipo: string;
  moeda: string;
  teto: number | null;
  precoMedio: number | null;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
  const [dados, setDados] = useState<Record<string, Cotacao>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [verTeto, setVerTeto] = useState(true);
  const [verPm, setVerPm] = useState(true);
  const [foco, setFoco] = useState<number | null>(null);

  const caixa = useRef<HTMLDivElement>(null);
  const [L, setL] = useState(720);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setL(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (dados[periodo]) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    fetch(`/api/cotacao/${encodeURIComponent(ticker)}?tipo=${tipo}&periodo=${periodo}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.erro ?? "Cotação indisponível agora");
        if (vivo) setDados((d) => ({ ...d, [periodo]: j }));
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Cotação indisponível agora"))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [periodo, ticker, tipo, dados]);

  const atual = dados[periodo];
  const pontos = atual?.pontos ?? [];
  const moedaGrafico = atual?.moeda ?? moeda;
  // Teto e preço médio só fazem sentido se o gráfico estiver na mesma moeda da análise
  const mesmaMoeda = moedaGrafico === moeda;
  const tetoLinha = verTeto && mesmaMoeda && teto != null && teto > 0 ? teto : null;
  const pmLinha = verPm && mesmaMoeda && precoMedio != null && precoMedio > 0 ? precoMedio : null;

  const base = periodo === "1d" && atual?.anterior ? atual.anterior : pontos[0]?.c ?? null;
  const ultimo = pontos[pontos.length - 1]?.c ?? null;
  const variacao = base && ultimo ? ultimo / base - 1 : null;
  const cor = (variacao ?? 0) >= 0 ? COR_ALTA : COR_BAIXA;

  const A = 300;
  const m = { t: 16, r: 64, b: 26, l: 8 };
  const escala = useMemo(() => {
    if (pontos.length < 2) return null;
    const vals = pontos.map((p) => p.c);
    let min = Math.min(...vals), max = Math.max(...vals);
    // Só estica a escala para o teto/PM se eles estiverem perto (senão a linha do preço vira um traço)
    for (const ref of [tetoLinha, pmLinha, periodo === "1d" ? base : null]) {
      if (ref != null && ref > min * 0.8 && ref < max * 1.25) {
        min = Math.min(min, ref);
        max = Math.max(max, ref);
      }
    }
    const folga = (max - min) * 0.08 || max * 0.02;
    return { min: min - folga, max: max + folga };
  }, [pontos, tetoLinha, pmLinha, base, periodo]);

  const x = (i: number) => m.l + (i / Math.max(1, pontos.length - 1)) * (L - m.l - m.r);
  const y = (v: number) => (escala ? m.t + (1 - (v - escala.min) / (escala.max - escala.min)) * (A - m.t - m.b) : 0);
  const dentro = (v: number | null) => v != null && escala != null && v >= escala.min && v <= escala.max;
  const f = foco != null ? pontos[foco] : null;

  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const area = pontos.length ? `${caminho}L${x(pontos.length - 1).toFixed(1)},${A - m.b}L${x(0).toFixed(1)},${A - m.b}Z` : "";
  // Rótulos do eixo que ficariam embaixo das etiquetas (teto, preço médio, último preço) são escondidos
  const ocupados = [tetoLinha, pmLinha, f ? f.c : ultimo].filter((v): v is number => dentro(v)).map(y);
  const marcasY = escala
    ? Array.from({ length: 5 }, (_, i) => escala.min + ((escala.max - escala.min) * (i + 0.5)) / 5).filter((v) => ocupados.every((o) => Math.abs(o - y(v)) > 14))
    : [];
  // Teto ou preço médio fora da escala: aviso na borda do gráfico, com a distância
  const foraDaEscala = ultimo
    ? [
        { v: tetoLinha, nome: "Teto", cor: COR_TETO },
        { v: pmLinha, nome: "Preço médio", cor: COR_PM },
      ].filter((r): r is { v: number; nome: string; cor: string } => r.v != null && !dentro(r.v))
    : [];
  const nMarcasX = Math.max(2, Math.floor((L - m.l - m.r) / 110));
  const marcasX = pontos.length > 1 ? Array.from({ length: nMarcasX }, (_, i) => Math.round((i * (pontos.length - 1)) / (nMarcasX - 1))) : [];

  const minimo = pontos.length ? Math.min(...pontos.map((p) => p.c)) : null;
  const maximo = pontos.length ? Math.max(...pontos.map((p) => p.c)) : null;
  const gradId = `grad-${ticker}`;

  function mover(clientX: number, r: DOMRect) {
    const px = ((clientX - r.left) / r.width) * L;
    const i = Math.round(((px - m.l) / (L - m.l - m.r)) * (pontos.length - 1));
    setFoco(Math.max(0, Math.min(pontos.length - 1, i)));
  }

  const etiqueta = (v: number, fundo: string, texto = "#0a0e14") => (
    <g>
      <rect x={L - m.r + 4} y={y(v) - 9} width={m.r - 6} height={18} rx={4} fill={fundo} />
      <text x={L - m.r + 4 + (m.r - 6) / 2} y={y(v) + 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={texto}>
        {v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </text>
    </g>
  );

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="tabular-nums">
          <p className="text-2xl font-semibold tracking-tight">{dinheiro(f?.c ?? ultimo, moedaGrafico)}</p>
          <p className="text-sm">
            {f && base ? (
              <>
                <span className={f.c >= base ? "text-alta" : "text-baixa"}>{pctSinal(f.c / base - 1, 2)}</span>{" "}
                <span className="text-xs text-fraco">em {rotuloData(f.t, periodo, true)}</span>
              </>
            ) : variacao != null ? (
              <>
                <span className={variacao >= 0 ? "text-alta" : "text-baixa"}>
                  {variacao >= 0 ? "▲" : "▼"} {pctSinal(variacao, 2)} ({dinheiro(ultimo! - base!, moedaGrafico)})
                </span>{" "}
                <span className="text-xs text-fraco">{PERIODOS.find((p) => p.id === periodo)?.rotulo === "1D" ? "hoje" : "no período"}</span>
              </>
            ) : (
              <span className="text-xs text-fraco">&nbsp;</span>
            )}
          </p>
        </div>
        <div className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-painel2 p-1" role="tablist" aria-label="Período do gráfico">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={periodo === p.id}
              onClick={() => {
                setPeriodo(p.id);
                setFoco(null);
              }}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                periodo === p.id ? "bg-fundo text-texto shadow ring-1 ring-borda" : "text-suave hover:text-texto"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {teto != null && teto > 0 && mesmaMoeda && (
          <button onClick={() => setVerTeto((v) => !v)} className={`chip flex items-center gap-1.5 ${verTeto ? "chip-ativo" : ""}`}>
            <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: COR_TETO }} />
            Preço teto {dinheiro(teto, moeda)}
          </button>
        )}
        {precoMedio != null && precoMedio > 0 && mesmaMoeda && (
          <button onClick={() => setVerPm((v) => !v)} className={`chip flex items-center gap-1.5 ${verPm ? "chip-ativo" : ""}`}>
            <span className="h-0 w-3 border-t-2 border-dotted" style={{ borderColor: COR_PM }} />
            Meu preço médio {dinheiro(precoMedio, moeda)}
          </button>
        )}
      </div>

      <div ref={caixa} className="relative mt-2" style={{ height: A }}>
        {pontos.length > 1 && escala ? (
          <svg
            viewBox={`0 0 ${L} ${A}`}
            className={`block w-full touch-pan-y select-none transition-opacity ${carregando ? "opacity-40" : ""}`}
            style={{ height: A }}
            onMouseLeave={() => setFoco(null)}
            onMouseMove={(e) => mover(e.clientX, e.currentTarget.getBoundingClientRect())}
            onTouchMove={(e) => mover(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
            onTouchEnd={() => setFoco(null)}
            role="img"
            aria-label={`Cotação de ${ticker}`}
          >
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={cor} stopOpacity="0.28" />
                <stop offset="100%" stopColor={cor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {marcasY.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={L - m.r} y1={y(v)} y2={y(v)} stroke="#222c38" strokeDasharray="2 4" />
                <text x={L - m.r + 8} y={y(v) + 3} className="fill-[#66727f] text-[10px] tabular-nums">
                  {v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </text>
              </g>
            ))}
            {marcasX.map((i, k) => (
              <text
                key={i}
                x={x(i)}
                y={A - 8}
                textAnchor={k === 0 ? "start" : k === marcasX.length - 1 ? "end" : "middle"}
                className="fill-[#66727f] text-[10px]"
              >
                {rotuloData(pontos[i].t, periodo)}
              </text>
            ))}
            {periodo === "1d" && dentro(base) && (
              <line x1={m.l} x2={L - m.r} y1={y(base!)} y2={y(base!)} stroke="#66727f" strokeDasharray="1 3" />
            )}
            <path d={area} fill={`url(#${gradId})`} />
            <path d={caminho} fill="none" stroke={cor} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            {dentro(tetoLinha) && (
              <>
                <line x1={m.l} x2={L - m.r} y1={y(tetoLinha!)} y2={y(tetoLinha!)} stroke={COR_TETO} strokeWidth="1.5" strokeDasharray="6 4" />
                {etiqueta(tetoLinha!, COR_TETO, "#fff")}
              </>
            )}
            {dentro(pmLinha) && (
              <>
                <line x1={m.l} x2={L - m.r} y1={y(pmLinha!)} y2={y(pmLinha!)} stroke={COR_PM} strokeWidth="1.5" strokeDasharray="2 3" />
                {etiqueta(pmLinha!, COR_PM)}
              </>
            )}
            {ultimo != null && !f && (
              <>
                {etiqueta(ultimo, cor)}
                <circle cx={x(pontos.length - 1)} cy={y(ultimo)} r="3.5" fill={cor} />
              </>
            )}
            {f && (
              <g>
                <line x1={x(foco!)} x2={x(foco!)} y1={m.t} y2={A - m.b} stroke="#9aa6b2" strokeDasharray="3 3" />
                <line x1={m.l} x2={L - m.r} y1={y(f.c)} y2={y(f.c)} stroke="#9aa6b2" strokeDasharray="3 3" />
                <circle cx={x(foco!)} cy={y(f.c)} r="5" fill={cor} stroke="#10161e" strokeWidth="2" />
                {etiqueta(f.c, "#e6edf3")}
              </g>
            )}
          </svg>
        ) : (
          <div className="grid h-full place-items-center rounded-lg bg-painel2/40">
            {carregando || (!atual && !erro) ? (
              <div className="h-full w-full animate-pulse rounded-lg bg-painel2/60" />
            ) : (
              <p className="px-6 text-center text-sm text-suave">{erro ?? "Sem cotações para este período."}</p>
            )}
          </div>
        )}
        {foraDaEscala.map((r, k) => {
          const acima = r.v > (escala?.max ?? 0);
          return (
            <span
              key={r.nome}
              className="pointer-events-none absolute left-2 rounded-md border bg-fundo/90 px-2 py-0.5 text-[11px] font-medium tabular-nums"
              style={{ borderColor: r.cor, color: r.cor, ...(acima ? { top: 4 + k * 24 } : { bottom: m.b + 4 + k * 24 }) }}
            >
              {acima ? "↑" : "↓"} {r.nome} {dinheiro(r.v, moeda)} ({pctSinal(r.v / ultimo! - 1)})
            </span>
          );
        })}
        {f && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-borda bg-fundo/95 px-3 py-2 text-xs shadow-xl tabular-nums"
            style={x(foco!) > L / 2 ? { right: L - x(foco!) + 12 } : { left: x(foco!) + 12 }}
          >
            <p className="text-fraco">{rotuloData(f.t, periodo, true)}</p>
            <p className="font-semibold">{dinheiro(f.c, moedaGrafico)}</p>
            {tetoLinha != null && (
              <p className="text-suave">
                Até o teto <b className={tetoLinha >= f.c ? "text-alta" : "text-baixa"}>{pctSinal(tetoLinha / f.c - 1)}</b>
              </p>
            )}
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-borda pt-4 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-fraco">Mínima do período</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{dinheiro(minimo, moedaGrafico)}</dd>
        </div>
        <div>
          <dt className="text-fraco">Máxima do período</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{dinheiro(maximo, moedaGrafico)}</dd>
        </div>
        <Faixa52 min={atual?.minimo52s ?? null} max={atual?.maximo52s ?? null} preco={atual?.preco ?? ultimo} moeda={moedaGrafico} />
      </dl>
      {!mesmaMoeda && atual && (
        <p className="mt-3 text-[11px] text-fraco">
          Cotação em {moedaGrafico} na fonte; o preço teto da análise está em {moeda}, por isso a linha do teto não aparece.
        </p>
      )}
      <p className="mt-3 text-[11px] text-fraco">Fonte: Yahoo Finance (pode ter atraso de até 15 minutos).</p>
    </div>
  );
}

/** Onde o preço de hoje está entre a mínima e a máxima de 52 semanas. */
function Faixa52({ min, max, preco, moeda }: { min: number | null; max: number | null; preco: number | null; moeda: string }) {
  if (min == null || max == null || max <= min) return null;
  const pos = preco != null ? Math.max(0, Math.min(100, ((preco - min) / (max - min)) * 100)) : null;
  return (
    <div className="col-span-2">
      <dt className="text-fraco">Faixa de 52 semanas</dt>
      <dd className="mt-1.5">
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-baixa/60 via-amber-300/60 to-alta/60">
          {pos != null && (
            <span className="absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded bg-texto ring-2 ring-painel" style={{ left: `${pos}%` }} />
          )}
        </div>
        <div className="mt-1 flex justify-between font-semibold tabular-nums">
          <span>{dinheiro(min, moeda)}</span>
          <span>{dinheiro(max, moeda)}</span>
        </div>
      </dd>
    </div>
  );
}
