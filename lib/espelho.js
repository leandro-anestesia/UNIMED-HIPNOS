import { kv } from "./kv";

/**
 * A fila do espelhamento: o que está esperando para ir à planilha.
 *
 * Guarda os registros mexidos no app e os anos a reescrever. Mora no banco, e
 * não na memória de quem começou o ciclo, porque não é quem começa que termina:
 * só um espelhamento roda por vez, quem chega no meio marca pendência e vai
 * embora, e é o worker em curso que refaz a volta.
 *
 * Guardada em memória, a volta seguinte repetia a lista de quem chamou o worker
 * — e o registro de quem chegou depois ficava desprotegido na leitura da
 * planilha, que então devolvia o valor antigo por cima. Era assim que um "Não"
 * marcado no app voltava a ser "Sim" sozinho, sem ninguém sincronizar.
 *
 * Mora em `lib/` porque quem precisa dela não é só o espelhamento: a
 * sincronização manual também consulta a fila, para não ler da planilha um
 * registro cuja mudança ainda nem chegou lá.
 */

const IDS = "guias:sync:ids";
const ANOS = "guias:sync:anos";

/** Põe na fila o que uma gravação mexeu. */
export async function enfileirarParaEspelhar(anos, ids) {
  const anosLimpos = [...new Set((anos || []).filter(Boolean))];
  const idsLimpos = [...new Set((ids || []).filter(Boolean))];
  if (anosLimpos.length > 0) await kv.sadd(ANOS, ...anosLimpos);
  if (idsLimpos.length > 0) await kv.sadd(IDS, ...idsLimpos);
}

/** O que está acumulado agora, sem consumir: quem usa só apaga no fim. */
export async function pendenciasDoEspelhamento() {
  const [anos, ids] = await Promise.all([kv.smembers(ANOS), kv.smembers(IDS)]);
  return { anos: anos || [], ids: ids || [] };
}

/**
 * Tira da fila exatamente o que foi usado — nem mais, nem menos.
 *
 * Apagar a chave inteira perderia o que chegou enquanto o ciclo rodava. Tirar
 * só o que foi lido deixa o recém-chegado na fila: ele entra na volta seguinte,
 * protegido. O preço é um registro ficar protegido um ciclo a mais do que o
 * necessário, o que no máximo adia em uma volta a leitura de uma correção feita
 * direto na planilha.
 */
export async function consumirPendencias({ anos, ids }) {
  await Promise.all([
    anos.length > 0 ? kv.srem(ANOS, ...anos) : null,
    ids.length > 0 ? kv.srem(IDS, ...ids) : null,
  ]);
}
