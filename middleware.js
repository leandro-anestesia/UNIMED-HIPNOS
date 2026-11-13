import { NextResponse } from "next/server";
import { NOME_DO_COOKIE, lerAcesso, podeVerSecretaria, trancaConfigurada } from "./lib/acesso";

/**
 * O cadeado.
 *
 * Toda requisição passa por aqui antes de chegar à página ou à rota. Sem cookie
 * válido, uma página é mandada para `/entrar` e uma rota de API responde 401 e
 * nada mais — e é isto, não a tela, que tranca: o que protege os pacientes é
 * `/api/entries` não responder, não o botão estar escondido.
 *
 * Roda no Edge e não toca no banco de propósito: conferir a assinatura é
 * cálculo local, enquanto consultar o Redis custaria uma viagem de rede em cada
 * toque do app. A consequência é que "sair de todos os aparelhos" e "desativar"
 * não valem aqui — valem na primeira chamada de API, que é onde `lib/guarda.js`
 * olha a pessoa no banco.
 */

const PUBLICO = [
  "/entrar",
  "/api/acesso/entrar",
  "/api/acesso/eu",
  "/api/acesso/sair",
  "/manifest.json",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/logo-mark.png",
];

function ehPublico(caminho) {
  return PUBLICO.includes(caminho) || caminho.startsWith("/_next/");
}

export async function middleware(req) {
  const { pathname, search } = req.nextUrl;
  if (ehPublico(pathname)) return NextResponse.next();

  const ehApi = pathname.startsWith("/api/");

  // Sem nenhuma fonte de chave não há como assinar nem conferir cookie. Aqui a
  // escolha é recusar, e não deixar passar: deixar passar seria o app aberto
  // sem ninguém perceber. Como o app todo vive no mesmo banco cuja variável
  // serve de chave, sem ela ele já não funcionaria de qualquer modo.
  if (!trancaConfigurada()) {
    const recado = "O acesso não pôde ser verificado: falta a chave que assina os cookies.";
    return ehApi
      ? NextResponse.json({ error: recado }, { status: 503 })
      : new NextResponse(recado, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const lido = await lerAcesso(req.cookies.get(NOME_DO_COOKIE)?.value);

  if (!lido.ok) {
    if (ehApi) {
      return NextResponse.json({ error: "Entre no app para continuar.", motivo: lido.motivo }, { status: 401 });
    }
    const destino = req.nextUrl.clone();
    destino.pathname = "/entrar";
    destino.search = `?de=${encodeURIComponent(pathname + (search || ""))}`;
    return NextResponse.redirect(destino);
  }

  // A tela da secretaria é dela e do mestre. Digitar o endereço não serve de
  // atalho — e a recusa volta dizendo o motivo, em vez de uma tela em branco.
  if (pathname.startsWith("/secretaria") && !podeVerSecretaria(lido.pessoa.papel)) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/";
    destino.search = "?negado=secretaria";
    return NextResponse.redirect(destino);
  }

  return NextResponse.next();
}

export const config = {
  // Fica de fora o que não tem dado: os pacotes do Next, as imagens do app e a
  // tela de entrada. Todo o resto — páginas e rotas — passa pelo cadeado.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
