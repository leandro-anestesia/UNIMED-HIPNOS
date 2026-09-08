import { normalizarTexto } from "./texto";

/**
 * Os campos de um registro, num lugar só.
 *
 * O formulário, a planilha do Google e a exportação em Excel leem daqui, então
 * acrescentar ou remover um campo é uma edição única — e as três coisas
 * continuam combinando entre si.
 */

/**
 * Os campos do registro que não são os dois do anestesista.
 *
 * `daGuia` marca os que a foto da guia preenche. Prontuário e convênio nem
 * sempre estão impressos; quando não estão, chegam em branco e são digitados.
 *
 * `cadastroKey` liga o campo à lista de nomes cadastrados. O cirurgião vem
 * lido da guia e mesmo assim tem autocompletar, que é como se corrige uma
 * leitura ruim e se padroniza a grafia do nome.
 *
 * `aprende` faz o valor entrar no cadastro sozinho, ao salvar. Só o convênio,
 * que é uma lista curta e conferida na tela antes de gravar; o cirurgião não,
 * porque cada guia traz um nome novo e a lista viraria depósito de erros de
 * leitura.
 */
export const CAMPOS_DO_REGISTRO = [
  { key: "prontuario", label: "Prontuário", daGuia: true },
  // O nome do paciente é sempre gravado em caixa alta, venha da foto ou digitado.
  { key: "paciente", label: "Paciente", daGuia: true, maiusculo: true },
  { key: "convenio", label: "Convênio", daGuia: true, cadastroKey: "convenios", aprende: true },
  { key: "nGuia", label: "Nº da Guia", daGuia: true },
  { key: "nCarteira", label: "Nº da Carteira", daGuia: true },
  { key: "cirurgiao", label: "Cirurgião", daGuia: true, cadastroKey: "cirurgioes" },
];

/**
 * Os dois campos que o anestesista digita.
 *
 * Quem aplicou a anestesia e de quem é o carimbo na guia podem ser pessoas
 * diferentes — por isso são dois campos, e não um.
 *
 * `label` é o nome da coluna na planilha; `appLabel` é o rótulo mais longo que
 * cabe no formulário.
 */
export const CAMPOS_MANUAIS = [
  {
    key: "anestesista",
    label: "Anestesista",
    appLabel: "Anestesista que fez o procedimento",
    cadastroKey: "anestesistas",
    required: true,
    maiusculo: true,
  },
  {
    key: "anestesistaCarimbo",
    label: "Anestesista (carimbo)",
    appLabel: "Anestesista do carimbo na guia",
    cadastroKey: "anestesistas",
    maiusculo: true,
    // Carimbo é de quem tem carimbo: a lista deste campo é o cadastro filtrado.
    somenteComCarimbo: true,
  },
];

/**
 * Quem tem carimbo próprio na Unimed.
 *
 * Guardado pelo primeiro nome, e com o sobrenome só onde ele é necessário para
 * separar dois homônimos: o nome completo mora no cadastro, e é de lá que sai
 * a lista que aparece na tela. Assim, corrigir a grafia de um nome no cadastro
 * não obriga a mexer aqui.
 */
export const ANESTESISTAS_COM_CARIMBO = [
  "FRANCISCO",
  "HEITOR",
  "JEFFERSON",
  "LEANDRO",
  "LUCIANO",
  "OTAVIO FERREIRA",
  "RODRIGO",
  "ROGERIO",
];

/**
 * Este nome completo é de alguém com carimbo?
 *
 * O primeiro nome tem de ser o mesmo, e os demais pedaços da chave precisam
 * aparecer no nome — "OTAVIO FERREIRA" acha "OTAVIO AUGUSTO FERREIRA LIMA" e
 * não acha um outro Otávio. Comparação sem caixa e sem acento.
 */
export function temCarimbo(nomeCompleto) {
  const palavras = normalizarTexto(nomeCompleto).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return false;

  return ANESTESISTAS_COM_CARIMBO.some((chave) => {
    const [primeiro, ...resto] = normalizarTexto(chave).split(/\s+/).filter(Boolean);
    return palavras[0] === primeiro && resto.every((pedaco) => palavras.includes(pedaco));
  });
}

/** Campos, dos dois grupos, cujo valor digitado alimenta o cadastro sozinho. */
export const CAMPOS_QUE_APRENDEM = [...CAMPOS_DO_REGISTRO, ...CAMPOS_MANUAIS].filter(
  (f) => f.aprende && f.cadastroKey
);

/**
 * Cadastros guardados em caixa alta.
 *
 * A lista é o que alimenta o autocompletar, então padronizá-la aqui já resolve
 * o formulário: escolher um nome cadastrado grava em caixa alta sozinho.
 */
export const CADASTROS_EM_CAIXA_ALTA = ["anestesistas"];

/** Texto aparado e em caixa alta. */
export function emCaixaAlta(texto) {
  return (texto || "").toString().trim().toUpperCase();
}

/** Os cadastros que alimentam os autocompletares. */
export const TIPOS_DE_CADASTRO = ["cirurgioes", "anestesistas", "convenios"];

/**
 * Vários procedimentos vão para uma célula só da planilha. O separador é " · "
 * e não a vírgula porque a descrição TUSS costuma ter vírgulas dentro.
 */
export const SEPARADOR_PROCEDIMENTOS = " · ";

/**
 * Colunas de dados, na ordem em que saem na planilha e no Excel.
 *
 * Vêm depois de "Data" e "Hora do lançamento" e antes de "Executado",
 * "Procedimento complementar" e "Observação", que são colunas fixas.
 */
export const COLUNAS = [
  { key: "prontuario", label: "Prontuário" },
  { key: "paciente", label: "Paciente" },
  { key: "convenio", label: "Convênio" },
  { key: "nGuia", label: "Nº da Guia" },
  { key: "nCarteira", label: "Nº da Carteira" },
  { key: "urgencia", label: "Urgência", booleano: true },
  { key: "procedimentos", label: "Procedimentos", lista: true },
  { key: "cirurgiao", label: "Cirurgião" },
  { key: "anestesista", label: "Anestesista" },
  { key: "anestesistaCarimbo", label: "Anestesista (carimbo)" },
];

/** O valor de uma coluna já em texto, pronto para a célula. */
export function valorDaColuna(entry, coluna) {
  const v = entry[coluna.key];
  if (coluna.lista) return (v || []).join(SEPARADOR_PROCEDIMENTOS);
  if (coluna.booleano) return v === true ? "Sim" : "Não";
  return v || "";
}
