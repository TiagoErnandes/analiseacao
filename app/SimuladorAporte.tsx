"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { brl, pct } from "@/lib/format";
import { Logo } from "./Logo";
import type { Estrategia } from "@/lib/modos";

export type ItemAporte = {
  ticker: string;
  logo: string | null;
  preco: number | null;
  valor: number; // posição atual em R$
  margem: number | null;
  recomendacao: string | null;
  score: number | null;
  setor: string | null;
  nova?: boolean; // oportunidade fora da carteira
};

type Props = {
  itens: ItemAporte[];
  novas?: ItemAporte[];
  pesoSetor: Record<string, number>;
  limiteSetor: number;
  estrategia?: Estrategia; // padrão: balanceamento
};

type Compra = { item: ItemAporte; qtd: number };

/**
 * Divide o aporte entre as ações (da carteira e, se pedido, as melhores oportunidades fora dela) que estão abaixo do preço teto, sem sinal de "Evitar"
 * e fora de setor concentrado.
 * Balanceamento: prioriza quem está mais longe do peso ideal e tem maior score.
 * Oportunidade: concentra o aporte nas de maior score, da carteira ou não, sem olhar o peso ideal.
 */
function calcular(valorAporte: number, { itens, pesoSetor, limiteSetor, estrategia }: Omit<Props, "novas">) {
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

  if (estrategia === "oportunidade") {
    // As melhores (maior score) dividem o aporte em partes iguais
    const top = elegiveis.slice(0, TOP_OPORTUNIDADE);
    for (const i of top) {
      const qtd = Math.floor(Math.min(valorAporte / top.length, resto) / i.preco!);
      compras.get(i.ticker)!.qtd += qtd;
      resto -= qtd * i.preco!;
    }
  } else {
    // 0) Oportunidades fora da carteira ficam com até 30% do aporte (senão as da carteira, abaixo do peso ideal, levariam tudo)
    const novas = elegiveis.filter((i) => i.nova);
    const cotaNovas = novas.length ? valorAporte * COTA_NOVAS : 0;
    for (const i of novas) {
      const parte = cotaNovas / novas.length;
      const qtd = Math.floor(Math.min(parte, alvo, resto) / i.preco!);
      compras.get(i.ticker)!.qtd += qtd;
      resto -= qtd * i.preco!;
    }
    // 1) Completa o peso ideal de cada uma da carteira, na ordem do score
    for (const i of elegiveis.filter((e) => !e.nova)) {
      const falta = Math.max(0, alvo - i.valor - compras.get(i.ticker)!.qtd * i.preco!);
      const qtd = Math.floor(Math.min(falta, resto) / i.preco!);
      compras.get(i.ticker)!.qtd += qtd;
      resto -= qtd * i.preco!;
    }
  }
  // 2) A sobra vai uma ação por vez, revezando (as melhores primeiro), enquanto der para comprar.
  // Na Oportunidade a sobra fica só entre as escolhidas (senão uma ação de fora entra com 1 unidade de troco).
  const recebemSobra = estrategia === "oportunidade" ? elegiveis.slice(0, TOP_OPORTUNIDADE) : elegiveis;
  let comprou = true;
  while (comprou) {
    comprou = false;
    for (const i of recebemSobra) {
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
const COTA_NOVAS = 0.3;
/** Na estratégia Oportunidade, quantas das melhores dividem o aporte. */
const TOP_OPORTUNIDADE = 3;

export function SimuladorAporte(props: Props) {
  const [texto, setTexto] = useState("1000");
  const [comNovas, setComNovas] = useState(true);
  const novas = props.novas ?? [];
  const valor = Math.max(0, Number(texto.replace(/\./g, "").replace(",", ".")) || 0);
  const r = useMemo(
    () => calcular(valor, { ...props, itens: comNovas ? [...props.itens, ...novas] : props.itens }),
    [valor, props, comNovas, novas],
  );

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
      {novas.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-suave">
          <input type="checkbox" checked={comNovas} onChange={(e) => setComNovas(e.target.checked)} className="accent-[#199e70]" />
          Incluir oportunidades fora da carteira
          <span className="text-xs text-fraco">({novas.map((n) => n.ticker).join(", ")})</span>
        </label>
      )}

      {r.elegiveis === 0 ? (
        <p className="rounded-lg bg-amber-400/5 p-3 text-sm text-amber-200/90">
          Hoje nenhuma ação está abaixo do preço teto com sinal favorável e fora de setor concentrado.
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
                      {c.item.nova && (
                        <span className="rounded bg-marca/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-marca" title="Fora da sua carteira hoje">nova</span>
                      )}
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
        <span>
          Só entram ativos abaixo do teto, sem “Evitar”{props.limiteSetor < 1 ? ` e com setor até ${pct(props.limiteSetor, 0)}` : ""}.{" "}
          {props.estrategia === "oportunidade"
            ? `Estratégia Oportunidade: as ${TOP_OPORTUNIDADE} de maior nota, da carteira ou novas, dividem o aporte, sem olhar o peso ideal.`
            : `Oportunidades novas (sinal “Comprar” e qualidade ≥ 6) ficam com até ${pct(COTA_NOVAS, 0)} do aporte.`}
        </span>
      </div>
    </div>
  );
}
