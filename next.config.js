/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
