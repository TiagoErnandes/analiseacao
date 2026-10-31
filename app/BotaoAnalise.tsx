"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { iniciarAnalise, salvarModoIa } from "./analise-actions";
import { MODOS, type ModoIa } from "@/lib/modos";

type Props = {
  status: "rodando" | "ok" | "erro" | null;
  inicio: string | null;
  erro: string | null;
  etapa?: string | null;
  modo: ModoIa;
  custo: number | null;
  custoMes: number;
  economiaMes?: number;
};

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function BotaoAnalise({ status, inicio, erro, etapa, modo, custo, custoMes, economiaMes = 0 }: Props) {
  const [modoAtual, setModo] = useState<ModoIa>(modo);
  const [, startSalvar] = useTransition();
  const info = MODOS.find((m) => m.id === modoAtual);
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);
  const rodando = status === "rodando";

  // Quando a análise começa ou termina, o aviso antigo sai e fica só a linha de status.
  useEffect(() => setMensagem(null), [status, inicio]);

  // Enquanto roda, atualiza a página a cada 10s para mostrar o resultado quando terminar.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [rodando, router]);

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1 sm:w-auto sm:items-end">
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
        className="campo h-[38px] w-full min-w-0 max-w-full !py-0 text-sm sm:w-auto"
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
      {mensagem && <p className="max-w-80 text-xs text-texto sm:text-right">{mensagem}</p>}
      <p className="max-w-80 text-xs text-suave sm:text-right">
        {rodando && inicio
          ? `Rodando desde ${hora(inicio)}${etapa ? `: ${etapa}` : ". Leva alguns minutos"}.`
          : status === "erro"
            ? `A última análise falhou${inicio ? ` (${hora(inicio)})` : ""}${erro ? `: ${erro}` : "."}`
            : inicio
              ? `Última análise: ${hora(inicio)}${custo != null ? ` · custou ${reais(custo)}` : ""} · no mês ${reais(custoMes)}` +
                (economiaMes >= 0.005 ? ` · economizou ${reais(economiaMes)}` : "")
              : "Nenhuma análise ainda."}
      </p>
    </div>
  );
}
