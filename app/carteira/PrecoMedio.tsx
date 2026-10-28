"use client";
// Preço médio editável na própria tabela.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { editarPrecoMedio } from "./actions";

export function PrecoMedio({ ticker, preco, moeda }: { ticker: string; preco: number; moeda: "BRL" | "USD" }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const inicial = preco.toFixed(4).replace(/0{1,2}$/, "").replace(".", ",");
  const [texto, setTexto] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, startTransition] = useTransition();
  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: moeda });

  const salvar = () => {
    const t = texto.trim();
    if (t === inicial) return setEditando(false); // nada mudou: mantém o valor exato
    const valor = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    startTransition(async () => {
      const r = await editarPrecoMedio(ticker, valor);
      if (!r.ok) return setErro(r.mensagem);
      setErro(null);
      setEditando(false);
      router.refresh();
    });
  };

  if (!editando) {
    return (
      <button
        onClick={() => setEditando(true)}
        title="Clique para corrigir o preço médio"
        className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 tabular-nums hover:bg-painel2"
      >
        {fmt(preco)}
        <span className="text-xs text-fraco group-hover:text-marca" aria-hidden>✎</span>
      </button>
    );
  }
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <span className="text-xs text-fraco">{moeda === "USD" ? "US$" : "R$"}</span>
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") setEditando(false);
          }}
          inputMode="decimal"
          aria-label={`Preço médio de ${ticker}`}
          className="w-20 rounded-md border border-borda bg-fundo px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-marca"
        />
        <button onClick={salvar} disabled={salvando} className="rounded-md px-1.5 py-1 text-xs font-semibold text-marca hover:bg-marca/10" aria-label="Salvar">
          {salvando ? "…" : "✓"}
        </button>
        <button onClick={() => { setEditando(false); setErro(null); }} className="rounded-md px-1.5 py-1 text-xs text-suave hover:bg-painel2" aria-label="Cancelar">
          ✕
        </button>
      </div>
      {erro && <span className="max-w-48 text-[11px] text-baixa">{erro}</span>}
    </div>
  );
}
