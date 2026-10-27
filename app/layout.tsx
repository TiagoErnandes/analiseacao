import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Análise de Ações",
  description: "Preço teto e ação do dia para previdência e buy and hold",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="border-b border-neutral-800">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">📈 Análise de Ações</Link>
            <Link href="/" className="text-neutral-400 hover:text-white">Hoje</Link>
            <Link href="/carteira" className="text-neutral-400 hover:text-white">Minha carteira</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-neutral-500">
          Ferramenta de apoio à decisão. Não é recomendação de investimento.
        </footer>
      </body>
    </html>
  );
}
