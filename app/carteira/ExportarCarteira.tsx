"use client";
// Copia a carteira em texto pronto para colar em outra IA, ou baixa em Markdown, JSON ou CSV.
import { useState } from "react";

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sem HTTPS o navegador bloqueia a área de transferência: usa o jeito antigo
    const t = document.createElement("textarea");
    t.value = texto;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

export function ExportarCarteira() {
  const [estado, setEstado] = useState<"parado" | "copiando" | "copiado" | "erro">("parado");

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-suave">
        Leva a carteira inteira para outra IA (ChatGPT, Claude, Gemini) analisar. Vai com posições, preço médio e atual, preço teto, setor,
        proventos, indicadores, a análise do app e as oportunidades de fora.
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          className="botao"
          disabled={estado === "copiando"}
          onClick={async () => {
            setEstado("copiando");
            try {
              const res = await fetch("/carteira/exportar?formato=md", { cache: "no-store" });
              if (!res.ok) throw new Error();
              setEstado((await copiar(await res.text())) ? "copiado" : "erro");
            } catch {
              setEstado("erro");
            }
          }}
        >
          {estado === "copiando" ? "Copiando…" : estado === "copiado" ? "✓ Copiado" : "Copiar para IA"}
        </button>
        <a className="chip" href="/carteira/exportar?formato=md&baixar=1">.md</a>
        <a className="chip" href="/carteira/exportar?formato=json&baixar=1">JSON</a>
        <a className="chip" href="/carteira/exportar?formato=csv&baixar=1">CSV (Excel)</a>
      </div>
      {estado === "copiado" && <p className="text-xs text-alta sm:hidden">Agora é só colar na IA.</p>}
      {estado === "erro" && <p className="text-xs text-baixa">Não deu para copiar. Baixe o .md e envie o arquivo para a IA.</p>}
    </div>
  );
}
