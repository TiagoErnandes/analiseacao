"use client";

import { useEffect, useState, useTransition } from "react";
import { dinheiro } from "@/lib/format";
import type { PrecoAlvo as Alvo } from "@/lib/precoAlvo";
import { definirPrecoAlvo, excluirPrecoAlvo, testarEmail } from "./actions";

/** "14,07", "1.234,56" ou "14.07" viram número. */
function lerNumero(txt: string): number {
  const limpo = txt.replace(/[^\d,.-]/g, "");
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
}

function Chave({ ligado, onChange, rotulo, icone, desligada }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string; icone: string; desligada?: boolean }) {
  return (
    <label className={`flex w-72 items-center justify-between gap-3 text-sm ${desligada ? "opacity-50" : "cursor-pointer"}`}>
      <span className="flex items-center gap-2 text-suave">
        <span aria-hidden>{icone}</span>
        {rotulo}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={desligada}
        onClick={() => onChange(!ligado)}
        className={`relative h-5 w-9 rounded-full transition ${ligado ? "bg-marca" : "bg-painel2 ring-1 ring-borda"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${ligado ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** Botão "Definir meu Preço-Alvo" e o modal: avisa no site, no email e no WhatsApp quando a cotação chega no alvo. */
export function PrecoAlvo({
  ticker,
  tipo,
  moeda,
  precoAtual,
  alvo: inicial,
  podeWhatsapp,
  whatsappPronto,
  email,
  emailPronto,
}: {
  ticker: string;
  tipo: string | null;
  moeda: string;
  precoAtual: number | null;
  alvo: Alvo | null;
  /** Só o dono do site recebe no WhatsApp (o número fica no servidor). */
  podeWhatsapp: boolean;
  /** WhatsApp (CallMeBot), Telegram ou ntfy configurado no servidor. */
  whatsappPronto: boolean;
  /** Email da conta Google de quem está logado (para onde vai o aviso). */
  email: string | null;
  /** SMTP configurado no servidor. */
  emailPronto: boolean;
}) {
  const [alvo, setAlvo] = useState(inicial);
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [viaSite, setViaSite] = useState(true);
  const [viaZap, setViaZap] = useState(podeWhatsapp);
  const [viaEmail, setViaEmail] = useState(!!email);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [testeEmail, setTesteEmail] = useState<string | null>(null);
  const [testando, iniciarTeste] = useTransition();

  useEffect(() => {
    if (!aberto) return;
    setValor(alvo ? alvo.preco_alvo.toFixed(2).replace(".", ",") : "");
    setViaSite(alvo?.via_site ?? true);
    setViaZap(podeWhatsapp && (alvo?.via_whatsapp ?? true));
    setViaEmail(!!email && (alvo?.via_email ?? true));
    setErro(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, alvo, podeWhatsapp, email]);

  const numero = lerNumero(valor);
  const valido = valor.trim() !== "" && Number.isFinite(numero) && numero > 0;
  const distancia = valido && precoAtual ? numero / precoAtual - 1 : null;

  function salvar() {
    if (!valido) return setErro("Digite um preço-alvo maior que zero.");
    iniciar(async () => {
      const r = await definirPrecoAlvo({ ticker, tipo, moeda, precoAlvo: numero, viaSite, viaWhatsapp: viaZap, viaEmail }).catch((e: Error) => ({ ok: false, mensagem: e.message, alvo: undefined }));
      if (!r.ok) return setErro(r.mensagem);
      setAlvo(r.alvo ?? null);
      setAviso(r.mensagem);
      setAberto(false);
    });
  }

  function excluir() {
    iniciar(async () => {
      await excluirPrecoAlvo(ticker);
      setAlvo(null);
      setAviso("Preço-alvo removido.");
      setAberto(false);
    });
  }

  const ponto = alvo?.direcao === "venda" ? "venda" : "compra";
  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <button
          onClick={() => setAberto(true)}
          className={
            alvo?.atingido_em
              ? "inline-flex items-center gap-2 rounded-lg border border-marca/60 bg-marca/10 px-3 py-1.5 text-xs font-semibold text-marca"
              : "inline-flex items-center gap-2 rounded-lg border border-borda px-3 py-1.5 text-xs font-medium text-texto transition hover:border-suave"
          }
        >
          <span aria-hidden>🎯</span>
          {alvo
            ? alvo.atingido_em
              ? `Atingiu o alvo de ${dinheiro(alvo.preco_alvo, moeda)}`
              : `Preço-alvo de ${ponto}: ${dinheiro(alvo.preco_alvo, moeda)}`
            : "Definir meu Preço-Alvo"}
        </button>
        {aviso && <span className="text-[11px] text-marca">✓ {aviso}</span>}
      </div>

      {aberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}>
          <div role="dialog" aria-modal="true" aria-label="Definir meu Preço-Alvo" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-borda bg-painel shadow-2xl">
            <div className="flex items-center justify-between border-b border-borda px-5 py-4">
              <h2 className="text-lg font-semibold">Definir meu Preço-Alvo</h2>
              <button onClick={() => setAberto(false)} aria-label="Fechar" className="rounded-lg p-1 text-2xl leading-none text-suave hover:bg-painel2 hover:text-texto">×</button>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-xl bg-painel2 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden>🏷️</span> Preço-alvo de {ticker}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-suave">
                  O Preço-Alvo permite definir o valor esperado de um ativo. Abaixo da cotação de agora, é um ponto de compra (avisa quando o preço cair até ele);
                  acima, um ponto de venda (avisa quando subir até ele).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm text-suave">Meu Preço-Alvo</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    className="campo w-full tabular-nums"
                    placeholder={moeda === "USD" ? "US$ 0,00" : "R$ 0,00"}
                    value={valor}
                    onChange={(e) => (setValor(e.target.value), setErro(null))}
                    onKeyDown={(e) => e.key === "Enter" && salvar()}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm text-suave">Preço Atual</span>
                  <input disabled className="campo w-full cursor-not-allowed bg-painel2 tabular-nums text-suave" value={dinheiro(precoAtual, moeda)} />
                </label>
              </div>
              {distancia != null && (
                <p className="-mt-2 text-xs text-suave">
                  {distancia < 0
                    ? `Ponto de compra: o preço precisa cair ${(-distancia * 100).toFixed(1).replace(".", ",")}% para chegar lá.`
                    : distancia > 0
                      ? `Ponto de venda: o preço precisa subir ${(distancia * 100).toFixed(1).replace(".", ",")}% para chegar lá.`
                      : "Igual à cotação de agora."}
                </p>
              )}

              <div className="space-y-3 border-t border-borda pt-5">
                <p className="text-sm font-semibold">Defina como você gostaria de receber o alerta do seu Preço-Alvo.</p>
                <Chave icone="🖥️" rotulo="Via website" ligado={viaSite} onChange={setViaSite} />
                {podeWhatsapp && <Chave icone="💬" rotulo="Via WhatsApp" ligado={viaZap} onChange={setViaZap} />}
                {podeWhatsapp && !whatsappPronto && viaZap && (
                  <p className="text-xs leading-snug text-amber-300">
                    O WhatsApp ainda não está conectado. Pode deixar ligado: o aviso aparece no site na hora e, assim que o WhatsApp
                    for conectado (card "WhatsApp dos alertas" no painel), os próximos avisos chegam lá também.
                  </p>
                )}
                {email && <Chave icone="📧" rotulo="Via Email" ligado={viaEmail} onChange={setViaEmail} />}
                {email && viaEmail && (
                  <p className={`text-xs leading-snug ${emailPronto ? "text-suave" : "text-amber-300"}`}>
                    {emailPronto
                      ? <>
                          O aviso vai para <b className="text-texto">{email}</b>.{" "}
                          <button
                            type="button"
                            disabled={testando}
                            onClick={() => iniciarTeste(async () => setTesteEmail((await testarEmail().catch((e: Error) => ({ mensagem: e.message }))).mensagem))}
                            className="text-marca hover:underline disabled:opacity-50"
                          >
                            {testando ? "Enviando…" : "Enviar email de teste"}
                          </button>
                          {testeEmail && <span className="mt-1 block">{testeEmail}</span>}
                        </>
                      : <>O envio de email ainda não está configurado no servidor (SMTP_USUARIO e SMTP_SENHA no .env.production). Pode deixar ligado: depois de configurado, os avisos vão para <b className="text-texto">{email}</b>.</>}
                  </p>
                )}
              </div>

              {erro && <p className="text-sm text-baixa">{erro}</p>}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-borda px-5 py-4">
              <div className="flex items-center gap-4">
                <button onClick={() => setAberto(false)} className="text-sm text-suave hover:text-texto">Cancelar</button>
                {alvo && (
                  <button onClick={excluir} disabled={salvando} className="text-sm text-baixa hover:underline disabled:opacity-50">Excluir alvo</button>
                )}
              </div>
              <button onClick={salvar} disabled={salvando} className="botao">
                {salvando ? "Salvando..." : alvo ? "Salvar Preço-Alvo" : "Criar Preço-Alvo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
