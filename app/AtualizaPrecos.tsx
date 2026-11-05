"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVALO = 60_000;

/**
 * Recarrega os valores da página quando o servidor tiver preços novos (o agendador atualiza a cada 5 minutos no pregão).
 * Pergunta só ao nosso servidor, e só com a aba aberta; o que você estiver digitando na página continua.
 */
export function AtualizaPrecos() {
  const router = useRouter();
  const versao = useRef<string | null>(null);
  const [em, setEm] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const conferir = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/precos", { cache: "no-store" })
        .then((r) => r.json())
        .then((r: { em?: string | null }) => {
          if (!vivo || !r?.em) return;
          if (versao.current && versao.current !== r.em) router.refresh();
          versao.current = r.em;
          setEm(r.em);
        })
        .catch(() => {});
    };
    conferir();
    const t = setInterval(conferir, INTERVALO);
    document.addEventListener("visibilitychange", conferir);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", conferir);
    };
  }, [router]);

  if (!em) return null;
  const d = new Date(em);
  const hoje = d.toDateString() === new Date().toDateString();
  const quando = d.toLocaleString("pt-BR", hoje ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <span className="ml-auto shrink-0 text-fraco" title="Os preços do site são atualizados a cada 5 minutos durante o pregão">
      Preços de {quando}
    </span>
  );
}
