"use client";

import { useMemo, useState, useTransition } from "react";
import type { Alerta } from "@/lib/alertas";
import { testarAlerta } from "./analise-actions";
import { Cartao } from "./ui";

const quando = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Alertas dos últimos 7 dias (notícias graves, fatos relevantes, quedas fortes, EVITAR na análise),
 * agrupados por ativo: cada ativo mostra o alerta mais recente e os outros ficam recolhidos.
 */
export function AlertasVenda({ alertas }: { alertas: Alerta[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [testando, iniciar] = useTransition();
  const [filtro, setFiltro] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const m = new Map<string, Alerta[]>();
    for (const a of alertas) m.set(a.ticker, [...(m.get(a.ticker) ?? []), a]);
    // Ativos com alerta de venda primeiro, depois os com mais alertas
    return [...m.entries()]
      .map(([ticker, lista]) => ({ ticker, lista, vender: lista.some((a) => a.nivel === "VENDER") }))
      .sort((x, y) => Number(y.vender) - Number(x.vender) || y.lista.length - x.lista.length);
  }, [alertas]);
  const urgentes = alertas.filter((a) => a.nivel === "VENDER").length;
  const visiveis = filtro ? grupos.filter((g) => g.ticker === filtro) : grupos;

  const botao = (
    <button
      type="button"
      disabled={testando}
      onClick={() => iniciar(async () => setMsg((await testarAlerta()).mensagem))}
      className="rounded-md border border-borda px-2 py-1 text-xs text-suave hover:text-texto disabled:opacity-50"
    >
      {testando ? "Enviando…" : "Testar no celular"}
    </button>
  );

  return (
    <Cartao
      id="alertas"
      titulo={
        <span className="flex items-center gap-2">
          Alertas da carteira
          {alertas.length > 0 && <span className="rounded-full bg-painel2 px-2 py-0.5 text-[11px] font-medium text-suave">{alertas.length} em 7 dias</span>}
          {urgentes > 0 && <span className="rounded-full bg-baixa/15 px-2 py-0.5 text-[11px] font-semibold text-baixa">{urgentes} de venda</span>}
        </span>
      }
      acao={botao}
    >
      <div className="space-y-3 p-4 text-sm">
        {msg && <p className="text-xs text-suave">{msg}</p>}
        {alertas.length === 0 ? (
          <p className="text-suave">Nenhum alerta nos últimos 7 dias. O vigia confere notícias, fatos relevantes e quedas fortes a cada 30 minutos.</p>
        ) : (
          <>
            {grupos.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por ativo">
                <button onClick={() => setFiltro(null)} className={`chip ${filtro == null ? "chip-ativo" : ""}`}>Todos</button>
                {grupos.map((g) => (
                  <button key={g.ticker} onClick={() => setFiltro(g.ticker)} className={`chip ${filtro === g.ticker ? "chip-ativo" : ""} ${g.vender ? "!border-baixa/50 !text-baixa" : ""}`}>
                    {g.ticker} <span className="text-fraco">{g.lista.length}</span>
                  </button>
                ))}
              </div>
            )}
            <ul className="grid gap-2 lg:grid-cols-2">
              {visiveis.map(({ ticker, lista, vender }) => {
                const [ultimo, ...antigos] = lista;
                return (
                  <li key={ticker} className={`rounded-lg border px-3 py-2.5 ${vender ? "border-baixa/50 bg-baixa/5" : "border-borda bg-painel2/30"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex items-center gap-2 font-semibold ${vender ? "text-baixa" : ""}`}>
                        <span aria-hidden>{vender ? "🚨" : "⚠️"}</span>
                        {ticker}
                        {vender && <span className="rounded bg-baixa/15 px-1.5 py-0.5 text-[10px] uppercase">venda urgente?</span>}
                      </span>
                      <span className="text-[11px] text-fraco tabular-nums">{quando(ultimo.criado_em)}</span>
                    </div>
                    <Item a={ultimo} />
                    {antigos.length > 0 && (
                      <details className="mt-1.5 group">
                        <summary className="cursor-pointer list-none text-xs text-marca hover:underline">
                          <span className="group-open:hidden">+ {antigos.length} alerta{antigos.length > 1 ? "s" : ""} anterior{antigos.length > 1 ? "es" : ""}</span>
                          <span className="hidden group-open:inline">Recolher</span>
                        </summary>
                        <ul className="mt-2 space-y-2 border-l border-borda pl-3">
                          {antigos.map((a) => (
                            <li key={a.chave}>
                              <span className="text-[11px] text-fraco tabular-nums">{quando(a.criado_em)}</span>
                              <Item a={a} />
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Cartao>
  );
}

function Item({ a }: { a: Alerta }) {
  return (
    <>
      <p className="mt-0.5 leading-snug">
        {a.link ? (
          <a href={a.link} target="_blank" rel="noreferrer" className="hover:underline">{a.titulo}</a>
        ) : (
          a.titulo
        )}
      </p>
      {a.motivo && <p className="mt-0.5 text-xs leading-snug text-suave">{a.motivo}</p>}
    </>
  );
}
