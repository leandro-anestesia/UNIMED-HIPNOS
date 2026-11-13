import { nomeCurtoDoConvenio, semCodigoNaFrente } from "../../lib/convenios";
import { PROCEDIMENTOS_IGNORADOS, semOsIgnorados } from "../../lib/procedimentos";
import { semTratamento } from "../../lib/texto";
import { exigir } from "../../lib/guarda";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

/**
 * Leitura da foto de um documento de paciente: a guia, a etiqueta ou a ficha.
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
 *
 * O terceiro documento é a ficha de VIDEO DIAGNÓSTICO da Endodiagnose, que ali
 * faz as vezes da guia: folha A4 preenchida à caneta, com os exames marcados a
 * X no alto. Ela também tem o par de campos quase iguais — "Senha da guia
 * Unimed" e "Senha da guia Anestesia" —, e a equipe decidiu que o Nº da Guia
 * sai do primeiro; e dois médicos em linhas vizinhas, dos quais vale o
 * responsável pelo exame, que é quem o faz.
 *
 * O quarto é a Solicitação de Anátomo Patológico da Unimed, que é a guia usada
 * no IGCC. Nela quase nada se chama pelo nome que o aplicativo usa: o Nº da
 * Guia é o "Protocolo", a carteira é o "Código" — com pontos, e ao lado de um
 * "Código Requisitante" que não serve —, e o cirurgião não é o "Requisitante"
 * impresso no alto, e sim quem carimbou no pé da folha. A data é ignorada de
 * propósito: a equipe lança no dia, e a folha traz datas de solicitação e de
 * atendimento que não são a da anestesia.
 */
const PROMPT = `Esta foto é de UM de quatro documentos. Reconheça qual antes de ler:

(A) uma GUIA de convênio no padrão TISS — em geral a "Guia de Solicitação de Internação" da Unimed, folha grande com os campos numerados;
(B) uma ETIQUETA de paciente impressa pela clínica — um retângulo pequeno, com o nome da clínica no alto e poucas linhas rotuladas ("CLIENTE:", "DATA NASC:", "DATA ATENDIMENTO:", "CONVÊNIO:", "CIRURGIÃO:"), e o procedimento solto embaixo; ou
(C) a FICHA DA ENDODIAGNOSE — folha A4 em retrato, com "ENDODIAGNOSE" no alto, "VIDEO DIAGNÓSTICO" logo abaixo e, em seguida, "ENDOSCOPIA ( ) COLONOSCOPIA ( )" com os quadrados marcados à mão. O resto da folha é uma pilha de linhas rotuladas, preenchidas à caneta; ou
(D) a SOLICITAÇÃO DE ANÁTOMO PATOLÓGICO — folha A4 impressa, com o logotipo da Unimed no alto à esquerda, o título "SOLICITAÇÃO DE ANÁTOMO PATOLÓGICO" ao lado e um "ANS Nº" à direita. Os campos são impressos, não escritos à mão, em linhas que começam por "Protocolo:", "Beneficiário(a):" e "Requisitante:", e embaixo há uma tabela de "Cód. Proced." e "Descrição". No pé da folha costuma haver um carimbo de médico.

Os quatro preenchem os mesmos campos; a etiqueta simplesmente tem menos deles. Devolva vazio o que o documento não trouxer, e não invente para completar.

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta, exatamente com estas chaves:
{
  "atendimento": "",
  "paciente": "",
  "convenio": "",
  "nGuia": "",
  "nCarteira": "",
  "cirurgiao": "",
  "procedimentos": []
}

Como preencher cada campo:

- "atendimento": o número do atendimento, quando a guia trouxer. Procure pelo rótulo — "Atendimento", "Nº do Atendimento", "Atend." — em qualquer lugar da folha, inclusive em carimbo, etiqueta ou cabeçalho impresso pelo hospital. Devolva só o número, como está escrito, com os zeros à esquerda se houver.
  NÃO use o número da guia, o da carteira, o da senha, o do prontuário nem o "7 - Número da Carteira": são números vizinhos e parecidos. Se não houver campo de atendimento na folha, devolva "".

- "convenio": o nome do convênio (a operadora do plano de saúde do paciente — quem paga).
  Procure primeiro um campo rotulado "Convênio", "Convenio", "Operadora" ou "Plano". O valor costuma vir como CÓDIGO seguido de traço e nome, assim: "0110 - UNIMED CAMPINAS". Devolva SÓ O NOME, sem o código e sem o traço — no exemplo, "UNIMED CAMPINAS".
  Se não houver campo rotulado, use o nome da operadora impresso no alto da guia (junto do logotipo, ao lado de "1 - Registro ANS").
  NÃO devolva o nome do hospital ou da clínica onde o procedimento vai acontecer — "13 - Nome do Contratado", "20 - Nome do Hospital / Local Solicitado" e "43 - Nome do Hospital / Local Autorizado" — a menos que a operadora do plano seja exatamente essa mesma empresa.

- "paciente": o campo "10 - Nome", na seção "Dados do Beneficiário". Nome completo, exatamente como escrito, sem abreviar. Não use "50 - Nome Social".

- "nGuia": o campo "3 - Número da Guia Atribuído pela Operadora". Ele vem com um hífen antes do último dígito, assim: "2728385947-6". Esse último dígito é o verificador e FAZ PARTE do número: devolva tudo junto, só os dígitos, sem o hífen — no exemplo, "27283859476".
  Na mesma guia existem outros números parecidos, que NÃO servem: "2 - Nº Guia no Prestador" é o mesmo número porém sem o dígito verificador; "5 - Senha" costuma ser idêntica ao número da guia; "1 - Registro ANS" é o registro da operadora. Se o campo 3 não estiver legível, use o campo 2 e devolva o que der para ler — quem completa o dígito é o aplicativo.

- "nCarteira": o campo "7 - Número da Carteira", na seção "Dados do Beneficiário". Costuma ter 17 dígitos e COMEÇAR COM ZEROS — preserve os zeros à esquerda (ex.: "00027614700001013"). Só dígitos. Não confunda com o número da guia nem com o Cartão Nacional de Saúde.

- "cirurgiao": o campo "14 - Nome do Profissional Solicitante". É o cirurgião.
  NÃO use "13 - Nome do Contratado", "20 - Nome do Hospital / Local Solicitado" nem "43 - Nome do Hospital / Local Autorizado": esses três são o hospital ou a clínica, não uma pessoa.

- "procedimentos": uma entrada para cada linha da tabela "Procedimentos ou Itens Assistenciais Solicitados", juntando a coluna "35 - Código do Procedimento" com a "36 - Descrição", no formato "CÓDIGO - DESCRIÇÃO". Exemplo: "31309127 - PARTO (VIA VAGINAL)".
  A descrição às vezes ocupa duas linhas na impressão: junte os pedaços numa entrada só.
  IGNORE as linhas que não entram neste controle: ${PROCEDIMENTOS_IGNORADOS.map((t) => t.nome.toUpperCase()).join(", ")}. As três primeiras são item do hospital, e não ato anestésico; a última é a própria anestesia, que a equipe não lança como procedimento. Basta o termo aparecer em qualquer parte da descrição — "99996666 - INTERNACAO", "DIÁRIA DE INTERNAÇÃO", "VISITA HOSPITALAR (POR DIA)" — para a linha ficar fora da lista.
  IGNORE POR COMPLETO a seção "Gabaritos Solicitados", que vem logo abaixo e tem aparência de tabela igual: gabarito é pacote de cobrança, não é procedimento, e não pode entrar na lista.
  Se a linha tiver descrição mas o código estiver ilegível, devolva só a descrição.

SE FOR ETIQUETA (B), onde cada coisa está:

- "paciente": o que vem depois de "CLIENTE:".
- "convenio": o que vem depois de "CONVÊNIO:".
- "cirurgiao": o que vem depois de "CIRURGIÃO:". Devolva o nome SEM o "DR"/"DRA" da frente.
- "procedimentos": o texto solto embaixo dos rótulos, sem código TUSS — por exemplo "CIRURGIA DE CATARATA" numa linha e "OLHO ESQUERDO" na seguinte. É UM procedimento só: junte as duas linhas numa entrada, porque a lateralidade faz parte dele. Nunca devolva a lateralidade como procedimento separado.
- "nGuia", "nCarteira" e "atendimento": a etiqueta normalmente não traz nenhum dos três. Deixe vazios.
- O nome da clínica no alto da etiqueta NÃO é o convênio.

SE FOR A FICHA DA ENDODIAGNOSE (C), onde cada coisa está:

A folha inteira é preenchida à mão, em letra de forma ou cursiva. Transcreva o que está escrito; não corrija e não complete.

- "paciente": o que vem depois de "Nome :". Use esse, e não o "Nome social:" da linha de cima, que é outro campo e costuma vir vazio.
- "cirurgiao": o que vem depois de "Médico Responsável pelo exame:", que é quem faz o procedimento. Devolva o nome SEM o "DR"/"DRA" da frente.
  NÃO use "Médico Solicitante:", a linha logo acima: esse é quem pediu o exame, não quem o faz.
- "convenio": o que vem depois de "Convênio:". Esta ficha é usada numa clínica onde os pacientes são da Unimed; se o campo estiver vazio ou ilegível, devolva "UNIMED".
- "nCarteira": o que vem depois de "N. carteirinha:". Costuma ter 17 dígitos e COMEÇAR COM ZEROS — preserve os zeros à esquerda. Só dígitos.
- "nGuia": o que vem depois de "Senha da guia Unimed:". Só dígitos, sem a validade que vem ao lado.
  NÃO use "Senha da guia Anestesia:", a linha logo abaixo, nem o CPF, o RG, o CEP ou os telefones.
- "procedimentos": os exames marcados na linha "ENDOSCOPIA ( ) COLONOSCOPIA ( )", no alto da folha. Devolva uma entrada para CADA quadrado marcado — com os dois marcados, ["ENDOSCOPIA", "COLONOSCOPIA"]; com um só, a lista tem um item. A marca é um X à mão, às vezes por cima de um risco de marca-texto. Quadrado vazio não entra.
- "atendimento": a ficha não traz. Deixe vazio.
- Peso, altura, idade, CPF, RG, endereço, CEP, cidade, estado, telefones, acompanhante e "Hora:" NÃO são usados: não devolva nenhum deles em campo nenhum.
- A folha pode estar sobre outras, e o verso de uma delas aparecer de cabeça para baixo ao fundo: leia só a folha de cima, a que está na frente.

SE FOR A SOLICITAÇÃO DE ANÁTOMO PATOLÓGICO (D), onde cada coisa está:

- "nGuia": o número depois de "Protocolo:". Ele vem com um hífen antes do último dígito, assim: "123456789-7". Esse último dígito é o verificador e FAZ PARTE do número: devolva tudo junto, só os dígitos, sem o hífen — no exemplo, "1234567897".
- "nCarteira": o número depois de "Código:", na mesma linha do beneficiário. Vem separado por pontos — "0001.0002.000345.00.6" — e são 17 dígitos no total, começando com zeros. Devolva SÓ OS DÍGITOS, sem os pontos e preservando os zeros à esquerda.
  NÃO use o "Código Requisitante:", que é o registro do médico e tem bem menos dígitos.
- "paciente": o nome depois de "Beneficiário(a):".
- "cirurgiao": o nome do CARIMBO no pé da folha — carimbo ou assinatura com o nome do médico, o CRM e a especialidade embaixo. Devolva só o nome, SEM o "DR"/"DRA" da frente e sem o CRM nem a especialidade.
  NÃO use "Requisitante:", a linha do alto: nesta folha quem faz o procedimento é quem carimbou no pé, e não quem a solicitou.
- "convenio": devolva "UNIMED". A folha é da Unimed, e é ela que está no alto.
- "procedimentos": uma entrada para cada linha da tabela "Cód. Proced." / "Descrição", juntando o código com a descrição no formato "CÓDIGO - DESCRIÇÃO". Exemplo: "40202666 - COLONOSCOPIA COM BIOPSIA E/OU CITOLOGIA". A linha da anestesia para endoscopia diagnóstica NÃO entra — vale aqui a mesma regra das linhas ignoradas, acima.
  As colunas "Qtd Autoriz." e "Via de acesso", à direita, NÃO entram.
- "atendimento": a folha não traz. Deixe vazio.
- Data de nascimento, sexo, CID, a observação com o CID por extenso e o "ANS Nº" NÃO são usados: não devolva nenhum deles em campo nenhum.

Regras gerais:
- NENHUMA DATA é lida, de documento nenhum. A data do lançamento é a do dia em que a foto está sendo tirada, e quem a informa é o aplicativo. Não devolva data em campo nenhum, nem acrescente uma chave de data ao JSON — nem a do atendimento, nem a da solicitação, nem a de nascimento.
- Campo que não estiver visível ou legível fica como string vazia "" (ou lista vazia, em "procedimentos").
- Não invente e não complete dados que não estejam escritos na guia.
- Transcreva exatamente o que está escrito, inclusive em campos preenchidos à mão.
- Não corrija o número da guia nem o da carteira: devolva os dígitos como estão na imagem.`;

/**
 * O convênio como a equipe o chama: sem o código na frente e pelo nome curto.
 *
 * As duas regras moram em `lib/convenios.js`, porque não valem só para a foto:
 * o mesmo nome curto tem de sair quando alguém digita à mão ou corrige direto
 * na planilha, senão o cadastro junta três grafias do mesmo convênio.
 */
function nomeDoConvenio(valor) {
  return nomeCurtoDoConvenio(semCodigoNaFrente(valor));
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

    // O formulário conta com uma lista aqui. `semOsIgnorados` aceita texto solto
    // (acontece quando a guia tem um único procedimento) e já tira o que não é
    // ato anestésico: internação, visita hospitalar e recém-nascido. A instrução de
    // leitura acima pede a mesma coisa, montada da mesma lista, e esta aqui vale
    // mesmo quando o modelo traz a linha assim mesmo. A lista mora em lib/
    // porque a leitura do mapa cirúrgico usa a mesma.
    const procedimentos = semOsIgnorados(parsed.procedimentos);

    return res.status(200).json({
      atendimento: (parsed.atendimento || "").toString().trim(),
      paciente: parsed.paciente || "",
      convenio: nomeDoConvenio(parsed.convenio),
      nGuia: parsed.nGuia || "",
      nCarteira: parsed.nCarteira || "",
      cirurgiao: semTratamento(parsed.cirurgiao),
      procedimentos,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro desconhecido ao processar imagem" });
  }
}
