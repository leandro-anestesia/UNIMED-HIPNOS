import {
  assinarAcesso,
  cookieDeAcesso,
  hashDoPin,
  normalizarUsuario,
  pinBate,
  pinValido,
  trancaConfigurada,
  usuarioValido,
} from "../../../lib/acesso";
import {
  bloqueio,
  buscarPessoa,
  criarPessoas,
  limparErros,
  listaVazia,
  registrarErro,
  MINUTOS_DE_BLOQUEIO,
} from "../../../lib/pessoas";

/**
 * A única porta aberta: usuário e PIN entram, cookie sai.
 *
 * Duas coisas que esta rota faz de propósito e podem parecer defeito:
 *
 * 1. A resposta é a mesma para "usuário não existe", "PIN errado" e "pessoa
 *    desativada". Quem está tentando adivinhar não fica sabendo que acertou
 *    metade.
 * 2. Quando o usuário não existe, ela ainda assim calcula um hash jogado fora.
 *    Sem isso, a resposta para quem não existe voltaria muito mais rápido, e o
 *    tempo diria o que a mensagem não diz.
 */

const SAL_DE_ENROLAR = "sal-que-nao-e-de-ninguem";

async function enrolar(pin) {
  await hashDoPin((pin || "").toString(), SAL_DE_ENROLAR);
}

/** Uma resposta só para todos os jeitos de errar a entrada. */
function naoEntra(res) {
  return res.status(401).json({ error: "Usuário ou PIN incorreto." });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método não permitido" });
  }

  if (!trancaConfigurada()) {
    return res.status(503).json({
      error: "O acesso não pôde ser verificado: falta a chave que assina os cookies.",
    });
  }

  try {
    const usuario = normalizarUsuario((req.body || {}).usuario);
    const pin = ((req.body || {}).pin || "").toString();
    const criarMestre = (req.body || {}).criarMestre === true;

    if (!usuarioValido(usuario)) return naoEntra(res);

    const travado = await bloqueio(usuario);
    if (travado.bloqueado) {
      const minutos = Math.max(1, Math.ceil(travado.segundos / 60));
      return res.status(429).json({
        error: `Muitas tentativas. Tente de novo em ${minutos} minuto${minutos === 1 ? "" : "s"}.`,
        segundos: travado.segundos,
      });
    }

    // ── O primeiro acesso: com a lista vazia, quem chega cria o mestre ──────
    if (criarMestre) {
      if (!(await listaVazia())) {
        return res.status(409).json({ error: "Já existe gente cadastrada: entre com seu usuário e PIN." });
      }
      if (!pinValido(pin)) {
        return res.status(400).json({ error: "O PIN precisa ter 6 dígitos." });
      }

      const { criadas, recusadas } = await criarPessoas([
        { usuario, nome: (req.body || {}).nome || "", papel: "mestre", pin },
      ]);
      if (criadas.length === 0) {
        return res.status(400).json({ error: (recusadas[0] && recusadas[0].motivo) || "Não consegui criar o mestre." });
      }

      const pessoa = await buscarPessoa(usuario);
      const token = await assinarAcesso(pessoa);
      res.setHeader("Set-Cookie", cookieDeAcesso(token));
      return res.status(200).json({
        usuario: pessoa.usuario,
        nome: pessoa.nome,
        papel: pessoa.papel,
        pinTrocado: true,
      });
    }

    // ── A entrada de todo dia ──────────────────────────────────────────────
    const pessoa = await buscarPessoa(usuario);

    if (!pessoa) {
      await enrolar(pin);
      await registrarErro(usuario);
      return naoEntra(res);
    }

    // O PIN de emergência, se existir na Vercel, entra como mestre — é o
    // conserto para o caso de o mestre esquecer o próprio PIN e não haver um
    // segundo mestre para zerá-lo. Só vale para quem já é mestre: não promove
    // ninguém.
    const deEmergencia =
      Boolean(process.env.ACESSO_PIN_MESTRE) &&
      pessoa.papel === "mestre" &&
      pin === process.env.ACESSO_PIN_MESTRE;

    const bate = deEmergencia || (await pinBate(pin, pessoa));

    if (!bate || pessoa.ativo === false) {
      const erros = await registrarErro(usuario);
      if (erros >= 5) {
        return res.status(429).json({
          error: `Muitas tentativas. Tente de novo em ${MINUTOS_DE_BLOQUEIO} minutos.`,
          segundos: MINUTOS_DE_BLOQUEIO * 60,
        });
      }
      return naoEntra(res);
    }

    await limparErros(usuario);
    const token = await assinarAcesso(pessoa);
    res.setHeader("Set-Cookie", cookieDeAcesso(token));
    return res.status(200).json({
      usuario: pessoa.usuario,
      nome: pessoa.nome || "",
      papel: pessoa.papel,
      pinTrocado: pessoa.pinTrocado === true,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao entrar" });
  }
}
