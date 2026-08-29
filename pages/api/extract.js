export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

/**
 * Leitura da foto da GUIA (não da etiqueta do paciente).
 *
 * A instrução foi calibrada contra uma Guia de Solicitação de Internação da
 * Unimed Campinas, no padrão TISS, em que os campos são numerados. Os números
 * citados abaixo são os daquela guia; guias de outros tipos (SP/SADT) trazem os
 * mesmos dados com numeração diferente, e por isso cada campo é descrito
 * também pelo rótulo.
 *
 * Três armadilhas dessa guia, todas vistas na real e todas tratadas abaixo:
 * o número da guia aparece três vezes com valores quase iguais, o número da
 * carteira começa com zeros que não podem cair, e a tabela de procedimentos é
 * seguida por uma de "Gabaritos" que não é procedimento nenhum.
 */
const PROMPT = `Esta é a foto de uma guia de convênio médico brasileira no padrão TISS — em geral a "Guia de Solicitação de Internação" da Unimed, com os campos numerados. Leia a guia e extraia os campos abaixo.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "paciente": "",
  "nGuia": "",
  "nCarteira": "",
  "cirurgiao": "",
  "procedimentos": []
}

Como preencher cada campo:

- "paciente": o campo "10 - Nome", na seção "Dados do Beneficiário". Nome completo, exatamente como escrito, sem abreviar. Não use "50 - Nome Social".

- "nGuia": o campo "3 - Número da Guia Atribuído pela Operadora". Ele vem com um hífen antes do último dígito, assim: "2728385947-6". Esse último dígito é o verificador e FAZ PARTE do número: devolva tudo junto, só os dígitos, sem o hífen — no exemplo, "27283859476".
  Na mesma guia existem outros números parecidos, que NÃO servem: "2 - Nº Guia no Prestador" é o mesmo número porém sem o dígito verificador; "5 - Senha" costuma ser idêntica ao número da guia; "1 - Registro ANS" é o registro da operadora. Se o campo 3 não estiver legível, use o campo 2 e devolva o que der para ler — quem completa o dígito é o aplicativo.

- "nCarteira": o campo "7 - Número da Carteira", na seção "Dados do Beneficiário". Costuma ter 17 dígitos e COMEÇAR COM ZEROS — preserve os zeros à esquerda (ex.: "00027614700001013"). Só dígitos. Não confunda com o número da guia nem com o Cartão Nacional de Saúde.

- "cirurgiao": o campo "14 - Nome do Profissional Solicitante". É o cirurgião.
  NÃO use "13 - Nome do Contratado", "20 - Nome do Hospital / Local Solicitado" nem "43 - Nome do Hospital / Local Autorizado": esses três são o hospital ou a clínica, não uma pessoa.

- "procedimentos": uma entrada para cada linha da tabela "Procedimentos ou Itens Assistenciais Solicitados", juntando a coluna "35 - Código do Procedimento" com a "36 - Descrição", no formato "CÓDIGO - DESCRIÇÃO". Exemplo: "31309127 - PARTO (VIA VAGINAL)".
  A descrição às vezes ocupa duas linhas na impressão: junte os pedaços numa entrada só.
  IGNORE POR COMPLETO a seção "Gabaritos Solicitados", que vem logo abaixo e tem aparência de tabela igual: gabarito é pacote de cobrança, não é procedimento, e não pode entrar na lista.
  Se a linha tiver descrição mas o código estiver ilegível, devolva só a descrição.

Regras gerais:
- Campo que não estiver visível ou legível fica como string vazia "" (ou lista vazia, em "procedimentos").
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
