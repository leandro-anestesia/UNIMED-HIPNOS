/**
 * A ordem em que os registros são lidos — na planilha, na lista do app e na
 * tela da conferência.
 *
 * Três telas mostram os mesmos registros, e cada uma ordenava do seu jeito: a
 * planilha pela ordem em que estavam gravados, o app pela hora do lançamento.
 * A mesma pergunta recebia respostas em ordens diferentes, e quem confere lê
 * as três. A regra passa a morar aqui, e as três a chamam.
 *
 * Primeiro a data da cirurgia, que é o eixo do controle. Depois a ordem de
 * lançamento, que dentro de um mesmo dia é a ordem do mapa cirúrgico: foi
 * nessa ordem que os pacientes foram lidos da folha.
 */

/**
 * Por onde o registro se ordena dentro do dia.
 *
 * É a hora em que ele foi criado — menos na cópia, que se ordena pela hora do
 * original, para cair logo depois dele. `criadoEm` da cópia continua sendo a
 * hora de verdade em que ela nasceu: quem duplica um lançamento de terça na
 * sexta não quer que o app minta sobre quando a cópia foi feita, quer que ela
 * apareça colada no original.
 */
export function chaveDeOrdem(entry) {
  return ((entry && (entry.ordenarApos || entry.criadoEm)) || "").toString();
}

/**
 * Da cirurgia mais antiga para a mais recente; dentro do dia, da primeira
 * lançada para a última, com a cópia logo depois do registro que ela copiou.
 *
 * Registro sem data vai para o fim, e não para o começo: "" ordena antes de
 * qualquer data, e o que não se sabe quando foi não pode abrir o mês.
 */
export function ordenarRegistros(a, b) {
  const da = ((a && a.dataCirurgia) || "").trim();
  const db = ((b && b.dataCirurgia) || "").trim();
  if (!da !== !db) return da ? -1 : 1;

  const porData = da.localeCompare(db);
  if (porData !== 0) return porData;

  const porOrdem = chaveDeOrdem(a).localeCompare(chaveDeOrdem(b));
  if (porOrdem !== 0) return porOrdem;

  // Mesma chave: é o original e a cópia dele. O original vem primeiro — só a
  // cópia carrega `ordenarApos`.
  const copiaA = a && a.ordenarApos ? 1 : 0;
  const copiaB = b && b.ordenarApos ? 1 : 0;
  if (copiaA !== copiaB) return copiaA - copiaB;

  // Duas cópias do mesmo original: na ordem em que foram feitas.
  return (((a && a.criadoEm) || "").toString()).localeCompare(((b && b.criadoEm) || "").toString());
}
