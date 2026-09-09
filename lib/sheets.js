import { google } from "googleapis";
import { kv } from "./kv";
import { ehParticular } from "./campos";
import {
  cabecalhos,
  camposDaLinha,
  indiceDoExecutado,
  indiceDoId,
  lerLinha,
  linhaDoRegistro,
  registroDaLinha,
} from "./linha";
import { CORES, tituloDoAno } from "./marca";

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
  Atendimento: 130,
  Paciente: 355,
  Convênio: 180,
  "Nº da Guia": 115,
  "Nº da Carteira": 170,
  Urgência: 80,
  Procedimentos: 400,
  Cirurgião: 270,
  Anestesista: 365,
  "Anestesista (carimbo)": 280,
  Executado: 95,
  "Procedimento complementar": 615,
  Observação: 260,
};

/**
 * As larguras da planilha particular.
 *
 * Ela é mais estreita: sem guia, carteira, carimbo e convênio, sobra espaço, e
 * as três colunas de tempo são curtas. O que se repete entre as duas é
 * herdado; só o que difere está escrito aqui.
 */
const LARGURAS_PARTICULAR = {
  ...LARGURAS,
  Início: 90,
  Término: 90,
  Horas: 90,
};

/** Coluna nova que ainda não tem medida: melhor larga demais do que cortada. */
const LARGURA_PADRAO = 150;

/**
 * As duas planilhas que o app mantém, e o que separa uma da outra.
 *
 * `filtro` decide de quem é cada registro — e as duas listas são
 * complementares, então nenhum registro fica de fora nem entra nas duas.
 * `chaveDoMapa` é onde mora o id do arquivo de cada ano no Redis: chaves
 * separadas, senão o app acharia a planilha de convênio procurando a
 * particular.
 */
const MODELOS = {
  convenio: {
    chaveDoMapa: "guias:sheets",
    larguras: LARGURAS,
    filtro: (e) => !ehParticular(e),
  },
  particular: {
    chaveDoMapa: "guias:sheets:particular",
    larguras: LARGURAS_PARTICULAR,
    filtro: ehParticular,
  },
};

const NOMES_DOS_MODELOS = Object.keys(MODELOS);

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
  const chave = MODELOS[modelo].chaveDoMapa;
  const mapa = (await kv.get(chave)) || {};
  if (mapa[ano]) return mapa[ano];

  const titulo = tituloDoAno(ano, modelo);
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

const BRANCO = { red: 1, green: 1, blue: 1 };

/**
 * Verde por formatação condicional, e não pintando célula a célula: assim a
 * linha muda de cor na hora em que alguém marca a caixa direto na planilha,
 * sem depender de uma nova sincronização.
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

/** Aplica nesta aba a largura, a altura, o alinhamento e a quebra de texto. */
function requestsDeLayout(sheetId, modelo) {
  const HEADERS = cabecalhos(modelo);
  const IDX_ID = indiceDoId(modelo);
  const larguras = MODELOS[modelo].larguras;
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
 * Regrava, no Google Sheets, todas as abas mensais do ano informado.
 * Um arquivo por ano; uma aba por mês com lançamento.
 */
/**
 * Escreve um ano inteiro numa das duas planilhas.
 *
 * Devolve o id do arquivo, ou null quando não há registro daquele modelo no
 * ano — e aí nem se procura o arquivo. Sem isso, quem nunca fez cirurgia
 * particular veria "planilha não encontrada" em toda sincronização.
 */
async function sincronizarModelo(ano, entries, modelo) {
  const HEADERS = cabecalhos(modelo);

  const doAno = entries
    .filter((e) => (e.dataCirurgia || "").startsWith(`${ano}-`))
    .filter(MODELOS[modelo].filtro);

  const { sheets, drive } = getClients();

  // Ano sem registro deste modelo e sem planilha já localizada: não há o que
  // escrever nem o que limpar, e procurar um arquivo que talvez nem precise
  // existir só faria a sincronização falhar.
  if (doAno.length === 0) {
    const mapa = (await kv.get(MODELOS[modelo].chaveDoMapa)) || {};
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
  // não tem registro nenhum.
  await ensureTabs(sheets, spreadsheetId, nomesAbas.length > 0 ? nomesAbas : ["Janeiro"]);

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

  const formatacao = [];

  for (const mes of mesesComDados) {
    const nome = MESES[mes - 1];
    const ordenados = porMes[mes]
      .slice()
      .sort((a, b) => (a.dataCirurgia || "").localeCompare(b.dataCirurgia || ""));
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

  for (const modelo of NOMES_DOS_MODELOS) {
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
 * Como funciona: cada linha é comparada com a linha que o app escreveria para
 * aquele registro (`toRow`). Célula diferente é edição de gente, e só ela é
 * trazida — assim diferença de formato (a data em dd/mm, a hora derivada da
 * criação) nunca é confundida com alteração.
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

  for (const ano of anos) {
    for (const modelo of NOMES_DOS_MODELOS) {
      // Ano sem registro deste modelo: a planilha pode nem existir, e não há o
      // que ler nela.
      if (!entries.some((e) => (e.dataCirurgia || "").startsWith(`${ano}-`) && MODELOS[modelo].filtro(e))) {
        continue;
      }

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

      const resposta = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: abas.map((nome) => `${nome}!A2:${colunaFinal(modelo)}`),
      });

      (resposta.data.valueRanges || []).forEach((faixa, i) => {
        const aba = abas[i];
        (faixa.values || []).forEach((linha) => {
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
          idsVistos.add(id);

          const entry = porId.get(id);
          if (!entry) return; // apagado no app: a reescrita tira a linha

          const { registro, campos, recusadas: naoAceitas } = lerLinha(entry, linha, modelo);
          recusadas.push(...naoAceitas);

          if (campos.length > 0) {
            porId.set(id, registro);
            mudancas.push({ id, paciente: registro.paciente || "", tipo: "alterado", campos });
          }
        });
      });
    }
  }

  return { entries: [...porId.values(), ...novos], mudancas, recusadas };
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
      // Um objeto por ano: { convenio: id, particular: id } — a planilha
      // particular só aparece nos anos em que houve cirurgia particular.
      const { ids, falhas: doAno } = await syncAno(ano, entries);
      if (Object.keys(ids).length > 0) sincronizados[ano] = ids;

      // A falha diz de qual das duas planilhas ela é: "2026" e
      // "2026 (particular)" pedem providências diferentes.
      Object.entries(doAno).forEach(([modelo, mensagem]) => {
        falhas[modelo === "particular" ? `${ano} (particular)` : ano] = mensagem;
      });
    } catch (err) {
      falhas[ano] = err.message;
    }
  }

  return { sincronizados, falhas };
}
