/**
 * A identidade desta publicação.
 *
 * A Vercel entrega o commit publicado em `VERCEL_GIT_COMMIT_SHA`, e `env` o
 * grava dentro do pacote — tanto no JavaScript que roda no celular quanto na
 * rota que responde do servidor. Como cada publicação é imutável, o app que
 * está aberto no aparelho carrega a versão dele, e a rota do domínio responde
 * sempre a da publicação no ar: diferentes, saiu versão nova.
 *
 * Fora da Vercel (desenvolvimento) não há commit, e "dev" nos dois lados faz
 * a comparação dizer, corretamente, que não há nada a atualizar.
 */
const VERSAO = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  env: { VERSAO_DO_APP: VERSAO },

  /**
   * O HTML das páginas nunca fica em cache.
   *
   * Adicionado à tela de início do celular, o app roda numa janela própria que
   * guarda o documento com avidez. E é o HTML que aponta para os pacotes de
   * JavaScript, cujos nomes mudam a cada publicação — então um HTML velho
   * mantém o app velho indefinidamente, mesmo com a versão nova no ar. Pior:
   * os pacotes que ele pede deixam de existir quando a publicação antiga sai
   * do ar, e aí o app não abre.
   *
   * São todas as páginas, e não só a raiz: `/entrar` voltava com
   * `max-age=0, must-revalidate` e servida do cache da borda, e é por ela que
   * passa todo mundo que abre o app com o cookie vencido.
   *
   * Os arquivos de `/_next/static` continuam em cache longo, de propósito: o
   * nome deles já muda a cada versão, então nunca ficam desatualizados.
   */
  async headers() {
    const naoGuardar = [{ key: "Cache-Control", value: "no-store, must-revalidate" }];
    return ["/", "/entrar", "/secretaria", "/manifest.json"].map((source) => ({
      source,
      headers: naoGuardar,
    }));
  },
};

module.exports = nextConfig;
