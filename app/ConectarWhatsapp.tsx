"use client";

import { useEffect, useState, useTransition } from "react";
import type { EstadoWhatsapp } from "@/lib/whatsapp";
import { whatsappConectar, whatsappDesconectar, whatsappEstado } from "./analise-actions";
import { Cartao } from "./ui";

/** Painel do dono: conecta o chip do WhatsApp na Evolution API lendo o QR code. */
export function ConectarWhatsapp({ destino }: { destino: string | null }) {
  const [st, setSt] = useState<EstadoWhatsapp | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    whatsappEstado().then(setSt).catch(() => setSt({ estado: "erro", mensagem: "Não consegui ver a situação do WhatsApp." }));
  }, []);

  const temQr = !!st?.qr;
  // Enquanto o QR está na tela, confere a cada 3 segundos se o chip já conectou; o QR muda a cada ~40 s
  useEffect(() => {
    if (st?.estado !== "conectando") return;
    let voltas = 0;
    const t = setInterval(async () => {
      voltas++;
      const novo = await whatsappEstado().catch(() => null);
      if (novo?.estado === "conectado") return setSt(novo);
      // Sem QR ainda (a conexão com o WhatsApp leva alguns segundos), pede de novo; com QR, renova a cada ~40 s
      if (!temQr || voltas % 13 === 0) {
        const r = await whatsappConectar().catch(() => null);
        if (r && (r.qr || r.estado !== "conectando")) setSt(r);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [st?.estado, temQr]);

  const conectado = st?.estado === "conectado";
  return (
    <Cartao
      titulo={
        <span className="flex items-center gap-2">
          WhatsApp dos alertas
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${conectado ? "bg-marca/15 text-marca" : "bg-painel2 text-suave"}`}>
            {st == null ? "conferindo…" : conectado ? "conectado" : st.estado === "conectando" ? "aguardando o QR code" : st.estado === "erro" ? "com erro" : "desconectado"}
          </span>
        </span>
      }
      acao={
        conectado ? (
          <button
            disabled={pendente}
            onClick={() => iniciar(async () => (await whatsappDesconectar(), setSt(await whatsappEstado())))}
            className="rounded-md border border-borda px-2 py-1 text-xs text-suave hover:text-texto disabled:opacity-50"
          >
            Desconectar
          </button>
        ) : (
          <button disabled={pendente} onClick={() => iniciar(async () => setSt(await whatsappConectar()))} className="botao !px-3 !py-1.5 !text-xs">
            {pendente ? "Gerando…" : "Conectar WhatsApp"}
          </button>
        )
      }
    >
      <div className="space-y-3 p-4 text-sm">
        {conectado ? (
          <p className="text-suave">
            O chip {st?.numero ? <b className="text-texto">+{st.numero}</b> : null} está conectado e manda os avisos de preço-alvo e os alertas de venda
            {destino ? <> para <b className="text-texto">{destino}</b></> : null}. Use <b>Testar no celular</b> nos alertas para conferir.
          </p>
        ) : st?.estado === "conectando" ? (
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            {st.qr ? (
              <img src={st.qr.startsWith("data:") ? st.qr : `data:image/png;base64,${st.qr}`} alt="QR code do WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
            ) : (
              <p className="text-suave">Gerando o QR code…</p>
            )}
            <ol className="list-decimal space-y-1 pl-5 text-suave">
              <li>No celular com o <b className="text-texto">chip novo</b>, abra o WhatsApp.</li>
              <li>Toque em <b className="text-texto">⋮ → Dispositivos conectados → Conectar um dispositivo</b>.</li>
              <li>Aponte a câmera para este QR code. A página confirma sozinha.</li>
            </ol>
          </div>
        ) : st?.estado === "erro" ? (
          <p className="text-baixa">{st.mensagem}</p>
        ) : (
          <p className="text-suave">
            Conecte o chip que vai <b className="text-texto">enviar</b> os avisos. Eles chegam no seu número
            {destino ? <> (<b className="text-texto">{destino}</b>)</> : " (WHATSAPP_NUMERO no .env.production)"}.
          </p>
        )}
        {!destino && <p className="text-xs text-amber-300">Falta WHATSAPP_NUMERO no .env.production: é o seu número, que recebe os avisos.</p>}
      </div>
    </Cartao>
  );
}
