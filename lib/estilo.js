import { CORES } from "./marca";

/**
 * As medidas e os estilos repetidos, num lugar só.
 *
 * O app é estilizado em linha, campo a campo — foi o que permitiu chegar até
 * aqui depressa, e não há por que desfazer. O que não cabia mais era cada
 * campo escolher o próprio tamanho: havia oito corpos de texto em uso (9, 11,
 * 12, 13, 14, 15, 16, 20) e espaçamentos de 2 a 24 em passos arbitrários.
 * Nenhum deles errado sozinho; juntos, nada alinhava.
 *
 * A fonte não está aqui: mora em `styles/globais.css`, declarada uma vez para
 * o documento inteiro. Repeti-la em cada estilo é o que fazia `fontFamily`
 * aparecer quarenta e sete vezes.
 *
 * Isto também é o que deixa a página da secretária nascer falando a mesma
 * língua visual sem copiar nada.
 */

/** A escala de texto. Quatro tamanhos, e os nomes dizem o papel. */
export const TEXTO = {
  /** Etiquetas, contagens, estado vazio. */
  miudo: 11,
  /** Rótulos de campo, metadados do cartão. */
  apoio: 13,
  /** O que se lê: campos, botões, procedimentos. */
  corpo: 15,
  /** Nome do paciente, título de seção. */
  nome: 20,
};

/** A escala de espaço, em múltiplos de 4. */
export const ESPACO = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 };

/**
 * O alvo mínimo do dedo.
 *
 * 44px é o que a Apple e o Google recomendam, e a diferença aparece numa tela
 * usada em pé, de luva, com pressa. Os botões de ícone do cartão tinham 38.
 */
export const ALVO = 44;

export const inputStyle = {
  width: "100%",
  // Sem isto, padding e borda somam à largura e o campo estoura o container.
  boxSizing: "border-box",
  // Item de flex nasce com `min-width: auto` e se recusa a encolher abaixo do
  // conteúdo — é assim que um campo escapa pela lateral do cartão.
  minWidth: 0,
  // Teto absoluto. Os campos de data e hora são desenhados pelo sistema, que
  // os dimensiona pelo próprio conteúdo e nem sempre respeita `width` — o do
  // iPhone é assim. `maxWidth` vale mesmo nesse caso, e é o que garante que
  // nenhum campo passe da borda do cartão.
  maxWidth: "100%",
  // Data e hora nascem `inline-block` no iOS, o que reabre a porta para a
  // largura intrínseca mandar. Em bloco, a largura é a que se pede.
  display: "block",
  padding: "10px 12px",
  border: `1px solid ${CORES.borda}`,
  borderRadius: 4,
  fontSize: TEXTO.corpo,
  // Altura de linha explícita para que todos os campos tenham a mesma altura.
  // Com `normal`, cada tipo escolhe a sua: o campo de texto ficava com 39px, o
  // de data com 41 e o de hora com 43,75 — três alturas na mesma coluna.
  lineHeight: "20px",
  background: "white",
};

export const btnPrimary = {
  flex: 1,
  padding: ESPACO[4],
  borderRadius: 8,
  background: CORES.principal,
  color: CORES.sobrePrincipal,
  border: `1px solid ${CORES.principal}`,
  fontWeight: 600,
  fontSize: TEXTO.corpo,
  cursor: "pointer",
};

export const btnSecondary = {
  ...btnPrimary,
  background: "white",
  color: CORES.tinta,
  border: `1px solid ${CORES.borda}`,
  fontWeight: 500,
};

/**
 * Botão de caminho alternativo: mesma largura do principal, menos peso.
 *
 * A diferença é altura e cor, não tamanho da fonte — o alvo continua grande o
 * bastante para o dedo, que é o que importa numa tela de centro cirúrgico.
 */
export const btnDiscreto = {
  ...btnSecondary,
  padding: `${ESPACO[3]}px ${ESPACO[4]}px`,
  color: CORES.suave,
  fontSize: TEXTO.apoio,
};

export const btnIcone = {
  width: ALVO,
  height: ALVO,
  padding: 0,
  borderRadius: 8,
  background: "white",
  color: CORES.tinta,
  border: `1px solid ${CORES.borda}`,
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
  flexShrink: 0,
};

/** Ícone sem moldura — o ⋯, o ✎, o 🗑 do cartão. */
export const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  width: ALVO,
  height: ALVO,
  padding: 0,
  color: CORES.suave,
  fontSize: 16,
};

/**
 * Chips do seletor de mês: compactos e sem `flex: 1`, para caberem numa
 * fileira que rola na horizontal.
 */
export const chipMes = {
  padding: "7px 12px",
  borderRadius: 16,
  background: "white",
  color: CORES.suave,
  border: `1px solid ${CORES.borda}`,
  fontWeight: 600,
  fontSize: TEXTO.apoio,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const chipMesAtivo = {
  background: CORES.clara,
  color: CORES.escura,
  border: `1px solid ${CORES.principal}`,
};

/** Os botões de um campo de escolha, no cartão e no formulário. */
export const execBtn = {
  padding: "8px 12px",
  borderRadius: 6,
  background: "white",
  color: CORES.suave,
  border: `1px solid ${CORES.borda}`,
  fontWeight: 600,
  fontSize: TEXTO.apoio,
  cursor: "pointer",
};

/** Rótulo pequeno em caixa alta, acima de um campo ou de uma seção. */
export const rotulo = {
  fontSize: TEXTO.apoio,
  color: CORES.suave,
};

/** Texto de apoio: metadados do cartão, contagens, estado vazio. */
export const apoio = {
  fontSize: TEXTO.apoio,
  color: CORES.suave,
};
