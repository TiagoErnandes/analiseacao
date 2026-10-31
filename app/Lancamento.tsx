"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { registrarOperacao } from "./carteira/actions";
import { TIPOS_MERCADO as TIPOS, infoTipo, type Tipo } from "@/lib/tipos";

export type PosicaoLancamento = { ticker: string; tipo: Tipo | null; quantidade: number; preco_medio: number; preco: number | null };

const paraNumero = (t: string) => {
  const limpo = t.trim().replace(/\s/g, "");
  // Aceita "1.234,56" e "1234.56"
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
};
const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dinheiro = (v: number, moeda: "BRL" | "USD") =>
  v.toLocaleString("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Campo({ rotulo, extra, children }: { rotulo: string; extra?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex justify-between text-xs text-suave">
        {rotulo}
        {extra && <span className="text-[11px] text-fraco">{extra}</span>}
      </span>
      {children}
    </label>
  );
}

function ComMoeda({ moeda, children }: { moeda: "BRL" | "USD"; children: React.ReactNode }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-borda bg-fundo focus-within:border-marca">
      <span className="grid place-items-center border-r border-borda bg-painel2 px-3 text-xs font-semibold text-suave">{moeda === "USD" ? "US$" : "R$"}</span>
      {children}
    </div>
  );
}

/** Formulário de lançamento (compra ou venda), no formato dos apps de carteira. */
export function FormLancamento({
  posicoes,
  tipoInicial = "acao",
  aoSalvar,
}: {
  posicoes: PosicaoLancamento[];
  tipoInicial?: Tipo;
  aoSalvar?: () => void;
}) {
  const router = useRouter();
  const [salvando, start] = useTransition();
  const [operacao, setOperacao] = useState<"C" | "V">("C");
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [ticker, setTicker] = useState("");
  const [data, setData] = useState(hojeSp);
  const [qtd, setQtd] = useState("1");
  const [preco, setPreco] = useState("");
  const [custos, setCustos] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  const info = infoTipo(tipo)!;
  const codigo = ticker.trim().toUpperCase();
  const pos = posicoes.find((p) => p.ticker === codigo);
  const q = paraNumero(qtd);
  const p = paraNumero(preco);
  const c = custos.trim() ? paraNumero(custos) : 0;
  const total = (q > 0 ? q : 0) * (p > 0 ? p : 0) + (operacao === "C" ? 1 : -1) * (c > 0 ? c : 0);
  const codigoOk = info.formato.test(codigo);
  const valido = codigoOk && q > 0 && p > 0 && c >= 0 && (operacao === "C" || q <= (pos?.quantidade ?? 0));
  const qA = pos?.quantidade ?? 0;
  const pmA = pos?.preco_medio ?? 0;
  const pmDepois = operacao === "C" && valido ? (qA * pmA + q * p + c) / (qA + q) : null;

  // Sugestões: o que você já tem desse tipo + os mais negociados
  const meus = posicoes.filter((x) => (x.tipo ?? "acao") === tipo || (tipo === "acao" && !x.tipo)).map((x) => x.ticker);
  const sugestoes = [...new Set([...meus, ...(operacao === "C" ? info.sugestoes : [])])];

  // Ao escolher um ativo que já tem cotação, sugere o preço atual
  useEffect(() => {
    if (pos?.preco && !preco) setPreco(pos.preco.toFixed(2).replace(".", ","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await registrarOperacao({ ticker: codigo, tipoAtivo: tipo, tipo: operacao, quantidade: q, preco: p, custos: c, data });
      setMsg({ ok: r.ok, txt: r.mensagem });
      if (r.ok) {
        setTicker("");
        setQtd("1");
        setPreco("");
        setCustos("");
        router.refresh();
        aoSalvar?.();
      }
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-5">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-painel2 p-1 text-sm font-semibold">
        {(["C", "V"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setOperacao(t)}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition ${operacao === t ? "bg-borda text-texto shadow" : "text-suave hover:text-texto"}`}
          >
            <span className={t === "C" ? "text-alta" : "text-baixa"}>{t === "C" ? "↗" : "↘"}</span>
            {t === "C" ? "Compra" : "Venda"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo de ativo">
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); setTicker(""); }} className="campo">
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Ativo">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            list="lancamento-ativos"
            placeholder={`Ex.: ${info.exemplo}`}
            required
            className={`campo uppercase ${codigo && !codigoOk ? "!border-baixa" : ""}`}
          />
          <datalist id="lancamento-ativos">{sugestoes.map((s) => <option key={s} value={s} />)}</datalist>
        </Campo>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} max={hojeSp()} required className="campo" />
        </Campo>
        <Campo rotulo="Quantidade">
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" required className="campo" />
        </Campo>
        <Campo rotulo={operacao === "C" ? "Preço de compra" : "Preço de venda"} extra="por unidade">
          <ComMoeda moeda={info.moeda}>
            <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="0,00" required className="w-full min-w-0 bg-transparent px-3 py-2 text-sm tabular-nums outline-none" />
          </ComMoeda>
        </Campo>
        <Campo rotulo="Outros custos" extra="(Opcional)">
          <ComMoeda moeda={info.moeda}>
            <input value={custos} onChange={(e) => setCustos(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-full min-w-0 bg-transparent px-3 py-2 text-sm tabular-nums outline-none" />
          </ComMoeda>
        </Campo>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-painel2 px-4 py-3">
        <span className="text-sm text-suave">Valor total</span>
        <span className="text-lg font-semibold tabular-nums">{dinheiro(total, info.moeda)}</span>
      </div>

      {codigoOk && (
        <p className="text-xs text-suave tabular-nums">
          {pos ? <>Hoje: {pos.quantidade} × {dinheiro(pmA, info.moeda)}. </> : <>{codigo} ainda não está na carteira. </>}
          {pmDepois != null && <>Depois: <b className="text-texto">{qA + q} × {dinheiro(pmDepois, info.moeda)}</b> (preço médio com custos).</>}
          {operacao === "V" && q > qA && <span className="text-baixa">Você tem só {qA} para vender.</span>}
          {operacao === "V" && valido && (
            <>Resultado: <b className={p * q - c >= pmA * q ? "text-alta" : "text-baixa"}>{dinheiro(p * q - c - pmA * q, info.moeda)}</b> sobre o preço médio.</>
          )}
        </p>
      )}

      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-alta/10 text-alta" : "bg-baixa/10 text-baixa"}`}>{msg.ok ? "✓ " : ""}{msg.txt}</p>}

      <div className="flex justify-end">
        <button className="botao" disabled={salvando || !valido}>
          <span className="text-base leading-none">+</span>
          {salvando ? "Salvando…" : "Adicionar lançamento"}
        </button>
      </div>
    </form>
  );
}

/** Botão que abre a janela "Adicionar lançamento". */
export function BotaoLancamento({
  posicoes,
  tipoInicial,
  variante = "primario",
}: {
  posicoes: PosicaoLancamento[];
  tipoInicial?: Tipo;
  variante?: "primario" | "contorno";
}) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className={variante === "primario" ? "botao" : "inline-flex items-center gap-2 rounded-lg border border-borda px-3 py-1.5 text-xs font-medium text-texto transition hover:border-suave"}
      >
        <span className="text-base leading-none">+</span> Adicionar lançamento
      </button>
      {aberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}>
          <div role="dialog" aria-modal="true" aria-label="Adicionar lançamento" className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-borda bg-painel shadow-2xl">
            <div className="flex items-center justify-between border-b border-borda px-5 py-4">
              <h2 className="text-lg font-semibold">Adicionar lançamento</h2>
              <button onClick={() => setAberto(false)} aria-label="Fechar" className="rounded-lg p-1 text-2xl leading-none text-suave hover:bg-painel2 hover:text-texto">×</button>
            </div>
            <div className="p-5">
              <FormLancamento posicoes={posicoes} tipoInicial={tipoInicial} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
