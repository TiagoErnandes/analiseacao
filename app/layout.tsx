import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Navegacao } from "./Navegacao";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Preço Teto · Análise de Ações", template: "%s · Preço Teto" },
  description: "Preço teto, qualidade e ação do dia para previdência e buy and hold",
};

export const viewport: Viewport = { themeColor: "#0a0e14" };

function Marca() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-marca/15 text-marca">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      </span>
      <span className="hidden min-[400px]:inline">
        Preço<span className="text-marca">Teto</span>
      </span>
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-borda bg-fundo/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <Marca />
            <Navegacao />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-7xl border-t border-borda px-4 py-6 text-xs leading-relaxed text-fraco">
          Ferramenta de apoio à decisão para investimento de longo prazo. Não é recomendação de compra ou venda.
          Dados: Yahoo Finance e Fundamentus (podem ter atraso). Análise qualitativa gerada por IA.
        </footer>
      </body>
    </html>
  );
}
