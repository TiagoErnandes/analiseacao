"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { brl, pctSinal } from "@/lib/format";
import { registrarOperacao } from "./actions";

type Atual = { ticker: string; quantidade: number; preco_medio: number; preco: number | null };

const paraNumero = (t: string) => Number(t.trim().replace(/\./g, "").replace(",", "."));
const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Registra uma compra (ou venda) e mostra, antes de salvar, como ficam a quantidade e o preço médio. */
export function RegistrarOperacao({ atual }: { atual: Atual[] }) {
  const router = useRouter();
  const [salvando, start] = useTransition();
  const [tipo, setTipo] = useState<"C" | "V">("C");
  const [ticker, setTicker] = useState("");
  const [qtd, setQtd] = useState("");
  const [preco, setPreco] = useState("");
  const [data, setData] = useState(hojeSp);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  const codigo = ticker.trim().toUpperCase();
  const pos = atual.find((a) => a.ticker === codigo);
  const q = paraNumero(qtd);
  const p = paraNumero(preco);
  const valido = /^[A-Z]{4}\d{1,2}$/.test(codigo) && q > 0 && p > 0;
  const qAtual = pos?.quantidade ?? 0;
  const pmAtual = pos?.preco_medio ?? 0;
  const depois =
    valido && tipo === "C"
      ? { qtd: qAtual + q, pm: (qAtual * pmAtual + q * p) / (qAtual + q) }
      : valido && tipo === "V"
        ? { qtd: qAtual - q, pm: pmAtual }
        : null;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await registrarOperacao({ ticker: codigo, tipo, quantidade: q, preco: p, data });
      setMsg({ ok: r.ok, txt: r.mensagem });
      if (r.ok) {
        setQtd("");
        setPreco("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-4 p-4">
      <div className="inline-flex rounded-lg border border-borda p-0.5 text-sm">
        {(["C", "V"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`rounded-md px-4 py-1.5 transition ${tipo === t ? (t === "C" ? "bg-alta/15 text-alta" : "bg-baixa/15 text-baixa") : "text-suave hover:text-texto"}`}
          >
            {t === "C" ? "Compra" : "Venda"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="rotulo">Código</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="PETR4" list="meus-ativos" required className="campo w-28 uppercase" />
          <datalist id="meus-ativos">{atual.map((a) => <option key={a.ticker} value={a.ticker} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="rotulo">Quantidade</span>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" placeholder="10" required className="campo w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="rotulo">Preço pago (R$ por unidade)</span>
          <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={pos?.preco ? pos.preco.toFixed(2).replace(".", ",") : "25,40"} required className="campo w-36" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="rotulo">Data</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} max={hojeSp()} required className="campo w-40" />
        </label>
        <button className="botao" disabled={salvando || !valido || (tipo === "V" && q > qAtual)}>
          {salvando ? "Salvando…" : tipo === "C" ? "Registrar compra" : "Registrar venda"}
        </button>
      </div>

      {valido && (
        <div className="grid gap-2 rounded-lg bg-painel2 p-3 text-sm tabular-nums sm:grid-cols-3">
          <p>
            <span className="text-suave">Hoje: </span>
            {pos ? `${qAtual} × ${brl(pmAtual)}` : "não está na carteira"}
          </p>
          {tipo === "V" && q > qAtual ? (
            <p className="text-baixa sm:col-span-2">Você tem só {qAtual} para vender.</p>
          ) : (
            depois && (
              <>
                <p>
                  <span className="text-suave">Depois: </span>
                  <b>{depois.qtd} × {brl(depois.pm)}</b> <span className="text-xs text-fraco">(preço médio)</span>
                </p>
                <p>
                  <span className="text-suave">{tipo === "C" ? "Total da compra: " : "Resultado da venda: "}</span>
                  {tipo === "C" ? (
                    <b>{brl(q * p)}</b>
                  ) : (
                    <b className={p >= pmAtual ? "text-alta" : "text-baixa"}>
                      {brl((p - pmAtual) * q)} ({pctSinal(pmAtual ? p / pmAtual - 1 : null)})
                    </b>
                  )}
                </p>
              </>
            )
          )}
        </div>
      )}

      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-alta/10 text-alta" : "bg-baixa/10 text-baixa"}`}>{msg.ok ? "✓ " : ""}{msg.txt}</p>}
    </form>
  );
}
