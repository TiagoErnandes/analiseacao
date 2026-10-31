import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginAtivo, usuarioAtual } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (!loginAtivo() || (await usuarioAtual())) redirect("/");
  const { erro } = await searchParams;
  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="cartao p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-marca/15 text-marca">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M15 7h6v6" />
          </svg>
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          Preço<span className="text-marca">Teto</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-suave">
          Preço teto, qualidade e ação do dia para previdência e buy and hold. Entre para montar e acompanhar a sua carteira.
        </p>
        {erro && <p className="mt-4 rounded-lg border border-baixa/40 bg-baixa/10 px-3 py-2 text-xs text-baixa">{erro}</p>}
        {/* Link comum (não o <Link> do Next): o login sai do site e volta pelo Google */}
        <a
          href="/api/auth/google"
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f2f2f2]"
        >
          <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Entrar com Google
        </a>
        <p className="mt-4 text-[11px] leading-relaxed text-fraco">
          Usamos só o seu nome, e-mail e foto do Google para identificar a sua carteira. Cada pessoa vê apenas a própria carteira.
        </p>
      </div>
    </div>
  );
}
