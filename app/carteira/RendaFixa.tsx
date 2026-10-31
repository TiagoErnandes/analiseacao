"use client";
// Cadastro de renda fixa e outros bens sem cotação (CDB, Tesouro, caixa, imóvel, negócio próprio).
import { useRef, useState, useTransition } from "react";
import { salvarRendaFixa } from "./actions";

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export function FormRendaFixa() {
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, iniciar] = useTransition();
  return (
    <form
      ref={form}
      action={(dados) =>
        iniciar(async () => {
          const r = await salvarRendaFixa(dados);
          setMsg({ ok: r.ok, texto: r.mensagem });
          if (r.ok) form.current?.reset();
        })
      }
      className="flex flex-wrap items-end gap-3 p-4"
    >
      <label className="flex flex-col gap-1">
        <span className="rotulo">Nome</span>
        <input name="nome" placeholder="CDB INTER" required list="sugestoes-rf" className="campo w-44 uppercase" />
        <datalist id="sugestoes-rf">
          {["CDB INTER", "TESOURO SELIC", "LCI", "CAIXA", "NEGOCIO PROPRIO"].map((s) => <option key={s} value={s} />)}
        </datalist>
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Valor aplicado (R$)</span>
        <input name="valor" inputMode="decimal" placeholder="1.500,00" required className="campo w-32" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Rende (% do CDI)</span>
        <input name="taxa" inputMode="decimal" defaultValue="100" className="campo w-24" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="rotulo">Desde</span>
        <input name="data" type="date" defaultValue={hoje()} max={hoje()} required className="campo" />
      </label>
      <button className="botao" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      <p className="w-full text-xs text-fraco">
        O valor cresce pelo CDI do Banco Central desde a data informada (ex.: CDB a 100% do CDI). Use 0% para bens que não rendem juros, como
        caixa parado, imóvel ou negócio próprio. Salvar de novo com o mesmo nome substitui o valor.
      </p>
      {msg && <p className={`w-full text-sm ${msg.ok ? "text-alta" : "text-baixa"}`}>{msg.texto}</p>}
    </form>
  );
}
