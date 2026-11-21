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
   * O HTML da página nunca fica em cache.
   *
   * Adicionado à tela de início do celular, o app roda numa janela própria que
   * guarda o documento com avidez. E é o HTML que aponta para os pacotes de
   * JavaScript, cujos nomes mudam a cada publicação — então um HTML velho
   * mantém o app velho indefinidamente, mesmo com a versão nova no ar.
   *
   * Os arquivos de `/_next/static` continuam em cache longo, de propósito: o
   * nome deles já muda a cada versão, então nunca ficam desatualizados.
   */
  async headers() {
    const naoGuardar = [{ key: "Cache-Control", value: "no-store, must-revalidate" }];
    return [
      { source: "/", headers: naoGuardar },
      { source: "/manifest.json", headers: naoGuardar },
    ];
  },
};

module.exports = nextConfig;
