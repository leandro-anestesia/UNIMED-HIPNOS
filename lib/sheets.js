import { google } from "googleapis";
import { kv } from "./kv";
import { COLUNAS, valorDaColuna } from "./campos";
import { CORES, tituloDoAno } from "./marca";
import { formatarData, horaDoRegistro } from "./tempo";

const MAP_KEY = "guias:sheets";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const HEADERS = [
  "Data",
  "Hora do lançamento",
  ...COLUNAS.map((c) => c.label),
  "Executado",
  "Procedimento complementar",
  "Observação",
  "ID", // coluna técnica (oculta): casa a linha da planilha com o registro do app
];

const IDX_EXECUTADO = HEADERS.indexOf("Executado");
const IDX_ID = HEADERS.indexOf("ID");

// Letra da coluna "Executado" para a fórmula da formatação condicional (A=0).
const COL_EXECUTADO = String.fromCharCode(65 + IDX_EXECUTADO);
const COL_FINAL = String.fromCharCode(65 + HEADERS.length - 1);

export { tituloDoAno };

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

function toRow(e) {
  return [
    formatarData(e.dataCirurgia),
    horaDoRegistro(e),
    ...COLUNAS.map((c) => valorDaColuna(e, c)),
    e.executado === true ? "Sim" : "Não",
    (e.procedimentoComplementar || []).join(", "),
    e.observacao || "",
    e.id || "",
  ];
}

/**
 * Localiza a planilha do ano dentro da pasta compartilhada do Drive.
 *
 * Contas de serviço não têm cota de armazenamento própria, então não podem
 * criar arquivos: quem cria a planilha de cada ano é o usuário, e o app
 * apenas a encontra pelo nome. A tentativa de criação continua aqui como
 * atalho para quem usa Drive Compartilhado (Workspace), onde a cota é do
 * drive e a criação funciona.
 */
async function getSpreadsheetId(ano, sheets, drive) {
  const mapa = (await kv.get(MAP_KEY)) || {};
  if (mapa[ano]) return mapa[ano];

  const titulo = tituloDoAno(ano);
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
      await kv.set(MAP_KEY, { ...mapa, [ano]: achada.id });
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
    await kv.set(MAP_KEY, { ...mapa, [ano]: created.data.id });
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

const BRANCO = { red: 1, green: 1, blue: 1 };

/**
 * Verde por formatação condicional, e não pintando célula a célula: assim a
 * linha muda de cor na hora em que alguém marca a caixa direto na planilha,
 * sem depender de uma nova sincronização.
 */
function requestsDeCor(sheetId, regrasExistentes, totalLinhas) {
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

  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=$${COL_EXECUTADO}2="Sim"` }],
          },
          format: { backgroundColor: CORES.verdePlanilha },
        },
      },
    },
  });

  // Caixa de seleção na coluna Executado.
  //
  // BOOLEAN com dois valores: marcada grava "Sim", desmarcada grava "Não".
  // Assim a leitura de volta e o verde condicional continuam funcionando, e o
  // visual é todo controlado pela API (a API não expõe o estilo do menu
  // suspenso, então ele não servia para isso).
  //
  // A faixa PRECISA terminar na última linha com dado. Aplicada à coluna
  // inteira, o Sheets materializa "Não" em todas as ~1000 linhas da grade e a
  // planilha passa a parecer cheia de registros vazios.
  if (totalLinhas > 0) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 1 + totalLinhas,
          startColumnIndex: IDX_EXECUTADO,
          endColumnIndex: IDX_EXECUTADO + 1,
        },
        rule: {
          condition: {
            type: "BOOLEAN",
            values: [{ userEnteredValue: "Sim" }, { userEnteredValue: "Não" }],
          },
          strict: true,
        },
      },
    });
  }

  // Tira a validação (e o "Não" que ela gera) de tudo que vem abaixo dos dados.
  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1 + totalLinhas,
        startColumnIndex: IDX_EXECUTADO,
        endColumnIndex: IDX_EXECUTADO + 1,
      },
    },
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

/**
 * Lê de uma aba-modelo as larguras de coluna e o alinhamento, para que todas as
 * outras fiquem idênticas a ela.
 *
 * O modelo é o mês mais antigo do arquivo: ajeite aquele mês uma vez, à mão, e
 * os seguintes nascem iguais.
 */
async function lerReferencia(sheets, spreadsheetId, abasExistentes) {
  const modelo = MESES.find((m) => abasExistentes.includes(m));
  if (!modelo) return null;

  const r = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${modelo}!A1:${COL_FINAL}2`],
    includeGridData: true,
    fields:
      "sheets(data(columnMetadata(pixelSize)," +
      "rowData(values(dataValidation.condition.type,effectiveFormat(horizontalAlignment,verticalAlignment)))))",
  });

  const dados = r.data.sheets?.[0]?.data?.[0];
  if (!dados) return null;

  const larguras = (dados.columnMetadata || []).map((c) => c.pixelSize);
  const linhaDados = dados.rowData?.[1]?.values || [];

  // Alinhamento coluna a coluna: assim, centralizar só a coluna da caixa de
  // seleção no modelo se propaga sem bagunçar o resto.
  const alinhamentos = HEADERS.map((_, i) => {
    const f = linhaDados[i]?.effectiveFormat || {};
    return { horizontal: f.horizontalAlignment || null, vertical: f.verticalAlignment || null };
  });

  return { larguras, alinhamentos };
}

/** Replica larguras e alinhamento da aba-modelo nesta aba. */
function requestsDeLayout(sheetId, referencia) {
  if (!referencia) return [];
  const requests = [];

  referencia.larguras.forEach((pixelSize, i) => {
    if (!pixelSize || i === IDX_ID) return; // coluna de ID fica oculta
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    });
  });

  referencia.alinhamentos.forEach(({ horizontal, vertical }, i) => {
    if (!horizontal && !vertical) return;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: {
          userEnteredFormat: {
            ...(horizontal ? { horizontalAlignment: horizontal } : {}),
            ...(vertical ? { verticalAlignment: vertical } : {}),
          },
        },
        fields: [
          horizontal ? "userEnteredFormat.horizontalAlignment" : null,
          vertical ? "userEnteredFormat.verticalAlignment" : null,
        ]
          .filter(Boolean)
          .join(","),
      },
    });
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

function requestsDeCabecalho(sheetId) {
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
 * Regrava, no Google Sheets, todas as abas mensais do ano informado.
 * Um arquivo por ano; uma aba por mês com lançamento.
 */
export async function syncAno(ano, entries) {
  const { sheets, drive } = getClients();
  const spreadsheetId = await getSpreadsheetId(ano, sheets, drive);

  const doAno = entries.filter((e) => (e.dataCirurgia || "").startsWith(`${ano}-`));

  const porMes = {};
  doAno.forEach((e) => {
    const mes = parseInt((e.dataCirurgia || "").split("-")[1], 10);
    if (!mes) return;
    porMes[mes] = porMes[mes] || [];
    porMes[mes].push(e);
  });

  const mesesComDados = Object.keys(porMes).map(Number).sort((a, b) => a - b);
  const nomesAbas = mesesComDados.length > 0 ? mesesComDados.map((m) => MESES[m - 1]) : ["Janeiro"];

  await ensureTabs(sheets, spreadsheetId, nomesAbas);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,sheetId),conditionalFormats,protectedRanges(protectedRangeId,range))",
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

  const referencia = await lerReferencia(sheets, spreadsheetId, Object.keys(idsPorNome));

  const formatacao = [];

  for (const mes of mesesComDados) {
    const nome = MESES[mes - 1];
    const ordenados = porMes[mes]
      .slice()
      .sort((a, b) => (a.dataCirurgia || "").localeCompare(b.dataCirurgia || ""));
    const linhas = ordenados.map(toRow);

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
        ...requestsDeCor(sheetId, regrasPorNome[nome] || 0, ordenados.length),
        ...requestsDeLayout(sheetId, referencia),
        ...requestsDeCabecalho(sheetId),
        ...requestsDeProtecao(protecaoPorNome[nome])
      );
    }
  }

  if (formatacao.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatacao } });
  }

  return spreadsheetId;
}

/**
 * Lê a coluna "Executado" das planilhas e traz de volta as alterações feitas
 * direto no Google Sheets. Casa as linhas pelo ID da coluna técnica.
 *
 * `ignorarIds` protege os registros que acabaram de ser alterados no app:
 * sem isso, um valor antigo ainda presente na planilha desfaria a alteração.
 *
 * Devolve { entries, mudancas } — `entries` é uma nova lista já com os valores
 * vindos da planilha; `mudancas` descreve o que veio de lá.
 */
export async function pullExecutados(entries, ignorarIds = []) {
  const { sheets, drive } = getClients();
  const ignorar = new Set(ignorarIds.filter(Boolean));
  const porId = new Map(entries.map((e) => [e.id, e]));
  const mudancas = [];

  const anos = [...new Set(entries.map((e) => (e.dataCirurgia || "").split("-")[0]).filter(Boolean))];

  for (const ano of anos) {
    let spreadsheetId;
    try {
      spreadsheetId = await getSpreadsheetId(ano, sheets, drive);
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

    const resposta = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: abas.map((nome) => `${nome}!A2:${COL_FINAL}`),
    });

    (resposta.data.valueRanges || []).forEach((faixa) => {
      (faixa.values || []).forEach((linha) => {
        const id = linha[IDX_ID];
        const valor = (linha[IDX_EXECUTADO] || "").toString().trim().toLowerCase();
        if (!id || ignorar.has(id)) return;

        const entry = porId.get(id);
        if (!entry) return;

        const naPlanilha = valor === "sim" ? true : valor === "não" || valor === "nao" ? false : null;
        if (naPlanilha === null || naPlanilha === (entry.executado === true)) return;

        entry.executado = naPlanilha;
        mudancas.push({ id, paciente: entry.paciente || "", executado: naPlanilha });
      });
    });
  }

  return { entries: [...porId.values()], mudancas };
}

/**
 * Sincroniza todos os anos presentes nos lançamentos.
 * Um ano que falha (planilha ainda não criada, por exemplo) não impede os demais.
 */
export async function syncTudo(entries) {
  const anos = [...new Set(entries.map((e) => (e.dataCirurgia || "").split("-")[0]).filter(Boolean))].sort();
  const sincronizados = {};
  const falhas = {};

  for (const ano of anos) {
    try {
      sincronizados[ano] = await syncAno(ano, entries);
    } catch (err) {
      falhas[ano] = err.message;
    }
  }

  return { sincronizados, falhas };
}
