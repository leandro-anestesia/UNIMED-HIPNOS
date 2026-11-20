import { MINUTOS_DO_CODIGO, assinarCodigoDeCopia, podeGerirAcesso } from "../../../lib/acesso";
import { exigir } from "../../../lib/guarda";

/**
 * Gera um código de cópia: quinze minutos, só leitura.
 *
 * É o que destrava a cópia dos pacientes para o app de teste. Lá o servidor
 * precisa ler daqui, e desde a tranca ele não tem como — um servidor não
 * digita PIN.
 *
 * Só o mestre gera. O código não é guardado em lugar nenhum: ele é assinado na
 * hora e se verifica sozinho, então não há lista de códigos para alguém
 * esquecer de limpar.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método não permitido" });
  }

  const pessoa = await exigir(req, res, podeGerirAcesso);
  if (!pessoa) return;

  try {
    const codigo = await assinarCodigoDeCopia();
    return res.status(200).json({ codigo, minutos: MINUTOS_DO_CODIGO });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao gerar o código" });
  }
}
