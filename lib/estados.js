import { CORES } from "./marca";
import { normalizarTexto } from "./texto";

/**
 * Os campos que são uma escolha entre poucas opções fixas.
 *
 * São três, e todos nasceram da mesma necessidade: sim/não não dava conta.
 *
 * - **Executado**: existe o procedimento que foi feito mas está incompleto —
 *   falta documento, falta assinatura —, e ele não é "não feito" nem pode ser
 *   dado por resolvido. Antes ficava marcado como "não" e se perdia no meio dos
 *   que de fato não aconteceram.
 * - **PC Executado**: o mesmo para o procedimento complementar, que é cobrado à
 *   parte e tem o próprio ciclo. Fala da guia do complementar: "Retirado" e
 *   "Não Retirado" dizem se ela já foi buscada, e "Pendente" é a que falta
 *   resolver. "Sim" é anterior a esse vocabulário e **continua no menu de
 *   propósito**: a equipe o usa no fluxo da conferência. Não é sobra da
 *   renomeação, e não sai daqui sem a secretária pedir.
 * - **Recebido**: só no particular, onde a cobrança é com o paciente.
 *
 * Cada opção guarda a chave ("sim", "nao", …), o rótulo que aparece na tela e
 * na célula, e as cores: `cor` é o fundo da linha na planilha, em RGB 0–1 como
 * a API do Sheets pede, e o par `fundoNaTela`/`tintaNaTela` é o botão no app.
 *
 * Só o Executado pinta a linha. Duas regras de cor na mesma linha brigariam, e
 * a segunda venceria sem critério nenhum.
 */

const VERDE = CORES.verdePlanilha;
// Vermelho claro da própria paleta do Sheets, para casar com o verde que já
// estava em uso: mesma clareza, o texto preto segue legível.
const VERMELHO = { red: 0.957, green: 0.8, blue: 0.8 };
// O amarelo é mais forte que os dois de propósito (#FFD966, dois passos acima
// do #FFF2CC de antes). Incompleto é o único dos três estados que pede ação de
// alguém: o verde diz "pronto", o vermelho diz "não foi", e o amarelo diz
// "falta alguma coisa nesta linha". No tom claro ele se perdia entre os outros
// numa aba de sessenta linhas. Continua claro o bastante para o texto preto —
// o contraste passa de 10:1.
const AMARELO = { red: 1, green: 0.851, blue: 0.4 };

const SIM = {
  valor: "sim",
  rotulo: "Sim",
  cor: VERDE,
  // Na tela, o mesmo dourado das ações: é o estado que se quer alcançar.
  fundoNaTela: CORES.principal,
  tintaNaTela: CORES.sobrePrincipal,
};

const NAO = {
  valor: "nao",
  rotulo: "Não",
  cor: VERMELHO,
  fundoNaTela: CORES.alerta,
  tintaNaTela: "#FFFFFF",
};

/**
 * Os campos de escolha, cada um com suas opções e o que vale quando ninguém
 * escolheu nada.
 *
 * O padrão do Executado é **vazio**, e não "Não".
 *
 * Nascer "Não" era afirmar o que ninguém tinha dito: a cirurgia acabara de ser
 * lançada, e a planilha já declarava que não foi feita — a linha nascia
 * vermelha e o vermelho queria dizer duas coisas diferentes, "não aconteceu" e
 * "ninguém olhou ainda". Vazio diz a segunda sozinho, e sobra cor para a
 * primeira. Quem lança escolhe depois, no app ou na própria planilha.
 *
 * Os outros dois seguem com padrão: o PC Executado nasce "Não Retirado", que é
 * onde toda guia de complementar começa, e o Recebido nasce "Não" porque
 * particular lançado é particular a receber até que alguém diga o contrário.
 */
export const CAMPOS_DE_ESCOLHA = {
  executado: {
    opcoes: [
      SIM,
      NAO,
      {
        valor: "incompleto",
        rotulo: "Incompleto",
        cor: AMARELO,
        fundoNaTela: CORES.avisoTinta,
        tintaNaTela: "#FFFFFF",
      },
    ],
    padrao: "",
  },
  pcExecutado: {
    opcoes: [
      SIM,
      {
        valor: "pendente",
        rotulo: "Pendente",
        cor: AMARELO,
        fundoNaTela: CORES.avisoTinta,
        tintaNaTela: "#FFFFFF",
      },
      // A guia do complementar já foi retirada.
      {
        valor: "retirado",
        rotulo: "Retirado",
        cor: null,
        fundoNaTela: CORES.escura,
        tintaNaTela: CORES.sobreEscura,
      },
      // O estado em que a maioria fica, e por isso o padrão.
      //
      // A chave continua "np", do tempo em que o rótulo era "NP". Trocar a
      // chave obrigaria a migrar todo registro já gravado e toda célula já
      // escrita; trocar só o rótulo não quebra nada, e uma célula antiga
      // escrita "NP" continua sendo reconhecida — é a chave que `estadoDoTexto`
      // aceita, junto do rótulo de hoje.
      {
        valor: "np",
        rotulo: "Não Retirado",
        cor: null,
        fundoNaTela: CORES.suave,
        tintaNaTela: "#FFFFFF",
      },
    ],
    padrao: "np",
  },
  recebido: {
    opcoes: [SIM, NAO],
    padrao: "nao",
  },
};

/** As opções deste campo, na ordem em que aparecem na tela e no menu. */
export function opcoesDe(campo) {
  return (CAMPOS_DE_ESCOLHA[campo] || CAMPOS_DE_ESCOLHA.executado).opcoes;
}

/** O que vale neste campo quando ninguém escolheu nada. */
export function padraoDe(campo) {
  return (CAMPOS_DE_ESCOLHA[campo] || CAMPOS_DE_ESCOLHA.executado).padrao;
}

/**
 * O valor deste campo, aceitando o que ficou gravado antes.
 *
 * O Executado já foi booleano. Registro antigo continua com `true` e `false` no
 * banco, e converter tudo de uma vez seria migração para ganhar nada: a leitura
 * resolve, e cada registro se atualiza sozinho na primeira vez que for gravado.
 *
 * `false` cai no padrão, que hoje é vazio, e isso é o que ele sempre quis
 * dizer: a caixa que ninguém marcou, e não alguém afirmando que a cirurgia não
 * aconteceu.
 */
export function estadoDe(campo, valor) {
  if (valor === true) return "sim";
  if (valor === false || valor === null || valor === undefined) return padraoDe(campo);
  return estadoDoTexto(campo, valor) || padraoDe(campo);
}

/**
 * O estado que este texto quer dizer, ou `null` quando não dá para saber.
 *
 * `null` importa: é ele que faz a leitura da planilha recusar uma célula
 * digitada torto em vez de rebaixá-la ao padrão e dar a cirurgia por não feita.
 */
export function estadoDoTexto(campo, texto) {
  const limpo = normalizarTexto(texto);
  if (!limpo) return padraoDe(campo);

  const achado = opcoesDe(campo).find(
    (e) => e.valor === limpo || normalizarTexto(e.rotulo) === limpo
  );
  return achado ? achado.valor : null;
}

/** O valor como ele aparece na célula e na tela. */
export function rotuloDe(campo, valor) {
  const estado = estadoDe(campo, valor);
  const achado = opcoesDe(campo).find((e) => e.valor === estado);
  return achado ? achado.rotulo : "";
}

/**
 * Este campo pode ficar sem escolha nenhuma?
 *
 * Só o Executado pode, e é o que diz aos menus suspensos que eles precisam de
 * uma opção vazia: sem ela, a célula em branco não teria como ser mostrada nem
 * como voltar a ser escolhida depois de escolhida errado.
 */
export function aceitaVazio(campo) {
  return padraoDe(campo) === "";
}

/** A cirurgia está dada por feita? */
export function foiExecutada(valor) {
  return estadoDe("executado", valor) === "sim";
}

/** O particular já foi pago? */
export function foiRecebido(valor) {
  return estadoDe("recebido", valor) === "sim";
}
