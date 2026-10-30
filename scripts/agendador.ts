// Fica rodando no container "agendador" e dispara a análise de segunda a sexta às 7h (Brasília).
import cron from "node-cron";
import { rodarAnalise } from "../lib/analise";
import { vigiarCarteira } from "../lib/alertas";

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
console.log(`Agendador ativo: "${HORARIO}" (America/Sao_Paulo)`);
