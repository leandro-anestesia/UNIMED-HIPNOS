import { normalizarTexto } from "./texto";

/**
 * Onde a equipe opera.
 *
 * Lista fechada: não há "outro local" nem texto livre. Antes o campo aprendia
 * sozinho, como o convênio, e a lista virava depósito de grafias — "VERMAIS",
 * "VER MAIS", "Vermais" — que depois não casavam com nada. Doze nomes escritos
 * uma vez resolvem isso e cabem numa tela.
 *
 * O local **não decide mais para qual planilha o registro vai**. Isso agora é
 * só do convênio (`lib/modelos.js`): a conta é acertada com a Unimed, com as
 * outras operadoras ou com o paciente, e onde a cirurgia aconteceu é informação,
 * não roteamento. Antes três clínicas tinham arquivo próprio, e a regra não
 * cabia numa frase.
 *
 * `leitura` diz o que a tela inicial oferece como caminho principal naquele
 * local: `"mapa"` onde a folha do dia traz todos os pacientes de uma vez,
 * `"foto"` onde se fotografa uma guia ou etiqueta por paciente. O outro botão
 * continua disponível nos dois casos — é peso, não permissão.
 */
export const LOCAIS = [
  { nome: "HOSPITAL RENASCENÇA", leitura: "foto" },
  { nome: "HOSPITAL SÃO LUIZ", leitura: "foto" },
  { nome: "HOSPITAL SAMARITANO SB", leitura: "foto" },
  { nome: "OFTALMO VERMAIS", leitura: "mapa" },
  { nome: "OFTALMO NOVA CAMPINAS", leitura: "mapa" },
  { nome: "OFTALMO CAMBUI", leitura: "mapa" },
  { nome: "OFTALMO CENTRAL DA VISAO", leitura: "mapa" },
  { nome: "OFTALMO VISION", leitura: "mapa" },
  { nome: "BAIRRAL", leitura: "foto" },
  { nome: "SPAZIO ESTETICA E LASER", leitura: "foto" },
  { nome: "DIMEN", leitura: "foto" },
  { nome: "CONSULTAS HRC", leitura: "mapa" },
];

/** Só os nomes, na ordem em que aparecem no seletor. */
export const NOMES_DE_LOCAL = LOCAIS.map((l) => l.nome);

/**
 * O local que vem marcado num lançamento novo.
 *
 * É o mais frequente, e deixá-lo escolhido economiza um toque em quase todo
 * lançamento. O campo é obrigatório — não existe mais a opção em branco —, então
 * um padrão tem de existir.
 */
export const LOCAL_PADRAO = "HOSPITAL RENASCENÇA";

/** O local escrito assim está na lista? */
export function ehLocalConhecido(local) {
  const nome = normalizarTexto(local || "");
  return nome !== "" && NOMES_DE_LOCAL.some((l) => normalizarTexto(l) === nome);
}

/**
 * O nome exato deste local, ou "" se ele não estiver na lista.
 *
 * Serve para aceitar o que vier torto de fora — de uma célula da planilha, de
 * um registro antigo — sem deixar entrar um local inventado.
 */
export function nomeDoLocal(local) {
  const nome = normalizarTexto(local || "");
  return NOMES_DE_LOCAL.find((l) => normalizarTexto(l) === nome) || "";
}

/**
 * Que leitura este local usa como caminho principal.
 *
 * Local desconhecido cai em `"foto"`: é o caminho que funciona em qualquer
 * lugar, e errar para o lado do mais geral não atrapalha ninguém.
 */
export function leituraDoLocal(local) {
  const nome = normalizarTexto(local || "");
  const achado = LOCAIS.find((l) => normalizarTexto(l.nome) === nome);
  return achado ? achado.leitura : "foto";
}
