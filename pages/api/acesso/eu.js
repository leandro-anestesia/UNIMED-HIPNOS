import { trancaConfigurada } from "../../../lib/acesso";
import { quemEsta } from "../../../lib/guarda";
import { listaVazia } from "../../../lib/pessoas";

/**
 * Quem sou eu, e em que estado está a tranca.
 *
 * O app precisa disto porque o cookie é `HttpOnly`: a página não consegue ler o
 * próprio acesso, e sem saber o papel ela não sabe o que esconder. Esconder é
 * cortesia — o que protege é cada rota recusar —, mas botão que dá erro é pior
 * do que botão que não existe.
 *
 * Responde também a quem não está logado, porque é esta rota que diz à tela de
 * entrada se ainda não existe ninguém (e é hora de criar o mestre).
 */
export default async function handler(req, res) {
  try {
    const r = await quemEsta(req);

    if (r.ok) {
      return res.status(200).json({
        logado: true,
        tranca: true,
        usuario: r.pessoa.usuario,
        nome: r.pessoa.nome || "",
        papel: r.pessoa.papel,
        pinTrocado: r.pessoa.pinTrocado === true,
      });
    }

    return res.status(200).json({
      logado: false,
      tranca: trancaConfigurada(),
      vazia: trancaConfigurada() ? await listaVazia() : false,
      motivo: r.motivo,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao ler o acesso" });
  }
}
