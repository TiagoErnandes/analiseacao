"use client";

import { useEffect, useState } from "react";
import { pctSinal } from "@/lib/format";

type Indice = { nome: string; tipo: "pontos" | "brl"; valor: number; variacao: number | null };

/** Faixa fina com Ibovespa, dólar, S&P 500 e outros, como nas plataformas de mercado. Atualiza a cada 5 minutos. */
export function FaixaIndices() {
  const [indices, setIndices] = useState<Indice[]>([]);
  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      fetch("/api/indices")
        .then((r) => r.json())
        .then((l) => vivo && Array.isArray(l) && setIndices(l))
        .catch(() => {});
    buscar();
    const t = setInterval(buscar, 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);
  if (!indices.length) return null;
  return (
    <div className="border-b border-borda bg-painel/60">
      <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-1.5 text-xs [scrollbar-width:none]">
        {indices.map((i) => (
          <span key={i.nome} className="flex shrink-0 items-center gap-2 tabular-nums">
            <span className="text-fraco">{i.nome}</span>
            <span className="font-medium">
              {i.tipo === "brl"
                ? i.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: i.valor >= 1000 ? 0 : 2 })
                : i.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
            </span>
            {i.variacao != null && (
              <span className={i.variacao > 0 ? "text-alta" : i.variacao < 0 ? "text-baixa" : "text-suave"}>
                {i.variacao > 0 ? "▲" : i.variacao < 0 ? "▼" : ""} {pctSinal(i.variacao, 2)}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
