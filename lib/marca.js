/**
 * Identidade visual e textual da equipe.
 *
 * Este é o único arquivo que muda quando o app é adotado por outra equipe: o
 * resto do código lê tudo daqui. Trocar nome, cores e logo é uma edição só.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AINDA PROVISÓRIOS: as CORES abaixo e os ícones em `public/`. Trocar por:
 *   · CORES — as cores da equipe
 *   · public/logo-mark.png e os ícones — o logo de verdade
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Linha pequena acima do título, no cabeçalho, e no <title> da aba. */
export const EQUIPE = "UNIMED HIPNOS";

/** Título grande do cabeçalho, e nome do app. */
export const TITULO = "Controle de Cirurgias";

/** Nome curto: ícone na tela do celular, onde só cabem ~12 caracteres. */
export const TITULO_CURTO = "Cirurgias";

/** Prefixo dos arquivos .xlsx baixados: `controle-cirurgias-2026.xlsx`. */
export const PREFIXO_ARQUIVO = "controle-cirurgias";

/**
 * Nome EXATO da planilha de cada ano dentro da pasta compartilhada do Drive.
 *
 * A conta de serviço do Google não tem cota de armazenamento e não consegue
 * criar arquivos, então quem cria a planilha é uma pessoa, à mão — e o app só
 * a encontra pelo nome. Mudar esta função depois de a planilha existir faz o
 * app deixar de achá-la.
 */
export function tituloDoAno(ano) {
  return `${TITULO} ${ano}`;
}

/**
 * Paleta. Nomeada por papel, não por matiz, justamente para que a troca de
 * cores não exija renomear nada: `principal` continua sendo a cor de ação
 * mesmo quando deixa de ser verde.
 */
export const CORES = {
  /** Ações, destaques, o "Sim" do executado. */
  principal: "#1F6F5C",
  /** Cabeçalho e textos sobre fundo claro que precisam de peso. */
  escura: "#17564A",
  /** Fundos suaves: abas ativas, faixas de seção. */
  clara: "#E6F1EE",
  /** Texto e detalhes sobre o cabeçalho escuro. */
  acento: "#A9D6C9",

  /** Texto principal. */
  tinta: "#1A1A1A",
  /** Fundo da página. */
  fundo: "#F4F8F7",
  /** Bordas de campo, cartão e divisórias. */
  borda: "#D3E2DD",
  /** Divisórias internas, mais leves que `borda`. */
  bordaSuave: "#EAF1EF",
  /** Texto secundário: rótulos de campo, metadados. */
  suave: "#5B6B64",
  /** Texto terciário: contagens, estados vazios. */
  tenue: "#8FA79C",

  /** Urgência, erro, exclusão. */
  alerta: "#B04A3C",
  /** Fundo de urgência e de campo inválido. */
  alertaFundo: "#FCF0EE",
  /** Aviso menos grave (falha de extração). */
  avisoFundo: "#FCF3E3",
  avisoTinta: "#8A5A1C",

  /** Verde da linha executada na planilha do Google (RGB 0–1). */
  verdePlanilha: { red: 0.784, green: 0.918, blue: 0.843 },
  /** Cabeçalho da planilha do Google (RGB 0–1) — combine com `escura`. */
  cabecalhoPlanilha: { red: 0.09, green: 0.337, blue: 0.29 },
};
