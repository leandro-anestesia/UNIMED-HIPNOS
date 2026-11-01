import { ehParticular, ehUnimed } from "./campos";
import { EQUIPE_NA_PLANILHA, EQUIPE_OUTROS, EQUIPE_PARTICULAR, tituloDoAno } from "./marca";

/**
 * Para qual planilha vai cada registro.
 *
 * São três, e só três — Unimed, outros convênios e particular —, porque são
 * três as conferências: com a Unimed, com as demais operadoras e com o próprio
 * paciente. Quem decide é o convênio, sozinho.
 *
 * Houve um tempo em que o local decidia: três clínicas tinham arquivo próprio,
 * e a regra era "o local manda sobre o convênio, menos quando não manda". O
 * local continua sendo gravado e sai numa coluna das três planilhas — mas como
 * informação de onde a cirurgia foi, não como roteamento.
 *
 * O modelo continua sendo uma string, que é o que `lib/sheets.js` e
 * `lib/linha.js` carregam de um lado para o outro.
 */

/** Os três, na ordem em que aparecem em avisos e menus. */
export const MODELOS = ["convenio", "outros", "particular"];

/**
 * O modelo deste registro.
 *
 * Convênio em branco fica na Unimed: aqui ela é o caso comum, e campo vazio é
 * omissão, não afirmação de que é outro plano.
 */
export function modeloDoRegistro(entry) {
  if (ehParticular(entry)) return "particular";

  const convenio = ((entry && entry.convenio) || "").toString().trim();
  return !convenio || ehUnimed(entry) ? "convenio" : "outros";
}

/**
 * Qual jogo de colunas o modelo usa.
 *
 * Um por planilha: as três têm colunas e ordens próprias, escritas por extenso
 * em `lib/campos.js`. Antes duas delas compartilhavam o mesmo jogo, e mexer na
 * ordem de uma mexia na outra sem querer.
 */
export function conjuntoDeColunas(modelo) {
  if (modelo === "particular") return "particular";
  if (modelo === "outros") return "outros";
  return "unimed";
}

/**
 * Onde o id da planilha de cada ano fica guardado no Redis.
 *
 * A chave da Unimed não muda de nome: ela já guarda o id da planilha que existe
 * desde o começo, e renomeá-la faria o app procurar o arquivo de novo.
 */
export function chaveDoMapa(modelo) {
  if (modelo === "particular") return "guias:sheets:particular";
  if (modelo === "outros") return "guias:sheets:outros";
  return "guias:sheets";
}

/** Os modelos que aparecem nesta lista de registros, sem repetir. */
export function modelosPresentes(entries) {
  return [...new Set((entries || []).map(modeloDoRegistro))];
}

/** Como o modelo aparece numa mensagem para quem usa o app. */
export function nomeDoModelo(modelo) {
  if (modelo === "particular") return "planilha particular";
  if (modelo === "outros") return "planilha dos outros convênios";
  return "planilha da Unimed";
}

/** Como a falha do modelo é rotulada no aviso da sincronização. */
export function rotuloDaFalha(ano, modelo) {
  if (modelo === "particular") return `${ano} (particular)`;
  if (modelo === "outros") return `${ano} (outros convênios)`;
  return `${ano}`;
}

/**
 * O nome exato do arquivo deste modelo no Drive.
 *
 * A conta de serviço não cria arquivo, então o app só encontra o que já existe,
 * pelo nome — e é por isso que ele tem de ser exato.
 */
export function tituloDoModelo(ano, modelo) {
  if (modelo === "particular") return tituloDoAno(ano, EQUIPE_PARTICULAR);
  if (modelo === "outros") return tituloDoAno(ano, EQUIPE_OUTROS);
  return tituloDoAno(ano, EQUIPE_NA_PLANILHA);
}
