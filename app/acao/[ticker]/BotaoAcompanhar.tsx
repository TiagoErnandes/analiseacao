"use client";

import { useState, useTransition } from "react";
import { acompanhar } from "./actions";

export function BotaoAcompanhar({ ticker, jaAcompanha }: { ticker: string; jaAcompanha: boolean }) {
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<string | null>(jaAcompanha ? "Já está na lista: entra na próxima análise." : null);
  if (msg) return <span className="text-xs font-medium text-marca">✓ {msg}</span>;
  return (
    <button
      className="botao whitespace-nowrap"
      disabled={pendente}
      onClick={() => iniciar(async () => setMsg((await acompanhar(ticker)).mensagem))}
    >
      {pendente ? "Adicionando..." : "+ Acompanhar na análise diária"}
    </button>
  );
}
