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
];

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
  if (!texto) return "";
  const achado = PROCEDIMENTOS_IGNORADOS.find((t) => t.acha.test(texto));
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
