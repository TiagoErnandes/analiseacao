"use client";
// Escolha da estratégia da carteira: automático (Oportunidade nos primeiros meses), Oportunidade ou Balanceamento.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { salvarEstrategia } from "./analise-actions";
import { ESTRATEGIAS, MESES_OPORTUNIDADE, type EscolhaEstrategia, type Estrategia } from "@/lib/modos";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export function SeletorEstrategia({ escolha, atual, trocaEm }: { escolha: EscolhaEstrategia; atual: Estrategia; trocaEm: string }) {
  const router = useRouter();
  const [valor, setValor] = useState<EscolhaEstrategia>(escolha);
  const [salvando, startTransition] = useTransition();
  const info = ESTRATEGIAS.find((e) => e.id === atual);
  const autoTexto =
    atual === "oportunidade" ? `Automático: Oportunidade até ${dataBr(trocaEm)}` : `Automático: Balanceamento (desde ${dataBr(trocaEm)})`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-borda bg-painel px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <span className="rotulo !mb-0 shrink-0">Estratégia</span>
        <select
          value={valor}
          disabled={salvando}
          onChange={(e) => {
            const v = e.target.value as EscolhaEstrategia;
            setValor(v);
            startTransition(async () => {
              await salvarEstrategia(v);
              router.refresh();
            });
          }}
          className="campo h-[34px] min-w-0 flex-1 !py-0 text-sm sm:flex-none"
          aria-label="Estratégia da carteira"
        >
          <option value="auto">{autoTexto}</option>
          {ESTRATEGIAS.map((e) => (
            <option key={e.id} value={e.id}>{e.nome}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-suave">
        {info?.descricao}
        {valor === "auto" && atual === "oportunidade" && ` Nos primeiros ${MESES_OPORTUNIDADE} meses o foco é oportunidade; depois o balanceamento entra sozinho.`}
        {" "}A nota e a IA mudam a partir da próxima análise.
      </p>
    </div>
  );
}
