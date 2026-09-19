import { HOSPITAL, temPlanilhaPropria } from "./locais";
import { normalizarTexto } from "./texto";
import { duracaoEntre } from "./tempo";

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
 * `daGuia` marca os que a foto da guia preenche. Atendimento e convênio nem
 * sempre estão impressos; quando não estão, chegam em branco e são digitados.
 *
 * `cadastroKey` liga o campo à lista de nomes cadastrados. O cirurgião vem
 * lido da guia e mesmo assim tem autocompletar, que é como se corrige uma
 * leitura ruim e se padroniza a grafia do nome.
 *
 * `aprende` faz o valor entrar no cadastro sozinho, ao salvar — convênio,
 * cirurgião e local. São listas que se repetem, e o nome já passou pela
 * conferência na tela antes de gravar.
 */
export const CAMPOS_DO_REGISTRO = [
  // Onde a cirurgia aconteceu. Vazio é o hospital, que é o caso da maioria e
  // não merece uma pergunta a mais. Preenchido, pode ser uma clínica com
  // planilha própria — e aí é ele que manda o registro para o arquivo dela — ou
  // um dos outros locais, onde ele é só a coluna que diz onde foi. Quem sabe a
  // diferença é `lib/locais.js`.
  {
    key: "local",
    label: "Local",
    appLabel: "Local (vazio = hospital)",
    cadastroKey: "locais",
    aprende: true,
    maiusculo: true,
  },
  { key: "atendimento", label: "Atendimento", daGuia: true, soHospital: true },
  // O nome do paciente é sempre gravado em caixa alta, venha da foto ou digitado.
  { key: "paciente", label: "Paciente", daGuia: true, maiusculo: true },
  // Convênio sempre em caixa alta: é lista curta e repetida, e "Unimed",
  // "unimed" e "UNIMED" viravam três convênios diferentes no cadastro.
  {
    key: "convenio",
    label: "Convênio",
    daGuia: true,
    cadastroKey: "convenios",
    aprende: true,
    maiusculo: true,
  },
  { key: "nGuia", label: "Nº da Guia", daGuia: true },
  { key: "nCarteira", label: "Nº da Carteira", daGuia: true, soHospital: true },
  // O cirurgião entra no cadastro sozinho, como o convênio. Foi decisão tomada
  // depois de rodar sem isso: a lista ficava vazia e o autocompletar não servia
  // para nada, que era pior do que o risco de ela juntar variações de grafia.
  // Quando juntar, a aba Cadastros apaga o nome errado.
  {
    key: "cirurgiao",
    label: "Cirurgião",
    daGuia: true,
    cadastroKey: "cirurgioes",
    aprende: true,
  },
  // Só a cirurgia particular é cobrada por tempo, então só nela estes dois
  // aparecem — no convênio seriam duas perguntas a mais em todo lançamento,
  // sem serventia nenhuma.
  { key: "inicio", label: "Início", appLabel: "Início da cirurgia", hora: true, soParticular: true },
  { key: "termino", label: "Término", appLabel: "Término da cirurgia", hora: true, soParticular: true },
];

/**
 * A cirurgia é particular?
 *
 * O convênio é quem decide: é ele que manda o registro para a planilha
 * particular, e é ele que faz os campos de horário aparecerem. Sem caixa e sem
 * acento, para "Particular" digitado à mão valer igual.
 */
export function ehParticular(entry) {
  return normalizarTexto(entry && entry.convenio) === "particular";
}

/**
 * A cirurgia foi numa clínica com planilha própria?
 *
 * É o que decide quais campos somem do formulário — atendimento, carteira e
 * carimbo, que a clínica não usa. Não basta o local estar preenchido: no
 * Vision, no Dimen e nos demais, a conta é acertada com a operadora e esses
 * três campos continuam valendo, como no hospital.
 */
export function ehDeClinica(entry) {
  return temPlanilhaPropria((entry && entry.local) || "");
}

/**
 * O convênio é Unimed?
 *
 * A regra do dígito verificador do nº da guia — módulo 11, começando com 1 ou
 * 2 — é da Unimed, e só dela. Aplicada às outras operadoras, ela reprovava
 * guia boa: a Sul América numera com 9 dígitos, a Notre Dame com 9, e nenhuma
 * das duas tem dígito no fim.
 *
 * Palavra inteira no começo do nome, como no resto do app: "UNIMED CAMPINAS"
 * conta, "UNIMEDICA" não.
 */
export function ehUnimed(entry) {
  const nome = normalizarTexto(entry && entry.convenio);
  return nome === "unimed" || nome.startsWith("unimed ");
}

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
    soHospital: true,
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
  "ANDRE",
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
export const CADASTROS_EM_CAIXA_ALTA = ["anestesistas", "convenios", "locais"];

/** Texto aparado e em caixa alta. */
export function emCaixaAlta(texto) {
  return (texto || "").toString().trim().toUpperCase();
}

/** Os cadastros que alimentam os autocompletares. */
export const TIPOS_DE_CADASTRO = ["cirurgioes", "anestesistas", "convenios", "locais"];

/**
 * Vários procedimentos vão para uma célula só da planilha. O separador é " · "
 * e não a vírgula porque a descrição TUSS costuma ter vírgulas dentro.
 */
export const SEPARADOR_PROCEDIMENTOS = " · ";

/**
 * Colunas de dados, na ordem em que saem na planilha e no Excel.
 *
 * Vêm depois de "Data" e "Hora do lançamento" e antes de "Executado" e
 * "Observação", que são colunas fixas.
 */
export const COLUNAS = [
  // `digitos` marca as colunas que são só número. Elas voltam da planilha com
  // desconfiança: o Google guarda número como número, e uma carteira redigitada
  // na mão volta em notação científica ou sem os zeros da frente.
  { key: "atendimento", label: "Atendimento", digitos: true },
  { key: "paciente", label: "Paciente" },
  { key: "convenio", label: "Convênio" },
  { key: "nGuia", label: "Nº da Guia", digitos: true },
  { key: "nCarteira", label: "Nº da Carteira", digitos: true },
  { key: "urgencia", label: "Urgência", booleano: true },
  { key: "procedimentos", label: "Procedimentos", lista: true },
  // Encostada nos procedimentos de propósito: é a mesma leitura, e no fim da
  // linha — onde ela ficava — obrigava a atravessar a planilha inteira para
  // conferir o que foi feito junto.
  { key: "procedimentoComplementar", label: "Procedimento complementar", lista: true },
  { key: "cirurgiao", label: "Cirurgião" },
  { key: "anestesista", label: "Anestesista" },
  { key: "anestesistaCarimbo", label: "Anestesista (carimbo)" },
];

/**
 * A coluna que diz onde a cirurgia foi feita.
 *
 * Ocupa o lugar do Convênio nas planilhas em que ele é o próprio arquivo. É
 * conta do app (`derivada`), não dado digitável: local em branco é o hospital,
 * e se a célula fosse lida de volta, o "HOSPITAL" escrito nela viraria um local
 * chamado HOSPITAL e o registro mudaria de planilha sozinho.
 */
export const COLUNA_LOCAL = {
  key: "local",
  label: "Local",
  derivada: true,
  calcular: (e) => ((e.local || "").toString().trim() || HOSPITAL),
};

/** As colunas das planilhas em que o convênio é o próprio arquivo. */
function comLocalNoLugarDoConvenio(colunas) {
  return colunas.map((c) => (c.key === "convenio" ? COLUNA_LOCAL : c));
}

/**
 * As colunas da planilha da Unimed.
 *
 * Sem a coluna Convênio: ali toda linha é Unimed, e repetir o nome em todas
 * elas era espaço gasto para não dizer nada. No lugar dela entra o local — a
 * equipe opera no hospital e em mais meia dúzia de casas, e saber onde cada
 * cirurgia foi é o que a conferência precisa e não tinha.
 */
export const COLUNAS_UNIMED = comLocalNoLugarDoConvenio(COLUNAS);

/**
 * As colunas da planilha particular.
 *
 * Enxuta: sem guia, carteira e carimbo, que não existem quando não há convênio.
 * A coluna Convênio dá lugar ao local, pela mesma razão da planilha da Unimed.
 *
 * "Horas" é a duração medida, calculada pelo app a partir do início e do
 * término. `derivada` diz que ela não volta da planilha: é conta, não dado.
 * Corrigir um horário na planilha recalcula as horas sozinho; escrever outro
 * número na coluna de horas não vale nada, e a sincronização seguinte o repõe.
 */
export const COLUNAS_PARTICULAR = [
  ...comLocalNoLugarDoConvenio(COLUNAS).filter(
    (c) => !["nGuia", "nCarteira", "anestesistaCarimbo"].includes(c.key)
  ),
  { key: "inicio", label: "Início", hora: true },
  { key: "termino", label: "Término", hora: true },
  {
    key: "duracao",
    label: "Horas",
    derivada: true,
    calcular: (e) => duracaoEntre(e.inicio, e.termino),
  },
];

/**
 * As colunas da planilha de uma clínica.
 *
 * Fora carteira, atendimento, carimbo e urgência — a clínica não usa nenhum dos
 * quatro. Sem coluna "Local", pela mesma razão de a planilha particular não ter
 * "Convênio": cada clínica tem seu arquivo, e repetir o nome em toda linha só
 * ocuparia espaço.
 *
 * A guia fica: é por ela que a clínica confere o que foi autorizado.
 */
export const COLUNAS_CLINICA = COLUNAS.filter(
  (c) => !["nCarteira", "atendimento", "anestesistaCarimbo", "urgencia"].includes(c.key)
);

/** O valor de uma coluna já em texto, pronto para a célula. */
export function valorDaColuna(entry, coluna) {
  if (coluna.calcular) return coluna.calcular(entry);

  const v = entry[coluna.key];
  if (coluna.lista) return (v || []).join(SEPARADOR_PROCEDIMENTOS);
  if (coluna.booleano) return v === true ? "Sim" : "Não";
  return v || "";
}
