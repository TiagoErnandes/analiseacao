"use client";
// Escolha do método do preço teto das ações: muda teto, margem e score na hora em todo o site.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { salvarMetodoTeto } from "./analise-actions";
import { infoMetodo, METODOS_TETO, type MetodoTeto } from "@/lib/valuation";

const GRUPOS = [...new Set(METODOS_TETO.map((m) => m.grupo))];

export function SeletorMetodoTeto({ metodo, compacto = false }: { metodo: MetodoTeto; compacto?: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState<MetodoTeto>(metodo);
  const [salvando, startTransition] = useTransition();

  const select = (
    <select
      value={valor}
      disabled={salvando}
      onChange={(e) => {
        const v = e.target.value as MetodoTeto;
        setValor(v);
        startTransition(async () => {
          await salvarMetodoTeto(v);
          router.refresh();
        });
      }}
      className="campo h-[34px] min-w-0 flex-1 !py-0 text-sm sm:flex-none"
      aria-label="Método do preço teto das ações"
    >
      {GRUPOS.map((g) => (
        <optgroup key={g} label={g}>
          {METODOS_TETO.filter((m) => m.grupo === g).map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  if (compacto) return <label className="flex min-w-0 items-center gap-2 text-sm">{select}</label>;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-borda bg-painel px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <label className="flex min-w-0 items-center gap-2 text-sm sm:shrink-0">
        <span className="rotulo !mb-0 shrink-0">Preço teto</span>
        {select}
      </label>
      <p className="min-w-0 text-xs text-suave sm:flex-1">
        {salvando ? "Recalculando..." : `${infoMetodo(valor).regra}.`} Vale para as ações: teto, margem e score mudam na hora. FIIs, ETFs e cripto
        seguem o método próprio, e o sinal e o comentário da IA continuam os da análise (feita pela mediana).
      </p>
    </div>
  );
}
