import { CADASTROS_EM_CAIXA_ALTA, TIPOS_DE_CADASTRO, emCaixaAlta } from "./campos";
import { nomeCurtoDoConvenio, semCodigoNaFrente } from "./convenios";
import { kv } from "./kv";
import { comTrava } from "./trava";

/**
 * As listas que alimentam o autocompletar: cirurgiões, anestesiologistas,
 * convênios, recebedores e procedimentos.
 *
 * Mora em `lib/` e não dentro da rota porque a sincronização também mexe nelas:
 * é ela que ensina os procedimentos do que já está lançado, e duas cópias da
 * regra de como guardar um nome acabariam divergindo.
 */

// Prefixo próprio desta equipe. Cada app tem seu próprio banco KV, então a
// separação já está garantida pela infraestrutura — o prefixo é a segunda
// tranca, para o caso de alguém apontar dois deploys para o mesmo banco.
const CHAVE = "guias:cadastros";

// A lista inteira mora numa chave só, e o app grava nela sozinho: todo registro
// salvo cadastra o que foi digitado. Dois anestesistas salvando ao mesmo tempo
// leriam a mesma lista e a última gravação apagaria a outra.
const TRAVA = "guias:cadastros:trava";

/**
 * O nome como ele deve ficar guardado, conforme o tipo de cadastro.
 *
 * O convênio entra pelo nome curto, a mesma regra que vale no registro. Sem
 * isso a lista guardaria o que já entrou antes — "UNIMED CAMPINAS" ao lado de
 * "UNIMED" —, e o autocompletar ofereceria as duas. Como `lerCadastros` regrava
 * o que converteu, a lista se limpa sozinha na primeira leitura.
 */
export function comoGuardar(tipo, nome) {
  const limpo = (nome || "").toString().trim();
  if (tipo === "convenios") return emCaixaAlta(nomeCurtoDoConvenio(semCodigoNaFrente(limpo)));
  return CADASTROS_EM_CAIXA_ALTA.includes(tipo) ? emCaixaAlta(limpo) : limpo;
}

function ordenar(nomes) {
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Lê os cadastros já no formato correto.
 *
 * Converte o que foi gravado antes desta regra existir e regrava uma única vez
 * — sem isso, a lista ficaria metade em caixa alta e metade não, e o mesmo
 * anestesista apareceria duas vezes no autocompletar.
 */
export async function lerCadastros() {
  const bruto = await kv.get(CHAVE);
  const data = {};
  let mudou = false;

  for (const tipo of TIPOS_DE_CADASTRO) {
    const antes = (bruto && bruto[tipo]) || [];
    const vistos = new Set();
    const depois = [];
    for (const nome of antes) {
      const certo = comoGuardar(tipo, nome);
      if (!certo || vistos.has(certo)) continue;
      vistos.add(certo);
      depois.push(certo);
    }
    data[tipo] = ordenar(depois);
    if (data[tipo].length !== antes.length || data[tipo].some((n, i) => n !== antes[i])) mudou = true;
  }

  if (mudou) await kv.set(CHAVE, data);
  return data;
}

/**
 * Acrescenta nomes a um tipo, pulando os que já estão lá.
 *
 * Aceita vários de uma vez para pegar uma trava só: a carga inicial dos
 * procedimentos passa por aqui com centenas de nomes, e uma trava por nome
 * seria uma ida ao banco por procedimento.
 */
export async function acrescentar(tipo, nomes) {
  const aGuardar = [];
  const vistos = new Set();
  for (const nome of nomes) {
    const certo = comoGuardar(tipo, nome);
    if (!certo || vistos.has(certo.toLowerCase())) continue;
    vistos.add(certo.toLowerCase());
    aGuardar.push(certo);
  }
  if (aGuardar.length === 0) return { cadastros: await lerCadastros(), novos: 0 };

  return comTrava(TRAVA, async () => {
    const atual = await lerCadastros();
    const jaTem = new Set(atual[tipo].map((n) => n.toLowerCase()));
    const novos = aGuardar.filter((n) => !jaTem.has(n.toLowerCase()));
    if (novos.length > 0) {
      atual[tipo] = ordenar([...atual[tipo], ...novos]);
      await kv.set(CHAVE, atual);
    }
    return { cadastros: atual, novos: novos.length };
  });
}

/** Tira um nome da lista. Comparação sem caixa: ele pode chegar como estava antes. */
export async function remover(tipo, nome) {
  const alvo = (nome || "").toString().trim().toLowerCase();
  return comTrava(TRAVA, async () => {
    const atual = await lerCadastros();
    atual[tipo] = atual[tipo].filter((n) => n.toLowerCase() !== alvo);
    await kv.set(CHAVE, atual);
    return atual;
  });
}

/**
 * Ensina os procedimentos que já estão lançados.
 *
 * O aprendizado normal acontece na hora de salvar, no aparelho de quem lançou.
 * Isso deixa de fora duas coisas: tudo o que foi lançado antes de o campo
 * aprender, e o que alguém digita direto na planilha, que nunca passa pelo app.
 *
 * Roda na sincronização, que é quando o servidor já tem todos os registros na
 * mão. É idempotente — só acrescenta o que falta —, então não é uma migração
 * que se roda uma vez: é a rede que recolhe o que escapou.
 */
export async function aprenderProcedimentos(entries) {
  const nomes = [];
  for (const entry of entries) {
    for (const descricao of (entry && entry.procedimentos) || []) nomes.push(descricao);
  }
  const { novos } = await acrescentar("procedimentos", nomes);
  return novos;
}
