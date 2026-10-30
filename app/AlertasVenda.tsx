"use client";

import { useState, useTransition } from "react";
import type { Alerta } from "@/lib/alertas";
import { testarAlerta } from "./analise-actions";
import { Cartao } from "./ui";

/** Alertas de venda dos últimos 7 dias (notícias graves, fatos relevantes, quedas fortes, EVITAR na análise). */
export function AlertasVenda({ alertas }: { alertas: Alerta[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [testando, iniciar] = useTransition();
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
    <Cartao titulo={`Alertas da carteira${alertas.length ? ` (${alertas.length})` : ""}`} acao={botao}>
      <div className="space-y-2 p-4 text-sm">
        {msg && <p className="text-xs text-suave">{msg}</p>}
        {alertas.length === 0 ? (
          <p className="text-suave">Nenhum alerta nos últimos 7 dias. O vigia confere notícias, fatos relevantes e quedas fortes a cada 30 minutos.</p>
        ) : (
          <ul className="space-y-2">
            {alertas.map((a) => (
              <li key={a.chave} className={`rounded-lg border px-3 py-2 ${a.nivel === "VENDER" ? "border-baixa/60 bg-baixa/10" : "border-borda"}`}>
                <p>
                  <b className={a.nivel === "VENDER" ? "text-baixa" : ""}>{a.nivel === "VENDER" ? "🚨 VENDA URGENTE?" : "⚠️ Atenção"} {a.ticker}</b>{" "}
                  <span className="text-xs text-fraco">{a.criado_em ? new Date(a.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : ""}</span>
                </p>
                <p className="mt-0.5">
                  {a.link ? <a href={a.link} target="_blank" rel="noreferrer" className="hover:underline">{a.titulo}</a> : a.titulo}
                </p>
                {a.motivo && <p className="mt-0.5 text-xs text-suave">{a.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Cartao>
  );
}
