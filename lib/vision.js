import { nomeDoLocal } from "./locais";
import { normalizarTexto } from "./texto";

/**
 * As regras do mapa cirúrgico da OFTALMO VISION, e só dele.
 *
 * Ali o pagamento é sempre do paciente, mesmo quando o mapa traz um convênio na
 * coluna Categoria: o convênio diz quanto a clínica paga pelo ato, não quem
 * paga. Por isso todo lançamento da Vision nasce PARTICULAR, com o convênio
 * real guardado na observação — sem isso, a conferência perderia a única
 * informação que explica o valor da linha.
 *
 * Estas regras moram aqui, e não na leitura da foto, de propósito: o modelo
 * transcreve o que está escrito, e a conversão é aritmética de negócio, que
 * precisa ser testável sem foto nenhuma e igual em toda leitura.
 */

export const LOCAL_DA_VISION = "OFTALMO VISION";

/** Este local é a Vision? As regras abaixo não valem em nenhum outro. */
export function ehDaVision(local) {
  return nomeDoLocal(local) === LOCAL_DA_VISION;
}

/**
 * O que a folha deixa implícito.
 *
 * O mapa escreve só o olho a operar, porque ali a catarata é o que se faz o dia
 * inteiro. Procedimento em branco quer dizer este.
 */
export const PROCEDIMENTO_PADRAO = "FACO + LIO";

/**
 * Quanto a Vision paga, por convênio.
 *
 * Tabela fechada e escrita por extenso: é dinheiro, e dinheiro não se adivinha.
 * Convênio fora desta lista vira PARTICULAR como todos os outros, mas **sem
 * valor** — a tela avisa quais linhas ficaram em branco, e quem conhece o
 * combinado preenche. Inventar aqui seria errar calado na conferência.
 */
export const VALORES_DO_FACO = [
  { nome: "UNIMED", acha: /\bunimed\b/, valor: 280 },
  { nome: "POUPE SAÚDE", acha: /\bpoupe\s*saude\b/, valor: 300 },
  { nome: "DOCTOR PRIME", acha: /\bdoctor\s*prime\b/, valor: 300 },
  { nome: "PARTICULAR", acha: /\bparticular\b/, valor: 500 },
];

export const VALOR_DA_BLEFARO_SIMPLES = 1200;
export const VALOR_DA_BLEFARO_COMPLETA = 1500;

/** O mapa já traz esta linha como particular? Então não há convênio a anotar. */
export function ehParticular(convenio) {
  return /\bparticular\b/.test(normalizarTexto(convenio));
}

/**
 * O SUS não entra.
 *
 * `\b` de propósito: sem ele, qualquer nome que contenha as três letras — um
 * "SUSTENTÁVEL" da vida — sumiria do mapa sem ninguém notar.
 */
export function ehSus(convenio) {
  return /\bsus\b/.test(normalizarTexto(convenio));
}

/** O convênio escrito no mapa, quando ele está na tabela de valores. */
function naTabela(convenio) {
  const texto = normalizarTexto(convenio);
  if (!texto) return null;
  return VALORES_DO_FACO.find((c) => c.acha.test(texto)) || null;
}

/**
 * Quanto vale esta linha.
 *
 * A blefaroplastia tem valor próprio e não depende do convênio; a de pálpebra
 * superior E inferior é a de 1500, e qualquer outra é a simples. O FACO sai da
 * tabela por convênio.
 *
 * Devolve "" — e não zero — quando não há regra: vazio é "ninguém disse", e
 * zero seria "combinado de graça".
 */
export function valorDaVision(procedimento, convenio) {
  const texto = normalizarTexto(procedimento);

  if (/blefaro/.test(texto)) {
    return /superior/.test(texto) && /inferior/.test(texto)
      ? VALOR_DA_BLEFARO_COMPLETA
      : VALOR_DA_BLEFARO_SIMPLES;
  }

  if (/\bfaco\b/.test(texto) || /facoemulsificacao/.test(texto)) {
    const achado = naTabela(convenio);
    return achado ? achado.valor : "";
  }

  return "";
}

/** O procedimento já diz de que lado é? */
function temLado(procedimento) {
  return /\b(od|oe|ao|ambos|bilateral)\b/.test(normalizarTexto(procedimento));
}

/**
 * O olho entra no procedimento: "FACO + LIO OD".
 *
 * É como o cadastro de procedimentos do app já guarda, e como os outros mapas
 * chegam — manter o lado fora dele faria a mesma cirurgia aparecer com dois
 * nomes diferentes conforme a clínica de origem.
 */
export function comOlho(procedimento, olho) {
  const base = (procedimento || "").toString().trim();
  const lado = (olho || "").toString().trim().toUpperCase();
  if (!base) return "";
  if (!lado || temLado(base)) return base;
  return `${base} ${lado}`;
}

/**
 * Uma linha do mapa da Vision, já no jeito que o app grava.
 *
 * Devolve também `convenioReal` e `semValor`, que não vão para o registro: são
 * para a tela de conferência mostrar o que foi convertido e o que ficou sem
 * valor, antes de qualquer coisa ser salva.
 */
export function comoAVisionLanca(linha) {
  const convenioReal = ((linha && linha.convenio) || "").toString().trim();

  const escritos = (linha.procedimentos || []).map((p) => (p || "").toString().trim()).filter(Boolean);
  const base = escritos.length > 0 ? escritos : [PROCEDIMENTO_PADRAO];
  const procedimentos = base.map((p) => comOlho(p, linha.olho).toUpperCase());

  const valor = valorDaVision(procedimentos[0], convenioReal);

  return {
    ...linha,
    procedimentos,
    // Todo lançamento da Vision é particular, qualquer que seja a categoria do
    // mapa: é o paciente quem paga.
    convenio: "PARTICULAR",
    convenioReal,
    // O convênio real é o que explica o valor. Sem ele na observação, a linha
    // de 280 e a de 500 ficam indistinguíveis na planilha.
    //
    // Quem já é particular no mapa não ganha anotação: "Convênio: PARTICULAR"
    // numa linha particular é ruído na coluna de observação.
    observacao: convenioReal && !ehParticular(convenioReal) ? `Convênio: ${convenioReal.toUpperCase()}` : "",
    valor,
    semValor: valor === "",
  };
}

/**
 * O mapa inteiro da Vision, convertido.
 *
 * Devolve os do SUS à parte em vez de sumir com eles calado: quem fotografou a
 * folha precisa saber que três pacientes dela não viraram lançamento.
 */
export function regrasDaVision(linhas) {
  const doSus = (linhas || []).filter((l) => ehSus(l.convenio));
  const convertidas = (linhas || []).filter((l) => !ehSus(l.convenio)).map(comoAVisionLanca);

  return {
    linhas: convertidas,
    ignoradosDoSus: doSus.map((l) => (l.paciente || "").toString().trim()).filter(Boolean),
    semValor: convertidas.filter((l) => l.semValor),
  };
}
