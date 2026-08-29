/**
 * Identidade visual e textual da equipe.
 *
 * Este é o único arquivo que muda quando o app é adotado por outra equipe: o
 * resto do código lê tudo daqui. Trocar nome, cores e logo é uma edição só.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Nome e cores já são os da equipe. Os ícones em `public/` foram gerados a
 * partir do símbolo do logo da Hipnos; se a versão oficial do arquivo for
 * outra, é só regerá-los.
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
 *
 * O nome da equipe entra no título de propósito. O app da outra equipe procura
 * a planilha dele exatamente do mesmo jeito, e se alguém trocar o
 * GOOGLE_DRIVE_FOLDER_ID por engano, este app acharia a planilha do outro e a
 * reescreveria inteira — `syncAno` limpa as abas antes de gravar. Com o nome
 * distinto, o erro de pasta não vira perda de dados: a busca não acha nada e
 * a sincronização falha avisando.
 */
export function tituloDoAno(ano) {
  return `${TITULO} ${EQUIPE} ${ano}`;
}

/**
 * Paleta. Nomeada por papel, não por matiz, justamente para que a troca de
 * cores não exija renomear nada: `principal` continua sendo a cor de ação
 * mesmo quando deixa de ser verde.
 */
export const CORES = {
  /** Ações, destaques, o "Sim" do executado. O dourado da Hipnos. */
  principal: "#B8963E",
  /**
   * Texto sobre o dourado. Preto, e não branco: branco sobre este dourado dá
   * contraste de 2,2:1, abaixo de qualquer limite legível — o preto dá 7,5:1.
   */
  sobrePrincipal: "#1A1A1A",

  /** Cabeçalho. O preto da Hipnos. */
  escura: "#1A1A1A",
  /** Texto sobre o cabeçalho preto. */
  sobreEscura: "#FFFFFF",
  /** Fundos suaves: abas ativas, faixas de seção. Dourado bem diluído. */
  clara: "#F6EFDF",
  /** Detalhes sobre o cabeçalho escuro: a linha fina e os textos de apoio. */
  acento: "#D9C286",

  /** Texto principal. */
  tinta: "#1A1A1A",
  /** Fundo da página. */
  fundo: "#FAF8F3",
  /** Bordas de campo, cartão e divisórias. */
  borda: "#E3DAC5",
  /** Divisórias internas, mais leves que `borda`. */
  bordaSuave: "#F0E9D8",
  /** Texto secundário: rótulos de campo, metadados. */
  suave: "#6B6355",
  /** Texto terciário: contagens, estados vazios. */
  tenue: "#9C9384",

  /** Urgência, erro, exclusão. */
  alerta: "#B04A3C",
  /** Fundo de urgência e de campo inválido. */
  alertaFundo: "#FCF0EE",
  /** Aviso menos grave (falha de leitura). */
  avisoFundo: "#FCF3E3",
  avisoTinta: "#8A5A1C",

  /**
   * Verde da linha executada na planilha do Google (RGB 0–1). Continua verde
   * de propósito: "feito" se lê como verde em qualquer planilha, e uma linha
   * dourada sobre tema dourado não se distinguiria do resto.
   */
  verdePlanilha: { red: 0.784, green: 0.918, blue: 0.843 },
  /** Cabeçalho da planilha do Google (RGB 0–1) — o mesmo preto de `escura`. */
  cabecalhoPlanilha: { red: 0.102, green: 0.102, blue: 0.102 },
};
