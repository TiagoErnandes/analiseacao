"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", rotulo: "Painel" },
  { href: "/ranking", rotulo: "Ranking" },
  { href: "/carteira", rotulo: "Carteira" },
];

export function Navegacao() {
  const rota = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const ativo = l.href === "/" ? rota === "/" : rota.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 transition ${ativo ? "bg-painel2 text-texto" : "text-suave hover:text-texto"}`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
