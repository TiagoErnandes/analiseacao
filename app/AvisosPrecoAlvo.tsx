"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dinheiro } from "@/lib/format";
import type { PrecoAlvo } from "@/lib/precoAlvo";
import { dispensarAvisoAlvo } from "./acao/[ticker]/actions";

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/** No painel: aviso de cada preço-alvo atingido (via website) e a lista dos alvos que ainda estão esperando. */
export function AvisosPrecoAlvo({ alvos }: { alvos: PrecoAlvo[] }) {
  const [fechados, setFechados] = useState<string[]>([]);
  const [, iniciar] = useTransition();
  const atingidos = alvos.filter((a) => a.atingido_em && a.via_site && !a.visto && !fechados.includes(a.ticker));
  const esperando = alvos.filter((a) => !a.atingido_em);
  if (!atingidos.length && !esperando.length) return null;

  return (
    <div className="space-y-2">
      {atingidos.map((a) => (
        <div key={a.ticker} className="flex items-center justify-between gap-3 rounded-xl border border-marca/50 bg-marca/10 px-4 py-3 text-sm">
          <Link href={`/acao/${a.ticker}`} className="hover:underline">
            <b className="text-marca">🎯 {a.ticker} {a.direcao === "compra" ? "está no ponto de compra" : "chegou no seu preço de venda"}</b>{" "}
            <span className="text-suave">
              cotação de {dinheiro(a.preco_atingido, a.moeda)} em {quando(a.atingido_em)} (seu alvo: {dinheiro(a.preco_alvo, a.moeda)}).
            </span>
          </Link>
          <button
            onClick={() => (setFechados((f) => [...f, a.ticker]), iniciar(() => dispensarAvisoAlvo(a.ticker)))}
            aria-label={`Fechar aviso de ${a.ticker}`}
            className="rounded-lg px-2 text-lg leading-none text-suave hover:bg-painel2 hover:text-texto"
          >
            ×
          </button>
        </div>
      ))}
      {esperando.length > 0 && (
        <details className="group rounded-xl border border-borda bg-painel px-4 py-2.5 text-sm">
          <summary className="cursor-pointer list-none text-suave hover:text-texto">
            🎯 Meus preços-alvo: <b className="text-texto">{esperando.length}</b> esperando{" "}
            <span className="text-xs text-marca group-open:hidden">ver ↓</span>
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {esperando.map((a) => (
              <li key={a.ticker}>
                <Link href={`/acao/${a.ticker}`} className="chip inline-flex items-center gap-1.5">
                  <b className="text-texto">{a.ticker}</b>
                  {a.direcao === "compra" ? "compra ≤" : "venda ≥"} {dinheiro(a.preco_alvo, a.moeda)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
