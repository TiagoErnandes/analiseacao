"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cotacaoUsdt, registrarOperacao } from "./carteira/actions";
import { TIPOS_MERCADO as TIPOS, infoTipo, type Tipo } from "@/lib/tipos";

export type PosicaoLancamento = { ticker: string; tipo: Tipo | null; quantidade: number; preco_medio: number; preco: number | null };

const paraNumero = (t: string) => {
  const limpo = t.trim().replace(/\s/g, "");
  // Aceita "1.234,56" e "1234.56"
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
};
const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
type Moeda = "BRL" | "USD" | "USDT";
const dinheiro = (v: number, moeda: Moeda) =>
  moeda === "USDT"
    ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
    : v.toLocaleString("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantidade = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 8 });

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

function ComMoeda({ moeda, children }: { moeda: Moeda; children: React.ReactNode }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-borda bg-fundo focus-within:border-marca">
      <span className="grid place-items-center border-r border-borda bg-painel2 px-3 text-xs font-semibold text-suave">{moeda === "USD" ? "US$" : moeda === "USDT" ? "USDT" : "R$"}</span>
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
  const [qtd, setQtd] = useState(tipoInicial === "cripto" ? "" : "1");
  const [preco, setPreco] = useState("");
  const [custos, setCustos] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);
  // Cripto: pago em reais ou em USDT, e informado pelo valor total (como aparece no histórico da Binance)
  const [pagoEm, setPagoEm] = useState<"BRL" | "USDT">("BRL");
  const [porTotal, setPorTotal] = useState(tipoInicial === "cripto");
  const [usdt, setUsdt] = useState("");

  const info = infoTipo(tipo)!;
  const ehCripto = tipo === "cripto";
  const emUsdt = ehCripto && pagoEm === "USDT";
  const moedaDigitada: Moeda = emUsdt ? "USDT" : info.moeda;
  const codigo = ticker.trim().toUpperCase();
  const pos = posicoes.find((p) => p.ticker === codigo);
  const q = paraNumero(qtd);
  const valorDigitado = paraNumero(preco);
  // Preço por unidade na moeda digitada (R$, US$ ou USDT)
  const p = ehCripto && porTotal ? (q > 0 && valorDigitado > 0 ? valorDigitado / q : NaN) : valorDigitado;
  const c = custos.trim() ? paraNumero(custos) : 0;
  const taxa = emUsdt ? paraNumero(usdt) : 1; // reais por USDT
  const total = (q > 0 ? q : 0) * (p > 0 ? p : 0) + (operacao === "C" ? 1 : -1) * (c > 0 ? c : 0);
  const codigoOk = info.formato.test(codigo);
  const valido = codigoOk && q > 0 && p > 0 && c >= 0 && taxa > 0 && (operacao === "C" || q <= (pos?.quantidade ?? 0));
  const qA = pos?.quantidade ?? 0;
  const pmA = pos?.preco_medio ?? 0;
  // A carteira guarda cripto em reais: com USDT, converte pela cotação informada
  const pR = p * taxa;
  const cR = c * taxa;
  const pmDepois = operacao === "C" && valido ? (qA * pmA + q * pR + cR) / (qA + q) : null;

  // Pago em USDT: busca a cotação de agora na Binance (dá para corrigir com a do dia da compra)
  useEffect(() => {
    if (!emUsdt || usdt) return;
    cotacaoUsdt().then((v) => v && setUsdt(v.toFixed(4).replace(".", ",")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emUsdt]);

  // Sugestões: o que você já tem desse tipo + os mais negociados
  const meus = posicoes.filter((x) => (x.tipo ?? "acao") === tipo || (tipo === "acao" && !x.tipo)).map((x) => x.ticker);
  const sugestoes = [...new Set([...meus, ...(operacao === "C" ? info.sugestoes : [])])];

  // Ao escolher um ativo que já tem cotação, sugere o preço atual
  useEffect(() => {
    if (pos?.preco && !preco && !(ehCripto && (porTotal || emUsdt))) setPreco(pos.preco.toFixed(2).replace(".", ","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await registrarOperacao({
        ticker: codigo, tipoAtivo: tipo, tipo: operacao, quantidade: q, preco: p, custos: c, data,
        ...(emUsdt ? { moedaPaga: "USDT" as const, cotacaoUsdt: taxa } : {}),
      });
      setMsg({ ok: r.ok, txt: r.mensagem });
      if (r.ok) {
        setTicker("");
        setQtd(ehCripto ? "" : "1");
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
          <select
            value={tipo}
            onChange={(e) => {
              const novo = e.target.value as Tipo;
              setTipo(novo);
              setTicker("");
              // Cripto se compra em frações (0,0005 BTC) e pelo valor total; o resto por unidade
              setQtd(novo === "cripto" ? "" : "1");
              setPorTotal(novo === "cripto");
              setPagoEm("BRL");
            }}
            className="campo"
          >
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
        {ehCripto && (
          <>
            <Campo rotulo={operacao === "C" ? "Pago em" : "Recebido em"}>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-painel2 p-1 text-xs font-semibold">
                {(["BRL", "USDT"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPagoEm(m)}
                    className={`rounded-md py-1.5 transition ${pagoEm === m ? "bg-borda text-texto" : "text-suave hover:text-texto"}`}
                  >
                    {m === "BRL" ? "Reais (R$)" : "USDT"}
                  </button>
                ))}
              </div>
            </Campo>
            <Campo rotulo="Informar">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-painel2 p-1 text-xs font-semibold">
                {([true, false] as const).map((t) => (
                  <button
                    key={String(t)}
                    type="button"
                    onClick={() => { setPorTotal(t); setPreco(""); }}
                    className={`rounded-md py-1.5 transition ${porTotal === t ? "bg-borda text-texto" : "text-suave hover:text-texto"}`}
                  >
                    {t ? "Valor total" : "Preço unitário"}
                  </button>
                ))}
              </div>
            </Campo>
          </>
        )}
        <Campo rotulo="Quantidade" extra={ehCripto ? "ex.: 0,00052" : undefined}>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" placeholder={ehCripto ? "0,00000000" : undefined} required className="campo" />
        </Campo>
        <Campo
          rotulo={ehCripto && porTotal ? (operacao === "C" ? "Valor total pago" : "Valor total recebido") : operacao === "C" ? "Preço de compra" : "Preço de venda"}
          extra={ehCripto && porTotal ? "sem as taxas" : "por unidade"}
        >
          <ComMoeda moeda={moedaDigitada}>
            <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="0,00" required className="w-full min-w-0 bg-transparent px-3 py-2 text-sm tabular-nums outline-none" />
          </ComMoeda>
        </Campo>
        {emUsdt && (
          <Campo rotulo="Cotação do USDT" extra="R$ por 1 USDT">
            <ComMoeda moeda="BRL">
              <input value={usdt} onChange={(e) => setUsdt(e.target.value)} inputMode="decimal" placeholder="5,40" required className="w-full min-w-0 bg-transparent px-3 py-2 text-sm tabular-nums outline-none" />
            </ComMoeda>
          </Campo>
        )}
        <Campo rotulo="Outros custos" extra={ehCripto ? "taxa da corretora (opcional)" : "(Opcional)"}>
          <ComMoeda moeda={moedaDigitada}>
            <input value={custos} onChange={(e) => setCustos(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-full min-w-0 bg-transparent px-3 py-2 text-sm tabular-nums outline-none" />
          </ComMoeda>
        </Campo>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-painel2 px-4 py-3">
        <span className="text-sm text-suave">Valor total</span>
        <span className="text-right">
          <span className="block text-lg font-semibold tabular-nums">{dinheiro(total, moedaDigitada)}</span>
          {emUsdt && taxa > 0 && <span className="block text-xs text-suave tabular-nums">≈ {dinheiro(total * taxa, "BRL")}</span>}
          {ehCripto && porTotal && p > 0 && <span className="block text-xs text-suave tabular-nums">preço por moeda: {dinheiro(p, moedaDigitada)}</span>}
        </span>
      </div>

      {codigoOk && (
        <p className="text-xs text-suave tabular-nums">
          {pos ? <>Hoje: {quantidade(pos.quantidade)} × {dinheiro(pmA, info.moeda)}. </> : <>{codigo} ainda não está na carteira. </>}
          {pmDepois != null && <>Depois: <b className="text-texto">{quantidade(qA + q)} × {dinheiro(pmDepois, info.moeda)}</b> (preço médio com custos{emUsdt ? ", em reais" : ""}).</>}
          {operacao === "V" && q > qA && <span className="text-baixa">Você tem só {quantidade(qA)} para vender.</span>}
          {operacao === "V" && valido && (
            <>Resultado: <b className={pR * q - cR >= pmA * q ? "text-alta" : "text-baixa"}>{dinheiro(pR * q - cR - pmA * q, info.moeda)}</b> sobre o preço médio.</>
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
