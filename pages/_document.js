import { Html, Head, Main, NextScript } from "next/document";
import { CORES, EQUIPE, HOSPITAL, TITULO, TITULO_CURTO } from "../lib/marca";

export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content={CORES.escura} />
        <meta name="description" content={`${TITULO} — ${EQUIPE}`} />
        {/* Dados de saúde: fora de buscadores. */}
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${TITULO} · ${HOSPITAL}`}</title>

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
