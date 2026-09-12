import { ehParticular } from "./campos";
import { EQUIPE_NA_PLANILHA, EQUIPE_PARTICULAR, MARCA, tituloDoAno } from "./marca";
import { normalizarTexto } from "./texto";

/**
 * Para qual planilha vai cada registro.
 *
 * São três famílias: o controle dos convênios do hospital, o das cirurgias
 * particulares do hospital e um por clínica. As duas primeiras são fixas; as
 * clínicas nascem do cadastro, em tempo de uso, e por isso o modelo deixou de
 * ser uma constante e passou a ser derivado do próprio registro.
 *
 * O modelo continua sendo uma string — é o que `lib/sheets.js` e `lib/linha.js`
 * já carregavam de um lado para o outro. O que mudou é quem a produz e quem a
 * interpreta, e isso mora tudo aqui.
 */

const PREFIXO_CLINICA = "clinica:";

/**
 * O modelo deste registro.
 *
 * O local manda sobre o convênio: cirurgia particular feita numa clínica vai
 * para a planilha da clínica, porque é com a clínica que o mês se fecha. A
 * planilha particular é a do hospital.
 */
export function modeloDoRegistro(entry) {
  const local = ((entry && entry.local) || "").toString().trim();
  if (local) return `${PREFIXO_CLINICA}${local.toUpperCase()}`;
  return ehParticular(entry) ? "particular" : "convenio";
}

/** O nome da clínica deste modelo, ou "" quando é uma das duas do hospital. */
export function localDoModelo(modelo) {
  return (modelo || "").startsWith(PREFIXO_CLINICA) ? modelo.slice(PREFIXO_CLINICA.length) : "";
}

/**
 * Qual jogo de colunas o modelo usa.
 *
 * Todas as clínicas compartilham o mesmo jogo — o que muda entre elas é o
 * arquivo, não o formato. Isso também mantém pequeno o cache de colunas de
 * `lib/linha.js`: três jogos, e não um por clínica.
 */
export function conjuntoDeColunas(modelo) {
  if (modelo === "particular") return "particular";
  return localDoModelo(modelo) ? "clinica" : "convenio";
}

/**
 * Onde o id da planilha de cada ano fica guardado no Redis.
 *
 * Chave por modelo, senão o app acharia a planilha do hospital ao procurar a de
 * uma clínica. O nome da clínica entra sem acento e sem espaço, para a chave
 * não depender de como ele foi digitado.
 */
export function chaveDoMapa(modelo) {
  const local = localDoModelo(modelo);
  if (local) return `guias:sheets:clinica:${normalizarTexto(local).replace(/\s+/g, "-")}`;
  return modelo === "particular" ? "guias:sheets:particular" : "guias:sheets";
}

/** Os modelos que aparecem nesta lista de registros, sem repetir. */
export function modelosPresentes(entries) {
  return [...new Set((entries || []).map(modeloDoRegistro))];
}

/** Como o modelo aparece numa mensagem para quem usa o app. */
export function nomeDoModelo(modelo) {
  const local = localDoModelo(modelo);
  if (local) return `planilha da ${local}`;
  return modelo === "particular" ? "planilha particular" : "planilha de convênio";
}

/** Como a falha do modelo é rotulada no aviso da sincronização. */
export function rotuloDaFalha(ano, modelo) {
  const local = localDoModelo(modelo);
  if (local) return `${ano} (${local})`;
  return modelo === "particular" ? `${ano} (particular)` : `${ano}`;
}

/**
 * O nome exato do arquivo deste modelo no Drive.
 *
 * A conta de serviço não cria arquivo, então o app só encontra o que já existe,
 * pelo nome — e é por isso que ele tem de ser exato. Para uma clínica, o nome
 * cadastrado entra onde entra UNIMED ou PARTICULAR nos outros dois.
 */
export function tituloDoModelo(ano, modelo) {
  const local = localDoModelo(modelo);
  if (local) return tituloDoAno(ano, `${local} ${MARCA}`);
  return tituloDoAno(ano, modelo === "particular" ? EQUIPE_PARTICULAR : EQUIPE_NA_PLANILHA);
}
