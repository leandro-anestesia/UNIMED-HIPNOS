import { estadoDe } from "./estados";
import { analisarGuia } from "./guia";
import { modeloDoRegistro } from "./modelos";

/**
 * O que falta em cada registro, do ponto de vista de quem cobra.
 *
 * É daqui que a conferência trabalha, e não da tabela. Percorrer trezentas
 * linhas procurando o que está faltando é o trabalho que o computador faz
 * melhor; o que sobra para a pessoa é resolver cada caso.
 *
 * Cada cesta diz três coisas: se ela **cabe** naquele registro — guia não cabe
 * em particular, credenciado da Unimed não cabe fora da Unimed —, se ela
 * **falta**, e como se chama na tela. Separar "não cabe" de "não falta" é o que
 * impede a lista de acusar como pendência o que nunca existiu.
 */

const naoEhParticular = (e) => modeloDoRegistro(e) !== "particular";
const ehDaUnimed = (e) => modeloDoRegistro(e) === "convenio";
const vazio = (v) => !(v || "").toString().trim();

export const PENDENCIAS = [
  {
    chave: "semGuia",
    nome: "Sem nº de guia",
    cabe: naoEhParticular,
    falta: (e) => vazio(e.nGuia),
  },
  {
    chave: "guiaSuspeita",
    nome: "Guia com dígito suspeito",
    // Só na Unimed: o dígito verificador é regra dela, e aplicá-lo às outras
    // operadoras reprovava guia boa.
    cabe: (e) => ehDaUnimed(e) && !vazio(e.nGuia),
    falta: (e) => {
      const r = analisarGuia(e.nGuia);
      return r.estado !== "valida" && r.estado !== "completada" && r.estado !== "vazia";
    },
  },
  {
    chave: "semCarteira",
    nome: "Sem carteira",
    cabe: naoEhParticular,
    falta: (e) => vazio(e.nCarteira),
  },
  {
    chave: "semAtendimento",
    nome: "Sem atendimento",
    cabe: () => true,
    falta: (e) => vazio(e.atendimento),
  },
  {
    chave: "semCirurgiao",
    nome: "Sem cirurgião",
    cabe: () => true,
    falta: (e) => vazio(e.cirurgiao),
  },
  {
    chave: "semAnestesiologista",
    nome: "Sem anestesiologista",
    cabe: () => true,
    falta: (e) => vazio(e.anestesista),
  },
  {
    chave: "semCredenciado",
    nome: "Sem anestesiologista Unimed",
    cabe: ehDaUnimed,
    falta: (e) => vazio(e.anestesistaCarimbo),
  },
  {
    chave: "incompleto",
    nome: "Executado incompleto",
    cabe: () => true,
    falta: (e) => estadoDe("executado", e.executado) === "incompleto",
  },
  {
    chave: "pcPendente",
    nome: "Complementar pendente",
    cabe: ehDaUnimed,
    falta: (e) => estadoDe("pcExecutado", e.pcExecutado) === "pendente",
  },
  {
    chave: "naoRecebido",
    nome: "Particular a receber",
    cabe: (e) => modeloDoRegistro(e) === "particular",
    falta: (e) => estadoDe("recebido", e.recebido) !== "sim",
  },
];

/** Este registro cai nesta cesta? */
export function temPendencia(entry, chave) {
  const cesta = PENDENCIAS.find((p) => p.chave === chave);
  if (!cesta) return false;
  return cesta.cabe(entry) && cesta.falta(entry);
}

/** Todas as cestas em que este registro cai. */
export function pendenciasDe(entry) {
  return PENDENCIAS.filter((p) => p.cabe(entry) && p.falta(entry)).map((p) => p.chave);
}

/**
 * Quantos registros caem em cada cesta, na ordem em que as cestas aparecem.
 *
 * Cesta vazia sai da lista: um zero na tela é uma cesta a menos para ler, e a
 * pergunta é "o que falta", não "o que não falta".
 */
export function contarPendencias(entries) {
  return PENDENCIAS.map((p) => ({
    chave: p.chave,
    nome: p.nome,
    quantos: entries.filter((e) => p.cabe(e) && p.falta(e)).length,
  })).filter((p) => p.quantos > 0);
}

/**
 * Há quantos dias este particular está sem receber.
 *
 * Serve para a cesta "a receber" dizer o que importa de verdade: não é que
 * falta receber, é que falta receber há quarenta dias.
 */
export function diasParados(entry, hoje = new Date()) {
  const data = (entry.dataCirurgia || "").trim();
  if (!data) return null;
  const quando = new Date(`${data}T12:00:00`);
  if (Number.isNaN(quando.getTime())) return null;
  return Math.max(0, Math.floor((hoje - quando) / 86400000));
}
