"use client";
// Cadastro de renda fixa e outros bens sem cotação (caixinha, CDB, Tesouro, LCI, caixa, imóvel, negócio próprio).
import { useRef, useState, useTransition } from "react";
import { movimentarRendaFixa, salvarRendaFixa } from "./actions";
import { INDEXADORES, type Indexador } from "@/lib/rendafixaInfo";

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const SUGESTOES = [
  "CAIXINHA NUBANK", "CAIXINHA INTER", "CAIXINHA PICPAY", "CAIXINHA MERCADO PAGO", "CDB INTER", "CDB PRE 2027",
  "LCI INTER", "LCA BTG", "TESOURO SELIC", "TESOURO PREFIXADO", "TESOURO IPCA 2035", "CAIXA", "NEGOCIO PROPRIO",
];

export function FormRendaFixa() {
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [indexador, setIndexador] = useState<Indexador>("cdi");
  const [salvando, iniciar] = useTransition();
  const ix = INDEXADORES.find((i) => i.id === indexador)!;
  return (
    <form
      ref={form}
      action={(dados) =>
        iniciar(async () => {
          const r = await salvarRendaFixa(dados);
          setMsg({ ok: r.ok, texto: r.mensagem });
          if (r.ok) {
            form.current?.reset();
            setIndexador("cdi");
          }
        })
      }
      className="flex flex-wrap items-end gap-3 p-4"
    >
      <label className="flex flex-col gap-1">
        <span className="rotulo">Nome</span>
        <input name="nome" placeholder="CAIXINHA NUBANK" required list="sugestoes-rf" className="campo w-48 uppercase" />
        <datalist id="sugestoes-rf">
          {SUGESTOES.map((s) => <option key={s} value={s} />)}
        </datalist>
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Valor aplicado (R$)</span>
        <input name="valor" inputMode="decimal" placeholder="1.500,00" required className="campo w-32" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Como rende</span>
        <select name="indexador" value={indexador} onChange={(e) => setIndexador(e.target.value as Indexador)} className="campo">
          {INDEXADORES.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">{ix.rotuloTaxa}</span>
        <input key={indexador} name="taxa" inputMode="decimal" defaultValue={ix.padrao} placeholder={ix.exemplo} className="campo w-28" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Aplicado em</span>
        <input name="data" type="date" defaultValue={hoje()} max={hoje()} required className="campo" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Vencimento (opcional)</span>
        <input name="vencimento" type="date" className="campo" />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm text-suave">
        <input name="isento" type="checkbox" className="h-4 w-4" />
        Isento de IR (LCI, LCA)
      </label>
      <button className="botao" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      <p className="w-full text-xs text-fraco">
        Caixinhas e CDB de liquidez diária costumam render 100% do CDI. O saldo é estimado com o CDI e o IPCA do Banco Central (prefixado por dia
        útil) e mostra também o líquido depois do IR. Use 0% do CDI para bens que não rendem juros, como caixa parado, imóvel ou negócio próprio.
        Para guardar ou tirar dinheiro depois, use “Aplicar / resgatar” na linha do ativo. Salvar de novo com o mesmo nome substitui tudo.
      </p>
      {msg && <p className={`w-full text-sm ${msg.ok ? "text-alta" : "text-baixa"}`}>{msg.texto}</p>}
    </form>
  );
}

/** Guardar mais ou tirar dinheiro de uma renda fixa já cadastrada. */
export function MovimentoRendaFixa({ nome, desde }: { nome: string; desde: string | null | undefined }) {
  const [aberto, setAberto] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();
  if (!aberto)
    return (
      <span className="inline-flex flex-col items-end">
        <button type="button" onClick={() => { setAberto(true); setMsg(null); }} className="rounded-md px-2 py-1 text-xs text-marca hover:bg-marca/10">
          Aplicar / resgatar
        </button>
        {msg?.ok && <span className="text-[11px] text-alta">{msg.texto}</span>}
      </span>
    );
  return (
    <form
      action={(dados) =>
        iniciar(async () => {
          const r = await movimentarRendaFixa(dados);
          setMsg({ ok: r.ok, texto: r.mensagem });
          if (r.ok) setAberto(false);
        })
      }
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      <input type="hidden" name="nome" value={nome} />
      <input name="valor" inputMode="decimal" placeholder="R$" required autoFocus className="campo w-24 !py-1 text-xs" />
      <input name="data" type="date" defaultValue={hoje()} min={desde ?? undefined} max={hoje()} className="campo !py-1 text-xs" />
      <button name="operacao" value="aplicar" disabled={enviando} className="rounded-md px-2 py-1 text-xs text-alta hover:bg-alta/10">Aplicar</button>
      <button name="operacao" value="resgatar" disabled={enviando} className="rounded-md px-2 py-1 text-xs text-baixa hover:bg-baixa/10">Resgatar</button>
      <button type="button" onClick={() => setAberto(false)} className="px-1 text-xs text-fraco">✕</button>
      {msg && !msg.ok && <p className="w-full text-right text-xs text-baixa">{msg.texto}</p>}
    </form>
  );
}
