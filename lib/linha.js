import { randomUUID } from "crypto";
import { COLUNAS, SEPARADOR_PROCEDIMENTOS } from "./campos";
import { normalizarRegistro } from "./registro";
import { normalizarTexto } from "./texto";
import { dataDoTexto, formatarData, horaDoRegistro } from "./tempo";

/**
 * A tradução entre a linha da planilha e o registro do app, nos dois sentidos.
 *
 * Está fora de sheets.js de propósito: aqui não há Google nenhum, só texto
 * virando registro e registro virando texto. É a parte que pode sobrescrever o
 * dado de um paciente, e por isso a que precisa poder ser testada sozinha.
 */

/**
 * As colunas da planilha, na ordem, com o que cada uma guarda e como.
 *
 * Uma lista só para os dois sentidos: é dela que sai a linha escrita e é por
 * ela que a linha é lida de volta. Em duas listas, uma coluna nova entraria na
 * escrita e ficaria faltando na leitura — e a edição feita na planilha se
 * perderia justamente ali.
 */
export const CAMPOS_DA_LINHA = [
  { label: "Data", key: "dataCirurgia", tipo: "data" },
  { label: "Hora do lançamento", key: "horaLancamento", tipo: "hora" },
  ...COLUNAS.map((c) => ({
    label: c.label,
    key: c.key,
    tipo: c.lista ? "lista" : c.booleano ? "booleano" : "texto",
    digitos: c.digitos === true,
  })),
  { label: "Executado", key: "executado", tipo: "booleano" },
  { label: "Procedimento complementar", key: "procedimentoComplementar", tipo: "lista" },
  { label: "Observação", key: "observacao", tipo: "texto" },
  // Coluna técnica (oculta): casa a linha da planilha com o registro do app.
  { label: "ID", key: "id", tipo: "texto" },
];

export const CABECALHOS = CAMPOS_DA_LINHA.map((c) => c.label);

export const INDICE_DO_ID = CAMPOS_DA_LINHA.findIndex((c) => c.key === "id");
export const INDICE_DO_EXECUTADO = CAMPOS_DA_LINHA.findIndex((c) => c.key === "executado");

/** O texto que vai para a célula desta coluna. */
function textoDaCelula(entry, campo) {
  if (campo.tipo === "data") return formatarData(entry.dataCirurgia);
  if (campo.tipo === "hora") return horaDoRegistro(entry);
  if (campo.tipo === "lista") return (entry[campo.key] || []).join(SEPARADOR_PROCEDIMENTOS);
  if (campo.tipo === "booleano") return entry[campo.key] === true ? "Sim" : "Não";
  return entry[campo.key] || "";
}

/** O registro como uma linha da planilha. */
export function linhaDoRegistro(entry) {
  return CAMPOS_DA_LINHA.map((campo) => textoDaCelula(entry, campo));
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
  if (campo.tipo === "hora") return /^\d{1,2}:\d{2}$/.test(limpo) ? limpo : null;
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
export function lerLinha(entry, linha) {
  const registro = { ...entry };
  const esperado = linhaDoRegistro(entry);
  const campos = [];
  const recusadas = [];

  CAMPOS_DA_LINHA.forEach((campo, coluna) => {
    if (campo.key === "id") return;

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
 */
export function registroDaLinha(linha) {
  const bruto = {};
  CAMPOS_DA_LINHA.forEach((campo, coluna) => {
    if (campo.key === "id") return;
    const valor = valorDaCelula(campo, linha[coluna]);
    if (valor !== null) bruto[campo.key] = valor;
  });

  if (!bruto.dataCirurgia || !(bruto.paciente || "").trim()) return null;

  return normalizarRegistro({
    ...bruto,
    id: randomUUID(),
    criadoEm: new Date().toISOString(),
  });
}
