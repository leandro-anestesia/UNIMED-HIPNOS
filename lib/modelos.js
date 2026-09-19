import { ehParticular, ehUnimed } from "./campos";
import { temPlanilhaPropria } from "./locais";
import { EQUIPE_NA_PLANILHA, EQUIPE_OUTROS, EQUIPE_PARTICULAR, MARCA, tituloDoAno } from "./marca";
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
 * A ordem das perguntas é a ordem das decisões:
 *
 * 1. O local manda sobre tudo. Cirurgia feita numa clínica vai para a planilha
 *    da clínica, particular ou não, porque é com a clínica que o mês se fecha.
 * 2. No hospital, particular tem planilha própria.
 * 3. E o convênio separa a Unimed dos demais: a conferência da Unimed é feita
 *    com a Unimed, e a dos outros convênios é outra conversa.
 */
export function modeloDoRegistro(entry) {
  // Só o local que tem planilha própria desvia o registro. Nos demais — Vision,
  // Dimen, IGCC e companhia — a equipe opera fora do hospital, mas a conta
  // continua sendo acertada com a operadora ou com o paciente, então o local é
  // só uma coluna e quem manda é o convênio.
  const local = ((entry && entry.local) || "").toString().trim();
  if (temPlanilhaPropria(local)) return `${PREFIXO_CLINICA}${local.toUpperCase()}`;
  if (ehParticular(entry)) return "particular";

  // Convênio em branco fica na Unimed. Aqui ela é o caso comum, e registro sem
  // convênio preenchido é omissão, não afirmação de que é outro plano — e os
  // registros antigos, anteriores ao campo existir, não mudam de planilha por
  // causa disso.
  const convenio = ((entry && entry.convenio) || "").toString().trim();
  return !convenio || ehUnimed(entry) ? "convenio" : "outros";
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
  if (localDoModelo(modelo)) return "clinica";
  // A Unimed e o particular não repetem o nome do convênio em toda linha — ali
  // ele é o próprio arquivo —, e usam a coluna daquele lugar para dizer onde a
  // cirurgia foi. A planilha dos outros convênios precisa do nome: é o que
  // separa a Notre Dame da Sul América dentro do mesmo arquivo.
  if (modelo === "outros") return "outros";
  return "unimed";
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
  if (modelo === "particular") return "guias:sheets:particular";
  if (modelo === "outros") return "guias:sheets:outros";
  // A chave da Unimed não muda de nome: ela já guarda o id da planilha que
  // existe desde o começo, e renomeá-la faria o app procurar o arquivo de novo.
  return "guias:sheets";
}

/** Os modelos que aparecem nesta lista de registros, sem repetir. */
export function modelosPresentes(entries) {
  return [...new Set((entries || []).map(modeloDoRegistro))];
}

/** Como o modelo aparece numa mensagem para quem usa o app. */
export function nomeDoModelo(modelo) {
  const local = localDoModelo(modelo);
  if (local) return `planilha da ${local}`;
  if (modelo === "particular") return "planilha particular";
  if (modelo === "outros") return "planilha dos outros convênios";
  return "planilha da Unimed";
}

/** Como a falha do modelo é rotulada no aviso da sincronização. */
export function rotuloDaFalha(ano, modelo) {
  const local = localDoModelo(modelo);
  if (local) return `${ano} (${local})`;
  if (modelo === "particular") return `${ano} (particular)`;
  if (modelo === "outros") return `${ano} (outros convênios)`;
  return `${ano}`;
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
  if (modelo === "particular") return tituloDoAno(ano, EQUIPE_PARTICULAR);
  if (modelo === "outros") return tituloDoAno(ano, EQUIPE_OUTROS);
  return tituloDoAno(ano, EQUIPE_NA_PLANILHA);
}
