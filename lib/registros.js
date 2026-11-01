import { kv } from "./kv";
import { comTrava } from "./trava";

/**
 * Onde os registros moram, e a única porta por onde se entra neles.
 *
 * Antes era uma chave só no Redis, `guias:entries`, com todas as cirurgias
 * dentro. Toda gravação lia o pacote inteiro, mudava uma linha e reescrevia o
 * pacote inteiro. Com centenas de registros não se notava; a algumas centenas
 * por mês, em um ano seriam milhares, e cada abertura de tela passaria a baixar
 * o ano todo.
 *
 * Agora é **uma chave por mês** — `guias:entries:2026-11` —, que é como o app
 * já pensa: o seletor de mês, as abas da planilha, o fechamento da secretária.
 * Um índice leve guarda quais meses existem, para não ser preciso varrer o
 * banco à procura.
 *
 * As rotas falam com este arquivo, e não com o Redis. É isso que deixa trocar
 * o armazenamento um dia — por um banco relacional, se a conferência crescer —
 * mexendo só aqui.
 */

const PREFIXO = "guias:entries:";
const INDICE = `${PREFIXO}meses`;
const TRAVA_DO_INDICE = `${PREFIXO}trava:indice`;

/**
 * Onde fica o registro sem data.
 *
 * Não deveria existir — a data é preenchida sozinha —, mas uma linha digitada
 * à mão na planilha pode chegar sem ela, e um registro sem lugar no banco é um
 * registro perdido.
 */
const SEM_DATA = "sem-data";

/** O mês de um registro, no formato "AAAA-MM". */
export function mesDe(entry) {
  return ((entry && entry.dataCirurgia) || "").slice(0, 7) || SEM_DATA;
}

function chave(mes) {
  return `${PREFIXO}${mes || SEM_DATA}`;
}

/** Os meses que têm registro, do mais novo para o mais antigo. */
export async function mesesComRegistro() {
  const lista = (await kv.get(INDICE)) || [];
  return [...lista].sort().reverse();
}

/**
 * Mantém o índice de meses em dia.
 *
 * Sob trava própria: dois meses diferentes sendo gravados ao mesmo tempo leriam
 * o mesmo índice e o último apagaria a entrada do outro — e o mês some das
 * telas, mesmo com os registros intactos na chave dele.
 */
async function ajustarIndice(mes, existe) {
  await comTrava(TRAVA_DO_INDICE, async () => {
    const lista = (await kv.get(INDICE)) || [];
    const tem = lista.includes(mes);
    if (existe === tem) return;
    await kv.set(INDICE, existe ? [...lista, mes].sort() : lista.filter((m) => m !== mes));
  });
}

/** Os registros de um mês. */
export async function lerMes(mes) {
  return (await kv.get(chave(mes))) || [];
}

/** Os registros de vários meses, numa leitura só. */
export async function lerMeses(meses) {
  if (!meses || meses.length === 0) return [];
  const pacotes = await kv.mget(...meses.map(chave));
  return pacotes.flatMap((p) => p || []);
}

/** Todos os registros. */
export async function lerTudo() {
  return lerMeses(await mesesComRegistro());
}

/** Os registros de um ano. */
export async function lerAno(ano) {
  const meses = await mesesComRegistro();
  return lerMeses(meses.filter((m) => m.startsWith(`${ano}-`)));
}

/** Grava a lista de um mês, tirando o mês do índice quando ela esvazia. */
async function gravarMes(mes, entries) {
  if (entries.length === 0) {
    await kv.del(chave(mes));
    await ajustarIndice(mes, false);
    return;
  }
  await kv.set(chave(mes), entries);
  await ajustarIndice(mes, true);
}

/**
 * Serializa o ciclo ler-modificar-gravar de um mês.
 *
 * A trava é por mês, e não global: dois anestesiologistas lançando em meses
 * diferentes deixam de esperar um pelo outro, que é o caso comum na virada.
 */
function comTravaDoMes(mes, fn) {
  return comTrava(`${PREFIXO}trava:${mes}`, fn);
}

/** Em que mês está este id, ou null se ele não existe. */
async function mesDoId(id) {
  const meses = await mesesComRegistro();
  const pacotes = await kv.mget(...meses.map(chave));
  const i = pacotes.findIndex((p) => (p || []).some((e) => e.id === id));
  return i >= 0 ? meses[i] : null;
}

/**
 * Acrescenta um registro, devolvendo a duplicata quando houver.
 *
 * `acharDuplicata` só precisa olhar o mês do próprio registro: duplicata é o
 * mesmo paciente no mesmo dia, e isso não atravessa meses.
 */
export async function acrescentar(entry, acharDuplicata) {
  const mes = mesDe(entry);
  return comTravaDoMes(mes, async () => {
    const entries = await lerMes(mes);

    if (acharDuplicata) {
      const existente = acharDuplicata(entries, entry);
      if (existente) return { duplicada: existente };
    }

    await gravarMes(mes, [entry, ...entries]);
    return { duplicada: null };
  });
}

/**
 * Acrescenta vários de uma vez — é o mapa cirúrgico virando lista.
 *
 * Agrupa por mês para pegar uma trava por mês, e não uma por registro. Um mapa
 * é de um dia só, então na prática é uma trava; o agrupamento está aqui porque
 * custa três linhas e evita a surpresa de um mapa que atravessa a virada.
 */
export async function acrescentarVarios(novos, acharDuplicata) {
  const porMes = {};
  novos.forEach((e) => {
    const mes = mesDe(e);
    porMes[mes] = porMes[mes] || [];
    porMes[mes].push(e);
  });

  const gravados = [];
  const duplicados = [];

  for (const [mes, doMes] of Object.entries(porMes)) {
    await comTravaDoMes(mes, async () => {
      const entries = await lerMes(mes);
      const novosDoMes = [];

      for (const entry of doMes) {
        // Compara contra a lista que vai crescendo: pega também o mapa que traz
        // o mesmo paciente duas vezes.
        if (acharDuplicata([...entries, ...novosDoMes], entry)) {
          duplicados.push(entry.paciente);
          continue;
        }
        novosDoMes.push(entry);
        gravados.push(entry);
      }

      if (novosDoMes.length > 0) await gravarMes(mes, [...novosDoMes, ...entries]);
    });
  }

  return { gravados, duplicados };
}

/**
 * Atualiza um registro, devolvendo como ele estava antes.
 *
 * Mudar a data muda o mês, e com isso a chave: o registro sai de uma e entra na
 * outra. É o caso delicado deste arquivo — feito errado, ele fica nas duas ou
 * em nenhuma.
 */
export async function atualizar(updated) {
  const mesNovo = mesDe(updated);

  // O caminho comum: a data não mudou, e o registro já está no mês certo.
  const anterior = await comTravaDoMes(mesNovo, async () => {
    const entries = await lerMes(mesNovo);
    const antes = entries.find((e) => e.id === updated.id);
    if (!antes) return undefined;

    await gravarMes(
      mesNovo,
      entries.map((e) =>
        e.id === updated.id ? { ...updated, criadoEm: e.criadoEm || updated.criadoEm } : e
      )
    );
    return antes;
  });
  if (anterior !== undefined) return anterior;

  // Mudou de mês, ou é registro que ainda não existe.
  const mesVelho = await mesDoId(updated.id);
  let antes = null;

  if (mesVelho) {
    antes = await comTravaDoMes(mesVelho, async () => {
      const entries = await lerMes(mesVelho);
      const achado = entries.find((e) => e.id === updated.id) || null;
      await gravarMes(mesVelho, entries.filter((e) => e.id !== updated.id));
      return achado;
    });
  }

  await comTravaDoMes(mesNovo, async () => {
    const entries = await lerMes(mesNovo);
    const guardado = { ...updated, criadoEm: (antes && antes.criadoEm) || updated.criadoEm };
    await gravarMes(mesNovo, [guardado, ...entries.filter((e) => e.id !== updated.id)]);
  });

  return antes;
}

/** Apaga um registro, devolvendo o que foi apagado. */
export async function apagar(id) {
  const mes = await mesDoId(id);
  if (!mes) return null;

  return comTravaDoMes(mes, async () => {
    const entries = await lerMes(mes);
    const alvo = entries.find((e) => e.id === id) || null;
    await gravarMes(mes, entries.filter((e) => e.id !== id));
    return alvo;
  });
}

/**
 * Regrava o conjunto inteiro, reagrupado por mês.
 *
 * Usado pelos dois caminhos que mexem em muita coisa de uma vez: a leitura de
 * volta da planilha e a normalização da sincronização. Mês que ficou sem
 * registro é apagado, senão a lista dele sobreviveria à própria exclusão.
 */
export async function gravarTudo(entries) {
  const porMes = {};
  entries.forEach((e) => {
    const mes = mesDe(e);
    porMes[mes] = porMes[mes] || [];
    porMes[mes].push(e);
  });

  const antes = await mesesComRegistro();
  for (const mes of new Set([...antes, ...Object.keys(porMes)])) {
    await gravarMes(mes, porMes[mes] || []);
  }
}
