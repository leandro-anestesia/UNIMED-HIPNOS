import { normalizarTexto } from "./texto";

/**
 * O que a guia lista junto dos procedimentos e não é ato anestésico.
 *
 * A guia da operadora não separa o que o anestesiologista fez do que o hospital
 * cobrou: na mesma tabela de "Procedimentos ou Itens Assistenciais" entram a
 * diária de internação, a visita hospitalar e a assistência ao recém-nascido.
 * Vinham para o aplicativo como procedimento, iam para a planilha e alguém
 * apagava à mão, guia por guia.
 *
 * `acha` procura o termo em QUALQUER parte da descrição, e não só no começo:
 * "DIÁRIA DE INTERNAÇÃO" e "99996666 - INTERNACAO" são a mesma linha escrita de
 * dois jeitos. O plural está nos padrões porque a impressão varia — "VISITAS
 * HOSPITALARES", "RECEM NASCIDOS" — e um "s" não muda o que a linha é.
 *
 * A comparação é feita sobre o texto sem acento, sem pontuação e em minúsculas,
 * então "RECÉM-NASCIDO", "RECEM NASCIDO" e "recém nascido" caem todos aqui.
 */
export const PROCEDIMENTOS_IGNORADOS = [
  { nome: "internação", acha: /internac(?:ao|oes)/ },
  { nome: "visita hospitalar", acha: /visitas? hospitalar(?:es)?/ },
  { nome: "recém-nascido", acha: /recem nascidos?/ },
  // A anestesia para endoscopia diagnóstica, que a guia do IGCC lista junto do
  // exame. Não é item do hospital como as três de cima: é a própria anestesia,
  // e a equipe não a lança como procedimento — toda cirurgia da lista tem
  // anestesia, e repeti-la linha a linha não controla nada.
  //
  // Esta sai pelo CÓDIGO, e não pelo texto: "anestesia para endoscopia" também
  // abre a descrição da terapêutica, que é outro código e não está em questão.
  // O texto fica como segunda rede, para a folha cujo código não se leu.
  {
    nome: "anestesia para endoscopia diagnóstica",
    codigo: "31602231",
    acha: /anestesia para endoscopia diagnostica/,
  },
  // Sai só pelo CÓDIGO, porque é por ele que a equipe o identifica. Sem o
  // texto, a linha ainda cai aqui quando o código foi lido — que é o caso
  // normal, já que a guia imprime o código na frente da descrição.
  { nome: "código 41301471", codigo: "41301471" },
];

/** Os termos que saem pelo texto da descrição. */
export const IGNORADOS_POR_TEXTO = PROCEDIMENTOS_IGNORADOS.filter((t) => t.acha);

/** Os códigos que saem sozinhos, seja qual for a descrição ao lado. */
export const IGNORADOS_POR_CODIGO = PROCEDIMENTOS_IGNORADOS.filter((t) => t.codigo);

/**
 * A descrição do procedimento, sem o código TUSS que vem na frente.
 *
 * A guia imprime "31309127 - PARTO (VIA VAGINAL)"; o que interessa à regra é o
 * que vem depois do traço. Tirar o código também evita que um número coincida
 * com um termo quando a comparação some a pontuação.
 */
function descricao(procedimento) {
  return (procedimento || "").toString().replace(/^\s*\d+\s*[-–—]\s*/, "");
}

/** O código TUSS que abre a linha, quando ela tem um. */
function codigoDo(procedimento) {
  return ((procedimento || "").toString().trim().match(/^\d+/) || [""])[0];
}

/**
 * O texto pronto para comparar: sem acento, minúsculo, e com a pontuação
 * virando espaço — é o que junta "RECÉM-NASCIDO" com "RECEM NASCIDO".
 */
function paraComparar(procedimento) {
  return normalizarTexto(descricao(procedimento))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Esta linha é uma das que não entram? Devolve o nome do termo, ou "". */
export function termoIgnorado(procedimento) {
  const texto = paraComparar(procedimento);
  const codigo = codigoDo(procedimento);
  if (!texto && !codigo) return "";

  const achado = PROCEDIMENTOS_IGNORADOS.find(
    (t) => (t.codigo && t.codigo === codigo) || (t.acha && texto && t.acha.test(texto))
  );
  return achado ? achado.nome : "";
}

/** Esta linha é uma das que não entram? */
export function ehIgnorado(procedimento) {
  return termoIgnorado(procedimento) !== "";
}

/**
 * A lista limpa: sem espaço sobrando, sem entrada vazia e sem as linhas que não
 * são ato anestésico.
 *
 * Mora aqui, e não dentro de cada rota, porque são duas as leituras que
 * devolvem procedimento — a guia/etiqueta e o mapa cirúrgico — e a regra que
 * ficasse em uma só deixaria a outra passar.
 */
export function semOsIgnorados(lista) {
  const entradas = Array.isArray(lista) ? lista : lista ? [lista] : [];
  return entradas
    .map((p) => (p || "").toString().trim())
    .filter(Boolean)
    .filter((p) => !ehIgnorado(p));
}

/**
 * O que não pode ser o procedimento PRINCIPAL, porque é cobrado à parte.
 *
 * A assistência ao trabalho de parto é o caso: a guia a lista junto do parto, e
 * quem lança às vezes a traz para o campo principal. Mas ela não é o ato
 * cirúrgico — é complementar, cobrada por hora, até o limite da tabela. Lançada
 * como principal, duas coisas se perdem de uma vez: o parto que de fato foi
 * feito nunca é escrito, e a assistência vai para a coluna errada, onde não
 * entra na conta das horas.
 *
 * Por isso o app recusa em vez de corrigir sozinho: só quem estava lá sabe qual
 * parto foi, e adivinhar entre normal e cesariana seria inventar.
 */
export const SO_COMPLEMENTARES = [
  {
    nome: "assistência ao trabalho de parto",
    codigo: "31309038",
    acha: /assistencia ao trabalho de parto/,
    oQuePedir:
      "Escreva no principal qual parto foi realizado (parto normal, cesariana) e marque a " +
      "assistência em Procedimento Complementar, com as horas.",
  },
];

/** Esta linha é das que só valem como complementar? Devolve o termo, ou null. */
export function soComoComplementar(procedimento) {
  const texto = paraComparar(procedimento);
  const codigo = codigoDo(procedimento);
  if (!texto && !codigo) return null;

  return (
    SO_COMPLEMENTARES.find(
      (t) => (t.codigo && t.codigo === codigo) || (t.acha && texto && t.acha.test(texto))
    ) || null
  );
}

/** As linhas da lista que não podem estar no principal. */
export function osSoComplementares(lista) {
  const entradas = Array.isArray(lista) ? lista : lista ? [lista] : [];
  return entradas.map(soComoComplementar).filter(Boolean);
}

/**
 * O recado para quem está lançando.
 *
 * Num lugar só porque ele é dito em três: no formulário, no mapa e na resposta
 * do servidor. Três textos diferentes para a mesma regra ensinariam três
 * regras.
 */
export function recadoDoSoComplementar(achados) {
  const lista = Array.isArray(achados) ? achados : [achados];
  const primeiro = lista.filter(Boolean)[0];
  if (!primeiro) return "";

  return (
    `${primeiro.nome.charAt(0).toUpperCase()}${primeiro.nome.slice(1)} não entra como procedimento ` +
    `principal: ela é cobrada à parte. ${primeiro.oQuePedir}`
  );
}
