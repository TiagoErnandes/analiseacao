"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", rotulo: "Painel" },
  { href: "/ranking", rotulo: "Ranking" },
  { href: "/carteira", rotulo: "Carteira" },
  { href: "/placar", rotulo: "Placar" },
];

export function Navegacao() {
  const rota = usePathname();
  return (
    <nav className="flex items-center gap-0.5 text-[13px] sm:gap-1 sm:text-sm">
      {LINKS.map((l) => {
        const ativo = l.href === "/" ? rota === "/" : rota.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-2 py-1.5 transition sm:px-3 ${ativo ? "bg-painel2 text-texto" : "text-suave hover:text-texto"}`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
