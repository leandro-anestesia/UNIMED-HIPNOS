import { pessoaParaTela, podeGerirAcesso } from "../../../lib/acesso";
import { exigir } from "../../../lib/guarda";
import {
  criarPessoas,
  lerPessoas,
  mudarPessoa,
  removerPessoa,
} from "../../../lib/pessoas";

/**
 * Quem pode entrar no app — a lista, e as mudanças nela.
 *
 * Tudo aqui é do mestre, e isso é conferido no servidor, não na tela: a seção
 * de Acesso some para quem não é mestre, mas quem souber o endereço desta rota
 * continua recusado.
 *
 * O POST cria várias de uma vez porque é assim que o dia 1 acontece: o mestre
 * traz a equipe do cadastro de anestesiologistas e cria todo mundo com o mesmo
 * PIN inicial.
 */
export default async function handler(req, res) {
  const pessoa = await exigir(req, res, podeGerirAcesso);
  if (!pessoa) return;

  try {
    if (req.method === "GET") {
      const lista = await lerPessoas();
      return res.status(200).json(lista.map(pessoaParaTela));
    }

    if (req.method === "POST") {
      const corpo = req.body || {};
      const novas = Array.isArray(corpo.pessoas) ? corpo.pessoas : [corpo];
      const { criadas, recusadas } = await criarPessoas(novas);
      return res.status(200).json({ criadas, recusadas });
    }

    if (req.method === "PUT") {
      const { usuario, papel, ativo, pin, derrubarAparelhos } = req.body || {};
      if (!usuario) return res.status(400).json({ error: "usuário é obrigatório" });

      const mudancas = {};
      if (papel !== undefined) mudancas.papel = papel;
      if (ativo !== undefined) mudancas.ativo = ativo;
      if (pin !== undefined) mudancas.pin = pin;
      if (derrubarAparelhos !== undefined) mudancas.derrubarAparelhos = derrubarAparelhos === true;

      // Tirar o próprio papel de mestre deixaria o app sem quem o administre se
      // não houver outro — e seria o mestre se trancando do lado de fora.
      if (mudancas.papel && mudancas.papel !== "mestre" && usuario === pessoa.usuario) {
        const lista = await lerPessoas();
        const outros = lista.filter(
          (p) => p.usuario !== pessoa.usuario && p.papel === "mestre" && p.ativo !== false
        );
        if (outros.length === 0) {
          return res.status(400).json({ error: "Você é o último mestre: crie outro antes de trocar o seu papel." });
        }
      }

      const r = await mudarPessoa(usuario, mudancas);
      if (!r.ok) return res.status(400).json({ error: r.motivo });
      return res.status(200).json(pessoaParaTela(r.pessoa));
    }

    if (req.method === "DELETE") {
      const { usuario } = req.query;
      if (!usuario) return res.status(400).json({ error: "usuário é obrigatório" });

      const r = await removerPessoa(usuario);
      if (!r.ok) return res.status(400).json({ error: r.motivo });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao mexer no acesso" });
  }
}
