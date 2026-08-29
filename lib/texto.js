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
