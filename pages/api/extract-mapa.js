import { normalizarTexto } from "../../lib/texto";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

/**
 * Leitura do MAPA CIRÚRGICO da clínica: a folha do dia, com todos os pacientes.
 *
 * A instrução foi calibrada contra a "Agenda de Consultas" do ProDoctor usada
 * pela Clínica de Oftalmologia Nova Campinas. Diferente da guia, aqui a resposta
 * é uma lista: uma foto vira vários lançamentos de uma vez.
 *
 * O que o mapa real ensinou, e está tratado abaixo:
 *
 * 1. Nem toda linha com horário é paciente. O mapa usa a agenda para recados
 *    ("DR FABIO AS 13:00", "DRA DENISE NÃO VAI OPERAR NESSE DIA"), sempre com
 *    prontuário e idade zerados.
 * 2. Entre os pacientes há linhas de anotação ("* PG DIA 09/09 *").
 * 3. Há cabeçalhos de seção no meio da tabela ("MÉDICO: NC Sala 01").
 * 4. O que interessa não está na linha do paciente, e sim no bloco
 *    "COMPLEMENTO:" logo abaixo dela: cirurgião, procedimento e nº da guia.
 * 5. A folha impressa pode trazer duas páginas na mesma foto.
 */
const PROMPT = `Esta é a foto do MAPA CIRÚRGICO (ou agenda) de uma clínica: uma tabela com VÁRIOS pacientes de um mesmo dia. Leia a folha inteira e devolva um paciente por entrada.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "data": "",
  "registros": [
    { "hora": "", "paciente": "", "convenio": "", "nGuia": "", "cirurgiao": "", "procedimentos": [] }
  ]
}

- "data": a data do mapa, no formato dd/mm/aaaa. Costuma estar no cabeçalho, em "DT. DA CONSULTA", "Período - dd/mm/aaaa até dd/mm/aaaa" ou "Data". Se houver várias iguais, use essa. Se não achar, devolva "".

Para cada paciente:

- "hora": o horário da coluna HORA, no formato HH:MM.
- "paciente": o nome da coluna NOME (ou "Paciente", "Cliente"). Nome completo, como escrito.
- "convenio": a coluna CONVÊNIO. Se vier em branco, devolva "".
- "cirurgiao": quem vai operar. ATENÇÃO: no mapa deste tipo, ele NÃO está na linha do paciente — está na primeira linha do bloco "COMPLEMENTO:" logo abaixo dela, escrito como "DRA VANESSA", "DR IVAN". Devolva o nome SEM o "DR"/"DRA" na frente.
- "procedimentos": o procedimento, também no bloco "COMPLEMENTO:" — linhas como "FACO + LIO OE", "FACO+ LIO OD". A lateralidade (OD, OE, ambos) FAZ PARTE do procedimento e fica na mesma entrada. Devolva como lista, normalmente com um item só.
  NÃO confunda com o modelo da lente, que aparece numa linha vizinha do mesmo bloco ("CLAREON T2 + 18.0", "Vivity +22,50 T3", "MA60AC + 23.0", "OD PureSee +30,0"): isso é material, não é procedimento, e não entra.
- "nGuia": o número da guia, quando o bloco "COMPLEMENTO:" trouxer algo como "RES 2728437876 GUIA OK" — devolva só os dígitos que vêm depois de "RES". Sem isso, "".

O QUE NÃO É PACIENTE (não devolva nenhum destes):

- Recado escrito no lugar do nome, ocupando a linha de um horário: "DR FABIO AS 13:00", "DRA DENISE NÃO VAI OPERAR NESSE DIA". Eles vêm com prontuário e idade ZERADOS, e o nome é sobre um médico, não um paciente.
- Linhas de anotação entre pacientes, como "* PG DIA 09/09 *".
- Cabeçalhos de seção: "MÉDICO: NC Sala 01", "DT. DA CONSULTA:", "Agenda de Consultas", o nome e o endereço da clínica no alto, e o rodapé do sistema.

Outras regras:

- A folha pode ter DUAS PÁGINAS na mesma foto, uma embaixo da outra, cada uma com seu cabeçalho. Leia as duas e junte os pacientes numa lista só, na ordem em que aparecem.
- Idade, identidade, telefone e prontuário NÃO são usados: não devolva nenhum deles.
- Campo que não estiver visível ou legível fica como string vazia "" (ou lista vazia).
- Não invente paciente, nem procedimento, nem número. Transcreva o que está escrito.`;

/** Tira o "DR"/"DRA" que o mapa escreve antes do nome de quem opera. */
function semTratamento(nome) {
  return (nome || "")
    .toString()
    .trim()
    .replace(/^(dr|dra|dr\.|dra\.)\s+/i, "")
    .trim();
}

/**
 * A linha é de paciente mesmo?
 *
 * Segunda tranca sobre a instrução: o mapa usa a agenda para recado, e recado
 * entrando como paciente vira lançamento de cirurgia que não existiu. Some
 * calado, porque a tela seguinte mostra a lista para conferir antes de salvar.
 */
function ehRecado(registro) {
  const nome = normalizarTexto(registro.paciente);
  if (!nome) return true;

  // "DR FABIO AS 13:00", "DRA DENISE NAO VAI OPERAR NESSE DIA"
  if (/^(dr|dra)\b/.test(nome)) return true;

  // Nome de gente não tem número. "DR FABIO AS 13:00" e "* PG DIA 09/09 *"
  // têm, e é o que os separa de um paciente de verdade.
  if (/\d/.test(nome)) return true;

  // Anotação marcada com asterisco, o jeito do mapa de destacar recado.
  if (nome.startsWith("*")) return true;

  // Sobra de OCR: risco, traço, uma letra solta.
  if (!/[a-z]{3}/.test(nome)) return true;

  return false;
}

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
        // Um mapa cheio tem vinte pacientes, cada um com procedimento e guia:
        // com folga, para o JSON não ser cortado no meio da lista.
        max_tokens: 8000,
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
    const brutos = Array.isArray(parsed.registros) ? parsed.registros : [];

    const registros = brutos
      .map((p) => ({
        hora: (p.hora || "").toString().trim(),
        paciente: (p.paciente || "").toString().trim(),
        convenio: (p.convenio || "").toString().trim(),
        nGuia: (p.nGuia || "").toString().replace(/\D/g, ""),
        cirurgiao: semTratamento(p.cirurgiao),
        procedimentos: (Array.isArray(p.procedimentos) ? p.procedimentos : [p.procedimentos])
          .map((x) => (x || "").toString().trim())
          .filter(Boolean),
      }))
      .filter((p) => !ehRecado(p));

    return res.status(200).json({ data: (parsed.data || "").toString().trim(), registros });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro desconhecido ao processar o mapa" });
  }
}
