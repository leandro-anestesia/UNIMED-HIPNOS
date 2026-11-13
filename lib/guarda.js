import { NOME_DO_COOKIE, lerAcesso, trancaConfigurada } from "./acesso";
import { buscarPessoa } from "./pessoas";

/**
 * Quem está do outro lado desta requisição — do ponto de vista da rota.
 *
 * O middleware já barrou quem não tem cookie, mas as rotas conferem de novo, e
 * isso não é desperdício: é a rota que decide o que cada papel pode fazer, e
 * ela não pode acreditar num cabeçalho que alguém poderia inventar. Conferir a
 * assinatura é cálculo local.
 *
 * O que a rota faz e o middleware não: olhar a pessoa no banco. É isso que faz
 * "sair de todos os aparelhos" e "desativar" valerem na chamada seguinte, em
 * vez de só quando o cookie vencer, daqui a noventa dias.
 */
export async function quemEsta(req) {
  if (!trancaConfigurada()) return { ok: false, motivo: "sem-tranca" };

  const token = (req.cookies || {})[NOME_DO_COOKIE];
  const lido = await lerAcesso(token);
  if (!lido.ok) return { ok: false, motivo: lido.motivo };

  const pessoa = await buscarPessoa(lido.pessoa.usuario);
  if (!pessoa) return { ok: false, motivo: "apagada" };
  if (pessoa.ativo === false) return { ok: false, motivo: "desativada" };
  if ((Number(pessoa.versao) || 0) !== (Number(lido.pessoa.versao) || 0)) {
    return { ok: false, motivo: "aparelho-derrubado" };
  }

  return { ok: true, pessoa };
}

/**
 * Exige acesso, e opcionalmente um papel que passe no teste.
 *
 * Devolve a pessoa, ou `null` depois de já ter respondido — quem chama só
 * precisa de `if (!pessoa) return;`.
 */
export async function exigir(req, res, teste) {
  const r = await quemEsta(req);

  if (!r.ok) {
    if (r.motivo === "sem-tranca") {
      res.status(503).json({ error: "O acesso não pôde ser verificado: falta a chave que assina os cookies." });
      return null;
    }
    res.status(401).json({ error: "Entre no app para continuar.", motivo: r.motivo });
    return null;
  }

  if (teste && !teste(r.pessoa.papel)) {
    res.status(403).json({ error: "Seu acesso não permite esta ação." });
    return null;
  }

  return r.pessoa;
}
