import { TIPOS_DE_CADASTRO } from "../../lib/campos";
import { acrescentar, comoGuardar, lerCadastros, remover } from "../../lib/cadastros";
import { exigir } from "../../lib/guarda";

/**
 * As listas que alimentam o autocompletar.
 *
 * A regra de como guardar e de onde guardar mora em `lib/cadastros.js`, porque
 * a sincronização também mexe nestas listas. Aqui fica só o que é de HTTP:
 * validar o tipo, escolher o verbo e responder.
 */
export default async function handler(req, res) {
  // Sem acesso, nada: a lista diz quem são os cirurgiões e os pacientes da
  // equipe.
  const pessoa = await exigir(req, res);
  if (!pessoa) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json(await lerCadastros());
    }

    if (req.method === "POST") {
      // `nomes` existe para o salvamento não virar uma requisição por nome: uma
      // guia com oito procedimentos novos eram oito idas ao servidor, em fila,
      // com o formulário aberto esperando. Agora é uma, com uma trava só.
      const { tipo, nome, nomes } = req.body || {};
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });

      const pedidos = Array.isArray(nomes) ? nomes : [nome];
      const validos = pedidos.filter((n) => comoGuardar(tipo, n));
      if (validos.length === 0) return res.status(400).json({ error: "nome é obrigatório" });

      const { cadastros } = await acrescentar(tipo, validos);
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
