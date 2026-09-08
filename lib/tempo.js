/**
 * Data e hora do lançamento.
 *
 * As duas são preenchidas sozinhas e ficam editáveis: a planilha é dividida por
 * mês, e um plantão da noite do dia 31 lançado depois da meia-noite cairia no
 * mês seguinte se o anestesista não pudesse corrigir a data.
 */

const FUSO = "America/Sao_Paulo";

function doisDigitos(n) {
  return String(n).padStart(2, "0");
}

/**
 * Data e hora de agora, pelo relógio de quem está usando o app.
 *
 * De propósito não usa `toISOString()`: ele devolve UTC, e das 21h em diante o
 * Brasil já está no dia seguinte em UTC — o lançamento nasceria com a data
 * errada justamente nos plantões da noite, que são o caso que mais importa.
 */
export function agoraLocal() {
  const d = new Date();
  return {
    data: `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`,
    hora: `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`,
  };
}

/** "2026-08-29" -> "29/08/2026". Devolve a entrada intacta se não reconhecer. */
export function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * "29/08/2026" -> "2026-08-29", o caminho de volta de `formatarData`.
 *
 * Devolve "" quando não reconhece o formato — e quem chama trata isso como
 * "não entendi esta célula", nunca como "a data ficou vazia".
 */
export function dataDoTexto(texto) {
  const m = (texto || "").toString().trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, dia, mes, ano] = m;
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

/** Hora de um instante ISO, no fuso de Brasília. */
export function horaDoInstante(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
}

/**
 * A hora que vale para o registro: a que o anestesista deixou no formulário e,
 * na falta dela (registros antigos), a do instante em que foi criado.
 */
export function horaDoRegistro(entry) {
  return (entry && entry.horaLancamento) || horaDoInstante(entry && entry.criadoEm);
}

/** "29/08/2026 às 19:40", para o "Lançado em" da tela de detalhes. */
export function dataHoraDoInstante(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.toLocaleDateString("pt-BR", { timeZone: FUSO })} às ${horaDoInstante(iso)}`;
}
