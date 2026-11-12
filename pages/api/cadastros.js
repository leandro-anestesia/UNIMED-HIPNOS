import { TIPOS_DE_CADASTRO } from "../../lib/campos";
import { acrescentar, comoGuardar, lerCadastros, remover } from "../../lib/cadastros";

/**
 * As listas que alimentam o autocompletar.
 *
 * A regra de como guardar e de onde guardar mora em `lib/cadastros.js`, porque
 * a sincronização também mexe nestas listas. Aqui fica só o que é de HTTP:
 * validar o tipo, escolher o verbo e responder.
 */
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await lerCadastros());
    }

    if (req.method === "POST") {
      const { tipo, nome } = req.body || {};
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });
      if (!comoGuardar(tipo, nome)) return res.status(400).json({ error: "nome é obrigatório" });

      const { cadastros } = await acrescentar(tipo, [nome]);
      return res.status(200).json(cadastros);
    }

    if (req.method === "DELETE") {
      const { tipo, nome } = req.query;
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });
      return res.status(200).json(await remover(tipo, nome));
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao acessar armazenamento" });
  }
}
