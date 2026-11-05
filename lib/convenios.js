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
  { nome: "AMIL", procura: ["amil"] },
  // A Notre Dame e a Hapvida se fundiram, e a guia sai com um nome ou outro.
  { nome: "NOTREDAME", procura: ["notre"] },
  // UNIPAR é como a guia identifica quem paga do próprio bolso.
  { nome: "PARTICULAR", procura: ["unipar", "particular"] },
];

/**
 * Palavras que vêm depois do nome e não distinguem convênio nenhum.
 *
 * "AMIL", "AMIL SAÚDE" e "AMIL ASSISTÊNCIA MÉDICA LTDA" são a mesma operadora,
 * e guardados assim viravam três. São tiradas só do fim do nome, uma a uma, e
 * nunca a última que sobrar: um convênio chamado só "SAÚDE" continuaria sendo
 * "SAÚDE", e não virar nada é melhor do que virar vazio.
 *
 * O que fica de fora desta lista é tão importante quanto o que está nela:
 * "CAMPINAS", "SOROCABA" e afins não entram, porque eles de fato distinguem —
 * quem resolve esses é a lista de nomes acima, que sabe que toda Unimed é
 * Unimed.
 */
const PALAVRAS_GENERICAS = new Set([
  "saude",
  "seguro",
  "seguros",
  "seguradora",
  "assistencia",
  "medica",
  "medicas",
  "medico",
  "medicina",
  "odontologia",
  "plano",
  "planos",
  "operadora",
  "cooperativa",
  "trabalho",
  "companhia",
  "grupo",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "sa",
  "ltda",
  "me",
  "epp",
  "eireli",
]);

/**
 * Tira a pontuação, e o hífen entre palavras vira espaço.
 *
 * "AMIL." e "AMIL" são a mesma coisa, e um ponto não pode fazer dois convênios.
 * Vem antes de tudo, inclusive da busca na lista acima: sem isso, "Amil." não
 * casava com "amil" e escapava da regra que deveria pegá-lo.
 *
 * O hífen entra aqui pelo mesmo motivo: a guia imprime "SUL-AMERICA" tanto
 * quanto "SUL AMERICA", e sem isto a primeira forma não casava com a lista e
 * ficava guardada como um convênio à parte. Hífen entre palavras é jeito de
 * escrever, não nome diferente.
 */
function semPontuacao(texto) {
  return texto
    .replace(/[.,;:\-\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tira as palavras genéricas do fim — o que vem depois do nome principal.
 *
 * É o que junta "AMIL SAÚDE LTDA" com "AMIL". Nunca tira a última que sobrar:
 * um convênio chamado só "SAÚDE" continuaria sendo "SAÚDE", e não virar nada é
 * melhor do que virar vazio.
 */
function semOQueVemDepois(texto) {
  // Letra sozinha no fim é sobra de abreviação: "S.A." vira "S A" quando a
  // pontuação sai, e o "A" que fica não é nome de convênio nenhum.
  const descartavel = (palavra) => {
    const limpa = normalizarTexto(palavra);
    return limpa.length === 1 || PALAVRAS_GENERICAS.has(limpa);
  };

  const palavras = texto.split(" ").filter(Boolean);
  while (palavras.length > 1 && descartavel(palavras[palavras.length - 1])) {
    palavras.pop();
  }
  return palavras.join(" ");
}

/** As palavras de `texto` aparecem seguidas dentro de `palavras`? */
function contemSequencia(palavras, texto) {
  const procura = texto.split(/\s+/).filter(Boolean);
  return palavras.some((_, i) => procura.every((p, n) => palavras[i + n] === p));
}

/**
 * O nome curto deste convênio.
 *
 * Duas regras, nesta ordem. Primeiro a lista acima, que sabe onde cortar os
 * nomes de mais de uma palavra: "SUL AMERICA COMPANHIA DE SEGURO SAÚDE" vira
 * "SUL AMERICA", e não "SUL".
 *
 * Convênio fora da lista cai na regra geral: sem pontuação e sem as palavras
 * genéricas do fim. Não é chute — "SAÚDE", "LTDA" e "ASSISTÊNCIA MÉDICA" não
 * distinguem operadora nenhuma, e o que sobra é o nome pelo qual a equipe
 * chama o convênio.
 */
export function nomeCurtoDoConvenio(convenio) {
  const texto = semPontuacao((convenio || "").toString().trim());
  if (!texto) return "";

  const palavras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  const achado = NOMES_DE_CONVENIO.find((c) =>
    c.procura.some((p) => contemSequencia(palavras, normalizarTexto(p)))
  );
  return achado ? achado.nome : semOQueVemDepois(texto);
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
