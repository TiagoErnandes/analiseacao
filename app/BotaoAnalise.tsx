"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { iniciarAnalise, salvarModoIa } from "./analise-actions";
import { MODOS, type ModoIa } from "@/lib/modos";

type Props = {
  status: "rodando" | "ok" | "erro" | null;
  inicio: string | null;
  erro: string | null;
  modo: ModoIa;
  custo: number | null;
  custoMes: number;
};

const usd = (v: number) => `US$ ${v < 0.1 ? v.toFixed(3).replace(".", ",") : v.toFixed(2).replace(".", ",")}`;

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function BotaoAnalise({ status, inicio, erro, modo, custo, custoMes }: Props) {
  const [modoAtual, setModo] = useState<ModoIa>(modo);
  const [, startSalvar] = useTransition();
  const info = MODOS.find((m) => m.id === modoAtual);
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);
  const rodando = status === "rodando";

  // Enquanto roda, atualiza a página a cada 10s para mostrar o resultado quando terminar.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [rodando, router]);

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
      <select
        value={modoAtual}
        title={info ? `${info.descricao} Custo: ${info.custo}.` : undefined}
        onChange={(e) => {
          const m = e.target.value as ModoIa;
          setModo(m);
          startSalvar(async () => {
            await salvarModoIa(m);
            router.refresh();
          });
        }}
        className="campo !w-auto !py-1.5 text-xs"
        aria-label="Modo da IA"
      >
        {MODOS.map((m) => (
          <option key={m.id} value={m.id}>{m.nome} ({m.custo})</option>
        ))}
      </select>
      <button
        disabled={rodando || pendente}
        onClick={() =>
          startTransition(async () => {
            const r = await iniciarAnalise();
            setMensagem(r.mensagem);
            router.refresh();
          })
        }
        className="botao"
      >
        {(rodando || pendente) && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-fundo/30 border-t-fundo" />}
        {rodando ? "Analisando…" : pendente ? "Iniciando…" : "Rodar análise agora"}
      </button>
      </div>
      <p className="max-w-80 text-xs text-suave sm:text-right">
        {mensagem ??
          (rodando && inicio
            ? `Rodando desde ${hora(inicio)}. Leva alguns minutos.`
            : status === "erro"
              ? `A última análise falhou${erro ? `: ${erro}` : "."}`
              : inicio
                ? `Última análise: ${hora(inicio)}${custo != null ? ` · custou ${usd(custo)}` : ""} · no mês ${usd(custoMes)}`
                : "Nenhuma análise ainda.")}
      </p>
    </div>
  );
}
