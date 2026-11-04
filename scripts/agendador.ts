// Fica rodando no container "agendador" e dispara a análise de segunda a sexta às 7h (Brasília).
import cron from "node-cron";
import { rodarAnalise } from "../lib/analise";
import { vigiarCarteira } from "../lib/alertas";
import { vigiarPrecosAlvo } from "../lib/precoAlvo";

const HORARIO = process.env.ANALISE_CRON ?? "0 7 * * 1-5";
// Vigia de alertas de venda: a cada 30 minutos, das 7h às 22h, todos os dias (notícia sai também no fim de semana)
const VIGIA = process.env.VIGIA_CRON ?? "*/30 7-22 * * *";

async function rodar() {
  const inicio = Date.now();
  const r = await rodarAnalise("agendador").catch((err) => ({ motivo: String(err) }));
  if ("motivo" in r) return console.warn(`Análise não iniciada: ${r.motivo}`);
  await r.termino;
  console.log(`Análise terminou em ${Math.round((Date.now() - inicio) / 1000)}s`);
}

cron.schedule(HORARIO, rodar, { timezone: "America/Sao_Paulo" });
let vigiando = false;
cron.schedule(
  VIGIA,
  async () => {
    if (vigiando) return; // a anterior ainda não terminou
    vigiando = true;
    await vigiarCarteira().catch((err) => console.warn(`Vigia falhou: ${(err as Error).message}`));
    vigiando = false;
  },
  { timezone: "America/Sao_Paulo" },
);
console.log(`Vigia de alertas ativo: "${VIGIA}"`);

// Preço-alvo: a cada 10 minutos no horário do pregão (cada alvo avisa uma vez só, no site e no WhatsApp)
const PRECO_ALVO = process.env.PRECO_ALVO_CRON ?? "*/10 10-18 * * 1-5";
let conferindoAlvos = false;
cron.schedule(
  PRECO_ALVO,
  async () => {
    if (conferindoAlvos) return;
    conferindoAlvos = true;
    await vigiarPrecosAlvo().catch((err) => console.warn(`Preço-alvo falhou: ${(err as Error).message}`));
    conferindoAlvos = false;
  },
  { timezone: "America/Sao_Paulo" },
);
console.log(`Vigia de preço-alvo ativo: "${PRECO_ALVO}"`);
console.log(`Agendador ativo: "${HORARIO}" (America/Sao_Paulo)`);
