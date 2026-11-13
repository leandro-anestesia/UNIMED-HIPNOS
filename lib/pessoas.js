import {
  PAPEL_PADRAO,
  hashDoPin,
  montarPessoa,
  normalizarUsuario,
  papelValido,
  pinBate,
  pinValido,
  novoSal,
  usuarioValido,
} from "./acesso";
import { kv } from "./kv";
import { comTrava } from "./trava";

/**
 * Quem pode entrar no app.
 *
 * Mora no mesmo banco e no mesmo padrão das outras listas (`guias:*`), numa
 * chave só — são poucas pessoas, e ler a lista inteira é uma chamada.
 *
 * Separado de `lib/acesso.js` porque aquele é importado pelo middleware, que
 * roda no Edge: o cliente do Redis não pode ir para lá.
 */

const CHAVE = "guias:acesso";
const TRAVA = "guias:acesso:trava";

/** Erros de PIN, por usuário. Chave própria porque expira sozinha. */
const chaveDosErros = (usuario) => `guias:acesso:erros:${usuario}`;

export const ERROS_PERMITIDOS = 5;
export const MINUTOS_DE_BLOQUEIO = 15;

export async function lerPessoas() {
  const bruto = await kv.get(CHAVE);
  return Array.isArray(bruto) ? bruto : [];
}

async function gravarPessoas(lista) {
  await kv.set(CHAVE, lista);
}

export async function listaVazia() {
  return (await lerPessoas()).length === 0;
}

export async function buscarPessoa(usuario) {
  const procurado = normalizarUsuario(usuario);
  return (await lerPessoas()).find((p) => p.usuario === procurado) || null;
}

/**
 * Cria uma ou várias pessoas de uma vez, sob uma trava só.
 *
 * Várias de uma vez porque é assim que o dia 1 acontece: o mestre traz a
 * equipe do cadastro e cria todo mundo com o mesmo PIN inicial. Criar uma por
 * uma, cada uma com sua trava, seria vinte idas ao banco e a chance de duas se
 * atropelarem.
 *
 * Nada é recusado em silêncio: o que não deu volta em `recusadas`, com motivo.
 */
export async function criarPessoas(novas) {
  return comTrava(TRAVA, async () => {
    const lista = await lerPessoas();
    const existentes = new Set(lista.map((p) => p.usuario));
    const criadas = [];
    const recusadas = [];

    for (const bruta of novas || []) {
      const usuario = normalizarUsuario(bruta.usuario);
      const nome = (bruta.nome || "").toString().trim();
      const papel = papelValido(bruta.papel) ? bruta.papel : PAPEL_PADRAO;

      if (!usuarioValido(usuario)) {
        recusadas.push({ usuario, nome, motivo: "usuário inválido (só minúsculas, números e pontos)" });
        continue;
      }
      if (existentes.has(usuario)) {
        recusadas.push({ usuario, nome, motivo: "já existe" });
        continue;
      }
      if (!pinValido(bruta.pin)) {
        recusadas.push({ usuario, nome, motivo: "o PIN precisa ter 6 dígitos" });
        continue;
      }

      const pessoa = await montarPessoa({ usuario, nome, papel, pin: bruta.pin });
      lista.push(pessoa);
      existentes.add(usuario);
      criadas.push({ usuario, nome, papel });
    }

    if (criadas.length > 0) await gravarPessoas(lista);
    return { criadas, recusadas };
  });
}

/**
 * Muda uma pessoa: papel, ativo, PIN novo, derrubar aparelhos.
 *
 * Tudo sob a trava, porque a lista é uma chave só — mudar o papel de alguém
 * enquanto outro cria uma pessoa apagaria uma das duas mudanças.
 */
export async function mudarPessoa(usuario, mudancas) {
  return comTrava(TRAVA, async () => {
    const lista = await lerPessoas();
    const procurado = normalizarUsuario(usuario);
    const i = lista.findIndex((p) => p.usuario === procurado);
    if (i < 0) return { ok: false, motivo: "não existe" };

    const pessoa = { ...lista[i] };

    if (mudancas.papel !== undefined) {
      if (!papelValido(mudancas.papel)) return { ok: false, motivo: "papel inválido" };
      pessoa.papel = mudancas.papel;
    }

    if (mudancas.ativo !== undefined) pessoa.ativo = mudancas.ativo !== false;

    if (mudancas.pin !== undefined) {
      if (!pinValido(mudancas.pin)) return { ok: false, motivo: "o PIN precisa ter 6 dígitos" };
      pessoa.sal = novoSal();
      pessoa.hash = await hashDoPin(mudancas.pin, pessoa.sal);
      // PIN novo derruba os aparelhos: se o antigo vazou, o cookie que ele
      // gerou também vazou.
      pessoa.versao = (Number(pessoa.versao) || 0) + 1;
      pessoa.pinTrocado = mudancas.pinTrocado === true;
    }

    if (mudancas.derrubarAparelhos === true) {
      pessoa.versao = (Number(pessoa.versao) || 0) + 1;
    }

    lista[i] = pessoa;
    await gravarPessoas(lista);
    if (mudancas.pin !== undefined) await limparErros(procurado);
    return { ok: true, pessoa };
  });
}

export async function removerPessoa(usuario) {
  return comTrava(TRAVA, async () => {
    const lista = await lerPessoas();
    const procurado = normalizarUsuario(usuario);
    const restante = lista.filter((p) => p.usuario !== procurado);
    if (restante.length === lista.length) return { ok: false, motivo: "não existe" };

    // Nunca deixar o app sem mestre: sem nenhum, ninguém mais cria pessoa, zera
    // PIN de quem esquecer, nem volta a mexer no acesso — e o conserto seria
    // apagar a lista no banco à mão.
    if (!restante.some((p) => p.papel === "mestre" && p.ativo !== false)) {
      return { ok: false, motivo: "é o último mestre ativo" };
    }

    await gravarPessoas(restante);
    await limparErros(procurado);
    return { ok: true };
  });
}

/** A pessoa troca o próprio PIN: tem de saber o atual. */
export async function trocarProprioPin(usuario, pinAtual, pinNovo) {
  const pessoa = await buscarPessoa(usuario);
  if (!pessoa) return { ok: false, motivo: "não existe" };
  if (!(await pinBate(pinAtual, pessoa))) return { ok: false, motivo: "o PIN atual não confere" };
  if (!pinValido(pinNovo)) return { ok: false, motivo: "o PIN novo precisa ter 6 dígitos" };
  if (await pinBate(pinNovo, pessoa)) return { ok: false, motivo: "o PIN novo é igual ao atual" };

  return mudarPessoa(usuario, { pin: pinNovo, pinTrocado: true });
}

// ── Tentativas erradas ──────────────────────────────────────────────────────

/**
 * Cinco erros bloqueiam por quinze minutos.
 *
 * O contador é por usuário digitado, exista a pessoa ou não: contar só os que
 * existem contaria ao atacante quais existem.
 */
export async function bloqueio(usuario) {
  const chave = chaveDosErros(normalizarUsuario(usuario));
  const erros = Number(await kv.get(chave)) || 0;
  if (erros < ERROS_PERMITIDOS) return { bloqueado: false, erros };

  const segundos = Number(await kv.ttl(chave)) || 0;
  return { bloqueado: true, erros, segundos: segundos > 0 ? segundos : MINUTOS_DE_BLOQUEIO * 60 };
}

export async function registrarErro(usuario) {
  const chave = chaveDosErros(normalizarUsuario(usuario));
  const erros = await kv.incr(chave);
  // A janela conta do primeiro erro: quem errou cinco vezes espera quinze
  // minutos, e não quinze minutos a cada tentativa nova.
  if (Number(erros) === 1) await kv.expire(chave, MINUTOS_DE_BLOQUEIO * 60);
  return Number(erros) || 0;
}

export async function limparErros(usuario) {
  await kv.del(chaveDosErros(normalizarUsuario(usuario)));
}
