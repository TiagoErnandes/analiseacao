"use client";

import { useEffect, useRef, useState } from "react";

/** Logo da empresa; se a imagem não carregar, mostra as iniciais do código. */
export function Logo({ ticker, src, tamanho = 28 }: { ticker: string; src?: string | null; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A imagem pode falhar antes do React ligar o onError
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFalhou(true);
  }, []);
  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-lg bg-painel2 text-[10px] font-bold text-suave ring-1 ring-borda"
      style={{ width: tamanho, height: tamanho }}
    >
      {src && !falhou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={src} alt="" loading="lazy" onError={() => setFalhou(true)} className="h-full w-full bg-white object-contain" />
      ) : (
        ticker.slice(0, 2)
      )}
    </span>
  );
}
