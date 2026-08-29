import { kv } from "@vercel/kv";
import { TIPOS_DE_CADASTRO } from "../../lib/campos";

// Prefixo próprio desta equipe. Cada app tem seu próprio banco KV, então a
// separação já está garantida pela infraestrutura — o prefixo é a segunda
// tranca, para o caso de alguém apontar dois deploys para o mesmo banco.
const KEY = "guias:cadastros";

async function getData() {
  const data = await kv.get(KEY);
  return Object.fromEntries(TIPOS_DE_CADASTRO.map((t) => [t, (data && data[t]) || []]));
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await getData());
    }

    if (req.method === "POST") {
      const { tipo, nome } = req.body || {};
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });
      const trimmed = (nome || "").trim();
      if (!trimmed) return res.status(400).json({ error: "nome é obrigatório" });

      const data = await getData();
      if (!data[tipo].some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
        data[tipo] = [...data[tipo], trimmed].sort((a, b) => a.localeCompare(b, "pt-BR"));
      }
      await kv.set(KEY, data);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const { tipo, nome } = req.query;
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });

      const data = await getData();
      data[tipo] = data[tipo].filter((n) => n !== nome);
      await kv.set(KEY, data);
      return res.status(200).json(data);
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao acessar armazenamento" });
  }
}
