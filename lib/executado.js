import { CORES } from "./marca";
import { normalizarTexto } from "./texto";

/**
 * O estado da cirurgia na conferência: feita, não feita ou feita pela metade.
 *
 * Era um sim/não, e sim/não não dava conta da conferência da Unimed: existe o
 * caso do procedimento que foi feito mas está incompleto — falta documento,
 * falta assinatura, falta o complementar — e ele não é "não feito" nem pode ser
 * dado por resolvido. Antes ficava marcado como "não" e se perdia no meio dos
 * que de fato não aconteceram.
 *
 * O valor guardado é a chave ("sim", "nao", "incompleto"); o rótulo é o que
 * aparece na tela e na célula. `cor` é o fundo da linha na planilha do Google,
 * em RGB 0–1, que é como a API do Sheets pede.
 */
export const ESTADOS_DE_EXECUCAO = [
  {
    valor: "sim",
    rotulo: "Sim",
    cor: CORES.verdePlanilha,
    // Na tela, o mesmo dourado das ações: é o estado que se quer alcançar.
    fundoNaTela: CORES.principal,
    tintaNaTela: CORES.sobrePrincipal,
  },
  {
    valor: "nao",
    rotulo: "Não",
    // Vermelho claro da própria paleta do Sheets, para casar com o verde que já
    // estava em uso: mesma clareza, o texto preto continua legível por cima.
    cor: { red: 0.957, green: 0.8, blue: 0.8 },
    fundoNaTela: CORES.alerta,
    tintaNaTela: "#FFFFFF",
  },
  {
    valor: "incompleto",
    rotulo: "Incompleto",
    cor: { red: 1, green: 0.949, blue: 0.8 }, // amarelo claro
    fundoNaTela: CORES.avisoTinta,
    tintaNaTela: "#FFFFFF",
  },
];

/**
 * O estado de quem ainda não foi conferido.
 *
 * "Não" e não um estado em branco: foi a escolha de manter o que já existia —
 * o mês começa vermelho e vai esverdeando conforme a conferência anda.
 */
export const EXECUCAO_PADRAO = "nao";

/**
 * O estado deste registro, aceitando o que ficou gravado antes.
 *
 * Até aqui o campo era booleano. Os registros antigos continuam com `true` e
 * `false` no banco, e converter tudo de uma vez seria uma migração para ganhar
 * nada: a leitura resolve, e cada registro se atualiza sozinho na primeira vez
 * que for gravado.
 */
export function estadoDeExecucao(valor) {
  if (valor === true) return "sim";
  if (valor === false || valor === null || valor === undefined) return EXECUCAO_PADRAO;
  return estadoDoTexto(valor) || EXECUCAO_PADRAO;
}

/**
 * O estado que este texto quer dizer, ou `null` quando não dá para saber.
 *
 * `null` importa: é ele que faz a leitura da planilha recusar uma célula
 * digitada torto em vez de rebaixá-la a "não" e dar a cirurgia por não feita.
 */
export function estadoDoTexto(texto) {
  const limpo = normalizarTexto(texto);
  if (!limpo) return EXECUCAO_PADRAO;

  const achado = ESTADOS_DE_EXECUCAO.find(
    (e) => e.valor === limpo || normalizarTexto(e.rotulo) === limpo
  );
  return achado ? achado.valor : null;
}

/** O estado como ele aparece na célula e na tela. */
export function rotuloDaExecucao(valor) {
  const estado = estadoDeExecucao(valor);
  return (ESTADOS_DE_EXECUCAO.find((e) => e.valor === estado) || ESTADOS_DE_EXECUCAO[1]).rotulo;
}

/** A cor de fundo da linha na planilha, ou null quando o estado não pinta. */
export function corDaExecucao(valor) {
  const estado = estadoDeExecucao(valor);
  const achado = ESTADOS_DE_EXECUCAO.find((e) => e.valor === estado);
  return achado ? achado.cor : null;
}

/** A cirurgia está dada por feita? */
export function foiExecutada(valor) {
  return estadoDeExecucao(valor) === "sim";
}

/**
 * Este modelo usa os três estados?
 *
 * Só a planilha da Unimed. É nela que a conferência é feita linha a linha com a
 * operadora, e é lá que "incompleto" quer dizer alguma coisa; nas outras, a
 * pergunta continua sendo feita ou não feita, e um menu de três opções só
 * atrapalharia.
 */
export function temTresEstados(modelo) {
  return modelo === "convenio";
}
