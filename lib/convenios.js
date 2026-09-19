import { normalizarTexto } from "./texto";

/**
 * O nome curto de cada convênio, e o que na folha impressa aponta para ele.
 *
 * A guia imprime a razão social inteira — "UNIMED CAMPINAS COOPERATIVA DE
 * TRABALHO MEDICO", "NOTRE DAME INTERMEDICA SAUDE S.A.", "SUL AMERICA
 * COMPANHIA DE SEGURO SAUDE" —, e cada folha imprime de um jeito. Guardado
 * assim, o mesmo convênio virava três no cadastro, três no filtro e três na
 * conferência.
 *
 * `procura` é o que basta aparecer no nome, em palavras inteiras e seguidas,
 * para o convênio ser aquele. Palavras inteiras porque "UNIMEDICA" não é
 * Unimed; seguidas porque "SUL AMERICA" é um nome só, e não duas palavras que
 * podem aparecer soltas.
 *
 * A troca é feita aqui, e não na instrução de leitura, porque leitura é pedido
 * e isto é regra: o modelo transcreve o que está impresso, e a tradução é
 * sempre a mesma.
 */
export const NOMES_DE_CONVENIO = [
  { nome: "UNIMED", procura: ["unimed"] },
  { nome: "SUL AMERICA", procura: ["sul america", "sulamerica"] },
  { nome: "PORTO SEGURO", procura: ["porto seguro"] },
  { nome: "BRADESCO", procura: ["bradesco"] },
  // A Notre Dame e a Hapvida se fundiram, e a guia sai com um nome ou outro.
  { nome: "NOTREDAME", procura: ["notre"] },
  // UNIPAR é como a guia identifica quem paga do próprio bolso.
  { nome: "PARTICULAR", procura: ["unipar", "particular"] },
];

/** As palavras de `texto` aparecem seguidas dentro de `palavras`? */
function contemSequencia(palavras, texto) {
  const procura = texto.split(/\s+/).filter(Boolean);
  return palavras.some((_, i) => procura.every((p, n) => palavras[i + n] === p));
}

/**
 * O nome curto deste convênio, ou o próprio nome quando não é nenhum da lista.
 *
 * Convênio fora da lista fica inteiro: são os poucos e variados, e encurtar sem
 * saber onde cortar produziria nome errado.
 */
export function nomeCurtoDoConvenio(convenio) {
  const texto = (convenio || "").toString().trim();
  if (!texto) return "";

  const palavras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  const achado = NOMES_DE_CONVENIO.find((c) =>
    c.procura.some((p) => contemSequencia(palavras, normalizarTexto(p)))
  );
  return achado ? achado.nome : texto;
}

/**
 * Tira o código que vem colado ao nome do convênio.
 *
 * A guia costuma imprimir "0110 - UNIMED CAMPINAS"; o que serve é o nome. A
 * instrução de leitura já pede o nome sozinho, mas a leitura às vezes devolve o
 * par inteiro, e aqui isso não depende de sorte.
 *
 * Só corta quando o pedaço antes do traço tem número: assim um convênio cujo
 * nome de verdade tenha traço — "SAO FRANCISCO - SAUDE" — fica inteiro.
 */
export function semCodigoNaFrente(valor) {
  return (valor || "")
    .toString()
    .trim()
    .replace(/^[A-Za-z0-9.]{1,10}\s*[-–—]\s*/, (achado) => (/\d/.test(achado) ? "" : achado))
    .trim();
}
