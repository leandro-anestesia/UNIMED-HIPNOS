import { rotuloDe } from "./estados";
import { NOMES_DE_LOCAL } from "./locais";
import { normalizarTexto } from "./texto";
import { duracaoEntre, formatarData, horaDoRegistro } from "./tempo";

/**
 * Os campos de um registro, num lugar só.
 *
 * O formulário, a planilha do Google e a exportação em Excel leem daqui, então
 * acrescentar ou remover um campo é uma edição única — e as três coisas
 * continuam combinando entre si.
 */

/**
 * Os campos do registro que não são os dois do anestesiologista.
 *
 * `daGuia` marca os que a foto da guia preenche. Atendimento e convênio nem
 * sempre estão impressos; quando não estão, chegam em branco e são digitados.
 *
 * `cadastroKey` liga o campo à lista de nomes cadastrados. O cirurgião vem
 * lido da guia e mesmo assim tem autocompletar, que é como se corrige uma
 * leitura ruim e se padroniza a grafia do nome.
 *
 * `aprende` faz o valor entrar no cadastro sozinho, ao salvar — convênio,
 * cirurgião e quem recebeu. São listas que se repetem, e o nome já passou pela
 * conferência na tela antes de gravar.
 */
export const CAMPOS_DO_REGISTRO = [
  // Onde a cirurgia aconteceu. Escolha obrigatória entre os locais da
  // lista, e não mais texto livre: o local deixou de decidir a planilha e virou
  // informação, mas informação que só serve se estiver sempre escrita igual.
  {
    key: "local",
    label: "Local",
    opcoes: NOMES_DE_LOCAL,
    required: true,
  },
  { key: "atendimento", label: "Atendimento", daGuia: true },
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
  // Guia e carteira não existem sem operadora, e a planilha particular não tem
  // essas colunas: perguntá-las ali seriam duas perguntas sem resposta em todo
  // lançamento, e a resposta não teria onde ser escrita.
  { key: "nGuia", label: "Nº da Guia", daGuia: true, naoParticular: true },
  { key: "nCarteira", label: "Nº da Carteira", daGuia: true, naoParticular: true },
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
  // O combinado com o paciente, e se ele já pagou. Também só no particular: é a
  // única cobrança que a equipe acerta diretamente.
  { key: "valor", label: "Valor", moeda: true, soParticular: true },
  {
    key: "recebido",
    label: "Recebido",
    escolha: "recebido",
    soParticular: true,
  },
  {
    key: "quemRecebeu",
    label: "Quem Recebeu",
    cadastroKey: "recebedores",
    aprende: true,
    maiusculo: true,
    soParticular: true,
  },
];

/**
 * A cirurgia é particular?
 *
 * O convênio é quem decide: é ele que manda o registro para a planilha
 * particular, e é ele que faz os campos de horário e cobrança aparecerem. Sem
 * caixa e sem acento, para "Particular" digitado à mão valer igual.
 */
export function ehParticular(entry) {
  return normalizarTexto(entry && entry.convenio) === "particular";
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
 * Os dois campos que o anestesiologista digita.
 *
 * Quem aplicou a anestesia e sob qual credencial da Unimed o procedimento é
 * lançado podem ser pessoas diferentes — por isso são dois campos, e não um.
 *
 * `label` é o nome da coluna na planilha; `appLabel` é o rótulo mais longo que
 * cabe no formulário.
 */
export const CAMPOS_MANUAIS = [
  {
    key: "anestesista",
    label: "Anestesiologista",
    appLabel: "Anestesiologista que fez o procedimento",
    cadastroKey: "anestesistas",
    required: true,
    maiusculo: true,
  },
  {
    key: "anestesistaCarimbo",
    label: "Anestesiologista Unimed",
    appLabel: "Anestesiologista Unimed do procedimento",
    cadastroKey: "anestesistas",
    maiusculo: true,
    // A lista deste campo é o cadastro filtrado por quem é credenciado.
    somenteDaUnimed: true,
    // E o campo só existe na conferência da Unimed: é a única das três
    // planilhas com essa coluna.
    soUnimed: true,
  },
];

/**
 * Quem é credenciado na Unimed.
 *
 * Guardado pelo primeiro nome, e com o sobrenome só onde ele é necessário para
 * separar dois homônimos: o nome completo mora no cadastro, e é de lá que sai
 * a lista que aparece na tela. Assim, corrigir a grafia de um nome no cadastro
 * não obriga a mexer aqui.
 */
export const ANESTESIOLOGISTAS_UNIMED = [
  "ANDRE",
  "FRANCISCO",
  "HEITOR",
  "JEFFERSON",
  "LEANDRO",
  "LUCIANO",
  "MARINA",
  "OTAVIO FERREIRA",
  "RODRIGO",
  "ROGERIO",
];

/**
 * Este nome completo é de um credenciado da Unimed?
 *
 * O primeiro nome tem de ser o mesmo, e os demais pedaços da chave precisam
 * aparecer no nome — "OTAVIO FERREIRA" acha "OTAVIO AUGUSTO FERREIRA LIMA" e
 * não acha um outro Otávio. Comparação sem caixa e sem acento.
 */
export function ehDaUnimed(nomeCompleto) {
  const palavras = normalizarTexto(nomeCompleto).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return false;

  return ANESTESIOLOGISTAS_UNIMED.some((chave) => {
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
export const CADASTROS_EM_CAIXA_ALTA = ["anestesistas", "convenios", "recebedores"];

/** Texto aparado e em caixa alta. */
export function emCaixaAlta(texto) {
  return (texto || "").toString().trim().toUpperCase();
}

/**
 * Os cadastros que alimentam os autocompletares.
 *
 * Os locais saíram: viraram lista fechada em `lib/locais.js`, e um cadastro que
 * aprende sozinho ao lado de uma lista fechada só serviria para criar um décimo
 * terceiro local escrito torto.
 */
export const TIPOS_DE_CADASTRO = ["cirurgioes", "anestesistas", "convenios", "recebedores"];

/**
 * Vários procedimentos vão para uma célula só da planilha. O separador é " · "
 * e não a vírgula porque a descrição TUSS costuma ter vírgulas dentro.
 */
export const SEPARADOR_PROCEDIMENTOS = " · ";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * As colunas de cada planilha
 *
 * Três listas escritas por extenso, e não filtros sobre uma lista comum. Elas
 * já nasceram de filtros, e o preço apareceu rápido: mexer na ordem de uma
 * mexia na ordem da outra sem ninguém pedir, e tirar uma coluna de uma tirava
 * das três. São três conferências diferentes, com gente diferente; que se
 * pareçam é coincidência útil, não regra.
 *
 * Cada lista vem depois de "Executado" e antes do ID oculto — esses dois são
 * fixos e moram em `lib/linha.js`.
 *
 * `digitos` marca as colunas que são só número. Elas voltam da planilha com
 * desconfiança: o Google guarda número como número, e uma carteira redigitada
 * na mão volta em notação científica ou sem os zeros da frente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A coluna que abre as três planilhas.
 *
 * Mora aqui, e não só em `lib/linha.js`, para a exportação em Excel e a
 * planilha do Google lerem a mesma definição — foi assim que a ordem das
 * colunas deixou de divergir entre as duas.
 */
export const COLUNA_EXECUTADO = { key: "executado", label: "Executado", escolha: "executado" };

const COL = {
  data: { key: "dataCirurgia", label: "Data", data: true },
  horaLancamento: { key: "horaLancamento", label: "Hora do lançamento", horaLancamento: true },
  local: { key: "local", label: "Local" },
  convenio: { key: "convenio", label: "Convênio" },
  atendimento: { key: "atendimento", label: "Atendimento", digitos: true },
  paciente: { key: "paciente", label: "Paciente" },
  procedimentos: { key: "procedimentos", label: "Procedimentos", lista: true },
  procedimentoComplementar: {
    key: "procedimentoComplementar",
    label: "Procedimento complementar",
    lista: true,
  },
  pcExecutado: { key: "pcExecutado", label: "PC Executado", escolha: "pcExecutado" },
  cirurgiao: { key: "cirurgiao", label: "Cirurgião" },
  nGuia: { key: "nGuia", label: "Nº da Guia", digitos: true },
  nCarteira: { key: "nCarteira", label: "Nº da Carteira", digitos: true },
  anestesistaCarimbo: { key: "anestesistaCarimbo", label: "Anestesiologista Unimed" },
  anestesista: { key: "anestesista", label: "Anestesiologista" },
  observacao: { key: "observacao", label: "Observação" },
  inicio: { key: "inicio", label: "Início", hora: true },
  termino: { key: "termino", label: "Término", hora: true },
  // Duração medida, calculada a partir do início e do término. `derivada` diz
  // que ela não volta da planilha: é conta, não dado. Corrigir um horário
  // recalcula as horas sozinho; escrever outro número na coluna não vale nada,
  // e a sincronização seguinte o repõe.
  duracao: {
    key: "duracao",
    label: "Horas",
    derivada: true,
    calcular: (e) => duracaoEntre(e.inicio, e.termino),
  },
  valor: { key: "valor", label: "Valor", moeda: true },
  recebido: { key: "recebido", label: "Recebido", escolha: "recebido" },
  quemRecebeu: { key: "quemRecebeu", label: "Quem Recebeu" },
};

/**
 * A planilha da Unimed.
 *
 * Sem a coluna Convênio: ali toda linha é Unimed, e repetir o nome em todas
 * elas era espaço gasto para não dizer nada. É a única das três com a hora do
 * lançamento, e a única com o anestesiologista credenciado — as duas coisas que
 * só a conferência com a operadora usa.
 */
export const COLUNAS_UNIMED = [
  COL.data,
  COL.horaLancamento,
  COL.local,
  COL.atendimento,
  COL.paciente,
  COL.procedimentos,
  COL.procedimentoComplementar,
  COL.pcExecutado,
  COL.cirurgiao,
  COL.nGuia,
  COL.nCarteira,
  COL.anestesistaCarimbo,
  COL.observacao,
  COL.anestesista,
];

/**
 * A planilha dos outros convênios.
 *
 * Aqui o Convênio é essencial: é o que separa a Notre Dame da Sul América
 * dentro do mesmo arquivo. Não tem o credenciamento da Unimed, que não existe
 * fora dela, nem o PC Executado, que é controle da conferência da Unimed.
 */
export const COLUNAS_OUTROS = [
  COL.data,
  COL.local,
  COL.convenio,
  COL.atendimento,
  COL.paciente,
  COL.procedimentos,
  COL.procedimentoComplementar,
  COL.cirurgiao,
  COL.nGuia,
  COL.nCarteira,
  COL.anestesista,
  COL.observacao,
];

/**
 * A planilha particular.
 *
 * Sem guia, carteira e procedimento complementar — nada disso existe quando não
 * há operadora. No lugar entram o tempo e o dinheiro, que é como esta cobrança
 * se faz: início, término, horas, valor, se recebeu e de quem.
 */
export const COLUNAS_PARTICULAR = [
  COL.data,
  COL.local,
  COL.atendimento,
  COL.paciente,
  COL.procedimentos,
  COL.cirurgiao,
  COL.inicio,
  COL.termino,
  COL.duracao,
  COL.valor,
  COL.anestesista,
  COL.recebido,
  COL.quemRecebeu,
  COL.observacao,
];

/**
 * O valor de uma coluna já em texto, pronto para a célula.
 *
 * É o único lugar que traduz coluna em conteúdo: a planilha do Google, a
 * exportação em Excel e a tela da conferência leem daqui. Em dois lugares, uma
 * coluna nova apareceria num e faltaria no outro — já aconteceu.
 */
export function valorDaColuna(entry, coluna) {
  if (coluna.calcular) return coluna.calcular(entry);
  if (coluna.data) return formatarData(entry.dataCirurgia);
  if (coluna.horaLancamento) return horaDoRegistro(entry);
  if (coluna.escolha) return rotuloDe(coluna.escolha, entry[coluna.key]);

  const v = entry[coluna.key];
  if (coluna.lista) return (v || []).join(SEPARADOR_PROCEDIMENTOS);
  // Dinheiro sai como número cru, sem símbolo: quem põe o "R$" e a vírgula é o
  // formato da coluna, e é isso que deixa a coluna ser somada.
  if (coluna.moeda) return v === "" || v == null ? "" : String(v);
  return v || "";
}
