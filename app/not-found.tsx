import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div className="cartao mx-auto max-w-md p-8 text-center">
      <p className="text-lg font-semibold">Ativo não encontrado</p>
      <p className="mt-2 text-sm text-suave">
        Não achamos esse código no Yahoo Finance nem no Fundamentus. Confira se está certo (ex.: PETR4, MXRF11, BOVA11, AAPL).
      </p>
      <Link href="/" className="botao mt-5">Voltar ao painel</Link>
    </div>
  );
}
