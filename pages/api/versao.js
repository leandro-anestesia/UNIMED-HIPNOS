/**
 * Qual versão do app está publicada agora.
 *
 * Existe para o app aberto no aparelho descobrir que ficou para trás. O iPhone
 * não recarrega uma página que volta da memória: devolve a tela como estava,
 * com o JavaScript da publicação antiga, e o app seguiria assim por semanas.
 *
 * Responde só isto — uma linha de texto que não diz nada sobre ninguém — e
 * continua atrás da tranca como todas as rotas, porque não há motivo para
 * abri-la. Quem não está logado já está indo para o PIN por outro caminho.
 */
export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "método não suportado" });
  // Guardar esta resposta anularia o que ela existe para responder.
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  return res.status(200).json({ versao: process.env.VERSAO_DO_APP || "dev" });
}
