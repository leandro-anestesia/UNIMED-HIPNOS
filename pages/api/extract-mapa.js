import { semOsIgnorados } from "../../lib/procedimentos";
import { normalizarTexto, semTratamento } from "../../lib/texto";
import { exigir } from "../../lib/guarda";
import { ehDaVision } from "../../lib/vision";
import { textoDaResposta } from "../../lib/resposta-da-ia";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

// Ler um PDF de várias páginas é bem mais lento do que ler uma foto, e o
// padrão da Vercel para rota de API é curto demais para isso: a função morreria
// no meio da leitura e o app mostraria um erro que não é o erro.
export const maxDuration = 300;

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
 * 6. A agenda também chega em PDF, direto do sistema da clínica. Aí ela vem
 *    como `document`, não `image`, e as páginas vêm separadas em vez de
 *    empilhadas numa foto só — por isso a instrução fala em "arquivo" e manda
 *    ler todas as páginas, seja qual for a forma.
 */
const PROMPT = `Este é o MAPA CIRÚRGICO (ou agenda) de uma clínica, em foto ou em PDF: uma tabela com VÁRIOS pacientes de um mesmo dia. Leia a folha inteira e devolva um paciente por entrada.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "registros": [
    { "hora": "", "paciente": "", "convenio": "", "nGuia": "", "cirurgiao": "", "procedimentos": [] }
  ]
}


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

- O arquivo pode ter VÁRIAS PÁGINAS: numa foto elas aparecem empilhadas, uma embaixo da outra, cada uma com seu cabeçalho; num PDF vêm separadas. Nos dois casos, leia TODAS e junte os pacientes numa lista só, na ordem em que aparecem.
- Idade, identidade, telefone e prontuário NÃO são usados: não devolva nenhum deles.
- Campo que não estiver visível ou legível fica como string vazia "" (ou lista vazia).
- A DATA DO MAPA não é lida. A data do lançamento é a do dia em que a foto está sendo tirada, e quem a informa é o aplicativo. Não devolva data em campo nenhum nem acrescente uma chave de data ao JSON.
- Não invente paciente, nem procedimento, nem número. Transcreva o que está escrito.`;

/**
 * Leitura do mapa da OFTALMO VISION, que é outra folha.
 *
 * Instrução própria, e não uma seção acrescentada à de cima, porque os dois
 * mapas não se parecem: lá o que interessa está num bloco "COMPLEMENTO:"
 * abaixo da linha; aqui está tudo dentro da própria célula do paciente —
 * nome, cirurgião, olho, marca da lente, valores cobrados pela clínica e
 * recados. Uma instrução só, tentando cobrir as duas folhas, piora as duas.
 *
 * O que esta folha ensina:
 *
 * 1. A célula "Paciente" empilha várias informações, e só a(s) primeira(s)
 *    linha(s) são o nome.
 * 2. O cirurgião vem como "DR.EDUARDO", colado, dentro da mesma célula.
 * 3. O procedimento quase nunca está escrito: está só o olho (OD/OE). Quem
 *    completa é o app, com a regra da clínica.
 * 4. O resto da célula é material e recado — lente, medicação, dinheiro —, e
 *    nada disso é procedimento.
 */
const PROMPT_VISION = `Este é o MAPA CIRÚRGICO da clínica, em foto ou em PDF, no formato "Módulo de Agenda Médica": uma tabela com as colunas Hora, Paciente, Telefone, Categoria, Tipo, F, Atendente, C, E, Chegou e Ficha. Cada linha é um paciente de um mesmo dia.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "registros": [
    { "hora": "", "paciente": "", "convenio": "", "cirurgiao": "", "olho": "", "procedimentos": [] }
  ]
}

Para cada paciente:

- "hora": a coluna Hora, no formato HH:MM.
- "paciente": SÓ o nome da pessoa, que ocupa a primeira linha da célula "Paciente" e às vezes continua na segunda (sobrenome que não coube). Pare no momento em que aparecer "DR."/"DRA." ou uma anotação. Devolva o nome como está escrito, sem as anotações.
- "convenio": a coluna CATEGORIA — "Unimed", "Poupe Saúde", "Doctor Prime", "SUS", "Particular" e afins. Em branco, devolva "".
- "cirurgiao": a linha da célula "Paciente" que começa com DR. ou DRA., normalmente colada ao nome ("DR.EDUARDO"). Devolva só o nome, SEM o "DR"/"DRA".
- "olho": a linha da célula que traz apenas "OD", "OE" ou "AO". Se não houver, "".
- "procedimentos": devolva a lista VAZIA quando a célula não nomear um procedimento — é o caso comum nesta folha, onde está escrito só o olho. Só preencha quando houver um procedimento escrito mesmo, como "BLEFAROPLASTIA", "BLEFAROPLASTIA SUPERIOR E INFERIOR", "PTERÍGIO", "TRANSPLANTE".

O QUE NÃO É PROCEDIMENTO, e não entra em campo nenhum:

- marca ou modelo de lente: "BIOTECH SERT MONOPLUS", "CICOLIN", "LOOP", "RAYONE", "ASFÉRICA", "LOOP OU RAYONE";
- medicação e recado clínico: "DAR DIAMOX";
- dinheiro: "R$4.500,00", "R$4.000,00 À VISTA", "R$4.500,00 NO CARTÃO", "EM 6X CARTÃO", "pagou 05/11 em dinheiro";
- números de carteirinha ("058.6250.002117.01-7"), telefone e número da ficha.

Outras regras:

- Telefone, Tipo, F, Atendente, C, E, Chegou e Ficha NÃO são usados: não devolva nenhum deles, nem o número da carteirinha.
- Linha sem nome de pessoa, ou que seja recado da clínica, não é paciente: não devolva.
- O arquivo pode ter mais de uma página — empilhadas, numa foto, ou separadas, num PDF. Leia todas e junte numa lista só, na ordem.
- A DATA do mapa não é lida: quem a informa é o aplicativo. Não devolva data em campo nenhum.
- Não invente paciente, procedimento nem valor. Transcreva o que está escrito.`;

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
  // Sem acesso, nada. A conta da Anthropic é da equipe: quem descobrisse
  // este endereço mandaria fotos para ler por ela, e isso só apareceria na
  // fatura.
  const pessoa = await exigir(req, res);
  if (!pessoa) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor" });
  }

  const { imageBase64, mediaType, local } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 é obrigatório" });
  }

  // A agenda da clínica sai do sistema em PDF, e um PDF não é imagem: vai num
  // bloco `document`, não `image`. Lista fechada porque é o que a API aceita —
  // um tipo solto aqui vira um erro vindo de fora, difícil de ler na tela.
  const TIPOS = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
  const tipo = mediaType || "image/jpeg";
  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo de arquivo não suportado: ${tipo}` });
  }
  const ehPdf = tipo === "application/pdf";

  // A Vision usa outra folha, e portanto outra instrução. O resto das clínicas
  // segue na calibrada contra o ProDoctor.
  const daVision = ehDaVision(local);
  const prompt = daVision ? PROMPT_VISION : PROMPT;

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
        // O raciocínio sai DESTE teto. No `claude-sonnet-5`, não mandar
        // `thinking` liga o modo adaptativo, e com 8000 um PDF de várias
        // páginas acabava a cota pensando: a resposta voltava sem bloco de
        // texto nenhum. O JSON de vinte pacientes não chega perto de 32000 —
        // a folga é para o raciocínio, não para a lista.
        max_tokens: 32000,
        messages: [
          {
            role: "user",
            content: [
              ehPdf
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: imageBase64 } }
                : { type: "image", source: { type: "base64", media_type: tipo, data: imageBase64 } },
              { type: "text", text: prompt },
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

    const lido = textoDaResposta(data);
    if (lido.erro) {
      return res.status(502).json({ error: lido.erro });
    }

    let clean = lido.texto.replace(/```json|```/g, "").trim();
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
        // Só a Vision escreve o olho em campo separado: nos outros mapas a
        // lateralidade já vem dentro do procedimento.
        ...(daVision ? { olho: (p.olho || "").toString().trim().toUpperCase() } : {}),
        // A mesma regra da guia: internação, visita hospitalar e recém-nascido
        // são item do hospital, não ato anestésico, e não entram na lista.
        procedimentos: semOsIgnorados(p.procedimentos),
      }))
      .filter((p) => !ehRecado(p));

    return res.status(200).json({ registros });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro desconhecido ao processar o mapa" });
  }
}
