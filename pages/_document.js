import { Html, Head, Main, NextScript } from "next/document";
import { COR_DO_NAVEGADOR, EQUIPE, TITULO, TITULO_CURTO } from "../lib/marca";

export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content={COR_DO_NAVEGADOR} />
        <meta name="description" content={`${TITULO} — ${EQUIPE}`} />
        {/* Dados de saúde: fora de buscadores. */}
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${TITULO} · ${EQUIPE}`}</title>

        {/* Inter, a fonte do app do celular. `display=swap` porque o app abre
            no centro cirúrgico com rede ruim: melhor o texto na fonte do
            sistema agora do que nada até a Inter chegar. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />

        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* O manifest é estático: nome e cores dele acompanham lib/marca.js à mão. */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={TITULO_CURTO} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
