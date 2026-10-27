import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div className="cartao mx-auto max-w-md p-8 text-center">
      <p className="text-lg font-semibold">Página não encontrada</p>
      <p className="mt-2 text-sm text-suave">Essa ação ainda não foi analisada ou o endereço está errado.</p>
      <Link href="/" className="botao mt-5">Voltar ao painel</Link>
    </div>
  );
}
