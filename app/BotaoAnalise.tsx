"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { iniciarAnalise } from "./analise-actions";

type Props = {
  status: "rodando" | "ok" | "erro" | null;
  inicio: string | null;
  erro: string | null;
};

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function BotaoAnalise({ status, inicio, erro }: Props) {
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
      <button
        disabled={rodando || pendente}
        onClick={() =>
          startTransition(async () => {
            const r = await iniciarAnalise();
            setMensagem(r.mensagem);
            router.refresh();
          })
        }
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {rodando ? "Analisando…" : pendente ? "Iniciando…" : "Rodar análise agora"}
      </button>
      <p className="text-xs text-neutral-400">
        {mensagem ??
          (rodando && inicio
            ? `Rodando desde ${hora(inicio)}. Leva alguns minutos.`
            : status === "erro"
              ? `A última análise falhou${erro ? `: ${erro}` : "."}`
              : inicio
                ? `Última análise: ${hora(inicio)}`
                : "Nenhuma análise ainda.")}
      </p>
    </div>
  );
}
