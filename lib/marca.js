import { normalizarTexto } from "./texto";

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
export const EQUIPE = "HIPNOS ANESTESIOLOGIA";

/**
 * Como a planilha do hospital se identifica no Drive — e por que não é o nome
 * da equipe acima.
 *
 * O arquivo já existe chamado "Controle de Cirurgias UNIMED HIPNOS 2026", e a
 * conta de serviço não cria arquivo: o app só encontra o que existe, pelo nome
 * exato. Mudar este texto faz o app deixar de achar a planilha e tentar criar
 * uma que ele não consegue criar.
 *
 * Ou seja: trocar o nome da equipe na tela é seguro; trocar este aqui só junto
 * com o nome do arquivo no Drive.
 */
export const EQUIPE_NA_PLANILHA = "UNIMED HIPNOS";

/**
 * Como a equipe assina a planilha das cirurgias particulares.
 *
 * Sem "UNIMED": ali não há convênio nenhum. O nome tem de ser diferente do da
 * planilha de convênio pela mesma razão explicada em `tituloDoAno` — dois
 * arquivos com o mesmo nome na mesma pasta viram um reescrevendo o outro.
 */
export const EQUIPE_PARTICULAR = "PARTICULAR HIPNOS";

/**
 * Como a planilha dos convênios que não são Unimed se identifica no Drive.
 *
 * A conferência da Unimed é feita com a Unimed, e a dos outros convênios é
 * outra conversa — por isso são dois arquivos. O da Unimed continua com o nome
 * que sempre teve, porque ele já existe e o app o encontra pelo nome exato.
 */
export const EQUIPE_OUTROS = "OUTROS CONVENIOS HIPNOS";

/**
 * A marca sozinha, sem o "UNIMED".
 *
 * É o que se acrescenta ao nome de uma clínica para compor o arquivo dela:
 * "OFTALMOLOGIA NOVA CAMPINAS" + "HIPNOS". Continua distinguindo estes arquivos
 * dos da outra equipe, que é a razão de o nome da equipe estar no título.
 */
export const MARCA = "HIPNOS";

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
export function tituloDoAno(ano, identificacao = EQUIPE_NA_PLANILHA) {
  return `${TITULO} ${identificacao} ${ano}`;
}

/**
 * A cor do convênio na lista de procedimentos.
 *
 * Serve para reconhecer de relance, sem ler: o nome do paciente e o nome do
 * convênio saem nesta cor no cartão.
 *
 * São três, e não uma por operadora. Uma cor para cada convênio parecia mais
 * informativa e era o contrário: sete cores não se reconhecem sem ler, e a
 * pergunta que a lista responde de relance não é "qual operadora?" — é para
 * qual das três planilhas aquele paciente vai. É a mesma divisão de
 * `lib/modelos.js`, agora visível na tela.
 *
 * Os tons são versões escurecidas: nos originais, o verde da Unimed e o azul
 * ficam entre 2 e 3,5:1 sobre o fundo claro, ilegíveis em corpo de texto. Estes
 * passam de 4,5:1.
 */
export const COR_UNIMED = "#06773F"; // verde
export const COR_PARTICULAR = "#0B3D91"; // azul escuro
export const COR_OUTROS = "#B5540E"; // laranja

/**
 * A cor deste convênio, ou null quando ele está em branco — e aí o texto fica
 * na cor normal, que é o certo para o registro que ainda não tem convênio.
 *
 * A comparação de "unimed" é sem caixa e sem acento, do começo do nome e por
 * palavra inteira: "UNIMED CAMPINAS" conta, "UNIMEDICA" não. É a mesma regra de
 * `ehUnimed`, e as duas precisam continuar combinando: a cor na tela diz para
 * qual planilha o registro vai.
 */
export function corDoConvenio(convenio) {
  const nome = normalizarTexto(convenio || "");
  if (!nome) return null;
  if (nome === "unimed" || nome.startsWith("unimed ")) return COR_UNIMED;
  if (nome === "particular") return COR_PARTICULAR;
  return COR_OUTROS;
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

  /**
   * Fundo do cartão já conferido pela secretária. Cinza neutro, fora da paleta
   * dourada de propósito: conferido é assunto encerrado, e tem de sair da
   * frente do que ainda falta.
   */
  conferido: "#ECEAE5",

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
