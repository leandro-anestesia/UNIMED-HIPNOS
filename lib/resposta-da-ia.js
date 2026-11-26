/**
 * O que fazer com a resposta da API da Anthropic quando ela não traz texto.
 *
 * O caso que ensinou isto: a leitura do mapa em PDF devolvia "Resposta da API
 * sem bloco de texto", sem dizer mais nada, e demorava para chegar a isso.
 *
 * A causa é que no `claude-sonnet-5` **omitir `thinking` liga o raciocínio
 * adaptativo**, e os tokens de raciocínio saem do mesmo `max_tokens` da
 * resposta. Um PDF de várias páginas é entrada muito mais pesada que uma foto:
 * com teto curto o modelo gasta a cota pensando e a resposta termina em
 * `stop_reason: "max_tokens"` com um bloco `thinking` (de texto vazio, que é o
 * padrão) e NENHUM bloco de texto. A foto escapava por ser uma página só.
 *
 * Teto maior resolve o caso comum. O que não se resolve com teto é saber qual
 * caso foi: por isso esta função devolve o motivo em vez de um recado único
 * para três falhas diferentes. `stop_reason: "refusal"` (um classificador
 * recusou) também chega sem bloco de texto, e tratar os dois como a mesma
 * coisa é o que fez a primeira falha custar uma conversa inteira para
 * diagnosticar.
 */
export function textoDaResposta(data) {
  const blocos = (data && data.content) || [];
  const texto = blocos.find((b) => b && b.type === "text");
  if (texto && (texto.text || "").trim()) return { texto: texto.text };

  const motivo = data && data.stop_reason;
  const tipos = blocos.map((b) => (b && b.type) || "?").join(", ") || "nenhum";

  if (motivo === "refusal") {
    const d = (data && data.stop_details) || {};
    return {
      erro:
        "O modelo recusou ler este arquivo" +
        (d.category ? ` (motivo: ${d.category})` : "") +
        ". Tente fotografar a folha.",
    };
  }

  if (motivo === "max_tokens") {
    return {
      erro:
        "A leitura passou do limite de tamanho da resposta antes de escrever o resultado. " +
        "Se o mapa tiver muitas páginas, leia metade de cada vez.",
    };
  }

  // Nenhum dos dois: ainda assim, diga o que veio. Um recado feio que nomeia o
  // estado é melhor do que um bonito que não diz nada.
  return { erro: `Resposta da API sem bloco de texto (stop_reason: ${motivo || "?"}; blocos: ${tipos})` };
}
