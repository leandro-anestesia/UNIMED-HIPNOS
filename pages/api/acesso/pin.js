import { assinarAcesso, cookieDeAcesso } from "../../../lib/acesso";
import { exigir } from "../../../lib/guarda";
import { buscarPessoa, trocarProprioPin } from "../../../lib/pessoas";

/**
 * Cada um troca o próprio PIN.
 *
 * Vale para os três papéis: o PIN inicial é o mesmo para a equipe inteira, e
 * trocar o seu é o que faz dele um PIN seu.
 *
 * Trocar derruba os outros aparelhos — se o PIN antigo vazou, o cookie que ele
 * gerou vazou também. O aparelho onde a troca aconteceu recebe um cookie novo
 * na mesma resposta, então quem trocou não é posto para fora.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método não permitido" });
  }

  const pessoa = await exigir(req, res);
  if (!pessoa) return;

  try {
    const { pinAtual, pinNovo } = req.body || {};
    const r = await trocarProprioPin(pessoa.usuario, (pinAtual || "").toString(), (pinNovo || "").toString());
    if (!r.ok) return res.status(400).json({ error: r.motivo });

    const atualizada = await buscarPessoa(pessoa.usuario);
    const token = await assinarAcesso(atualizada);
    res.setHeader("Set-Cookie", cookieDeAcesso(token));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao trocar o PIN" });
  }
}
