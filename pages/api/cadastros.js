import { kv } from "../../lib/kv";
import { TIPOS_DE_CADASTRO, CADASTROS_EM_CAIXA_ALTA, emCaixaAlta } from "../../lib/campos";

// Prefixo próprio desta equipe. Cada app tem seu próprio banco KV, então a
// separação já está garantida pela infraestrutura — o prefixo é a segunda
// tranca, para o caso de alguém apontar dois deploys para o mesmo banco.
const KEY = "guias:cadastros";

/** O nome como ele deve ficar guardado, conforme o tipo de cadastro. */
function comoGuardar(tipo, nome) {
  const limpo = (nome || "").toString().trim();
  return CADASTROS_EM_CAIXA_ALTA.includes(tipo) ? emCaixaAlta(limpo) : limpo;
}

function ordenar(nomes) {
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Lê os cadastros já no formato correto.
 *
 * Converte o que foi gravado antes desta regra existir e regrava uma única vez
 * — sem isso, a lista ficaria metade em caixa alta e metade não, e o mesmo
 * anestesista apareceria duas vezes no autocompletar.
 */
async function getData() {
  const bruto = await kv.get(KEY);
  const data = {};
  let mudou = false;

  for (const tipo of TIPOS_DE_CADASTRO) {
    const antes = (bruto && bruto[tipo]) || [];
    const vistos = new Set();
    const depois = [];
    for (const nome of antes) {
      const certo = comoGuardar(tipo, nome);
      if (!certo || vistos.has(certo)) continue;
      vistos.add(certo);
      depois.push(certo);
    }
    data[tipo] = ordenar(depois);
    if (data[tipo].length !== antes.length || data[tipo].some((n, i) => n !== antes[i])) mudou = true;
  }

  if (mudou) await kv.set(KEY, data);
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await getData());
    }

    if (req.method === "POST") {
      const { tipo, nome } = req.body || {};
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });
      const guardar = comoGuardar(tipo, nome);
      if (!guardar) return res.status(400).json({ error: "nome é obrigatório" });

      const data = await getData();
      if (!data[tipo].some((n) => n.toLowerCase() === guardar.toLowerCase())) {
        data[tipo] = ordenar([...data[tipo], guardar]);
      }
      await kv.set(KEY, data);
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const { tipo, nome } = req.query;
      if (!TIPOS_DE_CADASTRO.includes(tipo)) return res.status(400).json({ error: "tipo inválido" });

      // Compara sem caixa: o nome pode chegar como estava antes da conversão.
      const alvo = (nome || "").toString().trim().toLowerCase();
      const data = await getData();
      data[tipo] = data[tipo].filter((n) => n.toLowerCase() !== alvo);
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
