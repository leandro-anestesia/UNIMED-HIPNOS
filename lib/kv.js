import { createClient } from "@vercel/kv";

/**
 * Cliente do Redis.
 *
 * Existe por dois motivos, os dois vistos na prática ao publicar:
 *
 * 1. O `kv` pronto do @vercel/kv só enxerga KV_REST_API_URL e
 *    KV_REST_API_TOKEN. A Vercel aposentou o KV próprio e passou o banco para
 *    a integração da Upstash, que conforme o caminho de criação entrega as
 *    variáveis como UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN. Com só
 *    um dos nomes aceitos, um banco conectado e funcionando aparece como banco
 *    inexistente.
 *
 * 2. A mensagem original ("Missing required environment variables …") não diz
 *    o que fazer. Quem lê está a um passo de resolver e não sabe qual.
 *
 * O cliente nasce no primeiro uso, e não na importação: `createClient` estoura
 * na hora se a URL vier vazia, e isso derrubaria a rota inteira com um erro
 * que não explica nada.
 */

function credenciais() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

let cliente = null;

function obterCliente() {
  if (cliente) return cliente;

  const { url, token } = credenciais();
  if (!url || !token) {
    const faltam = [
      !url && "a URL (KV_REST_API_URL ou UPSTASH_REDIS_REST_URL)",
      !token && "o token (KV_REST_API_TOKEN ou UPSTASH_REDIS_REST_TOKEN)",
    ].filter(Boolean);
    throw new Error(
      `O banco de dados não está configurado: falta ${faltam.join(" e ")}. ` +
        `Na Vercel, aba Storage, conecte um banco Upstash Redis a este projeto — ` +
        `e depois refaça o deploy, porque variável nova só vale no próximo build.`
    );
  }

  cliente = createClient({ url, token });
  return cliente;
}

/** Mesma forma de uso do `kv` original (`kv.get`, `kv.set`, `kv.del`). */
export const kv = new Proxy(
  {},
  {
    get(_alvo, prop) {
      const c = obterCliente();
      const valor = c[prop];
      return typeof valor === "function" ? valor.bind(c) : valor;
    },
  }
);
