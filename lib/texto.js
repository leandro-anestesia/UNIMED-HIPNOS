/**
 * Texto em minúsculas e sem acento, para comparações que não devem depender
 * de como a pessoa digitou. Usado na busca e na detecção de duplicatas.
 */
export function normalizarTexto(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Tira o "DR"/"DRA" que a etiqueta e o mapa escrevem antes do nome de quem
 * opera.
 *
 * O app já escreve "Dr(a)." no cartão e nos relatórios; sem cortar aqui, sai
 * "Dr(a). DR CARLOS PORTO".
 */
export function semTratamento(nome) {
  return (nome || "")
    .toString()
    .trim()
    .replace(/^(dr|dra|dr\.|dra\.)\s+/i, "")
    .trim();
}
