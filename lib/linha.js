import { randomUUID } from "crypto";
import { COLUNAS, COLUNAS_PARTICULAR, SEPARADOR_PROCEDIMENTOS, valorDaColuna } from "./campos";
import { normalizarRegistro } from "./registro";
import { normalizarTexto } from "./texto";
import { dataDoTexto, formatarData, horaDoRegistro } from "./tempo";

/**
 * A tradução entre a linha da planilha e o registro do app, nos dois sentidos.
 *
 * Está fora de sheets.js de propósito: aqui não há Google nenhum, só texto
 * virando registro e registro virando texto. É a parte que pode sobrescrever o
 * dado de um paciente, e por isso a que precisa poder ser testada sozinha.
 *
 * Há duas planilhas — a de convênio e a das cirurgias particulares —, com
 * colunas diferentes. Por isso tudo aqui recebe o `modelo`: a mesma tradução,
 * aplicada ao conjunto de colunas de cada uma.
 */

const COLUNAS_DO_MODELO = {
  convenio: COLUNAS,
  particular: COLUNAS_PARTICULAR,
};

function tipoDaColuna(c) {
  if (c.derivada) return "derivada";
  if (c.lista) return "lista";
  if (c.booleano) return "booleano";
  if (c.hora) return "hora";
  return "texto";
}

/**
 * As colunas da planilha deste modelo, na ordem, com o que cada uma guarda e
 * como.
 *
 * Uma lista só para os dois sentidos: é dela que sai a linha escrita e é por
 * ela que a linha é lida de volta. Em duas listas, uma coluna nova entraria na
 * escrita e ficaria faltando na leitura — e a edição feita na planilha se
 * perderia justamente ali.
 */
function montar(modelo) {
  return [
    { label: "Data", key: "dataCirurgia", tipo: "data" },
    { label: "Hora do lançamento", key: "horaLancamento", tipo: "horaLancamento" },
    ...COLUNAS_DO_MODELO[modelo].map((c) => ({
      label: c.label,
      key: c.key,
      tipo: tipoDaColuna(c),
      digitos: c.digitos === true,
      coluna: c,
    })),
    { label: "Executado", key: "executado", tipo: "booleano" },
    { label: "Procedimento complementar", key: "procedimentoComplementar", tipo: "lista" },
    { label: "Observação", key: "observacao", tipo: "texto" },
    // Coluna técnica (oculta): casa a linha da planilha com o registro do app.
    { label: "ID", key: "id", tipo: "texto" },
  ];
}

// Montada uma vez por modelo: `pullDaPlanilha` chama isto uma vez por linha da
// planilha, e remontar a lista a cada linha seria trabalho jogado fora.
const montadas = {};
export function camposDaLinha(modelo = "convenio") {
  if (!montadas[modelo]) montadas[modelo] = montar(modelo);
  return montadas[modelo];
}

export function cabecalhos(modelo) {
  return camposDaLinha(modelo).map((c) => c.label);
}

export function indiceDoId(modelo) {
  return camposDaLinha(modelo).findIndex((c) => c.key === "id");
}

export function indiceDoExecutado(modelo) {
  return camposDaLinha(modelo).findIndex((c) => c.key === "executado");
}

/** O texto que vai para a célula desta coluna. */
function textoDaCelula(entry, campo) {
  if (campo.tipo === "data") return formatarData(entry.dataCirurgia);
  if (campo.tipo === "horaLancamento") return horaDoRegistro(entry);
  if (campo.tipo === "derivada") return valorDaColuna(entry, campo.coluna);
  if (campo.tipo === "lista") return (entry[campo.key] || []).join(SEPARADOR_PROCEDIMENTOS);
  if (campo.tipo === "booleano") return entry[campo.key] === true ? "Sim" : "Não";
  return entry[campo.key] || "";
}

/** O registro como uma linha da planilha deste modelo. */
export function linhaDoRegistro(entry, modelo = "convenio") {
  return camposDaLinha(modelo).map((campo) => textoDaCelula(entry, campo));
}

/**
 * O caminho de volta: o que a célula diz, no formato do registro.
 *
 * Devolve `null` quando a célula não dá para interpretar. Quem chama trata
 * isso como "não entendi", e o valor que está no app fica — o contrário seria
 * apagar dado bom por causa de uma célula digitada torto.
 */
function valorDaCelula(campo, texto) {
  const limpo = (texto || "").toString().trim();

  if (campo.tipo === "data") return dataDoTexto(limpo) || null;
  // A hora do lançamento não pode ser esvaziada: em branco, ela volta a ser
  // derivada do instante de criação, e a planilha discordaria dela para sempre.
  if (campo.tipo === "horaLancamento") return /^\d{1,2}:\d{2}$/.test(limpo) ? limpo : null;
  // Início e término, ao contrário, podem ser apagados: cirurgia sem término
  // anotado é caso normal, enquanto ela não acabou.
  if (campo.tipo === "hora") {
    if (!limpo) return "";
    return /^\d{1,2}:\d{2}$/.test(limpo) ? limpo : null;
  }
  if (campo.tipo === "lista") {
    return limpo ? limpo.split(SEPARADOR_PROCEDIMENTOS).map((t) => t.trim()).filter(Boolean) : [];
  }
  if (campo.tipo === "booleano") {
    const v = normalizarTexto(limpo);
    if (v === "sim") return true;
    if (v === "nao" || v === "") return false;
    return null;
  }
  return limpo;
}

/**
 * A célula parece um número estragado pela planilha?
 *
 * Planilha guarda número como número: uma carteira de 17 dígitos redigitada na
 * mão volta como "2,76147E+16", e um prontuário com zero na frente volta sem
 * ele. Aceitar isso apagaria o número certo que está no app.
 */
function numeroEstragado(campo, texto, valorNoApp) {
  if (!campo.digitos) return false;

  const novo = (texto || "").toString().trim();
  const antigo = (valorNoApp || "").toString().trim();
  if (!novo || !antigo) return false;

  if (/[^0-9]/.test(novo)) return true; // notação científica, ponto, vírgula
  return antigo !== novo && antigo.startsWith("0") && antigo.endsWith(novo);
}

/**
 * Compara a linha da planilha com a linha que o app escreveria para este
 * registro. Célula diferente é edição de gente, e só ela é trazida.
 *
 * Comparar com o que seria escrito, e não com o campo cru, é o que impede
 * confundir formato com alteração: a data sai em dd/mm/aaaa e a hora de um
 * registro antigo é derivada do instante de criação.
 *
 * Devolve { registro, campos, recusadas }: o registro já com as alterações,
 * os rótulos do que mudou e o que não deu para aceitar.
 */
export function lerLinha(entry, linha, modelo = "convenio") {
  const registro = { ...entry };
  const esperado = linhaDoRegistro(entry, modelo);
  const campos = [];
  const recusadas = [];

  camposDaLinha(modelo).forEach((campo, coluna) => {
    // A coluna derivada é conta do app, não dado: escrever nela não vale nada,
    // e comparar cairia em falso positivo toda vez.
    if (campo.key === "id" || campo.tipo === "derivada") return;

    const naPlanilha = (linha[coluna] || "").toString().trim();
    if (naPlanilha === (esperado[coluna] || "").toString().trim()) return;

    if (numeroEstragado(campo, naPlanilha, entry[campo.key])) {
      recusadas.push({
        paciente: entry.paciente || "",
        coluna: campo.label,
        motivo: "a planilha converteu em número e o valor perdeu dígitos",
      });
      return;
    }

    const valor = valorDaCelula(campo, naPlanilha);
    if (valor === null) {
      recusadas.push({
        paciente: entry.paciente || "",
        coluna: campo.label,
        motivo: `não entendi "${naPlanilha}"`,
      });
      return;
    }

    registro[campo.key] = valor;
    campos.push(campo.label);
  });

  return {
    registro: campos.length > 0 ? normalizarRegistro(registro) : entry,
    campos,
    recusadas,
  };
}

/**
 * Uma linha sem ID é lançamento digitado direto na planilha: vira registro.
 *
 * Exige data e paciente. Sem isso não dá para dizer se é lançamento ou
 * rascunho, e uma anotação solta numa célula viraria paciente fantasma.
 *
 * Na planilha particular não existe coluna de convênio — é ela que diz que o
 * registro é particular. Sem preencher aqui, a linha digitada à mão nasceria
 * sem convênio e migraria sozinha para a planilha de convênio na sincronização
 * seguinte.
 */
export function registroDaLinha(linha, modelo = "convenio") {
  const bruto = {};
  camposDaLinha(modelo).forEach((campo, coluna) => {
    if (campo.key === "id" || campo.tipo === "derivada") return;
    const valor = valorDaCelula(campo, linha[coluna]);
    if (valor !== null) bruto[campo.key] = valor;
  });

  if (!bruto.dataCirurgia || !(bruto.paciente || "").trim()) return null;

  return normalizarRegistro({
    ...bruto,
    ...(modelo === "particular" ? { convenio: "PARTICULAR" } : {}),
    id: randomUUID(),
    criadoEm: new Date().toISOString(),
  });
}
