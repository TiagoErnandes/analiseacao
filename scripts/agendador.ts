// Fica rodando no container "agendador" e dispara a análise de segunda a sexta às 7h (Brasília).
import cron from "node-cron";
import { executarAnalise } from "./daily";

const HORARIO = process.env.ANALISE_CRON ?? "0 7 * * 1-5";
let rodando = false;

async function rodar() {
  if (rodando) return console.warn("Análise anterior ainda em andamento, pulando.");
  rodando = true;
  const inicio = Date.now();
  try {
    await executarAnalise();
    console.log(`Análise concluída em ${Math.round((Date.now() - inicio) / 1000)}s`);
  } catch (err) {
    console.error("Falha na análise:", err);
  } finally {
    rodando = false;
  }
}

cron.schedule(HORARIO, rodar, { timezone: "America/Sao_Paulo" });
console.log(`Agendador ativo: "${HORARIO}" (America/Sao_Paulo)`);
