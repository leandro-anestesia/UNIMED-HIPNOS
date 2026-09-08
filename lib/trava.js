import { kv } from "./kv";

/**
 * Serializa um ciclo ler-modificar-gravar no Redis.
 *
 * As listas do app vivem cada uma numa chave só. Sem trava, duas gravações
 * simultâneas leem a mesma lista e a última sobrescreve a outra — some o que a
 * primeira tinha acrescentado.
 *
 * Se a trava não vier no tempo, segue sem ela: é melhor arriscar a
 * concorrência do que recusar a gravação.
 */
export async function comTrava(chave, fn, { tentativas = 50, intervalo = 100, segundos = 10 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const pegou = await kv.set(chave, "1", { nx: true, ex: segundos });
    if (pegou) {
      try {
        return await fn();
      } finally {
        await kv.del(chave);
      }
    }
    await new Promise((r) => setTimeout(r, intervalo));
  }
  console.error(`Trava ${chave} não obtida em ${(tentativas * intervalo) / 1000}s; seguindo sem ela.`);
  return fn();
}
