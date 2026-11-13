import { cookieApagado } from "../../../lib/acesso";

/** Sair deste aparelho: apaga o cookie e nada mais. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método não permitido" });
  }
  res.setHeader("Set-Cookie", cookieApagado());
  return res.status(200).json({ ok: true });
}
