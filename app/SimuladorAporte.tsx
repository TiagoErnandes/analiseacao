"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { brl, pct } from "@/lib/format";
import { Logo } from "./Logo";

export type ItemAporte = {
  ticker: string;
  logo: string | null;
  preco: number | null;
  valor: number; // posição atual em R$
  margem: number | null;
  recomendacao: string | null;
  score: number | null;
  setor: string | null;
};

type Props = { itens: ItemAporte[]; pesoSetor: Record<string, number>; limiteSetor: number };

type Compra = { item: ItemAporte; qtd: number };

/**
 * Divide o aporte entre as ações da carteira que estão abaixo do preço teto, sem sinal de "Evitar"
 * e fora de setor concentrado, priorizando quem está mais longe do peso ideal e tem maior score.
 */
function calcular(valorAporte: number, { itens, pesoSetor, limiteSetor }: Props) {
  const patrimonio = itens.reduce((s, i) => s + i.valor, 0);
  const alvo = (patrimonio + valorAporte) / Math.max(1, itens.length);
  const elegiveis = itens
    .filter(
      (i) =>
        i.preco != null && i.preco > 0 && (i.margem ?? -1) > 0 && i.recomendacao !== "EVITAR" &&
        (pesoSetor[i.setor ?? ""] ?? 0) <= limiteSetor,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const compras = new Map<string, Compra>(elegiveis.map((i) => [i.ticker, { item: i, qtd: 0 }]));
  let resto = valorAporte;

  // 1) Completa o peso ideal de cada uma, na ordem do score
  for (const i of elegiveis) {
    const falta = Math.max(0, alvo - i.valor);
    const qtd = Math.floor(Math.min(falta, resto) / i.preco!);
    compras.get(i.ticker)!.qtd += qtd;
    resto -= qtd * i.preco!;
  }
  // 2) A sobra vai uma ação por vez, revezando, enquanto der para comprar
  let comprou = true;
  while (comprou) {
    comprou = false;
    for (const i of elegiveis) {
      if (resto >= i.preco!) {
        compras.get(i.ticker)!.qtd += 1;
        resto -= i.preco!;
        comprou = true;
      }
    }
  }
  const lista = [...compras.values()].filter((c) => c.qtd > 0);
  const novoTotal = patrimonio + valorAporte - resto;
  return { lista, resto, novoTotal, elegiveis: elegiveis.length };
}

const ATALHOS = [500, 1000, 2000, 5000];

export function SimuladorAporte(props: Props) {
  const [texto, setTexto] = useState("1000");
  const valor = Math.max(0, Number(texto.replace(/\./g, "").replace(",", ".")) || 0);
  const r = useMemo(() => calcular(valor, props), [valor, props]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="rotulo">Quanto vai aportar?</span>
          <div className="flex items-center rounded-lg border border-borda bg-fundo focus-within:border-marca">
            <span className="pl-3 text-sm text-fraco">R$</span>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              inputMode="decimal"
              className="w-32 bg-transparent px-2 py-2 text-sm tabular-nums outline-none"
            />
          </div>
        </label>
        <div className="flex flex-wrap gap-1.5 pb-1">
          {ATALHOS.map((v) => (
            <button key={v} onClick={() => setTexto(String(v))} className={`chip ${valor === v ? "chip-ativo" : ""}`}>
              {brl(v).replace(",00", "")}
            </button>
          ))}
        </div>
      </div>

      {r.elegiveis === 0 ? (
        <p className="rounded-lg bg-amber-400/5 p-3 text-sm text-amber-200/90">
          Hoje nenhuma ação da sua carteira está abaixo do preço teto com sinal favorável e fora de setor concentrado.
          Para previdência, vale guardar o aporte para o próximo mês ou olhar o{" "}
          <Link href="/ranking?filtro=comprar" className="underline">ranking</Link>.
        </p>
      ) : r.lista.length === 0 ? (
        <p className="text-sm text-suave">O valor não é suficiente para comprar 1 ação das indicadas hoje.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Comprar</th>
                <th className="!text-right">Qtd.</th>
                <th className="!text-right">Preço</th>
                <th className="!text-right">Total</th>
                <th className="!text-right">Peso depois</th>
              </tr>
            </thead>
            <tbody>
              {r.lista.map((c) => (
                <tr key={c.item.ticker}>
                  <td>
                    <Link href={`/acao/${c.item.ticker}`} className="flex items-center gap-2 font-medium hover:text-marca">
                      <Logo ticker={c.item.ticker} src={c.item.logo} tamanho={22} />
                      {c.item.ticker}
                    </Link>
                  </td>
                  <td className="text-right">{c.qtd}</td>
                  <td className="text-right">{brl(c.item.preco)}</td>
                  <td className="text-right font-medium">{brl(c.qtd * c.item.preco!)}</td>
                  <td className="text-right text-suave">{pct((c.item.valor + c.qtd * c.item.preco!) / r.novoTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-suave tabular-nums">
        <span>Usado: <b className="text-texto">{brl(valor - r.resto)}</b> · Sobra: {brl(r.resto)}</span>
        <span>Só entram ações abaixo do teto, sem “Evitar” e com setor até {pct(props.limiteSetor, 0)}.</span>
      </div>
    </div>
  );
}
