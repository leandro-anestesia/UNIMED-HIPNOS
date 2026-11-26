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
 * Este app é um ambiente NOVO, separado do que a equipe usa hoje — e não pode
 * escrever em nenhuma das planilhas atuais.
 *
 * As planilhas em uso se chamam "Controle de Cirurgias UNIMED HIPNOS 2026",
 * "… PARTICULAR HIPNOS 2026" e "… OUTROS CONVENIOS HIPNOS 2026". Como o app
 * acha o arquivo pelo nome exato e `syncAno` limpa as abas antes de gravar,
 * reaproveitar esses nomes bastaria para que uma credencial do Google copiada
 * por engano reescrevesse a planilha da equipe. Por isso os três nomes abaixo
 * levam "CIRURGIA" no fim: com eles, a busca nunca encontra um arquivo atual.
 * Os títulos passam a ser, por exemplo, "Controle de Cirurgias UNIMED HIPNOS
 * CIRURGIA 2026" — é com esse nome que a planilha nova tem de ser criada.
 *
 * Nunca voltar a nenhum dos nomes antigos. A outra porta, o id guardado no
 * Redis, está fechada em `getSpreadsheetId`.
 */

/**
 * Como a planilha do hospital se identifica no Drive — e por que não é o nome
 * da equipe acima.
 *
 * A conta de serviço não cria arquivo: o app só encontra o que existe, pelo
 * nome exato. Mudar este texto faz o app deixar de achar a planilha e tentar
 * criar uma que ele não consegue criar.
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
 * outra conversa — por isso são dois arquivos.
 */
export const EQUIPE_OUTROS = "OUTROS CONVENIOS HIPNOS";

/**
 * A marca sozinha, sem o "UNIMED".
 *
 * É o que se acrescenta ao nome de uma clínica para compor o arquivo dela:
 * "OFTALMOLOGIA NOVA CAMPINAS" + "HIPNOS CIRURGIA". Continua distinguindo estes
 * arquivos dos da outra equipe e dos do ambiente atual da Hipnos.
 */
export const MARCA = "HIPNOS";

/** Título grande do cabeçalho, e nome do app. */
export const TITULO = "Controle de Cirurgias";

/**
 * O começo do nome das planilhas no Drive. Separado de `TITULO` de propósito:
 * o app acha a planilha pelo nome exato, e renomear o app não pode renomear
 * o arquivo que ele procura (ver `tituloDoAno`).
 */
export const TITULO_DA_PLANILHA = "Controle de Cirurgias";

/** Nome curto: ícone na tela do celular, onde só cabem ~12 caracteres. */
export const TITULO_CURTO = "Cirurgias";

/**
 * A versão que a equipe vê, no rodapé da caixa do acesso.
 *
 * Escrita à mão e subida a cada mudança que valha ser notada — não é o commit
 * publicado, que já vive em `VERSAO_DO_APP` e serve para o app descobrir
 * sozinho que ficou para trás. Esta é para uma pessoa olhar o aparelho e
 * dizer, em voz alta, qual versão está ali.
 */
export const VERSAO_VISIVEL = "1.8";

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
  return `${TITULO_DA_PLANILHA} ${identificacao} ${ano}`;
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
 *
 * O valor mora em `styles/globais.css`, como o de todas as cores abaixo.
 */
export const COR_UNIMED = "var(--conv-unimed)"; // verde
export const COR_PARTICULAR = "var(--conv-particular)"; // azul escuro
export const COR_OUTROS = "var(--conv-outros)"; // laranja

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
 * O fundo da etiqueta do convênio: a mesma matiz, bem diluída.
 *
 * Irmã de `corDoConvenio` e com exatamente a mesma regra de decisão — por isso
 * mora ao lado dela. Se as duas divergirem, a etiqueta sai com texto de um
 * convênio e fundo de outro.
 */
export function fundoDoConvenio(convenio) {
  const cor = corDoConvenio(convenio);
  if (!cor) return null;
  if (cor === COR_UNIMED) return "var(--conv-unimed-fundo)";
  if (cor === COR_PARTICULAR) return "var(--conv-particular-fundo)";
  return "var(--conv-outros-fundo)";
}

/**
 * A cor da barra do navegador e da tela de abertura do app instalado.
 *
 * Em hex, e não em `var(--…)`: a `<meta name="theme-color">` é lida pelo
 * navegador, não pelo CSS, e não entende variável. É o mesmo preto de
 * `--cabecalho`; `public/manifest.json` repete o valor à mão.
 */
export const COR_DO_NAVEGADOR = "#1A1A1A";

/**
 * Paleta. Nomeada por papel, não por matiz, justamente para que a troca de
 * cores não exija renomear nada: `principal` continua sendo a cor de ação
 * mesmo quando deixa de ser verde.
 *
 * Cada entrada é `var(--…)`: o valor mora em `styles/globais.css`, onde um
 * `@media` alcança e o estilo em linha não. Por isso estas cores só servem em
 * `style` — concatenar sufixo de transparência (`${CORES.x}22`) ou mandar para
 * fora do CSS não funciona; para isso há `COR_DO_NAVEGADOR` e as cores da
 * planilha no fim deste objeto.
 */
export const CORES = {
  /** Ações, destaques, o "Sim" do executado. O dourado da Hipnos. */
  principal: "var(--acento)",
  /**
   * Texto sobre o dourado. Preto, e não branco: branco sobre este dourado dá
   * contraste de 2,2:1, abaixo de qualquer limite legível — o preto dá 7,5:1.
   */
  sobrePrincipal: "var(--acento-tinta)",

  /**
   * Fundo do cabeçalho e do aviso. O preto da Hipnos.
   *
   * Só fundo: texto escuro é `tinta`. Hoje as duas dão o mesmo preto, mas num
   * tema escuro o cabeçalho continua escuro e o texto vira claro.
   */
  escura: "var(--cabecalho)",
  /** Texto sobre o cabeçalho preto. */
  sobreEscura: "var(--sobre-cabecalho)",
  /** Fundos suaves: abas ativas, faixas de seção. Dourado bem diluído. */
  clara: "var(--acento-fundo)",
  /** Borda do que está sobre `clara`. */
  claraBorda: "var(--acento-borda)",
  /**
   * O dourado quando vira texto. `principal` é preenchimento: como texto sobre
   * branco dá 2,8:1 e reprova.
   */
  principalTexto: "var(--acento-texto)",
  /** Detalhes sobre o cabeçalho escuro: a linha fina e os textos de apoio. */
  acento: "var(--cabecalho-acento)",

  /** Texto principal. */
  tinta: "var(--tinta-1)",
  /** Fundo da página. */
  fundo: "var(--fundo)",
  /** Campo, botão, cartão. */
  superficie: "var(--superficie)",
  /** Campo em repouso dentro de um cartão branco. */
  superficie2: "var(--superficie-2)",
  /** Trilho de controle segmentado, tecla. */
  superficie3: "var(--superficie-3)",
  /** Bordas de campo, cartão e divisórias. */
  borda: "var(--hairline)",
  /** Divisórias internas, mais leves que `borda`. */
  bordaSuave: "var(--divisoria)",
  /** Texto secundário: rótulos de campo, metadados. */
  suave: "var(--tinta-2)",
  /** Texto terciário: contagens, estados vazios. */
  tenue: "var(--tinta-3)",

  /**
   * Fundo do cartão já conferido pela secretária. Cinza neutro, fora da paleta
   * dourada de propósito: conferido é assunto encerrado, e tem de sair da
   * frente do que ainda falta.
   */
  conferido: "var(--conferido)",

  /** Urgência, erro, exclusão. */
  alerta: "var(--alerta)",
  /** Fundo de erro e de campo inválido. */
  alertaFundo: "var(--alerta-fundo)",
  /** Aviso menos grave (falha de leitura). */
  avisoFundo: "var(--aviso-fundo)",
  avisoTinta: "var(--aviso)",

  /**
   * Verde da linha executada na planilha do Google (RGB 0–1). Continua verde
   * de propósito: "feito" se lê como verde em qualquer planilha, e uma linha
   * dourada sobre tema dourado não se distinguiria do resto.
   */
  verdePlanilha: { red: 0.784, green: 0.918, blue: 0.843 },
  /**
   * Laranja vivo do "Verificado" (RGB 0–1), para a linha da planilha.
   *
   * Fica na paleta mesmo este app não escrevendo em planilha: `lib/estados.js`
   * é o mesmo arquivo nos dois apps, e um token faltando aqui o quebraria.
   */
  laranjaPlanilha: { red: 1, green: 0.6, blue: 0 },
  /** Cabeçalho da planilha do Google (RGB 0–1) — o mesmo preto de `escura`. */
  cabecalhoPlanilha: { red: 0.102, green: 0.102, blue: 0.102 },
};
