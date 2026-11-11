import { google } from "googleapis";
import { kv } from "./kv";
import { nomeDoLocal } from "./locais";
import { ordenarRegistros } from "./ordem";
import {
  chaveDoMapa,
  conjuntoDeColunas,
  modeloDoRegistro,
  MODELOS,
  rotuloDaFalha,
  tituloDoModelo,
} from "./modelos";
import {
  cabecalhos,
  camposDaLinha,
  indiceDoExecutado,
  indiceDoId,
  lerLinha,
  linhaDoRegistro,
  linhaNaOrdem,
  ordemDoCabecalho,
  registroDaLinha,
} from "./linha";
import { ehDaUnimed } from "./campos";
import { opcoesDe } from "./estados";
import { CORES } from "./marca";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * A largura de cada coluna, em pixels, e quais ficam centralizadas.
 *
 * Isto morava na planilha: o app lia as larguras de uma aba-modelo e copiava
 * nas outras, por posição. Quebrou na primeira coluna nova no meio — todas as
 * larguras andaram uma casa e cada uma foi parar na coluna errada. Aqui a
 * medida anda junto com o nome da coluna, e não com a posição dela.
 *
 * As medidas são as que foram ajustadas à mão na aba de setembro de 2026 e
 * depois lidas de volta. Para mudar uma largura, mude o número; a
 * sincronização seguinte aplica em todos os meses de uma vez.
 */
const LARGURAS = {
  Data: 90,
  "Hora do lançamento": 85,
  Local: 215,
  Atendimento: 130,
  Paciente: 355,
  Convênio: 180,
  "Nº da Guia": 115,
  "Nº da Carteira": 170,
  Procedimentos: 400,
  Cirurgião: 270,
  Anestesiologista: 365,
  "Anestesiologista Unimed": 280,
  Executado: 115,
  "PC Executado": 140,
  "Procedimento complementar": 615,
  Observação: 260,
};

/**
 * As larguras da planilha particular.
 *
 * Ela é mais estreita: sem guia, carteira e complementar, sobra espaço, e as
 * colunas de tempo e dinheiro são curtas. O que se repete entre as três é
 * herdado; só o que difere está escrito aqui.
 */
const LARGURAS_PARTICULAR = {
  ...LARGURAS,
  Início: 90,
  Término: 90,
  Horas: 90,
  Valor: 110,
  Recebido: 100,
  "Quem Recebeu": 200,
};

/** Coluna nova que ainda não tem medida: melhor larga demais do que cortada. */
const LARGURA_PADRAO = 150;

/**
 * A largura das colunas de cada jogo.
 *
 * Quem decide para qual planilha vai cada registro é `lib/modelos.js`; aqui só
 * mora o que é do Google — medida, formato e as chamadas à API.
 */
const LARGURAS_DO_CONJUNTO = {
  unimed: LARGURAS,
  outros: LARGURAS,
  particular: LARGURAS_PARTICULAR,
};



/** Letra da coluna (A=0), para as fórmulas e as faixas em texto. */
function letraDaColuna(indice) {
  return String.fromCharCode(65 + indice);
}

/**
 * Altura de toda linha, em pixels.
 *
 * 35 é a medida de duas linhas de texto: é o que faz um procedimento com
 * descrição longa caber quebrado em duas linhas sem cortar.
 */
const ALTURA_DA_LINHA = 35;

/**
 * Colunas em que o texto quebra dentro da célula.
 *
 * No resto ele vaza para o lado quando a vizinha está vazia — o padrão do
 * Google, e o que deixa a linha com uma altura só.
 */
const QUEBRAM_O_TEXTO = ["Procedimentos"];

/** Letra da última coluna, para a faixa em texto ("Setembro!A2:R"). */
function colunaFinal(modelo) {
  return letraDaColuna(cabecalhos(modelo).length - 1);
}

export function sheetsEnabled() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function getClients() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada");

  const credentials = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: (credentials.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });

  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

const toRow = linhaDoRegistro;

/**
 * Localiza a planilha do ano dentro da pasta compartilhada do Drive.
 *
 * Contas de serviço não têm cota de armazenamento própria, então não podem
 * criar arquivos: quem cria a planilha de cada ano é o usuário, e o app
 * apenas a encontra pelo nome. A tentativa de criação continua aqui como
 * atalho para quem usa Drive Compartilhado (Workspace), onde a cota é do
 * drive e a criação funciona.
 */
async function getSpreadsheetId(ano, sheets, drive, modelo) {
  const chave = chaveDoMapa(modelo);
  const mapa = (await kv.get(chave)) || {};
  if (mapa[ano]) return mapa[ano];

  const titulo = tituloDoModelo(ano, modelo);
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (folderId) {
    const busca = await drive.files.list({
      q:
        `'${folderId}' in parents and trashed = false ` +
        `and mimeType = 'application/vnd.google-apps.spreadsheet' ` +
        `and name = '${titulo.replace(/'/g, "\\'")}'`,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const achada = busca.data.files && busca.data.files[0];
    if (achada) {
      await kv.set(chave, { ...mapa, [ano]: achada.id });
      return achada.id;
    }
  }

  try {
    const created = await drive.files.create({
      requestBody: {
        name: titulo,
        mimeType: "application/vnd.google-apps.spreadsheet",
        ...(folderId ? { parents: [folderId] } : {}),
      },
      fields: "id",
      supportsAllDrives: true,
    });
    await kv.set(chave, { ...mapa, [ano]: created.data.id });
    return created.data.id;
  } catch (err) {
    throw new Error(
      `A planilha "${titulo}" não foi encontrada na pasta do Drive e não pôde ser criada ` +
        `automaticamente (${err.message}). Crie uma planilha Google chamada exatamente ` +
        `"${titulo}" dentro da pasta compartilhada e sincronize novamente.`
    );
  }
}

async function ensureTabs(sheets, spreadsheetId, nomesAbas) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existentes = meta.data.sheets.map((s) => s.properties.title);
  const faltando = nomesAbas.filter((n) => !existentes.includes(n));

  if (faltando.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: faltando.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  // Remove a aba placeholder "Janeiro" se ela não é usada e existem outras.
  const depois = faltando.length > 0 ? [...existentes, ...faltando] : existentes;
  const sobrando = depois.filter((n) => !nomesAbas.includes(n));
  if (sobrando.length > 0 && depois.length > sobrando.length) {
    const atual = await sheets.spreadsheets.get({ spreadsheetId });
    const ids = atual.data.sheets
      .filter((s) => sobrando.includes(s.properties.title))
      .map((s) => s.properties.sheetId);
    if (ids.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: ids.map((sheetId) => ({ deleteSheet: { sheetId } })) },
      });
    }
  }
}

/**
 * A aba de contagem por anestesiologista, só na planilha da Unimed.
 *
 * É lá que a produção de cada credenciado precisa ser vista, e é lá que a
 * coluna "Anestesiologista Unimed" existe.
 */
const ABA_RESUMO = "Resumo";

/**
 * A contagem por credencial é só do Hospital Renascença.
 *
 * É lá que a produção entra pela Unimed sob a credencial do anestesiologista.
 * O que acontece nas clínicas continua nas abas do mês, como sempre esteve —
 * só não entra nesta tabela, que existe para conferir a produção de cada um.
 *
 * O nome passa pela lista fechada de `lib/locais.js` para casar exatamente com
 * o que a coluna Local guarda, acento e caixa inclusive. Se um dia ele mudar
 * lá e não aqui, a tabela zeraria em silêncio — daí o aviso no log.
 */
const LOCAL_DO_RESUMO = nomeDoLocal("HOSPITAL RENASCENÇA") || "HOSPITAL RENASCENÇA";
if (!nomeDoLocal(LOCAL_DO_RESUMO)) {
  console.error(
    `Resumo: "${LOCAL_DO_RESUMO}" não está na lista de locais — a contagem por credencial vai zerar.`
  );
}

/**
 * O separador de argumentos das fórmulas, que depende do idioma da planilha.
 *
 * O Google interpreta o que o app escreve como se tivesse sido digitado por uma
 * pessoa, e numa planilha em português `=SOMA(A1;B1)` usa ponto e vírgula,
 * enquanto em inglês usa vírgula. Escrever o separador errado não dá erro de
 * API: a célula fica com a fórmula quebrada, e só se descobre olhando.
 *
 * A regra de verdade é a do separador decimal — onde o decimal é vírgula, o
 * argumento é ponto e vírgula. Em vez de manter uma lista de idiomas, pergunta-se
 * ao próprio Intl como aquele idioma escreve "1,1".
 */
function separadorDeArgumentos(locale) {
  try {
    const decimal = new Intl.NumberFormat((locale || "pt_BR").replace("_", "-")).format(1.1).charAt(1);
    return decimal === "," ? ";" : ",";
  } catch {
    return ";";
  }
}

/**
 * Os anestesiologistas credenciados que estão no cadastro.
 *
 * Sai do cadastro, e não da lista de primeiros nomes em `lib/campos.js`: é o
 * nome completo que aparece na coluna da planilha, e é por ele que a contagem
 * casa. A lista de `campos.js` é só o filtro de quem é credenciado.
 */
async function credenciadosDaUnimed() {
  try {
    const cadastros = (await kv.get("guias:cadastros")) || {};
    return (cadastros.anestesistas || []).filter(ehDaUnimed);
  } catch (err) {
    console.error("Não consegui ler o cadastro de anestesiologistas:", err.message);
    return [];
  }
}

/**
 * Escreve a aba Resumo: um anestesiologista por linha, um mês por coluna.
 *
 * As células são fórmulas, não números calculados aqui. Número escrito pelo app
 * só mudaria na sincronização seguinte; fórmula recalcula no instante em que
 * alguém mexe numa linha, inclusive quando quem mexeu foi outra pessoa — que é
 * o que significa "em tempo real".
 *
 * Só os meses que têm aba entram: `COUNTIF` sobre uma aba que não existe devolve
 * #REF! e estraga a linha inteira.
 */
async function escreverResumo(sheets, spreadsheetId, modelo, abasExistentes, locale) {
  const campos = camposDaLinha(modelo);
  const col = (key) => letraDaColuna(campos.findIndex((c) => c.key === key));
  const COL_CREDENCIADO = col("anestesistaCarimbo");
  const COL_PACIENTE = col("paciente");
  const COL_LOCAL = col("local");
  const COL_EXECUTADO = letraDaColuna(indiceDoExecutado(modelo));
  const SIM = opcoesDe("executado").find((o) => o.valor === "sim").rotulo;

  const sep = separadorDeArgumentos(locale);
  const mesesComAba = MESES.filter((mes) => abasExistentes.includes(mes));

  // O critério do local, que acompanha todas as contagens desta aba.
  const noLocal = (mes) =>
    `${sep}'${mes}'!$${COL_LOCAL}:$${COL_LOCAL}${sep}"${LOCAL_DO_RESUMO}"`;

  // A contagem de um mês, para um critério de nome já escrito em A.
  const porMes = (mes, linha) =>
    `=COUNTIFS('${mes}'!$${COL_CREDENCIADO}:$${COL_CREDENCIADO}${sep}$A${linha}` +
    `${noLocal(mes)})`;
  const porMesExecutado = (mes, linha) =>
    `=COUNTIFS('${mes}'!$${COL_CREDENCIADO}:$${COL_CREDENCIADO}${sep}$A${linha}` +
    `${noLocal(mes)}` +
    `${sep}'${mes}'!$${COL_EXECUTADO}:$${COL_EXECUTADO}${sep}"${SIM}")`;

  const nomes = await credenciadosDaUnimed();
  const primeira = 2;

  const linhas = nomes.map((nome, i) => {
    const l = primeira + i;
    const mensais = MESES.map((mes) => (mesesComAba.includes(mes) ? porMes(mes, l) : ""));
    const executados = mesesComAba
      .map((mes) => porMesExecutado(mes, l).slice(1))
      .join(" + ");
    return [
      nome,
      ...mensais,
      `=SUM(B${l}:M${l})`,
      executados ? `=${executados}` : "",
    ];
  });

  // A linha que mais interessa à conferência: cirurgia lançada sem dizer sob
  // qual credencial vai. Conta linha com paciente e sem credenciado — contar
  // célula vazia na coluna inteira pegaria as ~1000 linhas vazias da grade.
  const lSem = primeira + linhas.length;
  const semCredenciado = [
    "(sem anestesiologista Unimed)",
    ...MESES.map((mes) =>
      mesesComAba.includes(mes)
        ? `=COUNTIFS('${mes}'!$${COL_PACIENTE}:$${COL_PACIENTE}${sep}"<>"` +
          `${sep}'${mes}'!$${COL_CREDENCIADO}:$${COL_CREDENCIADO}${sep}""` +
          `${noLocal(mes)})`
        : ""
    ),
    `=SUM(B${lSem}:M${lSem})`,
    "",
  ];

  const valores = [
    [`Anestesiologista Unimed · ${LOCAL_DO_RESUMO}`, ...MESES, "Total", "Executados"],
    ...linhas,
    semCredenciado,
  ];

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${ABA_RESUMO}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ABA_RESUMO}!A1`,
    // USER_ENTERED, e não RAW: é o que faz a fórmula virar fórmula. As abas de
    // mês continuam em RAW, que é o que impede o Google de reinterpretar número
    // de carteira e de guia.
    valueInputOption: "USER_ENTERED",
    requestBody: { values: valores },
  });

  return valores.length;
}

/** Cabeçalho em negrito, primeira coluna larga e linha de título congelada. */
function requestsDoResumo(sheetId) {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: CORES.cabecalhoPlanilha,
            textFormat: { bold: true, foregroundColor: BRANCO },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 280 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 15 },
        properties: { pixelSize: 90 },
        fields: "pixelSize",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
        fields: "gridProperties(frozenRowCount,frozenColumnCount)",
      },
    },
  ];
}

const BRANCO = { red: 1, green: 1, blue: 1 };

/**
 * A cor da linha, o que se pode escolher na coluna Executado e a coluna oculta
 * de ID.
 */
function requestsDeCor(sheetId, regrasExistentes, totalLinhas, modelo) {
  const HEADERS = cabecalhos(modelo);
  const IDX_EXECUTADO = indiceDoExecutado(modelo);
  const IDX_ID = indiceDoId(modelo);
  // Letra da coluna "Executado" para a fórmula da formatação condicional.
  const COL_EXECUTADO = letraDaColuna(IDX_EXECUTADO);
  const requests = [
    // Limpa cor fixa deixada por versões anteriores, senão ela briga com a regra.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: BRANCO } },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
  ];

  // Remove regras antigas (de trás para frente, os índices deslocam).
  for (let i = regrasExistentes - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  // A linha inteira ganha a cor do Executado — e só dele.
  //
  // Por formatação condicional, e não pintando célula a célula: assim a linha
  // muda de cor na hora em que alguém escolhe outro estado direto na planilha,
  // sem depender de uma nova sincronização.
  //
  // Nenhuma outra coluna de escolha pinta a linha. Duas regras sobre a mesma
  // faixa brigariam, e a segunda venceria sem critério nenhum: uma cirurgia
  // executada com o complementar pendente ficaria amarela ou verde conforme a
  // ordem em que as regras foram criadas.
  opcoesDe("executado").forEach((estado, i) => {
    if (!estado.cor) return;
    requests.push({
      addConditionalFormatRule: {
        index: i,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length }],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: `=$${COL_EXECUTADO}2="${estado.rotulo}"` }],
            },
            format: { backgroundColor: estado.cor },
          },
        },
      },
    });
  });

  // Menu suspenso em toda coluna de escolha — Executado, PC Executado,
  // Recebido —, com as opções daquele campo.
  //
  // A faixa PRECISA terminar na última linha com dado. Aplicada à coluna
  // inteira, o Sheets materializa o valor em todas as ~1000 linhas da grade e a
  // planilha passa a parecer cheia de registros vazios. Por isso a validação é
  // posta na faixa com dados e tirada de tudo que vem abaixo.
  camposDaLinha(modelo).forEach((campo, i) => {
    if (campo.tipo !== "escolha") return;

    if (totalLinhas > 0) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + totalLinhas,
            startColumnIndex: i,
            endColumnIndex: i + 1,
          },
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: opcoesDe(campo.escolha).map((e) => ({ userEnteredValue: e.rotulo })),
            },
            showCustomUi: true,
            strict: true,
          },
        },
      });
    }

    requests.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: 1 + totalLinhas, startColumnIndex: i, endColumnIndex: i + 1 },
      },
    });
  });

  // Reexibe tudo antes de ocultar: se o número de colunas mudar, a coluna
  // escondida numa versão anterior não pode continuar escondida no lugar errado.
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length },
      properties: { hiddenByUser: false },
      fields: "hiddenByUser",
    },
  });

  // Esconde a coluna técnica de ID.
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: IDX_ID, endIndex: IDX_ID + 1 },
      properties: { hiddenByUser: true },
      fields: "hiddenByUser",
    },
  });

  return requests;
}

/** Aplica nesta aba a largura, a altura, o alinhamento e a quebra de texto. */
function requestsDeLayout(sheetId, modelo) {
  const HEADERS = cabecalhos(modelo);
  const IDX_ID = indiceDoId(modelo);
  const larguras = LARGURAS_DO_CONJUNTO[conjuntoDeColunas(modelo)];
  const requests = [];

  camposDaLinha(modelo).forEach((campo, i) => {
    const label = campo.label;

    // A coluna técnica de ID fica oculta: largura nela não muda nada.
    if (i !== IDX_ID) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: larguras[label] || LARGURA_PADRAO },
          fields: "pixelSize",
        },
      });
    }

    requests.push({
      repeatCell: {
        range: { sheetId, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: {
          userEnteredFormat: {
            // "OVERFLOW_CELL" é o nome do padrão do Google (texto vaza para a
            // célula vizinha vazia). "OVERFLOW", que parece o óbvio, não existe
            // na API: o lote inteiro é recusado, e nenhuma formatação entra.
            wrapStrategy: QUEBRAM_O_TEXTO.includes(label) ? "WRAP" : "OVERFLOW_CELL",
          },
        },
        fields: "userEnteredFormat.wrapStrategy",
      },
    });

    // A coluna de horas é duração, não hora do dia: com "[h]:mm" a soma do mês
    // passa de 24h em vez de dar a volta no relógio.
    if (campo.key === "duracao") {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "[h]:mm" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }

    // Dinheiro: a célula guarda o número cru e o formato põe o "R$" e a
    // vírgula. É o que deixa a coluna ser somada — com o símbolo dentro do
    // valor, o Google a trataria como texto e a soma daria zero.
    if (campo.tipo === "moeda") {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: "CURRENCY", pattern: 'R$ #,##0.00' },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }
  });

  // Sem endIndex, vale para a aba inteira — inclusive as linhas ainda vazias,
  // para a próxima gravação não nascer com altura diferente.
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0 },
      properties: { pixelSize: ALTURA_DA_LINHA },
      fields: "pixelSize",
    },
  });

  // Tudo centralizado, na horizontal e na vertical, cabeçalho incluído.
  requests.push({
    repeatCell: {
      range: { sheetId, startColumnIndex: 0, endColumnIndex: HEADERS.length },
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
      fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
    },
  });

  return requests;
}

/**
 * A planilha fica livre para edição: remove qualquer proteção de aba que
 * tenha sido criada antes. Lembrando que o app é o dono dos dados e
 * sobrescreve, na próxima sincronização, o que for alterado fora da
 * coluna "Executado".
 */
function requestsDeProtecao(protecaoExistente) {
  return protecaoExistente ? [{ deleteProtectedRange: { protectedRangeId: protecaoExistente } }] : [];
}

function requestsDeCabecalho(sheetId, modelo) {
  const HEADERS = cabecalhos(modelo);
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: {
          userEnteredFormat: {
            backgroundColor: CORES.cabecalhoPlanilha,
            textFormat: { bold: true, foregroundColor: BRANCO },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
  ];
}

/**
 * Escreve um ano inteiro numa das três planilhas.
 *
 * Devolve o id do arquivo, ou null quando não há registro daquele modelo no
 * ano — e aí nem se procura o arquivo. Sem isso, quem nunca fez cirurgia
 * particular veria "planilha não encontrada" em toda sincronização.
 */
async function sincronizarModelo(ano, entries, modelo) {
  const HEADERS = cabecalhos(modelo);

  const doAno = entries
    .filter((e) => (e.dataCirurgia || "").startsWith(`${ano}-`))
    .filter((e) => modeloDoRegistro(e) === modelo);

  const { sheets, drive } = getClients();

  // Ano sem registro deste modelo e sem planilha já localizada: não há o que
  // escrever nem o que limpar, e procurar um arquivo que talvez nem precise
  // existir só faria a sincronização falhar.
  if (doAno.length === 0) {
    const mapa = (await kv.get(chaveDoMapa(modelo))) || {};
    if (!mapa[ano]) return null;
  }

  const spreadsheetId = await getSpreadsheetId(ano, sheets, drive, modelo);

  const porMes = {};
  doAno.forEach((e) => {
    const mes = parseInt((e.dataCirurgia || "").split("-")[1], 10);
    if (!mes) return;
    porMes[mes] = porMes[mes] || [];
    porMes[mes].push(e);
  });

  const mesesComDados = Object.keys(porMes).map(Number).sort((a, b) => a - b);
  const nomesAbas = mesesComDados.map((m) => MESES[m - 1]);

  // Planilha do ano precisa de pelo menos uma aba, mesmo quando o ano ainda
  // não tem registro nenhum. A aba Resumo entra na lista porque `ensureTabs`
  // apaga o que não estiver nela.
  const abasDoArquivo = [
    ...(nomesAbas.length > 0 ? nomesAbas : ["Janeiro"]),
    ...(modelo === "convenio" ? [ABA_RESUMO] : []),
  ];
  await ensureTabs(sheets, spreadsheetId, abasDoArquivo);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.locale,sheets(properties(title,sheetId),conditionalFormats,protectedRanges(protectedRangeId,range))",
  });
  const idsPorNome = {};
  const regrasPorNome = {};
  const protecaoPorNome = {};
  meta.data.sheets.forEach((s) => {
    const titulo = s.properties.title;
    idsPorNome[titulo] = s.properties.sheetId;
    regrasPorNome[titulo] = (s.conditionalFormats || []).length;
    // Interessa a proteção de aba inteira (range sem limites de linha/coluna).
    const daAba = (s.protectedRanges || []).find(
      (p) => p.range && p.range.startRowIndex === undefined && p.range.startColumnIndex === undefined
    );
    protecaoPorNome[titulo] = daAba ? daAba.protectedRangeId : null;
  });

  const formatacao = [];

  for (const mes of mesesComDados) {
    const nome = MESES[mes - 1];
    const ordenados = porMes[mes]
      .slice()
      .sort(ordenarRegistros);
    const linhas = ordenados.map((e) => toRow(e, modelo));

    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${nome}!A:Z` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${nome}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS, ...linhas] },
    });

    const sheetId = idsPorNome[nome];
    if (sheetId !== undefined) {
      // Ordem importa: o reset de cor limpa as linhas, então vem antes do cabeçalho.
      formatacao.push(
        ...requestsDeCor(sheetId, regrasPorNome[nome] || 0, ordenados.length, modelo),
        ...requestsDeLayout(sheetId, modelo),
        ...requestsDeCabecalho(sheetId, modelo),
        ...requestsDeProtecao(protecaoPorNome[nome])
      );
    }
  }

  // Mês que ficou sem registro precisa ser esvaziado à mão: a reescrita acima
  // só passa pelos meses que têm dado, então a linha do último paciente
  // apagado — ou do que trocou de convênio e mudou de planilha — ficaria ali
  // para sempre.
  const abasEsvaziadas = Object.keys(idsPorNome).filter(
    (nome) => MESES.includes(nome) && !nomesAbas.includes(nome)
  );

  for (const nome of abasEsvaziadas) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${nome}!A:Z` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${nome}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });

    const sheetId = idsPorNome[nome];
    if (sheetId !== undefined) {
      formatacao.push(
        ...requestsDeCor(sheetId, regrasPorNome[nome] || 0, 0, modelo),
        ...requestsDeLayout(sheetId, modelo),
        ...requestsDeCabecalho(sheetId, modelo),
        ...requestsDeProtecao(protecaoPorNome[nome])
      );
    }
  }

  // A contagem por anestesiologista, depois das abas de mês: as fórmulas
  // apontam para elas, e uma aba criada agora precisa existir antes.
  if (modelo === "convenio" && idsPorNome[ABA_RESUMO] !== undefined) {
    try {
      await escreverResumo(sheets, spreadsheetId, modelo, nomesAbas, meta.data.properties.locale);
      formatacao.push(...requestsDoResumo(idsPorNome[ABA_RESUMO]));
    } catch (err) {
      // Resumo é leitura, não dado: se ele falhar, o mês não pode deixar de ser
      // gravado por causa disso.
      console.error("Falha ao escrever a aba Resumo:", err.message);
    }
  }

  if (formatacao.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatacao } });
  }

  return spreadsheetId;
}

/**
 * Sincroniza o ano nas duas planilhas: a de convênio e a das particulares.
 *
 * Falha de uma não impede a outra — a planilha particular pode nem ter sido
 * criada ainda, e isso não pode travar o controle dos convênios. A chave da
 * falha diz qual das duas foi.
 */
export async function syncAno(ano, entries) {
  const ids = {};
  const falhas = {};

  for (const modelo of MODELOS) {
    try {
      const id = await sincronizarModelo(ano, entries, modelo);
      if (id) ids[modelo] = id;
    } catch (err) {
      // Não relança: a planilha particular pode nem ter sido criada ainda, e
      // isso não pode impedir o controle dos convênios de ser gravado.
      falhas[modelo] = err.message;
    }
  }

  return { ids, falhas };
}

/**
 * Traz de volta o que foi editado direto no Google Sheets.
 *
 * A planilha é um segundo lugar de edição, e não só um espelho: como `syncAno`
 * limpa o mês e reescreve, o que fosse alterado lá seria desfeito na
 * sincronização seguinte se não passasse por aqui antes.
 *
 * Como funciona: cada coluna é achada pelo nome no cabeçalho da aba, e a linha
 * é comparada com a linha que o app escreveria para aquele registro (`toRow`).
 * Célula diferente é edição de gente, e só ela é trazida — assim diferença de
 * formato (a data em dd/mm, a hora derivada da criação) nunca é confundida com
 * alteração.
 *
 * Achar a coluna pelo nome é o que deixa a ordem das colunas mudar sem risco: a
 * planilha que está no Drive ainda tem a ordem da versão anterior do app até a
 * próxima reescrita, e por posição ela seria lida fora do lugar.
 *
 * Linha sem ID é lançamento digitado à mão: vira registro novo, desde que
 * tenha ao menos data e paciente. Linha apagada da planilha NÃO apaga o
 * registro: some da planilha e volta na reescrita, porque apagar paciente é
 * decisão que só se toma no app, onde há confirmação.
 *
 * `ignorarIds` protege os registros que acabaram de ser alterados no app: sem
 * isso, o valor antigo ainda presente na planilha desfaria a alteração.
 *
 * Devolve { entries, mudancas, recusadas } — `entries` já com o que veio da
 * planilha, `mudancas` descrevendo o que mudou e `recusadas` as células que
 * não deu para aceitar.
 */
export async function pullDaPlanilha(entries, ignorarIds = []) {
  const { sheets, drive } = getClients();
  const ignorar = new Set(ignorarIds.filter(Boolean));
  const porId = new Map(entries.map((e) => [e.id, e]));
  const idsVistos = new Set();
  const novos = [];
  const mudancas = [];
  const recusadas = [];

  const anos = [...new Set(entries.map((e) => (e.dataCirurgia || "").split("-")[0]).filter(Boolean))];
  const modelos = MODELOS;

  for (const ano of anos) {
    for (const modelo of modelos) {
      // Ano sem registro deste modelo: a planilha pode nem existir, e não há o
      // que ler nela.
      const temNoAno = entries.some(
        (e) => (e.dataCirurgia || "").startsWith(`${ano}-`) && modeloDoRegistro(e) === modelo
      );
      if (!temNoAno) continue;

      const IDX_ID = indiceDoId(modelo);

      let spreadsheetId;
      try {
        spreadsheetId = await getSpreadsheetId(ano, sheets, drive, modelo);
      } catch {
        continue; // planilha do ano ainda não existe: nada a ler
      }

      let meta;
      try {
        meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
      } catch {
        continue;
      }

      const abas = meta.data.sheets.map((s) => s.properties.title).filter((t) => MESES.includes(t));
      if (abas.length === 0) continue;

      // A partir de A1, e não de A2: a primeira linha é o cabeçalho, e é por
      // ele que cada coluna é achada. A planilha que está no Drive pode estar
      // com a ordem de uma versão anterior do app, e ler por posição a leria
      // uma casa fora.
      const resposta = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: abas.map((nome) => `${nome}!A1:${colunaFinal(modelo)}`),
      });

      (resposta.data.valueRanges || []).forEach((faixa, i) => {
        const aba = abas[i];
        const [cabecalho, ...linhas] = faixa.values || [];

        const ordem = ordemDoCabecalho(cabecalho, modelo);
        if (!ordem) {
          // Só avisa se havia o que ler: aba recém-criada, ainda sem cabeçalho,
          // não é problema nenhum.
          if (linhas.length > 0) {
            recusadas.push({
              paciente: `Aba ${aba}`,
              coluna: "cabeçalho",
              motivo: "não reconheci as colunas, então não li as edições desta aba",
            });
          }
          return;
        }

        let emBranco = 0;

        linhas.forEach((bruta) => {
          const linha = linhaNaOrdem(bruta, ordem);
          const id = (linha[IDX_ID] || "").toString().trim();

          if (!id) {
            const novo = registroDaLinha(linha, modelo);
            if (novo) {
              novos.push(novo);
              mudancas.push({ id: novo.id, paciente: novo.paciente, tipo: "novo", aba });
            }
            return;
          }

          if (ignorar.has(id) || idsVistos.has(id)) return;

          const entry = porId.get(id);
          if (!entry) return; // apagado no app: a reescrita tira a linha

          // Linha que sobrou de outra planilha. O registro mudou de arquivo — o
          // convênio deixou de ser Unimed, por exemplo, ou o arquivo nasceu de
          // uma cópia de outro — e esta linha é o retrato de antes. A reescrita
          // tira; ler dela seria trazer de volta o dado velho.
          if (modeloDoRegistro(entry) !== modelo) return;

          idsVistos.add(id);

          const { registro, campos, recusadas: naoAceitas, emBranco: vazia } = lerLinha(
            entry,
            linha,
            modelo
          );
          recusadas.push(...naoAceitas);
          if (vazia) emBranco += 1;

          if (campos.length > 0) {
            porId.set(id, registro);
            mudancas.push({ id, paciente: registro.paciente || "", tipo: "alterado", campos });
          }
        });

        // Um aviso por aba, e não um por linha: quando isto acontece, acontece
        // em dezenas de linhas de uma vez.
        if (emBranco > 0) {
          recusadas.push({
            paciente: `Aba ${aba}`,
            coluna: `${emBranco} ${emBranco === 1 ? "linha vazia" : "linhas vazias"}`,
            motivo: "não apaguei os registros; para apagar de vez, use o app",
          });
        }
      });
    }
  }

  return { entries: [...porId.values(), ...novos], mudancas, recusadas };
}

/**
 * Quais anos a sincronização precisa visitar.
 *
 * Os dos lançamentos, mais os que já têm planilha localizada. Os segundos são
 * o que permite **esvaziar**: um ano que perdeu o último registro some da
 * primeira lista, ninguém mais passaria por ele, e as linhas ficariam na
 * planilha para sempre. Foi exatamente o que aconteceria ao começar do zero —
 * sem registro nenhum, a sincronização não visitaria ano algum e as linhas de
 * teste continuariam lá.
 */
async function anosASincronizar(entries) {
  const anos = new Set(entries.map((e) => (e.dataCirurgia || "").split("-")[0]).filter(Boolean));

  for (const modelo of MODELOS) {
    try {
      const mapa = (await kv.get(chaveDoMapa(modelo))) || {};
      Object.keys(mapa).forEach((ano) => anos.add(ano));
    } catch (err) {
      console.error(`Não consegui ler a planilha de ${modelo}:`, err.message);
    }
  }

  return [...anos].sort();
}

/**
 * Sincroniza todos os anos presentes nos lançamentos.
 * Um ano que falha (planilha ainda não criada, por exemplo) não impede os demais.
 */
export async function syncTudo(entries) {
  const anos = await anosASincronizar(entries);
  const sincronizados = {};
  const falhas = {};

  for (const ano of anos) {
    try {
      // Um objeto por ano: { convenio: id, particular: id } — a planilha
      // particular só aparece nos anos em que houve cirurgia particular.
      const { ids, falhas: doAno } = await syncAno(ano, entries);
      if (Object.keys(ids).length > 0) sincronizados[ano] = ids;

      // A falha diz de qual das duas planilhas ela é: "2026" e
      // "2026 (particular)" pedem providências diferentes.
      Object.entries(doAno).forEach(([modelo, mensagem]) => {
        falhas[rotuloDaFalha(ano, modelo)] = mensagem;
      });
    } catch (err) {
      falhas[ano] = err.message;
    }
  }

  return { sincronizados, falhas };
}
