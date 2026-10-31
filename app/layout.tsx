import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Navegacao } from "./Navegacao";
import { BuscaAtivo } from "./BuscaAtivo";
import { FaixaIndices } from "./FaixaIndices";
import { loginAtivo, usuarioAtual, type Usuario } from "@/lib/auth";
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

/** Quem está logado e o botão de sair (só com o login do Google ligado). */
function MenuUsuario({ u }: { u: Usuario }) {
  const nome = u.nome ?? u.email ?? "";
  return (
    <form action="/api/auth/sair" method="post" className="flex items-center gap-2">
      {u.foto ? (
        <img src={u.foto} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" title={`${nome}${u.admin ? " (dono)" : ""}`} />
      ) : (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-painel2 text-xs font-semibold" title={nome}>
          {nome.slice(0, 1).toUpperCase()}
        </span>
      )}
      <button type="submit" className="rounded-lg px-2 py-1.5 text-[13px] text-suave transition hover:text-texto sm:text-sm">
        Sair
      </button>
    </form>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioAtual().catch(() => null);
  if (!usuario) {
    // Tela de entrar: sem busca, índices nem navegação (tudo isso exige login)
    return (
      <html lang="pt-BR">
        <body className="min-h-screen">
          <header className="border-b border-borda">
            <div className="mx-auto flex max-w-7xl items-center px-4 py-2.5">
              <Marca />
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
        </body>
      </html>
    );
  }
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <FaixaIndices />
        <header className="sticky top-0 z-20 border-b border-borda bg-fundo/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <Marca />
            <div className="order-last w-full md:order-none md:ml-4 md:w-auto md:max-w-md md:flex-1">
              <BuscaAtivo />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Navegacao />
              {loginAtivo() && <MenuUsuario u={usuario} />}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
        <footer className="mt-6 border-t border-borda">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 text-xs leading-relaxed text-fraco sm:grid-cols-[1.4fr_1fr_1fr]">
            <div className="space-y-2">
              <Marca />
              <p className="max-w-sm">
                Ferramenta de apoio à decisão para investimento de longo prazo (previdência e buy and hold). Não é recomendação de compra ou venda.
              </p>
            </div>
            <div>
              <p className="rotulo mb-2">Navegação</p>
              <ul className="space-y-1.5">
                <li><Link href="/" className="hover:text-texto">Painel</Link></li>
                <li><Link href="/ranking" className="hover:text-texto">Ranking</Link></li>
                <li><Link href="/carteira" className="hover:text-texto">Carteira</Link></li>
                <li><Link href="/placar" className="hover:text-texto">Placar</Link></li>
              </ul>
            </div>
            <div>
              <p className="rotulo mb-2">Fontes de dados</p>
              <p>Cotações: Yahoo Finance (atraso de até 15 min). Balanços: Fundamentus e CVM. Proventos: B3. Juro real: Tesouro Transparente. Análise qualitativa gerada por IA.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
