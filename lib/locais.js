import { normalizarTexto } from "./texto";

/**
 * Como o local vazio aparece — na tela e na coluna Local da planilha.
 *
 * Vazio é o hospital, que é o caso da maioria e por isso não merece uma
 * pergunta a mais no formulário. Guardado em branco, escrito por extenso.
 */
export const HOSPITAL = "HOSPITAL";

/**
 * Os locais onde a equipe opera, e o que cada um significa na hora de fechar o
 * mês.
 *
 * Há dois tipos, e a diferença não é de tamanho nem de nome — é com quem a
 * conta é acertada:
 *
 * - **Local com planilha própria**: a conferência é feita com a clínica, que
 *   paga direto. Tudo que foi feito lá vai para o arquivo dela, seja qual for o
 *   convênio, inclusive particular.
 * - **Local sem planilha própria**: a equipe opera lá, mas a conta continua
 *   sendo acertada com a operadora ou com o paciente. O local vira só uma
 *   coluna na planilha, dizendo onde foi; quem manda no arquivo é o convênio,
 *   igual ao hospital.
 *
 * Os seis do segundo grupo entraram pedidos de uma vez; os três do primeiro são
 * os que têm arquivo no Drive. Para promover um local a planilha própria basta
 * movê-lo de lista aqui — e criar o arquivo no Drive com o nome exato, que é
 * montado a partir deste nome (`tituloDoModelo`).
 */
export const LOCAIS_COM_PLANILHA = [
  "OFTALMOLOGIA NOVA CAMPINAS",
  "VERMAIS",
  "CENTRO DE CIRURGIA OFTALMOLOGICA",
];

export const LOCAIS_SEM_PLANILHA = [
  "VISION",
  "SAO LUIZ CAMPINAS",
  "DIMEN",
  "IGCC",
  "SAMARITANO SANTA BARBARA",
  "SPAZIO (GASTÃO)",
];

/**
 * Os locais que o app já oferece sem ninguém ter cadastrado.
 *
 * O cadastro continua aprendendo sozinho, como sempre; estes são só o ponto de
 * partida, para não ser preciso digitar nove nomes à mão no primeiro uso.
 */
export const LOCAIS_PADRAO = [...LOCAIS_COM_PLANILHA, ...LOCAIS_SEM_PLANILHA];

/**
 * Este local tem planilha própria?
 *
 * Comparação sem caixa e sem acento: o nome pode ter sido cadastrado com outra
 * grafia, e errar aqui manda o registro para o arquivo errado.
 */
export function temPlanilhaPropria(local) {
  const nome = normalizarTexto(local || "");
  if (!nome) return false;
  return LOCAIS_COM_PLANILHA.some((l) => normalizarTexto(l) === nome);
}
