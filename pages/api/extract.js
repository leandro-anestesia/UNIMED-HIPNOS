export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

/**
 * Leitura da foto da GUIA (não da etiqueta do paciente).
 *
 * A guia traz, além dos dados do paciente, o profissional solicitante — que é o
 * cirurgião — e a tabela de procedimentos solicitados, que pode ter mais de uma
 * linha. Por isso "procedimentos" é uma lista: o anestesista desmarca na tela o
 * que não se aplica ao ato anestésico.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CALIBRAR: esta instrução foi escrita a partir do padrão TISS das guias de
 * convênio. Confira campo a campo com uma guia real da equipe e ajuste os nomes
 * dos campos citados abaixo para os que aparecem no formulário que ela usa.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PROMPT = `Esta é a foto de uma guia de convênio médico brasileira (padrão TISS) — guia de solicitação de internação, de SP/SADT ou equivalente — usada por uma equipe de anestesia. Leia a guia e extraia os campos abaixo.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "paciente": "",
  "nGuia": "",
  "nCarteira": "",
  "cirurgiao": "",
  "procedimentos": []
}

Como preencher cada campo:

- "paciente": o nome do beneficiário/paciente. Campo costuma aparecer como "Nome" ou "Nome do Beneficiário". Transcreva o nome completo, sem abreviar.

- "nGuia": o número da guia atribuído pela OPERADORA do convênio. Na guia costumam existir vários números parecidos ("Nº Guia no Prestador", "Nº Guia Principal", "Nº da Guia Atribuído pela Operadora", "Senha", "Registro ANS"). O número que interessa aqui tem 10 ou 11 dígitos e começa com 1 ou 2 — use esse critério para escolher entre eles. Prefira o campo com "atribuído pela operadora" no rótulo. Devolva só os dígitos, sem pontos, espaços ou traços. Se nenhum número atender ao critério, devolva o que estiver rotulado como número da guia, ainda assim só com dígitos.

- "nCarteira": o número da carteira do beneficiário ("Nº Carteira", "Número da Carteira", "Carteirinha"). Só dígitos, sem pontos nem traços. NÃO confunda com o número da guia nem com o Cartão Nacional de Saúde (CNS), que tem 15 dígitos.

- "cirurgiao": o nome que estiver em "Nome do Profissional Solicitante" (em algumas guias, "Profissional Solicitante" ou "Médico Solicitante"). É o cirurgião. NÃO use o "Nome do Contratado", que é o hospital ou a clínica, nem o nome do profissional executante quando ele for diferente.

- "procedimentos": a lista de procedimentos solicitados, da tabela de procedimentos da guia (colunas "Código do Procedimento" e "Descrição"). Um item por linha preenchida da tabela, no formato "CÓDIGO - DESCRIÇÃO" (por exemplo "31003010 - Colecistectomia videolaparoscópica"). Se a linha tiver descrição mas não código, devolva só a descrição. Devolva lista vazia se não houver tabela de procedimentos legível.

Regras gerais:
- Campo que não estiver visível ou legível fica como string vazia "" (ou lista vazia, no caso de "procedimentos").
- Não invente e não complete dados que não estejam escritos na guia.
- Transcreva exatamente o que está escrito, inclusive em campos preenchidos à mão.
- Não corrija o número da guia nem o da carteira: devolva os dígitos como estão na imagem.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor" });
  }

  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 é obrigatório" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // A tabela de procedimentos pode ter várias linhas, cada uma com a
        // descrição TUSS inteira; 1000 tokens cortavam o JSON no meio.
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `Erro ${r.status} na API Anthropic`;
      return res.status(r.status).json({ error: msg });
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "Resposta da API sem bloco de texto" });
    }

    let clean = textBlock.text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];

    const parsed = JSON.parse(clean);

    // O formulário conta com uma lista aqui. Se a leitura devolver um texto só
    // (acontece quando a guia tem um único procedimento), vira lista de um item.
    const procedimentos = Array.isArray(parsed.procedimentos)
      ? parsed.procedimentos
      : parsed.procedimentos
      ? [parsed.procedimentos]
      : [];

    return res.status(200).json({
      paciente: parsed.paciente || "",
      nGuia: parsed.nGuia || "",
      nCarteira: parsed.nCarteira || "",
      cirurgiao: parsed.cirurgiao || "",
      procedimentos: procedimentos.map((p) => (p || "").toString().trim()).filter(Boolean),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro desconhecido ao processar imagem" });
  }
}
