/**
 * Os campos de um registro, num lugar só.
 *
 * O formulário, a planilha do Google e a exportação em Excel leem daqui, então
 * acrescentar ou remover um campo é uma edição única — e as três coisas
 * continuam combinando entre si.
 */

/**
 * Campos que a foto da guia preenche.
 *
 * `cadastroKey` liga o campo à lista de nomes cadastrados: o cirurgião vem lido
 * da guia, mas continua com autocompletar, que é como se corrige uma leitura
 * ruim e se padroniza a grafia do nome.
 */
export const CAMPOS_DA_GUIA = [
  // O nome do paciente é sempre gravado em caixa alta, venha da foto ou digitado.
  { key: "paciente", label: "Paciente", maiusculo: true },
  { key: "nGuia", label: "Nº da Guia" },
  { key: "nCarteira", label: "Nº da Carteira" },
  { key: "cirurgiao", label: "Cirurgião", cadastroKey: "cirurgioes" },
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
  },
  {
    key: "anestesistaCarimbo",
    label: "Anestesista (carimbo)",
    appLabel: "Anestesista do carimbo na guia",
    cadastroKey: "anestesistas",
  },
];

/** Os dois cadastros que alimentam os autocompletares. */
export const TIPOS_DE_CADASTRO = ["cirurgioes", "anestesistas"];

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
  { key: "paciente", label: "Paciente" },
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
