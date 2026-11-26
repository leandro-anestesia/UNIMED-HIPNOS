import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Icone from "../componentes/Icone";
import {
  ALVO,
  ESPACO,
  TEXTO,
  apoio,
  btnDiscreto,
  btnIcone,
  btnPrimary,
  btnSecondary,
  chipMes,
  chipMesAtivo,
  execBtn,
  iconBtn,
  inputStyle,
  rotulo,
} from "../lib/estilo";
import * as XLSX from "xlsx";
import { normalizarTexto } from "../lib/texto";
import { analisarGuia } from "../lib/guia";
import { estadoDe, foiExecutada, opcoesDe, padraoDe, rotuloDe } from "../lib/estados";
import { NOMES_DE_LOCAL, leituraDoLocal, nomeDoLocal } from "../lib/locais";
import { ehDaVision, regrasDaVision } from "../lib/vision";
import {
  osSoComplementares,
  recadoDoSoComplementar,
  temAssistenciaAoParto,
  temParto,
} from "../lib/procedimentos";
import { chaveDeOrdem, ordenarRegistros } from "../lib/ordem";
import { modeloDoRegistro } from "../lib/modelos";
import { CORES, EQUIPE, PREFIXO_ARQUIVO, TITULO, VERSAO_VISIVEL, corDoConvenio, fundoDoConvenio } from "../lib/marca";
import {
  DIGITOS_DO_PIN,
  PAPEIS,
  ROTULO_DO_PAPEL,
  podeApagarRegistro,
  podeConferir,
  podeGerirAcesso,
  podeVerSecretaria,
  usuarioComMeio,
  usuarioDoNome,
} from "../lib/acesso";
import {
  CAMPOS_DO_REGISTRO,
  CAMPOS_MANUAIS,
  CAMPOS_QUE_APRENDEM,
  COLUNAS_OUTROS,
  COLUNAS_PARTICULAR,
  COLUNAS_UNIMED,
  ehDaUnimed,
  ehParticular,
  ehUnimed,
  SEPARADOR_PROCEDIMENTOS,
  TIPOS_DE_CADASTRO,
  valorDaColuna,
} from "../lib/campos";
import {
  agoraLocal,
  dataHoraDoInstante,
  duracaoEntre,
  formatarData,
  horaDoRegistro,
} from "../lib/tempo";

const PROCEDIMENTOS_COMPLEMENTARES = [
  "31602339 - Bloqueio anestésico de plexo",
  "31309038 - Assistência ao trabalho de parto, por hora (até o limite de 6 horas)",
  "30906164 - Cateterismo de artéria radial",
  "30913012 - Implante de cateter venoso central",
  "31602223 - Passagem de cateter peridural",
  "31602029 - Analgesia por dia subsequente",
  "40202445 - Laringoscopia para intubação - com vídeo ou fibro",
  "31602169 - Bloqueio peridural ou subaracnoide (analgesia pós-operatória)",
  "31402038 - Tampão sanguíneo peridural",
];

/**
 * Procedimentos cobrados por hora: marcar não basta, é preciso dizer quantas.
 * O valor é o teto que a tabela permite.
 */
const LIMITE_DE_HORAS = { "31309038": 6 };

/** O código TUSS que abre a descrição. */
function codigoDo(item) {
  return (item.match(/^\d+/) || [""])[0];
}

/**
 * A entrada gravada correspondente a esta opção, quando ela está marcada.
 *
 * Os cobrados por hora são guardados com a quantidade no fim (" — 3h"), então
 * a comparação não pode ser por igualdade.
 */
function complementarMarcado(lista, item) {
  return (lista || []).find((s) => s === item || s.startsWith(`${item} — `)) || null;
}

/** As horas de uma entrada já gravada. */
function horasDe(entrada) {
  const m = (entrada || "").match(/ — (\d+)h$/);
  return m ? Number(m[1]) : null;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const TODOS_OS_MESES = "todos";
/**
 * O chip "Hoje".
 *
 * Não é um mês, e por isso tem valor próprio: entra no mesmo estado do
 * seletor, mas a comparação é com a data inteira, não com o `ano-mês`.
 */
const SO_HOJE = "hoje";

/**
 * Quanto a ilha das abas ocupa, do fim da tela para cima: o conteúdo da aba,
 * o respiro de dentro da ilha e o afastamento de baixo.
 *
 * Mora aqui porque três lugares precisam concordar com ele — a própria ilha, o
 * aviso que sobe acima dela e o espaço no fim da página. Quando estavam
 * espalhados, mudar a barra deixava o aviso encostando nela.
 */
const ALTURA_DA_BARRA = 76;

/** O filtro de local da lista, quando nenhum está escolhido. */
const TODOS_OS_LOCAIS = "todos";
const TODOS_OS_CONVENIOS = "todos";

/**
 * Este campo faz sentido neste registro?
 *
 * A regra é uma só, e é a das colunas: o campo aparece quando a planilha de
 * destino tem a coluna dele. Guia e carteira não existem sem operadora; o
 * credenciado da Unimed só existe na Unimed; valor, recebido e quem recebeu só
 * no particular. Perguntar fora disso é perguntar o que não tem onde ser
 * escrito — e foi assim que o formulário da clínica ficou com três campos
 * mortos antes.
 */
function cabeNesteRegistro(campo, entry) {
  const modelo = modeloDoRegistro(entry);
  if (campo.soParticular && modelo !== "particular") return false;
  if (campo.naoParticular && modelo === "particular") return false;
  if (campo.soUnimed && modelo !== "convenio") return false;
  return true;
}

/**
 * O que foi digitado num campo de dinheiro, como número.
 *
 * Aceita vírgula, que é como se digita no Brasil, e devolve "" enquanto o
 * campo está vazio ou só com o separador — "1," é meio caminho de digitação, e
 * virar zero no meio da digitação apagaria o que a pessoa está escrevendo.
 */
function numeroDigitado(texto) {
  const limpo = (texto || "").replace(/[^\d,.]/g, "").replace(",", ".");
  if (limpo === "" || limpo === ".") return "";
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : "";
}

/** Chave "AAAA-MM" do lançamento, usada para agrupar por mês. */
function chaveDoMes(entry) {
  return (entry.dataCirurgia || "").slice(0, 7);
}

function nomeDoMes(chave, comAno) {
  const [ano, mes] = chave.split("-");
  const nome = (MESES[parseInt(mes, 10) - 1] || "").replace(/^./, (c) => c.toUpperCase());
  return comAno ? `${nome} ${ano}` : nome;
}

/** "Ago", "Set"... Nos chips o ano não entra — quem resolve ano é a grade. */
function mesAbreviado(numeroDoMes) {
  return (MESES[numeroDoMes - 1] || "").slice(0, 3).replace(/^./, (c) => c.toUpperCase());
}

/**
 * Meses presentes nos registros, do mais recente para o mais antigo, com a
 * contagem de cada um. Registro sem data fica de fora — não dá para dizer a
 * que mês pertence, e ele continua acessível pela busca e por "Todos".
 */
function mesesDosRegistros(entries) {
  const contagem = {};
  entries.forEach((e) => {
    const chave = chaveDoMes(e);
    if (!chave) return;
    contagem[chave] = (contagem[chave] || 0) + 1;
  });
  return Object.keys(contagem)
    .sort()
    .reverse()
    .map((chave) => ({ chave, total: contagem[chave] }));
}


function entryMatchesSearch(e, query) {
  const q = normalizarTexto(query);
  if (!q) return true;
  // Os estados entram pelo RÓTULO, que é o que se digita: ninguém procura por
  // "np", procura por "Não Retirado".
  //
  // E cada um só entra onde ele existe — o Recebido é do particular, o PC
  // Executado é do convênio. Sem essa separação, o "Não" que todo registro
  // carrega no Recebido por padrão faria a busca por "não" devolver a lista
  // inteira, inclusive cirurgia de convênio, onde esse campo nem aparece.
  const modelo = modeloDoRegistro(e);
  const estados = [
    rotuloDe("executado", e.executado),
    modelo === "convenio" ? rotuloDe("pcExecutado", e.pcExecutado) : "",
    modelo === "particular" ? rotuloDe("recebido", e.recebido) : "",
  ];

  const textos = [
    e.atendimento,
    e.paciente,
    e.convenio,
    e.cirurgiao,
    e.anestesista,
    e.anestesistaCarimbo,
    ...(e.procedimentos || []),
    ...(e.procedimentoComplementar || []),
    ...estados,
  ];
  if (textos.some((f) => normalizarTexto(f).includes(q))) return true;
  if (e.dataCirurgia) {
    const [y, m, d] = e.dataCirurgia.split("-");
    if (normalizarTexto(`${d}/${m}/${y}`).includes(q) || normalizarTexto(e.dataCirurgia).includes(q)) return true;
    const mes = MESES[parseInt(m, 10) - 1];
    if (mes && normalizarTexto(mes).includes(q)) return true;
  }
  return false;
}

/**
 * Os procedimentos no formulário são linhas com caixa de seleção: a leitura da
 * guia traz todas marcadas, e o anestesista desmarca as que não se aplicam ao
 * ato anestésico. O texto continua editável, que é como se conserta uma leitura
 * ruim sem ter de refazer a foto.
 */
function paraLinhas(lista) {
  return (lista || []).map((descricao) => ({ descricao, incluido: true }));
}

/** Só o que ficou marcado, já limpo — é isto que vai para o banco. */
function marcados(linhas) {
  return (linhas || [])
    .filter((l) => l.incluido)
    .map((l) => (l.descricao || "").trim())
    .filter(Boolean);
}

/** Um cadastro vazio por tipo — a forma que o estado sempre tem. */
const CADASTROS_VAZIOS = Object.fromEntries(TIPOS_DE_CADASTRO.map((t) => [t, []]));

/** A resposta de /api/cadastros com todos os tipos presentes, mesmo os vazios. */
function comTodosOsTipos(data) {
  return Object.fromEntries(TIPOS_DE_CADASTRO.map((t) => [t, (data && data[t]) || []]));
}

function emptyDraft() {
  const { data, hora } = agoraLocal();
  const d = {};
  CAMPOS_DO_REGISTRO.forEach((f) => (d[f.key] = ""));
  CAMPOS_MANUAIS.forEach((f) => (d[f.key] = ""));
  d.dataCirurgia = data;
  d.horaLancamento = hora;
  d.procedimentos = [];
  d.procedimentoComplementar = [];
  d.observacao = "";
  d.local = "";
  d.executado = padraoDe("executado");
  d.pcExecutado = padraoDe("pcExecutado");
  d.recebido = padraoDe("recebido");
  d.valor = "";
  d.conferido = false;
  return d;
}

/**
 * A mensagem de erro que o servidor mandou, quando manda uma.
 *
 * `fetch` só rejeita quando a requisição nem sai — 500 e 400 chegam como
 * resposta normal, com `ok` falso. Quem não olhar o `ok` trata falha como
 * sucesso, e foi exatamente isso que fez um lançamento sumir sem aviso.
 */
async function mensagemDeErro(r) {
  try {
    const corpo = await r.json();
    if (corpo && corpo.error) return corpo.error;
  } catch {
    // resposta sem JSON; o código HTTP já diz o suficiente
  }
  return `erro ${r.status}`;
}

/** Onde o aparelho guarda o último local e os usados há pouco. */
const CHAVE_DO_LOCAL = "hipnos_local";
const CHAVE_DO_LOCAL_EM = "hipnos_local_confirmado_em";
/** A hora em que o local lembrado passa a pedir confirmação. */
const HORA_DE_CONFIRMAR_LOCAL = 7;

/**
 * As 07:00 mais recentes que já passaram: hoje, se já são 07:00; senão,
 * ontem. Hora do aparelho, que é a de quem está no centro cirúrgico.
 */
function ultimoCorteDoLocal(agora) {
  const corte = new Date(agora);
  corte.setHours(HORA_DE_CONFIRMAR_LOCAL, 0, 0, 0);
  if (corte > agora) corte.setDate(corte.getDate() - 1);
  return corte.getTime();
}

const CHAVE_DOS_RECENTES = "hipnos_locais_recentes";
/** Três: o que cabe acima da lista completa sem empurrá-la para fora da folha. */
const LOCAIS_RECENTES = 3;

/**
 * Este registro é desta pessoa?
 *
 * Pelo `criadoPor`, que o servidor carimba em todo lançamento novo. Os
 * registros de antes do carimbo — e os trazidos do app oficial — não têm
 * autor; para eles vale o anestesiologista do registro, comparado com o nome
 * de quem está logado. Sem acesso conhecido, nada é de ninguém: a tela inicial
 * não pode mostrar os pacientes de outro anestesiologista enquanto carrega.
 */
function lancadoPor(entry, eu) {
  if (!eu || !entry) return false;
  if (entry.criadoPor) return entry.criadoPor === eu.usuario;
  const nome = normalizarTexto(eu.nome || "");
  return nome !== "" && normalizarTexto(entry.anestesista || "") === nome;
}

/**
 * Quem é chamado pelo nome, sem "Dr." nem "Dra.".
 *
 * A Adriana é a secretária; todo o resto da lista de acesso é anestesiologista.
 * Por nome, e não pelo papel: há anestesiologista com papel de mestre, e o
 * papel diz o que a pessoa pode fazer no app, não como ela é chamada.
 */
const SEM_TRATAMENTO = ["adriana"];

/**
 * "Dr." ou "Dra.", pela última letra do primeiro nome.
 *
 * É uma aproximação, e acerta a equipe inteira de hoje (Amanda, Juliana,
 * Rayana… Dra.; Leandro, Matheus, Otávio… Dr.). Um nome que fuja da regra
 * entra em `TRATAMENTO_POR_NOME`, em vez de virar exceção espalhada no código.
 */
const TRATAMENTO_POR_NOME = {};

function tratamentoDe(primeiroNome) {
  const nome = normalizarTexto(primeiroNome);
  if (!nome || SEM_TRATAMENTO.includes(nome)) return "";
  if (TRATAMENTO_POR_NOME[nome]) return TRATAMENTO_POR_NOME[nome];
  return nome.endsWith("a") ? "Dra." : "Dr.";
}

/**
 * "Bom dia, Dr. Leandro", pela hora do aparelho.
 *
 * Só o primeiro nome. Antes de o acesso responder, fica a saudação sozinha,
 * em vez de um "carregando…".
 */
function saudacao(eu) {
  const hora = new Date().getHours();
  const cumprimento = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const primeiro = ((eu && eu.nome) || "").trim().split(/\s+/)[0] || "";
  if (!primeiro) return cumprimento;
  const nome = `${primeiro.charAt(0).toUpperCase()}${primeiro.slice(1).toLowerCase()}`;
  const tratamento = tratamentoDe(primeiro);
  return `${cumprimento}, ${tratamento ? `${tratamento} ` : ""}${nome}`;
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * "seg, 23 nov".
 *
 * Montada à mão, e não com `toLocaleDateString`: o formato do `pt-BR` muda de
 * navegador para navegador ("seg., 23 de nov.") e, num cabeçalho de uma linha,
 * cada ponto a mais empurra a saudação.
 */
function dataPorExtenso() {
  const d = new Date();
  return `${DIAS_DA_SEMANA[d.getDay()]}, ${d.getDate()} ${MESES_CURTOS[d.getMonth()]}`;
}

/**
 * O teto do PDF do mapa.
 *
 * Em base64 um arquivo cresce um terço, e o corpo da requisição ainda leva o
 * JSON em volta: 3 MB de PDF viram uns 4 MB de corpo. O teto é conservador de
 * propósito — a agenda exportada do sistema da clínica é um PDF de texto, de
 * algumas centenas de KB, e quem passa disso costuma ser um PDF escaneado, que
 * é foto com outro nome: para esse, fotografar a folha já funciona e dá menos
 * volta.
 */
const MAIOR_PDF = 3 * 1024 * 1024;

/** O que o seletor do mapa abre: foto OU a agenda em PDF. */
const TIPOS_DO_MAPA = "image/*,application/pdf";

/**
 * O arquivo em base64, inteiro e sem passar por canvas.
 *
 * `fileToResizedBase64` desenha num `<img>` para encolher, e PDF não entra em
 * `<img>` — a leitura falharia com "não foi possível decodificar esta imagem".
 * Aqui o arquivo vai como está; quem cuida do tamanho é `MAIOR_PDF`.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.onload = () => {
      const texto = String(reader.result || "");
      const virgula = texto.indexOf(",");
      if (virgula < 0) return reject(new Error("Não foi possível ler o arquivo selecionado."));
      resolve(texto.slice(virgula + 1));
    };
    reader.readAsDataURL(file);
  });
}

function fileToResizedBase64(file, maxDim = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Não foi possível decodificar esta imagem."));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | extracting | review
  // Qual leitura está em curso. O aviso de espera dizia "Lendo a guia…" nos
  // dois casos, porque `status` só sabe que está lendo, não o quê: quem
  // fotografava o mapa da clínica lia que o app estava lendo uma guia.
  const [lendo, setLendo] = useState("guia"); // guia | mapa | mapa-pdf
  // "Confirmo que preenchi a guia complementar": o complementar só é pago com
  // a guia própria, e o aviso piscando era ignorado de tanto aparecer. Um
  // aceite explícito trava o Salvar até alguém de fato olhar.
  const [aceiteComplementar, setAceiteComplementar] = useState(false);
  // "Realizou analgesia?", perguntada quando o principal é um parto:
  // "sim" | "nao" | null (ainda sem resposta).
  //
  // Não é campo do registro, e por isso não é gravada. O que se grava é a
  // consequência — a assistência entre os complementares, com as horas —, e
  // essa sim vai para a planilha e para a conta.
  const [analgesiaDeParto, setAnalgesiaDeParto] = useState(null);
  const [activeTab, setActiveTab] = useState("novo"); // novo | procedimentos | cadastros
  const [viewingEntry, setViewingEntry] = useState(null);
  const [cadastros, setCadastros] = useState(CADASTROS_VAZIOS);
  const [searchQuery, setSearchQuery] = useState("");
  const [mesSelecionado, setMesSelecionado] = useState(null); // null = ainda não escolhido
  const [sincronizando, setSincronizando] = useState(false);

  /**
   * Quem está usando o app, e o que o papel dele permite.
   *
   * O cookie é `HttpOnly`, então a página não consegue lê-lo: quem diz é o
   * servidor, em `/api/acesso/eu`. Três estados, e a diferença importa:
   *
   * - `undefined`: ainda não sei. Esconde o que é da conferência por um
   *   instante, porque mostrar e tirar é pior do que aparecer um pouco depois.
   * - `null`: não consegui saber (rota fora do ar, resposta estranha). Aí a
   *   tela mostra tudo: travar a equipe por causa de uma chamada que falhou
   *   seria o pior dos dois erros, e quem decide de verdade é o servidor, que
   *   recusa a ação mesmo com o botão na tela.
   * - objeto: o papel manda.
   */
  const [acesso, setAcesso] = useState(undefined);
  // O menu da pessoa, no cabeçalho. Fechado por padrão: ele cobre conteúdo.
  const [menuDoAcesso, setMenuDoAcesso] = useState(false);
  // Qual seção dos Cadastros está aberta. Uma de cada vez, e nenhuma ao
  // chegar: é o que faz os títulos caberem numa tela só.
  const [blocoAberto, setBlocoAberto] = useState(null);

  const permissao = useCallback(
    (teste) => {
      if (acesso === undefined) return false;
      if (acesso === null) return true;
      return teste(acesso.papel);
    },
    [acesso]
  );

  const podeConferirAqui = permissao(podeConferir);
  const podeApagarAqui = permissao(podeApagarRegistro);
  const veSecretaria = permissao(podeVerSecretaria);
  // O mestre precisa de papel conhecido: a seção de Acesso aparecer para quem
  // não é mestre só geraria recusa do servidor e confusão na tela.
  const ehMestre = Boolean(acesso && acesso.papel && podeGerirAcesso(acesso.papel));

  /**
   * O aviso que desliza do rodapé, no lugar do `alert()`.
   *
   * `alert()` trava a tela, exige um toque para sumir e tem cara de erro de
   * sistema — num app de centro cirúrgico, parece que alguma coisa quebrou
   * mesmo quando a mensagem é "salvo".
   *
   * Aviso curto some sozinho em cinco segundos. Aviso com mais de uma linha
   * fica até ser fechado: é relatório — o que a sincronização trouxe, o que ela
   * não conseguiu aceitar —, e some antes de ser lido não serve para nada.
   */
  const [aviso, setAviso] = useState(null);
  const avisoTimer = useRef(null);

  const avisar = useCallback((texto, tipo = "ok") => {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    const fixo = texto.includes("\n");
    setAviso({ texto, tipo, fixo });
    if (!fixo) avisoTimer.current = setTimeout(() => setAviso(null), 5000);
  }, []);

  useEffect(() => () => avisoTimer.current && clearTimeout(avisoTimer.current), []);
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);
  const [guiaInfo, setGuiaInfo] = useState(null);
  /**
   * O local escolhido na tela inicial, que vale para o próximo lançamento.
   *
   * Quem está na clínica lança vários seguidos; escolher o local em cada um
   * seria um toque a mais toda vez. Fica guardado no aparelho para sobreviver
   * ao recarregar, e aparece marcado na tela inicial — é o que impede lançar
   * um caso do hospital achando que o local ainda está vazio.
   */
  const [localAtivo, setLocalAtivo] = useState("");
  // O local veio da memória do aparelho, e não de um toque agora? A tela diz
  // isso embaixo do nome — é o aviso de que a escolha é de outro dia.
  const [localLembrado, setLocalLembrado] = useState(false);
  // Quando o local foi escolhido ou confirmado pela última vez neste aparelho
  // (ms). Sem data — escolha de antes desta regra — conta como velha.
  const [localConfirmadoEm, setLocalConfirmadoEm] = useState(null);
  // Muda quando o relógio cruza as 07:00 ou o app volta do segundo plano: o
  // PWA fica aberto de um dia para o outro, e o aviso tem de aparecer sem
  // ninguém recarregar a página.
  const [relogio, setRelogio] = useState(0);
  const [locaisRecentes, setLocaisRecentes] = useState([]);
  // Qual cartão da lista está aberto. Um de cada vez: a lista existe para
  // percorrer, e vários abertos a transformariam de novo num paredão.
  const [expandido, setExpandido] = useState(null);
  const [localFiltro, setLocalFiltro] = useState(TODOS_OS_LOCAIS);
  const [convenioFiltro, setConvenioFiltro] = useState(TODOS_OS_CONVENIOS);
  const [errorMsg, setErrorMsg] = useState("");
  // Lista vazia e lista que não carregou são idênticas na tela, e a segunda
  // faria o anestesista concluir que o lançamento dele sumiu.
  const [falhaDeCarga, setFalhaDeCarga] = useState("");
  const [draft, setDraft] = useState(emptyDraft());
  const [imagePreview, setImagePreview] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const mapaInputRef = useRef(null);
  // O mapa lido, esperando conferência: { data, anestesista, linhas: [...] }.
  const [mapa, setMapa] = useState(null);

  // A lista sendo buscada de novo em segundo plano, na volta ao app. Vira a
  // barrinha do topo, e nada mais: a tela continua inteira e utilizável.
  const [atualizando, setAtualizando] = useState(false);
  // Saiu publicação nova e este app ficou para trás.
  const [versaoNova, setVersaoNova] = useState("");
  // Recarregando de propósito, com a tela por cima dizendo isso.
  const [recarregando, setRecarregando] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/entries");
      if (r.status === 401) {
        // O cookie não vale mais. Mostrar "nenhum registro" aqui faria o
        // anestesiologista concluir que o lançamento dele sumiu.
        window.location.href = "/entrar";
        return;
      }
      if (!r.ok) {
        setFalhaDeCarga(await mensagemDeErro(r));
        return;
      }
      const data = await r.json();
      if (!Array.isArray(data)) {
        setFalhaDeCarga("o servidor respondeu algo que não é uma lista de registros");
        return;
      }
      setFalhaDeCarga("");
      setEntries(data);
    } catch (e) {
      console.error(e);
      setFalhaDeCarga("não consegui falar com o servidor");
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadCadastros = useCallback(async () => {
    try {
      const r = await fetch("/api/cadastros");
      const data = await r.json();
      setCadastros(comTodosOsTipos(data));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadEntries();
    loadCadastros();
  }, [loadEntries, loadCadastros]);

  /**
   * Quem sou eu — e ainda sou?
   *
   * Se o cookie não vale mais (aparelho derrubado, acesso desativado), a tela
   * não fica quebrada: vai para a entrada.
   *
   * Falha de rede NÃO põe ninguém para fora: `catch` deixa o papel como
   * desconhecido e a tela mostra tudo, porque quem recusa de verdade é o
   * servidor. Uma oscilação de sinal no corredor do centro cirúrgico não pode
   * expulsar quem está lançando.
   */
  const conferirAcesso = useCallback(async () => {
    try {
      const r = await fetch("/api/acesso/eu");
      const data = await r.json();
      if (data.logado) {
        setAcesso({ usuario: data.usuario, nome: data.nome, papel: data.papel, pinTrocado: data.pinTrocado });
      } else if (data.tranca === false) {
        // Sem tranca configurada ninguém entra, e nem há o que esconder.
        setAcesso(null);
      } else {
        window.location.href = "/entrar";
      }
    } catch (e) {
      console.error(e);
      setAcesso(null);
    }
  }, []);

  useEffect(() => {
    conferirAcesso();
  }, [conferirAcesso]);

  /**
   * O que ainda não está gravado em lugar nenhum.
   *
   * É o que impede o app de se recarregar sozinho por cima de trabalho: uma
   * guia recém-lida, um mapa em conferência, um registro em edição. Recarregar
   * ali apagaria uma leitura que custou foto, espera e conferência.
   *
   * A data, a hora e o local ficam de fora: os três já vêm preenchidos num
   * formulário que ninguém tocou, e contá-los faria todo app parecer ocupado.
   */
  const temTrabalhoNaoSalvo = useCallback(() => {
    if (salvando || mapa || imagePreview || editingId) return true;
    const vazio = emptyDraft();
    const ignorar = new Set(["dataCirurgia", "horaLancamento", "local"]);
    return Object.keys(vazio).some((k) => {
      if (ignorar.has(k)) return false;
      const agora = draft[k];
      if (Array.isArray(agora)) return agora.length > 0;
      return (agora || "") !== (vazio[k] || "");
    });
  }, [salvando, mapa, imagePreview, editingId, draft]);

  /**
   * Este app ficou para trás?
   *
   * Cada publicação na Vercel é imutável e carrega a própria identidade. O que
   * está aberto no aparelho responde com a versão dele; a rota do domínio
   * responde a da publicação no ar. Diferentes, saiu coisa nova.
   */
  const conferirVersao = useCallback(async () => {
    const minha = process.env.VERSAO_DO_APP || "dev";
    try {
      const r = await fetch("/api/versao");
      if (!r.ok) return;
      const { versao } = await r.json();
      if (!versao || versao === minha) return;

      // Já recarreguei uma vez por esta mesma versão e continuo velho: alguma
      // coisa está servindo o app antigo. Recarregar de novo viraria laço —
      // melhor avisar e deixar a pessoa decidir.
      let jaTentei = "";
      try {
        jaTentei = window.sessionStorage.getItem("hipnos_recarreguei_para") || "";
      } catch (e) {
        jaTentei = "";
      }
      if (jaTentei === versao || temTrabalhoNaoSalvo()) {
        setVersaoNova(versao);
        return;
      }
      try {
        window.sessionStorage.setItem("hipnos_recarreguei_para", versao);
      } catch (e) {
        // Navegador sem armazenamento: segue sem a trava, e o aviso abaixo
        // continua sendo a saída se o recarregar não resolver.
      }
      setRecarregando(true);
      // Um instante para a tela de "atualizando" aparecer antes de a página
      // ir embora: recarregar em branco parece travamento.
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      // Sem rede não há versão nova a descobrir, e isso não é erro de nada.
    }
  }, [temTrabalhoNaoSalvo]);

  /**
   * A lista, de novo, sem tirar a tela de ninguém.
   *
   * Enquanto se salva, não: a resposta do servidor ainda está a caminho, e
   * sobrescrever a lista no meio disso faria o registro recém-lançado piscar.
   */
  const atualizarDados = useCallback(async () => {
    if (salvandoRef.current) return;
    setAtualizando(true);
    try {
      await Promise.all([loadEntries(), loadCadastros()]);
    } finally {
      setAtualizando(false);
    }
  }, [loadEntries, loadCadastros]);

  /**
   * E de novo toda vez que o app volta do congelador.
   *
   * Sem isto, a tranca parecia não valer para quem já tinha o app aberto. O
   * iPhone não recarrega uma página que volta da memória — ele devolve a tela
   * exatamente como estava, com o React e os dados já carregados, e sem pedir
   * nada ao servidor. O app aparecia inteiro, com os registros de antes, como
   * se a pessoa continuasse logada; o servidor já recusava qualquer gravação,
   * mas o que estava na tela continuava na tela.
   *
   * `pageshow` com `persisted` é exatamente esse retorno; `visibilitychange` é
   * o app voltando a ser o aplicativo da frente. Nos dois casos, uma pergunta
   * ao servidor, que é barata, e quem não está mais logado vai para o PIN.
   */
  useEffect(() => {
    function aoVoltar(evento) {
      if (evento.type === "pageshow" && !evento.persisted) return;
      if (evento.type === "visibilitychange" && document.visibilityState !== "visible") return;
      // Quem está logado, o que há de novo na lista, e se este app ficou para
      // trás. Os três na volta, porque é exatamente aí que a tela devolvida da
      // memória está mais velha do que parece.
      conferirAcesso();
      atualizarDados();
      conferirVersao();
    }

    window.addEventListener("pageshow", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.removeEventListener("pageshow", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [conferirAcesso, atualizarDados, conferirVersao]);

  // A recusa da tela da secretaria chega por aqui: o middleware devolve para
  // cá com `?negado`, em vez de deixar a tela em branco sem explicação.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("negado") === "secretaria") {
      avisar("A área de conferência é da secretária e do mestre.", "erro");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [avisar]);

  /**
   * O local não é lembrado entre uma abertura e outra, de propósito.
   *
   * Campo que volta preenchido é campo que não se lê: quem opera no Bairral
   * abriria o app, fotografaria a guia e salvaria — e o registro iria para o
   * lugar do dia anterior, sem ninguém ter errado de digitar. O local sai em
   * coluna nas três planilhas e é por ele que a conferência diz onde a cirurgia
   * foi; local errado é pior do que local em branco, porque o branco se vê.
   */
  function marcarLocalConfirmado() {
    const agora = Date.now();
    setLocalConfirmadoEm(agora);
    try {
      window.localStorage.setItem(CHAVE_DO_LOCAL_EM, String(agora));
    } catch (e) {
      // Sem armazenamento, a confirmação vale até fechar o app.
    }
  }

  function escolherLocal(local) {
    setLocalAtivo(local);
    setLocalLembrado(false);
    if (!local) return;
    marcarLocalConfirmado();
    const recentes = [local, ...locaisRecentes.filter((l) => l !== local)].slice(0, LOCAIS_RECENTES);
    setLocaisRecentes(recentes);
    try {
      window.localStorage.setItem(CHAVE_DO_LOCAL, local);
      window.localStorage.setItem(CHAVE_DOS_RECENTES, JSON.stringify(recentes));
    } catch (e) {
      // Sem armazenamento, a escolha vale até fechar o app.
    }
  }

  // Memoizado porque entra na dependência do efeito abaixo: recriar o array a
  // cada render faria o efeito rodar sem necessidade.
  const meses = useMemo(() => mesesDosRegistros(entries), [entries]);

  // A lista do campo do credenciado sai do próprio cadastro, filtrada: o nome
  // completo é o que está cadastrado, e não uma segunda lista para manter.
  const credenciados = useMemo(
    () => (cadastros.anestesistas || []).filter(ehDaUnimed),
    [cadastros.anestesistas]
  );

  // Abre no mês corrente; se ele ainda não tiver registro, no mês mais recente
  // que tiver. Só define uma vez — não pode desfazer a escolha do usuário a
  // cada recarga da lista.
  useEffect(() => {
    if (mesSelecionado !== null || meses.length === 0) return;
    const atual = agoraLocal().data.slice(0, 7);
    setMesSelecionado(meses.some((m) => m.chave === atual) ? atual : meses[0].chave);
  }, [meses, mesSelecionado]);

  /** Um nome ou vários; vários vão numa requisição só. */
  async function addCadastro(tipo, nome, { avisarFalha = true } = {}) {
    try {
      const corpo = Array.isArray(nome) ? { tipo, nomes: nome } : { tipo, nome };
      const r = await fetch("/api/cadastros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) throw new Error(await mensagemDeErro(r));
      const data = await r.json();
      setCadastros(comTodosOsTipos(data));
      return true;
    } catch (e) {
      console.error(e);
      if (avisarFalha) avisar("Não consegui salvar o cadastro. Tente de novo.", "erro");
      return false;
    }
  }

  /**
   * Importa uma lista inteira de nomes.
   *
   * Um de cada vez de propósito: `/api/cadastros` lê a lista, acrescenta e
   * regrava, sem trava. Enviados em paralelo, os pedidos se sobrescreveriam e
   * parte dos nomes se perderia — justamente numa importação de trinta.
   */
  async function importarCadastros(tipo, nomes) {
    const falhas = [];
    let gravados = 0;
    for (const nome of nomes) {
      if (await addCadastro(tipo, nome, { avisarFalha: false })) gravados++;
      else falhas.push(nome);
    }
    return { gravados, falhas };
  }

  /**
   * Guarda no cadastro o que foi digitado nos campos marcados com `aprende`.
   *
   * É assim que a lista de convênios nasce: ninguém precisa cadastrar nada
   * antes: o primeiro lançamento de cada convênio o cadastra, e do segundo em
   * diante o nome aparece no autocompletar. Escrito errado, sai pela aba
   * Cadastros.
   *
   * Roda depois de o registro estar salvo e nunca reclama: falhar em cadastrar
   * um nome não pode virar aviso de erro num lançamento que deu certo.
   */
  async function aprenderCadastros(dados) {
    // Junta tudo antes de mandar: o salvamento espera por isto, e uma guia com
    // oito procedimentos novos eram oito requisições em fila com o formulário
    // aberto. Agora é uma por tipo, e nenhuma quando não há o que aprender.
    const novos = {};
    const anotar = (tipo, valor) => {
      const limpo = (valor || "").toString().trim();
      if (!limpo) return;
      const igual = (n) => normalizarTexto(n) === normalizarTexto(limpo);
      if ((cadastros[tipo] || []).some(igual)) return;
      const lista = novos[tipo] || (novos[tipo] = []);
      if (!lista.some(igual)) lista.push(limpo);
    };

    for (const f of CAMPOS_QUE_APRENDEM) {
      anotar(f.cadastroKey, dados[f.key]);
    }

    // O procedimento é lista, e não um campo de texto: cada linha gravada vira
    // uma entrada do cadastro. É daqui que sai o autocompletar do lançamento
    // manual — inclusive com os códigos TUSS que entraram pelas guias lidas.
    for (const descricao of dados.procedimentos || []) {
      anotar("procedimentos", descricao);
    }

    for (const [tipo, nomes] of Object.entries(novos)) {
      await addCadastro(tipo, nomes, { avisarFalha: false });
    }
  }

  async function removeCadastro(tipo, nome) {
    try {
      const r = await fetch(`/api/cadastros?tipo=${encodeURIComponent(tipo)}&nome=${encodeURIComponent(nome)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await mensagemDeErro(r));
      const data = await r.json();
      setCadastros(comTodosOsTipos(data));
    } catch (e) {
      console.error(e);
      avisar("Não consegui remover o cadastro. Tente de novo.", "erro");
    }
  }

  /**
   * Lê o mapa cirúrgico: uma foto, vários pacientes.
   *
   * O que chega da leitura não vira registro direto — vira uma lista para
   * conferir. Paciente que já está no app entra desmarcado, e é isso que evita
   * lançar o mesmo mapa duas vezes sem perceber.
   */
  async function handleMapa(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    // A agenda da clínica sai do sistema em PDF. Antes, só foto: quem tinha o
    // PDF na mão precisava imprimir para fotografar, ou abrir e dar print na
    // tela — duas voltas para chegar ao mesmo lugar, e com pior leitura.
    const ehPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");

    if (ehPdf && file.size > MAIOR_PDF) {
      // Recusar aqui, com o motivo, em vez de deixar o servidor devolver um
      // erro de tamanho que não diz o que fazer.
      setErrorMsg(
        `Este PDF tem ${(file.size / 1024 / 1024).toFixed(1)} MB e o limite é ` +
          `${MAIOR_PDF / 1024 / 1024} MB. Se ele for digitalizado, fotografar a folha funciona e costuma ler igual.`
      );
      if (mapaInputRef.current) mapaInputRef.current.value = "";
      return;
    }

    setErrorMsg("");
    setLendo(ehPdf ? "mapa-pdf" : "mapa");
    setStatus("extracting");
    try {
      // O PDF vai inteiro; a foto continua encolhendo antes de subir.
      const base64 = ehPdf ? await fileToBase64(file) : await fileToResizedBase64(file);

      const r = await fetch("/api/extract-mapa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // O local vai junto porque a folha da Vision é outra, e a leitura
        // precisa saber qual instrução usar.
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: ehPdf ? "application/pdf" : "image/jpeg",
          local: localAtivo,
        }),
      });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.error || "Falha na leitura do mapa");

      // A data do lançamento é a de hoje, não a do mapa: a folha costuma ser de
      // dias antes, e é lendo-a que o lançamento acontece. Quem precisar de
      // outra data troca no campo do mapa, que vale para todos os pacientes.
      const data = agoraLocal().data;
      const lidas = (parsed.registros || []).map((p) => ({
        ...p,
        paciente: (p.paciente || "").toUpperCase(),
        procedimentos: (p.procedimentos || []).map((x) => (x || "").toUpperCase()),
      }));

      // Na Vision o mapa não é lançado como está: o SUS sai, todo o resto vira
      // particular com o convênio real na observação, procedimento em branco
      // vira FACO + LIO com o olho, e o valor sai da tabela da clínica.
      const daVision = ehDaVision(localAtivo);
      const convertidas = daVision ? regrasDaVision(lidas) : { linhas: lidas, ignoradosDoSus: [], semValor: [] };

      // A duplicata é conferida DEPOIS da conversão: é o procedimento final que
      // identifica o lançamento, e antes dela ele ainda estaria em branco.
      const linhas = convertidas.linhas.map((p) => ({
        ...p,
        jaLancado: jaExiste(p.paciente, data, p.procedimentos),
        incluido: !jaExiste(p.paciente, data, p.procedimentos),
      }));

      if (linhas.length === 0) {
        setErrorMsg(
          convertidas.ignoradosDoSus.length > 0
            ? `Nesse mapa só havia paciente do SUS (${convertidas.ignoradosDoSus.length}), que não entra no controle.`
            : "Não achei nenhum paciente nesse mapa. Confira se a foto pegou a tabela inteira."
        );
        setStatus("idle");
        return;
      }

      // O que a conversão tirou ou não soube precificar é dito na cara. Linha
      // que some calada é linha que ninguém procura depois.
      if (daVision && (convertidas.ignoradosDoSus.length > 0 || convertidas.semValor.length > 0)) {
        avisar(
          [
            convertidas.ignoradosDoSus.length > 0
              ? `Fora do controle, por ser SUS: ${convertidas.ignoradosDoSus.join(", ")}.`
              : "",
            convertidas.semValor.length > 0
              ? `Sem valor na tabela da clínica — preencha antes de lançar: ${convertidas.semValor
                  .map((x) => `${x.paciente} (${x.convenioReal || "sem convênio"})`)
                  .join(", ")}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          convertidas.semValor.length > 0 ? "erro" : "ok"
        );
      }

      setMapa({ data, anestesista: "", linhas });
      setStatus("mapa");
    } catch (err) {
      console.error(err);
      setErrorMsg("Não consegui ler o mapa (" + (err.message || "erro") + ").");
      setStatus("idle");
    } finally {
      if (mapaInputRef.current) mapaInputRef.current.value = "";
    }
  }

  /** Este paciente, nesta data, com estes procedimentos, já está lançado? */
  function jaExiste(paciente, data, procedimentos) {
    const nome = normalizarTexto(paciente);
    if (!nome) return false;
    const chave = normalizarTexto((procedimentos || []).join(SEPARADOR_PROCEDIMENTOS));
    return entries.some(
      (e) =>
        normalizarTexto(e.paciente) === nome &&
        (e.dataCirurgia || "") === data &&
        normalizarTexto((e.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS)) === chave
    );
  }

  function atualizarLinha(indice, patch) {
    setMapa((m) => ({
      ...m,
      linhas: m.linhas.map((l, i) => (i === indice ? { ...l, ...patch } : l)),
    }));
  }

  /** Salva os pacientes marcados do mapa, todos de uma vez. */
  async function salvarMapa() {
    if (salvandoRef.current) return;

    const marcadas = mapa.linhas.filter((l) => l.incluido);
    if (marcadas.length === 0) {
      setErrorMsg("Nenhum paciente marcado.");
      return;
    }
    if (!(mapa.anestesista || "").trim()) {
      setErrorMsg("Informe o anestesiologista que fez os procedimentos.");
      return;
    }

    // Mesma regra do formulário, aplicada linha a linha: o mapa pode trazer
    // paciente sem procedimento legível, e lançar assim empurra o problema
    // para a conferência.
    const semProcedimento = marcadas.filter((l) => (l.procedimentos || []).filter(Boolean).length === 0);
    if (semProcedimento.length > 0) {
      setErrorMsg(
        `Preencha o procedimento de: ${semProcedimento.map((l) => l.paciente || "(sem nome)").join(", ")}.`
      );
      return;
    }

    const foraDeLugar = marcadas
      .map((l) => ({ paciente: l.paciente, achados: osSoComplementares(l.procedimentos) }))
      .filter((x) => x.achados.length > 0);
    if (foraDeLugar.length > 0) {
      setErrorMsg(
        `${foraDeLugar.map((x) => x.paciente || "(sem nome)").join(", ")}: ` +
          recadoDoSoComplementar(foraDeLugar[0].achados)
      );
      return;
    }
    if (!localAtivo) {
      setErrorMsg("Escolha o local antes de lançar o mapa.");
      return;
    }

    const anestesista = mapa.anestesista.toUpperCase();
    const registros = marcadas.map((l) => ({
      local: localAtivo,
      dataCirurgia: mapa.data,
      horaLancamento: l.hora || "",
      paciente: l.paciente,
      convenio: l.convenio || "",
      nGuia: l.nGuia || "",
      cirurgiao: l.cirurgiao || "",
      procedimentos: l.procedimentos.filter(Boolean),
      anestesista,
      // Quem fez é quem leva o crédito, quando é credenciado da Unimed.
      anestesistaCarimbo: ehDaUnimed(anestesista) ? anestesista : "",
      executado: padraoDe("executado"),
      pcExecutado: padraoDe("pcExecutado"),
      recebido: padraoDe("recebido"),
      // Os dois só vêm preenchidos no mapa da Vision, onde a conversão para
      // particular é que define o valor e guarda o convênio real.
      valor: l.valor === undefined || l.valor === null ? "" : l.valor,
      procedimentoComplementar: [],
      observacao: l.observacao || "",
    }));

    salvandoRef.current = true;
    setSalvando(true);
    try {
      const r = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registros }),
      });
      if (!r.ok) {
        setErrorMsg(`Não consegui salvar: ${await mensagemDeErro(r)}. A lista continua aqui.`);
        return;
      }
      const resposta = await r.json();
      await loadEntries();
      // O mapa também ensina: sem isto, o local que só lança por mapa nunca
      // teria os convênios e os cirurgiões dele no autocompletar. O local não
      // entra mais: é lista fechada, não cadastro.
      for (const linha of marcadas) {
        await aprenderCadastros({
          convenio: linha.convenio,
          cirurgiao: linha.cirurgiao,
          procedimentos: linha.procedimentos,
        });
      }

      const pulados = (resposta.duplicados || []).length;
      avisar(
        `${resposta.gravados} lançamento(s) do mapa.` +
          (pulados > 0 ? `\n${pulados} já estava(m) no app e foi(ram) pulado(s).` : "")
      );
      setMapa(null);
      setStatus("idle");
    } catch (err) {
      console.error(err);
      setErrorMsg("Não consegui salvar: o aparelho não falou com o servidor. A lista continua aqui.");
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErrorMsg("");
    setLendo("guia");
    setStatus("extracting");
    try {
      const base64 = await fileToResizedBase64(file);
      setImagePreview(`data:image/jpeg;base64,${base64}`);

      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      const respostaDaLeitura = await r.json();
      if (!r.ok) throw new Error(respostaDaLeitura.error || "Falha na extração");

      // A leitura não devolve mais data: nenhum dos documentos tem data
      // confiável para isto. A guia e a etiqueta trazem a data da solicitação
      // ou do atendimento, quase sempre anterior ao procedimento, e usá-las
      // jogava o lançamento para o mês errado. `data` ainda é desestruturada
      // para o caso de um aparelho continuar com a versão anterior do app em
      // cache: assim ela não se espalha no rascunho.
      const { data: _dataIgnorada, ...parsed } = respostaDaLeitura;

      // A guia às vezes chega sem o último dígito: completa já aqui, que é o
      // momento do "lançar a guia", e mostra o que aconteceu. Só na Unimed: o
      // dígito verificador é regra dela, e conferir a guia das outras
      // operadoras por essa régua reprovaria número bom.
      const guia = ehUnimed(parsed) ? analisarGuia(parsed.nGuia) : { estado: "vazia", numero: parsed.nGuia || "" };
      setGuiaInfo(guia.estado === "vazia" ? null : guia);
      // A caixa alta é aplicada aqui, e não só na gravação: a tela de
      // conferência tem de mostrar o texto como ele vai ficar na planilha.
      const emCaixa = Object.fromEntries(
        CAMPOS_DO_REGISTRO.filter((f) => f.maiusculo).map((f) => [
          f.key,
          (parsed[f.key] || "").toString().toUpperCase(),
        ])
      );
      setDraft({
        ...emptyDraft(),
        ...parsed,
        ...emCaixa,
        local: localAtivo,
        nGuia: guia.numero,
        procedimentos: paraLinhas(parsed.procedimentos),
      });
      setStatus("review");
    } catch (err) {
      console.error(err);
      setErrorMsg("Não consegui ler a guia automaticamente (" + (err.message || "erro") + "). Preencha manualmente abaixo.");
      setDraft(emptyDraft());
      setStatus("review");
    } finally {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  function updateDraft(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  /**
   * Escolher quem fez o procedimento já preenche o carimbo, quando essa pessoa
   * tem carimbo próprio — que é o caso da maioria dos lançamentos.
   *
   * Só preenche; não apaga. Quando quem fez não tem carimbo, o campo continua
   * como estava, porque aí o carimbo é mesmo de outra pessoa e é justamente o
   * que o anestesista precisa escolher.
   */
  function updateAnestesista(campo, valor) {
    const nome = campo.maiusculo ? valor.toUpperCase() : valor;
    setDraft((d) => {
      const proximo = { ...d, [campo.key]: nome };
      if (campo.key === "anestesista" && ehDaUnimed(nome)) proximo.anestesistaCarimbo = nome;
      return proximo;
    });
  }

  function updateProcedimento(indice, patch) {
    setDraft((d) => ({
      ...d,
      procedimentos: (d.procedimentos || []).map((l, i) => (i === indice ? { ...l, ...patch } : l)),
    }));
  }

  function addProcedimento() {
    setDraft((d) => ({ ...d, procedimentos: [...(d.procedimentos || []), { descricao: "", incluido: true }] }));
  }

  function removeProcedimento(indice) {
    setDraft((d) => ({ ...d, procedimentos: (d.procedimentos || []).filter((_, i) => i !== indice) }));
  }

  function toggleComplementar(item) {
    setDraft((d) => {
      const atual = d.procedimentoComplementar || [];
      const marcado = complementarMarcado(atual, item);
      if (marcado) return { ...d, procedimentoComplementar: atual.filter((s) => s !== marcado) };
      // Cobrado por hora nasce com 1: é o mínimo que faz sentido registrar.
      const novo = LIMITE_DE_HORAS[codigoDo(item)] ? `${item} — 1h` : item;
      return { ...d, procedimentoComplementar: [...atual, novo] };
    });
  }

  function definirHoras(item, horas) {
    setDraft((d) => {
      const atual = d.procedimentoComplementar || [];
      const marcado = complementarMarcado(atual, item);
      if (!marcado) return d;
      return {
        ...d,
        procedimentoComplementar: atual.map((s) => (s === marcado ? `${item} — ${horas}h` : s)),
      };
    });
  }

  // Falta procedimento, e já houve tentativa de salvar? É o que acende o
  // vermelho na seção — antes disso, campo vazio é só campo ainda não
  // preenchido.
  const faltaProcedimento = !!errorMsg && marcados(draft.procedimentos).length === 0;

  /**
   * O local lembrado, lido do aparelho na abertura.
   *
   * Só no aparelho (`localStorage`), e não no servidor: o lugar de hoje é de
   * quem está com o celular na mão, não da equipe. E nada de paciente entra
   * aqui — só nomes da lista fechada de `lib/locais.js`.
   */
  useEffect(() => {
    try {
      const ultimo = nomeDoLocal(window.localStorage.getItem(CHAVE_DO_LOCAL) || "");
      if (ultimo) {
        setLocalAtivo(ultimo);
        setLocalLembrado(true);
        const em = Number(window.localStorage.getItem(CHAVE_DO_LOCAL_EM));
        setLocalConfirmadoEm(Number.isFinite(em) && em > 0 ? em : null);
      }
      const recentes = JSON.parse(window.localStorage.getItem(CHAVE_DOS_RECENTES) || "[]");
      if (Array.isArray(recentes)) setLocaisRecentes(recentes.map(nomeDoLocal).filter(Boolean));
    } catch (e) {
      // Navegação privada ou armazenamento bloqueado: o app funciona igual,
      // só sem lembrar.
    }
  }, []);

  // O relógio que faz o aviso das 07:00 aparecer sem recarregar a página.
  useEffect(() => {
    const tocar = () => setRelogio((n) => n + 1);
    const intervalo = window.setInterval(tocar, 60 * 1000);
    document.addEventListener("visibilitychange", tocar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", tocar);
    };
  }, []);

  /**
   * O local lembrado vale até as 07:00 do dia seguinte. Escolhido ontem à
   * tarde, ele pede confirmação a partir das 07:00 de hoje: é a hora em que o
   * plantão troca e o lugar de ontem deixa de ser um palpite seguro. Até
   * confirmar ou trocar, os botões de lançamento esperam — barrar antes da
   * foto é mais barato do que descobrir o local errado na conferência.
   */
  const localPrecisaConfirmar = useMemo(() => {
    if (!localAtivo) return false;
    return !localConfirmadoEm || localConfirmadoEm < ultimoCorteDoLocal(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAtivo, localConfirmadoEm, relogio]);
  const podeLancar = !!localAtivo && !localPrecisaConfirmar;

  const faltaAceiteComplementar =
    !ehParticular(draft) && (draft.procedimentoComplementar || []).length > 0 && !aceiteComplementar;

  /**
   * A pergunta da analgesia, e o que ela passa a exigir.
   *
   * Só aparece fora do particular: na planilha particular não há coluna de
   * complementar — o bloco inteiro está escondido —, então perguntar ali seria
   * pedir uma resposta cuja única consequência não existe, e um "sim" travaria
   * o Salvar sem campo nenhum para destravá-lo.
   *
   * A resposta mostrada tolera o registro antigo: se a assistência JÁ está
   * marcada, o registro responde a pergunta por si, e a caixa abre com "Sim"
   * aceso em vez de em branco. A exigência, no entanto, olha só o que foi
   * clicado agora — quem clica "Sim" e desmarca a assistência continua barrado.
   */
  const perguntarAnalgesia = !ehParticular(draft) && temParto(marcados(draft.procedimentos));
  const respostaAnalgesia =
    analgesiaDeParto || (temAssistenciaAoParto(draft.procedimentoComplementar) ? "sim" : null);
  const faltaAssistenciaAoParto =
    perguntarAnalgesia &&
    analgesiaDeParto === "sim" &&
    !temAssistenciaAoParto(draft.procedimentoComplementar);
  // A pergunta é obrigatória: registro de parto não sai sem ela respondida.
  // Vale a resposta MOSTRADA, e não só a clicada.
  const faltaRespostaAnalgesia = perguntarAnalgesia && !respostaAnalgesia;

  // Mexeu nos complementares — marcou outro, desmarcou um —, o aceite volta
  // a valer nada: a guia que foi preenchida era para a lista de antes.
  const codigosComplementares = (draft.procedimentoComplementar || []).map(codigoDo).join("|");
  useEffect(() => {
    setAceiteComplementar(false);
  }, [codigosComplementares, status]);

  // Saiu o parto do principal — desmarcado, apagado, trocado —, a resposta
  // deixa de valer. Um "sim" esquecido travaria o Salvar de um registro que já
  // não é de parto, e nada na tela explicaria por quê.
  useEffect(() => {
    if (!perguntarAnalgesia) setAnalgesiaDeParto(null);
  }, [perguntarAnalgesia, status]);

  async function confirmEntry() {
    // A trava real é o ref: o estado do React só vale no próximo render, e um
    // toque duplo rápido dispararia dois envios antes disso. O `salvando` serve
    // para o visual do botão.
    if (salvandoRef.current) return;

    if (!(draft.local || "").trim()) {
      setErrorMsg("Escolha o local da cirurgia para salvar o registro.");
      return;
    }

    if (!(draft.anestesista || "").trim()) {
      setErrorMsg("Informe o anestesiologista que fez o procedimento para salvar o registro.");
      return;
    }

    // Procedimento é o que a planilha cobra: registro sem ele é uma linha que
    // não vira conta, e só se descobre na conferência, semanas depois.
    const procedimentos = marcados(draft.procedimentos);
    if (procedimentos.length === 0) {
      setErrorMsg(
        "Informe o procedimento para salvar o registro. Se ele veio da guia, confira se está marcado."
      );
      return;
    }

    // A assistência ao trabalho de parto, e outros cobrados à parte, não podem
    // ocupar o campo principal: recusar aqui é o que faz o parto de verdade ser
    // escrito, em vez de ficar sem registro nenhum.
    const foraDeLugar = osSoComplementares(procedimentos);
    if (foraDeLugar.length > 0) {
      setErrorMsg(recadoDoSoComplementar(foraDeLugar));
      return;
    }

    // A pergunta antes da consequência: sem resposta não há o que exigir, e
    // deixar passar em branco devolveria o esquecimento que a caixa veio
    // impedir.
    if (faltaRespostaAnalgesia) {
      setErrorMsg("Responda se houve analgesia para salvar o registro.");
      return;
    }

    // Respondeu "Sim" e a assistência não está marcada: é exatamente o
    // lançamento que a pergunta existe para evitar. Barrar aqui, e não só
    // pintar a caixa, é o que faz a hora ser cobrada.
    if (faltaAssistenciaAoParto) {
      setErrorMsg(
        "Houve analgesia: marque \"Assistência ao trabalho de parto\" em Procedimento " +
          "Complementar, com as horas."
      );
      return;
    }

    const payload = { ...draft, procedimentos };

    salvandoRef.current = true;
    setSalvando(true);
    // O formulário só pode fechar depois que o servidor confirmar a gravação:
    // fechá-lo antes apaga o que foi digitado e faz a falha parecer sucesso.
    let salvou = false;
    try {
      let r;
      if (editingId) {
        r = await fetch("/api/entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editingId }),
        });
      } else {
        r = await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // 409: já existe esse paciente, nesse dia, com esses procedimentos.
        if (r.status === 409) {
          const { existente } = await r.json();
          const quando = existente.criadoEm ? ` (lançado às ${horaDoRegistro(existente)})` : "";
          const oQue = (existente.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS) || "(sem procedimento)";
          const segue = window.confirm(
            `Já existe um registro de ${existente.paciente} nesta data com "${oQue}"${quando}.\n\n` +
              `Lançar mesmo assim?`
          );
          if (!segue) return; // o finally libera o botão e o formulário continua aberto

          r = await fetch("/api/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, confirmarDuplicado: true }),
          });
        }
      }
      if (!r.ok) {
        setErrorMsg(
          `Não consegui salvar: ${await mensagemDeErro(r)}. ` +
            `O que você preencheu continua aqui — tente de novo.`
        );
        return;
      }

      salvou = true;
      await loadEntries();
      await aprenderCadastros(payload);
    } catch (e) {
      console.error(e);
      setErrorMsg(
        "Não consegui salvar: o aparelho não conseguiu falar com o servidor. " +
          "O que você preencheu continua aqui — tente de novo."
      );
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
    if (!salvou) return;
    setEditingId(null);
    cancelReview();
  }

  function cancelReview() {
    setStatus("idle");
    setDraft(emptyDraft());
    setImagePreview(null);
    setErrorMsg("");
    setGuiaInfo(null);
  }

  function startManual() {
    setErrorMsg("");
    setDraft({ ...emptyDraft(), local: localAtivo });
    setImagePreview(null);
    setEditingId(null);
    setGuiaInfo(null);
    setStatus("review");
  }

  function startEdit(entry) {
    setDraft({
      ...emptyDraft(),
      ...entry,
      horaLancamento: horaDoRegistro(entry),
      procedimentos: paraLinhas(entry.procedimentos),
    });
    setEditingId(entry.id);
    setImagePreview(null);
    // Mostra logo de cara se a guia já gravada tem algum problema — de novo,
    // só na Unimed.
    const g = ehUnimed(entry) ? analisarGuia(entry.nGuia) : { estado: "vazia" };
    setGuiaInfo(g.estado === "vazia" ? null : g);
    setStatus("review");
  }

  /**
   * Abre um registro novo com os dados deste.
   *
   * Serve ao caso comum de dois lançamentos quase iguais — o mesmo paciente com
   * um segundo procedimento, ou a mesma dupla de cirurgião e anestesiologista no
   * paciente seguinte. Redigitar tudo é onde nasce a divergência de grafia entre
   * duas linhas que deveriam combinar.
   *
   * Vem sem `id` e com `editingId` nulo, senão salvar sobrescreveria o original
   * em vez de criar o segundo. A hora do lançamento é a de agora: o registro
   * está nascendo neste momento, e a data da cirurgia é que se repete.
   */
  function duplicarEntry(entry) {
    // `conferido` fica de fora: a cópia é um lançamento novo, e ninguém
    // conferiu ainda.
    const { id, criadoEm, conferido, ...dados } = entry;
    setDraft({
      ...emptyDraft(),
      ...dados,
      horaLancamento: agoraLocal().hora,
      procedimentos: paraLinhas(entry.procedimentos),
      // Onde a cópia entra na ordem: logo depois do registro que ela copiou,
      // na planilha e na lista. Sem isto ela ia para o fim do dia, longe do
      // original, e os dois lançamentos que nasceram juntos ficavam separados
      // por todos os pacientes lançados entre um e outro.
      //
      // Guarda a chave do original, e não o `criadoEm` dele: copiar uma cópia
      // entra no mesmo grupo, atrás da primeira, em vez de abrir outro.
      ordenarApos: chaveDeOrdem(entry),
    });
    setEditingId(null);
    setImagePreview(null);
    const g = ehUnimed(entry) ? analisarGuia(entry.nGuia) : { estado: "vazia" };
    setGuiaInfo(g.estado === "vazia" ? null : g);
    setStatus("review");
  }

  async function deleteEntry(id) {
    try {
      const r = await fetch(`/api/entries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await mensagemDeErro(r));
    } catch (e) {
      console.error(e);
      avisar("Não consegui apagar o registro. Ele continua lá; tente de novo.", "erro");
    }
    await loadEntries();
  }

  /**
   * Grava um campo só, direto da lista, sem abrir o registro.
   *
   * A tela muda na hora, para o toque parecer instantâneo; se a gravação
   * falhar, o estado anterior volta. Verde aceso sem ter gravado é pior do que
   * não ter mudado nada.
   */
  async function updateCampo(entry, campo, value, oQueE) {
    const updated = { ...entry, [campo]: value };
    setEntries((prev) => prev.map((x) => (x.id === entry.id ? updated : x)));
    try {
      const r = await fetch("/api/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!r.ok) throw new Error(await mensagemDeErro(r));
    } catch (e) {
      console.error(e);
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? entry : x)));
      avisar(`Não consegui salvar ${oQueE}. Tente de novo.`, "erro");
    }
  }

  const updateExecutado = (entry, value) => updateCampo(entry, "executado", value, "o executado");
  const updateConferido = (entry, value) => updateCampo(entry, "conferido", value, "a conferência");

  /**
   * Traz sozinho o que mudou na planilha, ao abrir a aba Procedimentos.
   *
   * Só a leitura: nada é reescrito, então são poucas chamadas ao Google e dá
   * para rodar de novo sem pensar. No máximo uma vez a cada cinco minutos por
   * aparelho — abrir e fechar a aba dez vezes seguidas não vira dez leituras.
   *
   * Falha em silêncio de propósito: é um extra, e quem depende de ver o
   * resultado aperta o botão de sincronizar. O que NÃO fica em silêncio é a
   * recusa — se a
   * planilha trouxe uma correção que o app não pôde aceitar, alguém precisa
   * saber, senão a pessoa que corrigiu a célula acha que valeu.
   */
  const ultimaLeve = useRef(0);

  async function sincronizacaoLeve() {
    if (sincronizando) return;
    if (Date.now() - ultimaLeve.current < 5 * 60 * 1000) return;
    ultimaLeve.current = Date.now();

    try {
      const r = await fetch("/api/sync-sheets?leve=1", { method: "POST" });
      if (!r.ok) return;
      const data = await r.json();
      if (data.configurado === false) return;

      if ((data.importadosDaPlanilha || []).length > 0) await loadEntries();

      const recusadas = data.recusadas || [];
      if (recusadas.length > 0) {
        avisar(
          "A planilha tem correções que eu não consegui aceitar:\n" +
            recusadas.map((x) => `· ${x.paciente || "(sem nome)"} — ${x.coluna}: ${x.motivo}`).join("\n"),
          "erro"
        );
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (activeTab === "procedimentos" && loaded) sincronizacaoLeve();
    // `loaded` entra na conta para a primeira leitura não disputar com a carga
    // inicial dos registros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loaded]);

  async function sincronizarPlanilha() {
    setSincronizando(true);
    try {
      const r = await fetch("/api/sync-sheets", { method: "POST" });
      const data = await r.json();
      await loadEntries();

      const vindos = data.importadosDaPlanilha || [];
      const novos = vindos.filter((m) => m.tipo === "novo").length;
      const alterados = vindos.length - novos;

      const trouxe = [];
      if (alterados > 0) trouxe.push(`${alterados} registro(s) alterado(s) na planilha`);
      if (novos > 0) trouxe.push(`${novos} lançamento(s) digitado(s) na planilha`);

      // Só aparece quando houve o que aprender — e é o que avisa que a primeira
      // sincronização encheu o autocompletar de procedimentos de uma vez.
      const aprendidos = data.procedimentosAprendidos || 0;
      const cadastrou = aprendidos > 0 ? `\n\n${aprendidos} procedimento(s) entraram no autocompletar.` : "";

      // O que a planilha mudou e o app não pôde aceitar precisa aparecer: em
      // silêncio, a pessoa acharia que a correção dela valeu.
      const recusadas = data.recusadas || [];
      const pendencias = recusadas.length
        ? "\n\nNão consegui aceitar:\n" +
          recusadas.map((x) => `· ${x.paciente || "(sem nome)"} — ${x.coluna}: ${x.motivo}`).join("\n")
        : "";

      // A sincronização acabou de trazer tudo: o relógio da leve recomeça daqui.
      ultimaLeve.current = Date.now();

      if (data.configurado === false) {
        avisar("A planilha do Google ainda não está configurada.", "erro");
      } else if (!data.ok) {
        avisar("Sincronizado com pendências:\n" + JSON.stringify(data.falhas || {}, null, 2), "erro");
      } else if (trouxe.length > 0) {
        avisar(`Planilha sincronizada. Trouxe ${trouxe.join(" e ")}.${cadastrou}${pendencias}`);
      } else {
        avisar(`Planilha sincronizada. Nada novo vindo dela.${cadastrou}${pendencias}`);
      }
    } catch (e) {
      console.error(e);
      avisar("Não consegui sincronizar com a planilha agora.", "erro");
    } finally {
      setSincronizando(false);
    }
  }

  // A busca tem prioridade sobre o mês: procurar um paciente de julho com
  // agosto selecionado precisa achar, senão parece que o registro sumiu.
  const buscando = normalizarTexto(searchQuery).length > 0;
  // O aviso da guia só aparece enquanto o convênio for Unimed. Sem isto, quem
  // conferisse a guia e depois trocasse o convênio ficaria com um aviso preso
  // na tela, falando de uma regra que não vale para o convênio novo.
  const avisoDaGuia = ehUnimed(draft) ? guiaInfo : null;

  // Os locais que aparecem nos registros, para o filtro da lista não oferecer
  // clínica onde nunca se lançou nada.
  const locaisComRegistro = [...new Set(entries.map((e) => (e.local || "").trim()).filter(Boolean))].sort();

  // Os convênios que aparecem nos registros — inclusive "PARTICULAR", que é
  // convênio nenhum mas se escolhe do mesmo jeito. Sai dos registros, e não do
  // cadastro: o cadastro tem os que já foram digitados alguma vez, e oferecer
  // no filtro um convênio sem nenhum paciente só dá lista vazia.
  const conveniosComRegistro = [
    ...new Set(entries.map((e) => (e.convenio || "").trim()).filter(Boolean)),
  ].sort();

  // O dia de hoje, pela hora do aparelho. Recalculado a cada render: quem
  // atravessa a meia-noite com o app aberto vê o "Hoje" virar no próximo toque,
  // e não fica preso no dia anterior.
  const hoje = agoraLocal().data;
  // A contagem do chip ignora os filtros de local e convênio, igual à dos
  // chips de mês: é quantos há no dia, não quantos sobraram na tela.
  const totalDeHoje = entries.filter((e) => (e.dataCirurgia || "") === hoje).length;

  const registrosVisiveis = entries
    .filter((e) => localFiltro === TODOS_OS_LOCAIS || (e.local || "").trim() === localFiltro)
    .filter((e) => convenioFiltro === TODOS_OS_CONVENIOS || (e.convenio || "").trim() === convenioFiltro)
    .filter((e) => entryMatchesSearch(e, searchQuery))
    .filter((e) => {
      if (buscando || mesSelecionado === TODOS_OS_MESES || !mesSelecionado) return true;
      if (mesSelecionado === SO_HOJE) return (e.dataCirurgia || "") === hoje;
      return chaveDoMes(e) === mesSelecionado;
    })
    .sort(ordenarRegistros);

  const resumo = {
    total: registrosVisiveis.length,
    executados: registrosVisiveis.filter((e) => foiExecutada(e.executado)).length,
  };

  /**
   * Baixa um arquivo por ano, com um mês por aba.
   *
   * Um arquivo por planilha do Google: Unimed, outros convênios e particular.
   * São três conferências diferentes, feitas com gente diferente, e as colunas
   * nem são as mesmas.
   */
  function exportExcel() {
    if (entries.length === 0) return;

    const doModelo = (modelo) => entries.filter((e) => modeloDoRegistro(e) === modelo);

    baixarAno(doModelo("convenio"), COLUNAS_UNIMED, PREFIXO_ARQUIVO);
    baixarAno(doModelo("outros"), COLUNAS_OUTROS, `${PREFIXO_ARQUIVO}-outros-convenios`);
    baixarAno(doModelo("particular"), COLUNAS_PARTICULAR, `${PREFIXO_ARQUIVO}-particular`);
  }

  function baixarAno(registros, colunas, prefixo) {
    if (registros.length === 0) return;

    // O Executado abre a linha, como na planilha do Google; o resto sai da
    // lista de colunas daquele modelo, para os dois arquivos combinarem.
    const todas = [COLUNA_EXECUTADO, ...colunas];
    const headers = todas.map((c) => c.label);
    const toRow = (e) => todas.map((c) => valorDaColuna(e, c));

    // Agrupa por ano e, dentro do ano, por mês (1-12). Sem data cai em "Sem data".
    const porAno = {};
    registros.forEach((e) => {
      const [ano, mes] = (e.dataCirurgia || "").split("-");
      const chaveAno = ano || "sem-data";
      const chaveMes = mes ? parseInt(mes, 10) : 0;
      porAno[chaveAno] = porAno[chaveAno] || {};
      porAno[chaveAno][chaveMes] = porAno[chaveAno][chaveMes] || [];
      porAno[chaveAno][chaveMes].push(e);
    });

    Object.keys(porAno)
      .sort()
      .forEach((ano) => {
        const wb = XLSX.utils.book_new();
        Object.keys(porAno[ano])
          .map(Number)
          .sort((a, b) => a - b)
          .forEach((mes) => {
            const doMes = porAno[ano][mes]
              .slice()
              .sort((a, b) => (a.dataCirurgia || "").localeCompare(b.dataCirurgia || ""));
            const ws = XLSX.utils.aoa_to_sheet([headers, ...doMes.map(toRow)]);
            ws["!cols"] = headers.map(() => ({ wch: 20 }));
            const nomeAba = mes === 0 ? "Sem data" : MESES[mes - 1].replace(/^./, (c) => c.toUpperCase());
            XLSX.utils.book_append_sheet(wb, ws, nomeAba);
          });
        XLSX.writeFile(wb, `${prefixo}-${ano}.xlsx`);
      });
  }

  return (
    <div style={{ minHeight: "100vh", background: CORES.fundo, color: CORES.tinta, paddingBottom: `calc(${ALTURA_DA_BARRA + ESPACO[4]}px + env(safe-area-inset-bottom))` }}>
      {/* A atualização em segundo plano, na volta ao app.

          Três pixels no topo, e nada mais: a lista continua na tela e
          utilizável enquanto chega a versão nova dela. Um giro no meio da tela
          ou uma tela de carregamento transformariam cada troca de app — e num
          plantão são dezenas — numa espera. */}
      {atualizando && !recarregando && (
        <div
          className="fita-de-atualizacao"
          role="status"
          aria-label="Atualizando"
          style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 60, overflow: "hidden", background: "rgba(255,255,255,0.18)" }}
        >
          <div style={{ height: "100%", width: "40%", background: `linear-gradient(90deg, ${CORES.principal}, ${CORES.acento})` }} />
        </div>
      )}

      {/* Recarregando de propósito: aqui a espera existe mesmo, e esconder
          isso faria o app parecer travado no instante em que some. */}
      {recarregando && (
        <div
          role="status"
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: CORES.escura,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ESPACO[4],
          }}
        >
          <img src="/logo-mark.png" alt="" style={{ height: 56, width: "auto", objectFit: "contain" }} />
          <div style={{ color: CORES.sobreEscura, fontSize: TEXTO.corpo }}>Atualizando o app…</div>
          <div className="fita-de-atualizacao" style={{ width: 180, height: 3, borderRadius: 2, overflow: "hidden", background: "rgba(255,255,255,0.18)" }}>
            <div style={{ height: "100%", width: "40%", background: `linear-gradient(90deg, ${CORES.principal}, ${CORES.acento})` }} />
          </div>
        </div>
      )}

      <div style={{ background: CORES.escura, padding: "20px 20px 24px", position: "relative" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${CORES.principal}, ${CORES.acento})` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo-mark.png" alt={EQUIPE} style={{ height: 40, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.15em", color: CORES.acento, textTransform: "uppercase", marginBottom: 4 }}>
              {EQUIPE}
            </div>
            {/* O corpo acompanha a largura da tela: com o botão da conta ao
                lado, 26px fixos quebravam "Controle de Cirurgias" em duas
                linhas num iPhone estreito, e o cabeçalho crescia junto. */}
            <h1 style={{ margin: 0, fontSize: "clamp(20px, 6vw, 26px)", fontWeight: 400, color: CORES.sobreEscura, whiteSpace: "nowrap" }}>
              {TITULO}
            </h1>
            <div style={{ fontSize: TEXTO.apoio, color: CORES.acento, marginTop: 4 }}>
              {loaded ? `${entries.length} registro${entries.length === 1 ? "" : "s"} · compartilhado` : "carregando…"}
            </div>
          </div>

          {/* Quem está logado, e por onde se sai.
              
              No cabeçalho porque vale nas três abas: antes isso morava só no
              fim dos Cadastros, e quem quisesse sair tinha de ir procurar. As
              iniciais, e não um ícone genérico, porque num aparelho
              compartilhado a primeira pergunta é "estou logado como quem?". */}
          <button
            type="button"
            onClick={() => setMenuDoAcesso((v) => !v)}
            // O texto do botão são as iniciais, que não dizem nada a quem usa
            // leitor de tela — daí o rótulo explícito.
            aria-label="Sua conta"
            title="Sua conta"
            style={{
              width: ALVO,
              height: ALVO,
              flexShrink: 0,
              borderRadius: "50%",
              background: menuDoAcesso ? CORES.acento : "transparent",
              color: menuDoAcesso ? CORES.escura : CORES.acento,
              border: `1px solid ${CORES.acento}`,
              fontSize: TEXTO.apoio,
              fontWeight: 700,
              letterSpacing: "0.03em",
              cursor: "pointer",
            }}
          >
            {iniciaisDe(acesso) || <Icone nome="pessoas" tamanho={18} />}
          </button>
        </div>
      </div>

      {menuDoAcesso && (
        <>
          {/* A camada que fecha o menu ao tocar fora. Sem ela, no celular só o
              próprio botão fecharia, e o menu ficaria preso na tela. */}
          <div
            onClick={() => setMenuDoAcesso(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              right: 16,
              zIndex: 41,
              marginTop: -8,
              width: 272,
              maxWidth: "calc(100vw - 32px)",
              background: "white",
              border: `1px solid ${CORES.borda}`,
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(26,26,26,0.18)",
              padding: ESPACO[4],
            }}
          >
            <MeuAcesso eu={acesso} avisar={avisar} aoTerminar={() => setMenuDoAcesso(false)} />
          </div>
        </>
      )}

      {/* Saiu versão nova, mas há coisa não salva na tela — ou recarregar já
          foi tentado e não resolveu. Nos dois casos quem decide é a pessoa:
          perder uma guia lida para ganhar a versão nova não é troca que o app
          possa fazer sozinho. */}
      {versaoNova && !recarregando && (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 0" }}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: ESPACO[3], flexWrap: "wrap",
              padding: "10px 12px", borderRadius: 10,
              background: CORES.clara, border: `1px solid ${CORES.borda}`,
              fontSize: TEXTO.apoio,
            }}
          >
            <Icone nome="atualizar" tamanho={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 140 }}>Há uma versão nova do app.</span>
            <button
              type="button"
              onClick={() => {
                setRecarregando(true);
                setTimeout(() => window.location.reload(), 400);
              }}
              style={{ ...btnPrimary, padding: "8px 14px", fontSize: TEXTO.apoio, minHeight: 0 }}
            >
              Atualizar agora
            </button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
        {/* Sem isto, "não carregou" e "não há nada" ficam iguais na tela. */}
        {falhaDeCarga && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              border: `1px solid ${CORES.alerta}`,
              background: CORES.alertaFundo,
              color: CORES.alerta,
              borderRadius: 8,
              fontSize: TEXTO.apoio,
            }}
          >
            <Icone nome="alerta" style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Não consegui carregar os registros ({falhaDeCarga}). A lista abaixo
            não reflete o que está gravado — confira antes de lançar.
          </div>
        )}

        {status === "idle" && activeTab === "novo" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {/* O local vem antes dos botões porque é a primeira decisão: o que
                se fotografa num lugar não vale no outro. Um campo que mostra o
                escolhido, e não um <select>: os nomes são longos, a lista
                cresceu, e a folha que sobe tem busca e os usados há pouco. */}
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="inicio-rotulo" id="rotulo-local">Local</span>
              <SeletorDeLocal
                local={localAtivo}
                lembrado={localLembrado}
                precisaConfirmar={localPrecisaConfirmar}
                aoConfirmar={marcarLocalConfirmado}
                recentes={locaisRecentes}
                aoEscolher={escolherLocal}
              />
            </section>

            {/* O recado de recusa, aqui na tela inicial.

                `errorMsg` só tinha lugar dentro do cartão do mapa e do
                formulário — telas que só existem DEPOIS de a leitura dar
                certo. Um arquivo recusado antes disso (um PDF grande demais)
                punha a mensagem num estado que não aparece, e o toque no botão
                virava silêncio: pior do que um erro do servidor, porque não
                diz nem que houve recusa. */}
            {status === "idle" && errorMsg && (
              <div style={{ padding: "12px 14px", borderRadius: 12, fontSize: TEXTO.apoio, color: CORES.avisoTinta, background: CORES.avisoFundo }}>
                {errorMsg}
              </div>
            )}

            {/* O recado de recusa, aqui na tela inicial.

                `errorMsg` só tinha lugar dentro do cartão do mapa e do
                formulário — telas que só existem DEPOIS de a leitura dar
                certo. Um arquivo recusado antes disso (um PDF grande demais)
                punha a mensagem num estado que não aparece, e o toque no botão
                virava silêncio. */}
            {status === "idle" && errorMsg && (
              <div style={{ padding: "12px 14px", borderRadius: 12, fontSize: TEXTO.apoio, color: CORES.avisoTinta, background: CORES.avisoFundo }}>
                {errorMsg}
              </div>
            )}

            {/* Um primário só, grande e escuro, e três discretos lado a lado:
                fotografar a guia é o caminho de quase todo lançamento.

                Sem local escolhido, os quatro esperam — desabilitados, e não
                só apagados. Barrar aqui é melhor do que deixar fotografar e
                recusar na hora de salvar: a leitura custa uma chamada ao modelo
                e a paciência de quem está no centro cirúrgico. */}
            <section className={`inicio-acoes${podeLancar ? "" : " sem-local"}`} aria-disabled={!podeLancar}>
              <button
                type="button"
                className="inicio-foto"
                onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                disabled={!podeLancar}
              >
                <span className="inicio-foto-icone">
                  <Icone nome="camera" tamanho={28} />
                </span>
                <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0 }}>Fotografar guia ou etiqueta</span>
              </button>

              <div className="inicio-blocos">
                <button
                  type="button"
                  className="inicio-bloco"
                  onClick={() => galleryInputRef.current && galleryInputRef.current.click()}
                  disabled={!podeLancar}
                >
                  <span className="inicio-bloco-icone"><Icone nome="galeria" /></span>
                  Da galeria
                </button>
                <button
                  type="button"
                  className="inicio-bloco"
                  onClick={() => mapaInputRef.current && mapaInputRef.current.click()}
                  disabled={!podeLancar}
                >
                  <span className="inicio-bloco-icone"><Icone nome="mapa" /></span>
                  Mapa cirúrgico
                </button>
                <button type="button" className="inicio-bloco" onClick={startManual} disabled={!podeLancar}>
                  <span className="inicio-bloco-icone"><Icone nome="lapis" /></span>
                  Manual
                </button>
              </div>
            </section>

            <HojeNaInicio
              registros={entries.filter((e) => (e.dataCirurgia || "") === hoje && lancadoPor(e, acesso))}
              carregado={loaded}
              aoAbrir={(id) => {
                // Os filtros da lista são limpos antes: o lançamento de hoje
                // tem de aparecer lá, e um filtro de outro convênio, esquecido
                // de ontem, o esconderia.
                setLocalFiltro(TODOS_OS_LOCAIS);
                setConvenioFiltro(TODOS_OS_CONVENIOS);
                setSearchQuery("");
                setMesSelecionado(SO_HOJE);
                setExpandido(id || null);
                setActiveTab("procedimentos");
              }}
            />
          </div>
        )}

        {status === "extracting" && (
          <div style={{ padding: 24, borderRadius: 8, border: `1px solid ${CORES.principal}`, background: CORES.clara, textAlign: "center", fontSize: TEXTO.apoio }}>
            {lendo === "guia" ? "Lendo a guia…" : "Lendo o mapa cirúrgico…"}
            {/* Um PDF de várias páginas leva bem mais tempo que uma foto. Sem
                dizer isso, a espera parece travamento e o dedo volta ao botão
                — o que recomeça a leitura e paga duas vezes. */}
            {lendo === "mapa-pdf" && (
              <div style={{ marginTop: 6, fontSize: TEXTO.apoio, color: CORES.suave }}>
                Em PDF demora mais que em foto. Pode deixar aberto.
              </div>
            )}
          </div>
        )}

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <input ref={mapaInputRef} type="file" accept={TIPOS_DO_MAPA} onChange={handleMapa} style={{ display: "none" }} />

        {status === "mapa" && mapa && (
          <div style={{ border: `1px solid ${CORES.borda}`, borderRadius: 8, background: "white", overflow: "hidden" }}>
            <div style={{ background: CORES.clara, padding: "12px 16px", borderBottom: `1px solid ${CORES.borda}`, fontSize: TEXTO.apoio, fontWeight: 600 }}>
              Mapa de {localAtivo} — {mapa.linhas.length} paciente(s)
            </div>

            {errorMsg && (
              <div style={{ padding: "12px 16px", fontSize: TEXTO.apoio, color: CORES.avisoTinta, background: CORES.avisoFundo, borderBottom: `1px solid ${CORES.borda}` }}>
                {errorMsg}
              </div>
            )}

            {/* Data e anestesista valem para o mapa inteiro: é um dia, um
                plantão, e perguntar paciente a paciente seria repetir a mesma
                resposta dez vezes. */}
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, borderBottom: `1px solid ${CORES.bordaSuave}` }}>
              <Field label="Data do mapa">
                <input
                  style={inputStyle}
                  type="date"
                  value={mapa.data || ""}
                  onChange={(ev) => setMapa((m) => ({ ...m, data: ev.target.value }))}
                />
              </Field>
              <Field label="Anestesiologista que fez os procedimentos *">
                <AutocompleteInput
                  value={mapa.anestesista || ""}
                  onChange={(v) => setMapa((m) => ({ ...m, anestesista: v.toUpperCase() }))}
                  options={cadastros.anestesistas || []}
                  placeholder="Anestesiologista"
                  invalid={!!errorMsg && !(mapa.anestesista || "").trim()}
                />
              </Field>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {mapa.linhas.map((l, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 16px",
                    borderBottom: `1px solid ${CORES.bordaSuave}`,
                    background: l.incluido ? "white" : CORES.fundo,
                    opacity: l.incluido ? 1 : 0.6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!l.incluido}
                      onChange={(ev) => atualizarLinha(i, { incluido: ev.target.checked })}
                      style={{ width: 18, height: 18, flexShrink: 0 }}
                    />
                    <input
                      style={{ ...inputStyle, fontSize: TEXTO.apoio }}
                      type="text"
                      value={l.paciente}
                      onChange={(ev) => atualizarLinha(i, { paciente: ev.target.value.toUpperCase() })}
                    />
                  </div>
                  <div style={{ paddingLeft: 28, marginTop: 4 }}>
                    <input
                      style={{ ...inputStyle, fontSize: TEXTO.apoio }}
                      type="text"
                      value={(l.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS)}
                      onChange={(ev) =>
                        atualizarLinha(i, {
                          procedimentos: ev.target.value
                            .split(SEPARADOR_PROCEDIMENTOS)
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Procedimento"
                    />
                    <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginTop: 4 }}>
                      {[
                        l.hora,
                        // Na Vision o convênio do mapa virou PARTICULAR: a
                        // linha mostra os dois, senão a conversão acontece sem
                        // ninguém ver o que foi convertido.
                        l.convenioReal !== undefined
                          ? `PARTICULAR${l.convenioReal ? ` (${l.convenioReal})` : ""}`
                          : l.convenio,
                        l.cirurgiao ? `Dr(a). ${l.cirurgiao}` : "",
                        l.nGuia ? `Guia ${l.nGuia}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {l.jaLancado && (
                        <span style={{ color: CORES.alerta, fontWeight: 600 }}> · já lançado</span>
                      )}
                    </div>

                    {/* O valor, só no mapa da Vision. Editável na própria
                        linha porque é aqui que se descobre que faltou um: ir
                        atrás do registro depois de salvo é o caminho em que a
                        correção não acontece. */}
                    {l.convenioReal !== undefined && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <span style={{ fontSize: TEXTO.miudo, color: CORES.suave, flexShrink: 0 }}>R$</span>
                        <input
                          style={{
                            ...inputStyle,
                            fontSize: TEXTO.apoio,
                            maxWidth: 120,
                            borderColor: l.valor === "" ? CORES.alerta : CORES.borda,
                          }}
                          type="text"
                          inputMode="decimal"
                          value={l.valor === "" || l.valor == null ? "" : String(l.valor).replace(".", ",")}
                          onChange={(ev) => atualizarLinha(i, { valor: numeroDigitado(ev.target.value) })}
                          placeholder="0,00"
                        />
                        {l.valor === "" && (
                          <span style={{ fontSize: TEXTO.miudo, color: CORES.alerta, fontWeight: 600 }}>
                            sem valor na tabela
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, padding: 16 }}>
              <button
                onClick={() => {
                  setMapa(null);
                  setErrorMsg("");
                  setStatus("idle");
                }}
                disabled={salvando}
                style={{ ...btnSecondary, flex: 1, opacity: salvando ? 0.5 : 1 }}
              >
                Cancelar
              </button>
              <button
                onClick={salvarMapa}
                disabled={salvando}
                style={{ ...btnPrimary, flex: 2, opacity: salvando ? 0.6 : 1 }}
              >
                {salvando ? (
                  "Salvando…"
                ) : (
                  <>
                    <Icone nome="check" /> Adicionar {mapa.linhas.filter((l) => l.incluido).length} registro(s)
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {status === "review" && (
          <div style={{ border: `1px solid ${CORES.borda}`, borderRadius: 8, background: "white", overflow: "hidden" }}>
            <div style={{ background: CORES.clara, padding: "12px 16px", borderBottom: `1px solid ${CORES.borda}`, fontSize: TEXTO.apoio, fontWeight: 600 }}>
              {editingId ? "Editar registro" : imagePreview ? "Confira os dados lidos da guia" : "Novo registro manual"}
            </div>

            {errorMsg && (
              <div style={{ padding: "12px 16px", fontSize: TEXTO.apoio, color: CORES.avisoTinta, background: CORES.avisoFundo, borderBottom: `1px solid ${CORES.borda}` }}>
                {errorMsg}
              </div>
            )}

            {imagePreview && (
              <img src={imagePreview} alt="Guia fotografada" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block", borderBottom: `1px solid ${CORES.borda}` }} />
            )}

            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Data e hora vêm preenchidas e continuam editáveis: a planilha é
                  dividida por mês, e um plantão do dia 31 lançado no dia 1º
                  cairia no mês errado. */}
              {/* Cada uma na sua linha, ocupando a largura toda.
                  Dividir a linha entre as duas não funciona: quem desenha o
                  campo de data é o sistema, e o iPhone escreve por extenso —
                  "2 de set. de 2026" em vez de "02/09/2026". A largura
                  necessária depende do idioma do aparelho e do formato de hora
                  (o "AM/PM" ainda alarga a hora), então não há fatia que sirva
                  sempre: numa fatia curta o controle nativo vaza para fora do
                  cartão em vez de se ajustar. Com a linha inteira à disposição,
                  sobra espaço para qualquer formato. */}
              <Field label="Data do lançamento">
                <input style={inputStyle} type="date" value={draft.dataCirurgia || ""} onChange={(e) => updateDraft("dataCirurgia", e.target.value)} />
              </Field>
              <Field label="Hora">
                <input style={inputStyle} type="time" value={draft.horaLancamento || ""} onChange={(e) => updateDraft("horaLancamento", e.target.value)} />
              </Field>

              {CAMPOS_DO_REGISTRO.map((f) => {
                // Início e término só existem na cirurgia particular, que é a
                // cobrada por tempo. Aparecem e somem conforme o convênio, e o
                // que já tiver sido digitado fica guardado no registro caso o
                // convênio volte a ser particular.
                if (!cabeNesteRegistro(f, draft)) return null;

                // Lista fechada: o local sai dela, e digitar não é opção.
                if (f.opcoes) {
                  const vazio = !(draft[f.key] || "").trim();
                  const reprovado = f.required && !!errorMsg && vazio;
                  return (
                    <Field key={f.key} label={f.required ? `${f.appLabel || f.label} *` : f.appLabel || f.label}>
                      <select
                        style={
                          reprovado
                            ? { ...inputStyle, border: `1px solid ${CORES.alerta}`, background: CORES.alertaFundo }
                            : inputStyle
                        }
                        value={draft[f.key] || ""}
                        onChange={(e) => updateDraft(f.key, e.target.value)}
                      >
                        <option value="">— Escolha —</option>
                        {f.opcoes.map((opcao) => (
                          <option key={opcao} value={opcao}>
                            {opcao}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                }

                // Escolha entre poucas opções: os mesmos botões do Executado.
                if (f.escolha) {
                  return (
                    <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>
                        {f.appLabel || f.label}
                      </span>
                      <Escolha
                        campo={f.escolha}
                        valor={draft[f.key]}
                        onEscolher={(v) => updateDraft(f.key, v)}
                        grande
                      />
                    </div>
                  );
                }

                // Dinheiro: teclado numérico e vírgula aceita, porque é como se
                // digita no Brasil. O registro guarda número.
                if (f.moeda) {
                  return (
                    <Field key={f.key} label={f.appLabel || f.label}>
                      <input
                        style={inputStyle}
                        type="text"
                        inputMode="decimal"
                        value={draft[f.key] === "" || draft[f.key] == null ? "" : String(draft[f.key]).replace(".", ",")}
                        onChange={(e) => updateDraft(f.key, numeroDigitado(e.target.value))}
                        placeholder="0,00"
                      />
                    </Field>
                  );
                }

                if (f.hora) {
                  // A duração aparece embaixo do término e recalcula a cada
                  // tecla: é ela que denuncia um horário trocado agora, e não
                  // depois, quando o registro já virou cobrança.
                  const duracao = f.key === "termino" ? duracaoEntre(draft.inicio, draft.termino) : "";
                  return (
                    <div key={f.key}>
                      <Field label={f.appLabel || f.label}>
                        <input
                          style={inputStyle}
                          type="time"
                          value={draft[f.key] || ""}
                          onChange={(e) => updateDraft(f.key, e.target.value)}
                        />
                      </Field>
                      {duracao && (
                        <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginTop: 4 }}>
                          Duração: {duracao}
                        </div>
                      )}
                    </div>
                  );
                }

                // Campo com cadastro atrás vira autocompletar. O cirurgião vem
                // lido da guia e mesmo assim mantém o dele: é assim que se
                // corrige leitura ruim e se padroniza a grafia do nome. O
                // convênio é digitado, e o que se digita hoje entra na lista
                // para o lançamento de amanhã.
                if (f.cadastroKey) {
                  return (
                    <Field key={f.key} label={f.appLabel || f.label}>
                      <AutocompleteInput
                        value={draft[f.key] || ""}
                        onChange={(v) => updateDraft(f.key, f.maiusculo ? v.toUpperCase() : v)}
                        options={cadastros[f.cadastroKey] || []}
                        placeholder={f.label}
                      />
                    </Field>
                  );
                }

                const campo = (
                  <Field key={f.key} label={f.appLabel || f.label}>
                    <input
                      style={inputStyle}
                      type="text"
                      value={draft[f.key] || ""}
                      onChange={(e) => updateDraft(f.key, f.maiusculo ? e.target.value.toUpperCase() : e.target.value)}
                      placeholder={f.label}
                    />
                  </Field>
                );

                // O nº da guia tem tratamento próprio: é o único campo com
                // conferência de dígito verificador e aviso embaixo.
                if (f.key !== "nGuia") return campo;

                return (
                  <div key={f.key}>
                    <div>
                      <div style={{ minWidth: 0 }}>
                        <Field label={f.label}>
                          <input
                            style={
                              avisoDaGuia && avisoDaGuia.estado !== "valida" && avisoDaGuia.estado !== "completada"
                                ? { ...inputStyle, border: `1px solid ${CORES.alerta}`, background: CORES.alertaFundo }
                                : inputStyle
                            }
                            type="text"
                            value={draft[f.key] || ""}
                            onChange={(e) => {
                              updateDraft(f.key, e.target.value);
                              setGuiaInfo(null); // reavalia só quando sair do campo
                            }}
                            // No blur, e não a cada tecla: completar durante a
                            // digitação faria o dígito brotar no meio do número.
                            onBlur={(e) => {
                              if (!ehUnimed(draft)) return;
                              const r = analisarGuia(e.target.value);
                              setGuiaInfo(r.estado === "vazia" ? null : r);
                              if (r.numero !== e.target.value) updateDraft(f.key, r.numero);
                            }}
                            placeholder={f.label}
                            inputMode="numeric"
                          />
                        </Field>
                      </div>
                    </div>

                    {avisoDaGuia && avisoDaGuia.mensagem && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: TEXTO.miudo,
                          color:
                            avisoDaGuia.estado === "valida" || avisoDaGuia.estado === "completada" ? CORES.principal : CORES.alerta,
                        }}
                      >
                        <Icone
                          nome={
                            avisoDaGuia.estado === "valida" || avisoDaGuia.estado === "completada"
                              ? "check"
                              : "alerta"
                          }
                          style={{ verticalAlign: "-2px", marginRight: 4 }}
                        />
                        {avisoDaGuia.mensagem}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Procedimentos solicitados: a leitura traz todos marcados, e o
                  anestesista desmarca o que não se aplica. Só os marcados são
                  gravados, na mesma célula da planilha. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* O asterisco e o vermelho seguem a mesma regra dos outros
                    campos obrigatórios: o aviso só pinta depois de uma
                    tentativa de salvar, e não enquanto a pessoa ainda digita. */}
                <span
                  style={{
                    fontSize: TEXTO.miudo,
                    color: faltaProcedimento ? CORES.alerta : CORES.suave,
                    fontWeight: faltaProcedimento ? 600 : 400,
                  }}
                >
                  Procedimentos solicitados na guia *
                </span>
                {(draft.procedimentos || []).length === 0 && (
                  <div style={{ fontSize: TEXTO.apoio, color: faltaProcedimento ? CORES.alerta : CORES.tenue }}>
                    Nenhum procedimento lido da guia. Use o botão abaixo para acrescentar.
                  </div>
                )}
                {(draft.procedimentos || []).map((linha, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!linha.incluido}
                      onChange={(e) => updateProcedimento(i, { incluido: e.target.checked })}
                      style={{ width: 18, height: 18, flexShrink: 0 }}
                    />
                    {/* Autocompletar com o que a equipe já lançou, inclusive o
                        que veio das guias com código TUSS. Só sugere a partir
                        de duas letras: a lista tem centenas de entradas, e
                        abri-la inteira ao tocar no campo seria um paredão por
                        cima do formulário. O texto continua livre — "EYLIA OD"
                        não está em tabela nenhuma e precisa continuar valendo. */}
                    <AutocompleteInput
                      value={linha.descricao || ""}
                      onChange={(v) => updateProcedimento(i, { descricao: v.toUpperCase() })}
                      options={cadastros.procedimentos || []}
                      placeholder="Código e descrição do procedimento"
                      minimo={2}
                      envolve={{ flex: 1, minWidth: 0 }}
                      estilo={{
                        opacity: linha.incluido ? 1 : 0.45,
                        textDecoration: linha.incluido ? "none" : "line-through",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeProcedimento(i)}
                      aria-label="Remover procedimento"
                      style={{ ...iconBtn, color: CORES.alerta, flexShrink: 0 }}
                    >
                      <Icone nome="lixo" tamanho={18} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addProcedimento} style={{ ...btnSecondary, padding: "10px 12px", fontSize: TEXTO.apoio }}>
                  + Acrescentar procedimento
                </button>
              </div>

              {/* O parto é o caso em que a analgesia fica sem cobrar: lança-se
                  a cesariana, que é o ato, e a assistência ao trabalho de
                  parto — paga por hora, à parte — vai junto com a lembrança.

                  A caixa fica AQUI, entre o principal que a abriu e o
                  complementar que ela exige, porque é a ordem em que a coisa
                  acontece. No fim do formulário seria uma pergunta sem
                  contexto; antes do principal, uma pergunta sem motivo. */}
              {perguntarAnalgesia && (
                <div className={`pergunta-analgesia${(faltaAssistenciaAoParto || faltaRespostaAnalgesia) && errorMsg ? " falta" : ""}`} role="group" aria-labelledby="pergunta-analgesia-titulo">
                  <span id="pergunta-analgesia-titulo" style={{ fontSize: 15, fontWeight: 600 }}>
                    Realizou Analgesia? *
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    {[["sim", "Sim"], ["nao", "Não"]].map(([valor, rotulo]) => (
                      <button
                        key={valor}
                        type="button"
                        className={`analgesia-botao${respostaAnalgesia === valor ? " aceso" : ""}`}
                        aria-pressed={respostaAnalgesia === valor}
                        onClick={() => setAnalgesiaDeParto(valor)}
                      >
                        {rotulo}
                      </button>
                    ))}
                  </div>
                  {/* O recado do "Sim" aparece na hora, e não só ao salvar: a
                      exigência nasce do toque, e descobri-la no fim do
                      formulário é descobrir tarde. */}
                  {faltaAssistenciaAoParto && (
                    <span style={{ fontSize: TEXTO.apoio, lineHeight: 1.4 }}>
                      Marque <strong>Assistência ao trabalho de parto</strong> em Procedimento
                      Complementar, com as horas.
                    </span>
                  )}
                </div>
              )}

              <div style={{ height: 1, background: CORES.bordaSuave, margin: "4px 0" }} />

              {CAMPOS_MANUAIS.filter((f) => cabeNesteRegistro(f, draft)).map((f) => {
                const rotulo = f.appLabel || f.label;
                return (
                  <Field key={f.key} label={f.required ? `${rotulo} *` : rotulo}>
                    <AutocompleteInput
                      value={draft[f.key] || ""}
                      onChange={(v) => updateAnestesista(f, v)}
                      options={f.somenteDaUnimed ? credenciados : cadastros[f.cadastroKey] || []}
                      placeholder={rotulo}
                      invalid={f.required && !!errorMsg && !(draft[f.key] || "").trim()}
                    />
                  </Field>
                );
              })}

              {/* O complementar é cobrança à parte, pela operadora: na
                  planilha particular não há coluna para ele, e aqui seria uma
                  lista de dez caixas sem destino. */}
              {!ehParticular(draft) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>Procedimento Complementar</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {PROCEDIMENTOS_COMPLEMENTARES.map((item) => {
                    const marcado = complementarMarcado(draft.procedimentoComplementar, item);
                    const limite = LIMITE_DE_HORAS[codigoDo(item)];
                    return (
                      <div key={item} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: TEXTO.apoio }}>
                          <input
                            type="checkbox"
                            checked={!!marcado}
                            onChange={() => toggleComplementar(item)}
                            style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
                          />
                          {item}
                        </label>

                        {limite && marcado && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
                            <span style={{ fontSize: TEXTO.apoio, color: CORES.suave }}>
                              Quantas horas?
                            </span>
                            <select
                              value={horasDe(marcado) || 1}
                              onChange={(e) => definirHoras(item, Number(e.target.value))}
                              style={{ ...inputStyle, width: "auto", padding: "8px 10px" }}
                            >
                              {Array.from({ length: limite }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                  {n} {n === 1 ? "hora" : "horas"}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(draft.procedimentoComplementar || []).length > 0 && (
                  /* O aviso piscando era ignorado de tanto aparecer: pisca
                     igual em todo registro com complementar, e o olho aprende
                     a não ver. O aceite explícito trava o Salvar até alguém de
                     fato olhar — e volta a zero sempre que a lista de
                     complementares muda, porque a guia preenchida era para a
                     lista de antes. */
                  <div className="aviso-complementar" role="alert">
                    <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Icone nome="alerta" tamanho={20} style={{ color: "#7a5200", flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: "#4a3500", lineHeight: 1.4 }}>
                        Este registro tem procedimento complementar.
                      </span>
                    </span>
                    <label style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        required
                        checked={aceiteComplementar}
                        onChange={(e) => setAceiteComplementar(e.target.checked)}
                        style={{ width: 22, height: 22, flexShrink: 0, accentColor: "#1a1a1a" }}
                      />
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Confirmo que preenchi a Guia Complementar</span>
                    </label>
                  </div>
                )}
              </div>
              )}

              <Field label="Observação">
                <textarea
                  style={{ ...inputStyle, resize: "vertical" }}
                  rows={3}
                  value={draft.observacao || ""}
                  onChange={(e) => updateDraft("observacao", e.target.value)}
                  placeholder="Observações adicionais"
                />
              </Field>

              {/* Os dois estados ficam no fim do formulário, depois da
                  observação, a pedido da equipe: quem lança preenche de uma vez
                  o que a guia traz e responde o estado por último.

                  Na planilha a ordem não muda — lá o Executado continua sendo a
                  primeira coluna, que é como a conferência lê o mês. A ordem das
                  colunas vem de `lib/campos.js`, e nada aqui a toca. */}
              {/* Para o usuário comum os dois estados não aparecem: quem
                  marca executado é quem confere. E não é só a tela — o servidor
                  descarta esses campos de quem não pode mexer neles. */}
              {podeConferirAqui && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>Executado</span>
                <Escolha
                  campo="executado"
                  valor={draft.executado}
                  onEscolher={(estado) => updateDraft("executado", estado)}
                  grande
                />
              </div>
              )}

              {/* O complementar tem o próprio ciclo de cobrança, e só na
                  conferência da Unimed ele é acompanhado. */}
              {podeConferirAqui && modeloDoRegistro(draft) === "convenio" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>
                    PC Executado
                  </span>
                  <Escolha
                    campo="pcExecutado"
                    valor={draft.pcExecutado}
                    onEscolher={(estado) => updateDraft("pcExecutado", estado)}
                    grande
                  />
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
              <button
                onClick={cancelReview}
                disabled={salvando}
                style={{ ...btnSecondary, flex: 1, opacity: salvando ? 0.5 : 1 }}
              >
                <Icone nome="fechar" /> Cancelar
              </button>
              <button
                onClick={confirmEntry}
                disabled={salvando || faltaAceiteComplementar}
                style={{
                  ...btnPrimary,
                  flex: 2,
                  opacity: salvando || faltaAceiteComplementar ? 0.45 : 1,
                  cursor: salvando || faltaAceiteComplementar ? "default" : "pointer",
                }}
              >
                {salvando ? (
                  "Salvando…"
                ) : (
                  <>
                    <Icone nome="check" /> {editingId ? "Salvar alterações" : "Adicionar ao controle"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {status === "idle" && activeTab === "procedimentos" && entries.length > 0 && (
          <div>
            {/* Busca, filtros e seletor de mês grudam no topo.
                
                A lista de um mês cheio passa de uma tela de rolagem, e quem
                percorre procurando um paciente perdia de vista o que estava
                filtrando — e rolava de volta para conferir. O fundo opaco é
                necessário: sem ele, os cartões passam por baixo e se leem
                através. */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 20,
                background: CORES.fundo,
                paddingTop: ESPACO[2],
                marginTop: -ESPACO[2],
                borderBottom: `1px solid ${CORES.bordaSuave}`,
                marginBottom: ESPACO[3],
              }}
            >
            {/* A lupa fica ao lado do campo, e não dentro do texto do
                placeholder: escrita no texto, ela some assim que a pessoa
                digita — justo quando o campo mais precisa dizer o que é. */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <Icone
                nome="busca"
                tamanho={17}
                style={{ position: "absolute", left: 12, top: 13, color: CORES.tenue, pointerEvents: "none" }}
              />
              <input
                style={{ ...inputStyle, paddingLeft: 38 }}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por paciente, data, mês, procedimento, cirurgião ou anestesiologista"
                aria-label="Buscar por paciente, data, mês, procedimento, cirurgião ou anestesiologista"
              />
            </div>

            {/* Durante a busca o seletor fica esmaecido e sem efeito,
                porque a procura roda em todos os meses. */}
            {/* O filtro de local só aparece quando há mais de um local
                lançado: com um só, ele seria uma linha sem função.

                Num seletor, como na tela inicial: nome de local é longo, e em
                fichas ele empurra o seletor de mês para baixo em três linhas. */}
            {locaisComRegistro.length > 1 && (
              <select
                value={localFiltro}
                onChange={(ev) => setLocalFiltro(ev.target.value)}
                style={{
                  ...inputStyle,
                  marginBottom: 10,
                  fontSize: TEXTO.apoio,
                  fontWeight: 600,
                  color: localFiltro === TODOS_OS_LOCAIS ? CORES.suave : CORES.escura,
                  background: localFiltro === TODOS_OS_LOCAIS ? "white" : CORES.clara,
                  borderColor: localFiltro === TODOS_OS_LOCAIS ? CORES.borda : CORES.principal,
                }}
              >
                <option value={TODOS_OS_LOCAIS}>Todos os locais</option>
                {locaisComRegistro.map((local) => (
                  <option key={local} value={local}>
                    {local}
                  </option>
                ))}
              </select>
            )}

            {/* Filtro de convênio, no mesmo formato do de local. Fechar o mês
                da Unimed é percorrer só os da Unimed, e antes disso era rolar a
                lista inteira pulando os outros. A cor no nome ajuda de relance,
                mas não some com o que não interessa. */}
            {conveniosComRegistro.length > 1 && (
              <select
                value={convenioFiltro}
                onChange={(ev) => setConvenioFiltro(ev.target.value)}
                style={{
                  ...inputStyle,
                  marginBottom: 10,
                  fontSize: TEXTO.apoio,
                  fontWeight: 600,
                  color: convenioFiltro === TODOS_OS_CONVENIOS ? CORES.suave : corDoConvenio(convenioFiltro) || CORES.escura,
                  background: convenioFiltro === TODOS_OS_CONVENIOS ? "white" : CORES.clara,
                  borderColor: convenioFiltro === TODOS_OS_CONVENIOS ? CORES.borda : CORES.principal,
                }}
              >
                <option value={TODOS_OS_CONVENIOS}>Todos os convênios</option>
                {conveniosComRegistro.map((convenio) => (
                  <option key={convenio} value={convenio}>
                    {convenio}
                  </option>
                ))}
              </select>
            )}

            {meses.length > 0 && (
              <SeletorDeMes
                meses={meses}
                selecionado={buscando ? null : mesSelecionado}
                onSelecionar={setMesSelecionado}
                totalGeral={entries.length}
                totalDeHoje={totalDeHoje}
                desabilitado={buscando}
              />
            )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.1em", textTransform: "uppercase", color: CORES.suave }}>
                  {buscando
                    ? "Resultados da busca"
                    : mesSelecionado === SO_HOJE
                    ? `Hoje · ${formatarData(hoje)}`
                    : mesSelecionado === TODOS_OS_MESES || !mesSelecionado
                    ? "Todos os registros"
                    : nomeDoMes(mesSelecionado, true)}
                </div>
                <div style={{ fontSize: TEXTO.miudo, color: CORES.tenue, marginTop: 2 }}>
                  {resumo.total} {resumo.total === 1 ? "registro" : "registros"}
                  {` · ${resumo.executados} executado${resumo.executados === 1 ? "" : "s"}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={sincronizarPlanilha}
                  disabled={sincronizando}
                  title="Sincronizar com a planilha do Google"
                  aria-label="Sincronizar com a planilha do Google"
                  style={{ ...btnIcone, opacity: sincronizando ? 0.6 : 1 }}
                >
                  {sincronizando ? "…" : <Icone nome="atualizar" tamanho={17} />}
                </button>
                <button
                  onClick={exportExcel}
                  title="Baixar planilha do ano em Excel"
                  aria-label="Baixar planilha do ano em Excel"
                  style={btnIcone}
                >
                  <Icone nome="baixar" tamanho={17} />
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {registrosVisiveis.length === 0 && (
                <div style={{ textAlign: "center", fontSize: TEXTO.apoio, color: CORES.tenue, padding: "24px 0" }}>
                  Nenhum registro encontrado para essa busca.
                </div>
              )}
              {registrosVisiveis.map((e) => {
                const aberto = expandido === e.id;

                return (
                <div
                  key={e.id}
                  style={{
                    border: `1px solid ${CORES.borda}`,
                    // A cor do convênio é uma faixa na lateral, e não o nome do
                    // paciente pintado. Pintar o nome custava legibilidade —
                    // laranja em corpo de 16px cansa a leitura —, e a faixa
                    // reconhece igual de rápido sem atrapalhar o que se lê.
                    borderLeft: `4px solid ${corDoConvenio(e.convenio) || CORES.borda}`,
                    borderRadius: 6,
                    // Cartão conferido fica cinza: é o que faz o que ainda falta
                    // conferir saltar da lista, sem precisar contar nada.
                    background: e.conferido === true ? CORES.conferido : "white",
                    padding: `${ESPACO[3]} ${ESPACO[4]}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: ESPACO[2],
                  }}
                >
                  {/* Fechado, o cartão mostra só o nome: a lista existe para
                      percorrer procurando um paciente, e o resto dos dados
                      transformava cada rolagem num paredão de texto. */}
                  <div
                    onClick={() => setExpandido(aberto ? null : e.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
                  >
                    {/* A caixa da conferência da secretária. Fica fora do
                        cartão que abre — `stopPropagation`, senão marcar
                        também abriria o registro. Não vai para a planilha: é
                        controle de quem confere, não dado da cirurgia. */}
                    {/* Para o usuário comum ela fica visível e travada, e não
                        escondida: o cinza do cartão diz que a secretária já
                        conferiu, e isso é informação útil para quem lança. */}
                    <input
                      type="checkbox"
                      checked={e.conferido === true}
                      disabled={!podeConferirAqui}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => updateConferido(e, ev.target.checked)}
                      title={podeConferirAqui ? "Conferido" : "Quem confere é a secretária"}
                      style={{
                        width: 20,
                        height: 20,
                        flexShrink: 0,
                        cursor: podeConferirAqui ? "pointer" : "default",
                        accentColor: CORES.principal,
                      }}
                    />

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: TEXTO.corpo, lineHeight: 1.3 }}>
                        {e.paciente || "(sem nome)"}
                      </div>
                      {/* A data e o convênio na mesma linha de apoio.
                          
                          O convênio em etiqueta, na cor da faixa, diz para qual
                          das três planilhas o paciente vai, sem precisar abrir o
                          cartão nem ler o nome inteiro. A data vem antes dele e
                          em cor neutra: é o que situa o paciente no mês, e com a
                          lista ordenada por data ela também diz onde começa e
                          termina cada dia. Numa linha só, para o cartão fechado
                          não ganhar altura. */}
                      {(e.dataCirurgia || e.convenio) && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: TEXTO.miudo,
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            display: "flex",
                            // Centro com centro: a etiqueta tem contorno e
                            // recheio, então é mais alta que a data ao lado.
                            // Alinhadas pelo topo, a data parecia ter subido.
                            alignItems: "center",
                            gap: 6,
                            minWidth: 0,
                          }}
                        >
                          {e.dataCirurgia && (
                            <span style={{ color: CORES.suave, flexShrink: 0 }}>
                              {formatarData(e.dataCirurgia)}
                            </span>
                          )}
                          {/* Etiqueta, e não texto colorido: a cor sozinha
                              some num relance por uma lista de vinte cartões,
                              e o contorno dá ao convênio um lugar fixo para o
                              olho pousar. */}
                          {e.convenio && (
                            <span
                              style={{
                                color: corDoConvenio(e.convenio) || CORES.suave,
                                background: fundoDoConvenio(e.convenio) || "transparent",
                                border: `1px solid ${corDoConvenio(e.convenio) || CORES.borda}`,
                                borderRadius: 999,
                                padding: "1px 8px",
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {e.convenio}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* O executado continua visível de fora: é o estado que se
                        procura percorrendo a lista, e abrir cartão por cartão
                        para vê-lo desfaria a serventia de fechar. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {estadoDe("executado", e.executado) === "sim" && (
                        <Icone nome="check" tamanho={15} espessura={2} style={{ color: CORES.principal }} />
                      )}
                      {/* O incompleto precisa de marca própria: sem ela, de fora
                          ele se confunde com o que não foi feito, que é o
                          contrário do motivo de o estado existir. */}
                      {estadoDe("executado", e.executado) === "incompleto" && (
                        <span style={{ color: CORES.avisoTinta, fontSize: TEXTO.miudo, fontWeight: 700 }}>
                          INCOMPLETO
                        </span>
                      )}
                      {estadoDe("executado", e.executado) === "verificado" && (
                        <span style={{ color: CORES.suave, fontSize: TEXTO.miudo, fontWeight: 700 }}>
                          VERIFICADO
                        </span>
                      )}
                      <Icone nome={aberto ? "acima" : "abaixo"} tamanho={14} style={{ color: CORES.tenue }} />
                    </div>
                  </div>

                  {aberto && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Hora e clínica em negrito, numa linha só: é o que
                              situa o caso — quando foi e onde foi. A data não
                              entra porque já está no cabeçalho, ao lado do
                              nome, e repetida aqui só roubaria peso do que
                              esta linha existe para dizer. */}
                          {(horaDoRegistro(e) || e.local) && (
                            <div style={{ fontSize: TEXTO.apoio, fontWeight: 700, color: CORES.tinta }}>
                              {[horaDoRegistro(e), e.local].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {/* Os dois médicos, sem negrito e em tom de apoio:
                              são o segundo olhar, não o primeiro. Cirurgião em
                              cima, anestesiologista embaixo.

                              O "Anest." continua na segunda linha. Sem ele as
                              duas viram "Dr(a). Fulano" e "Dr(a). Beltrano", e
                              não há como saber quem é quem — justamente o que
                              se procura ao conferir um registro. */}
                          {e.cirurgiao && (
                            <div style={{ fontSize: TEXTO.apoio, color: CORES.suave, marginTop: 2 }}>
                              Dr(a). {e.cirurgiao}
                            </div>
                          )}
                          {e.anestesista && (
                            <div style={{ fontSize: TEXTO.apoio, color: CORES.suave }}>
                              Anest. Dr(a). {e.anestesista}
                            </div>
                          )}
                          <LinhaDeIdentificacao entry={e} />
                          {(e.procedimentoComplementar || []).length > 0 && (
                            <div style={{ fontSize: TEXTO.miudo, color: CORES.principal, marginTop: 4 }}>
                              {e.procedimentoComplementar.join(" · ")}
                            </div>
                          )}
                        </div>
                        {/* Os botões empilhados na borda direita, e não em
                            fileira sobre o texto: assim eles ocupam a faixa que
                            já era margem, o texto ganha a largura toda, e o
                            polegar os encontra sempre no mesmo lugar, seja qual
                            for o tamanho do cartão. */}
                        {/* A caixa de cada botão é mais baixa que o alvo
                            padrão: 44px de altura com um glifo de 18px deixavam
                            13px vazios acima do lápis, 13px abaixo da lupa e 28
                            entre os dois, e a coluna ficava com 90px contra uns
                            50 de texto.

                            A largura continua 44 — o dedo erra mais de lado do
                            que de cima —, e os dois são ações mansas: abrir o
                            editor e abrir o registro. Um toque entre eles não
                            apaga nada. */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0, alignItems: "center" }}>
                          <button onClick={() => startEdit(e)} aria-label="Editar registro" style={{ ...iconBtn, height: 34 }}>
                            <Icone nome="lapis" tamanho={18} />
                          </button>
                          {/* Lupa com `+`, e não reticências: reticências é
                              "mais opções", e o que este botão faz é abrir o
                              registro inteiro. */}
                          <button onClick={() => setViewingEntry(e)} style={{ ...iconBtn, height: 34 }} title="Ver tudo" aria-label="Ver tudo"><Icone nome="lupaMais" tamanho={19} /></button>
                          {/* Apagar não mora aqui: mora no "ver tudo".

                              Três alvos somavam coluna demais contra umas três
                              linhas de texto, e o cartão ganhava dois dedos de
                              branco. E apagar um registro é raro e não tem
                              volta — um nível a mais é proteção, não atrito,
                              ainda mais ao lado do lápis. */}
                        </div>
                      </div>

                      {/* Procedimento em cima e os botões embaixo, na largura
                          toda. Lado a lado, o texto do procedimento ficava com
                          `flex: 1` e os quatro botões não encolhiam: a fileira
                          nascia com a largura natural dos quatro, o `wrap` de
                          dentro nunca entrava, e "Incompleto" e "Verificado"
                          saíam pela borda do cartão. Empilhado, a fileira ganha
                          a largura do cartão e quebra sozinha quando precisa. */}
                      <div style={{ display: "flex", flexDirection: "column", gap: ESPACO[2], paddingTop: 8, borderTop: `1px solid ${CORES.bordaSuave}` }}>
                        <div style={{ fontSize: TEXTO.apoio }}>
                          {(e.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS) || "(sem procedimento)"}
                        </div>
                        {podeConferirAqui && (
                          <Escolha
                            campo="executado"
                            valor={e.executado}
                            onEscolher={(estado) => updateExecutado(e, estado)}
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {status === "idle" && activeTab === "procedimentos" && loaded && entries.length === 0 && (
          <div style={{ marginTop: 32, textAlign: "center", fontSize: TEXTO.apoio, color: CORES.tenue }}>
            Nenhum registro ainda. Fotografe a primeira guia para começar.
          </div>
        )}

        {status === "idle" && activeTab === "cadastros" && (
          <div style={{ display: "flex", flexDirection: "column", gap: ESPACO[2] }}>
            <CadastroSection
              title="Cirurgiões"
              placeholder="Nome do cirurgião"
              items={cadastros.cirurgioes}
              onAdd={(nome) => addCadastro("cirurgioes", nome)}
              onImportar={(nomes) => importarCadastros("cirurgioes", nomes)}
              onRemove={(nome) => removeCadastro("cirurgioes", nome)}
              aberto={blocoAberto === "cirurgioes"}
              aoAlternar={() => setBlocoAberto((b) => (b === "cirurgioes" ? null : "cirurgioes"))}
            />
            <CadastroSection
              title="Anestesiologistas"
              placeholder="Nome do anestesiologista"
              items={cadastros.anestesistas}
              onAdd={(nome) => addCadastro("anestesistas", nome)}
              onImportar={(nomes) => importarCadastros("anestesistas", nomes)}
              onRemove={(nome) => removeCadastro("anestesistas", nome)}
              aberto={blocoAberto === "anestesistas"}
              aoAlternar={() => setBlocoAberto((b) => (b === "anestesistas" ? null : "anestesistas"))}
            />
            {/* Estas duas listas se enchem sozinhas, a cada registro salvo.
                Estão aqui para o caso contrário: apagar um nome que entrou
                escrito errado.

                Os locais não estão mais aqui: viraram lista fechada no código,
                e um cadastro que aprende ao lado de uma lista fechada só
                serviria para criar um décimo terceiro local escrito torto. */}
            {/* A lista cresce sozinha, a cada registro salvo. Está aqui pelo
                motivo contrário: apagar o que entrou escrito errado. */}
            <CadastroSection
              title="Procedimentos"
              placeholder="Código e descrição do procedimento"
              items={cadastros.procedimentos}
              onAdd={(nome) => addCadastro("procedimentos", nome)}
              onImportar={(nomes) => importarCadastros("procedimentos", nomes)}
              onRemove={(nome) => removeCadastro("procedimentos", nome)}
              aberto={blocoAberto === "procedimentos"}
              aoAlternar={() => setBlocoAberto((b) => (b === "procedimentos" ? null : "procedimentos"))}
            />
            <CadastroSection
              title="Convênios"
              placeholder="Nome do convênio"
              items={cadastros.convenios}
              onAdd={(nome) => addCadastro("convenios", nome)}
              onImportar={(nomes) => importarCadastros("convenios", nomes)}
              onRemove={(nome) => removeCadastro("convenios", nome)}
              aberto={blocoAberto === "convenios"}
              aoAlternar={() => setBlocoAberto((b) => (b === "convenios" ? null : "convenios"))}
            />
            <CadastroSection
              title="Quem recebe"
              placeholder="Nome de quem recebe"
              items={cadastros.recebedores}
              onAdd={(nome) => addCadastro("recebedores", nome)}
              onImportar={(nomes) => importarCadastros("recebedores", nomes)}
              onRemove={(nome) => removeCadastro("recebedores", nome)}
              aberto={blocoAberto === "recebedores"}
              aoAlternar={() => setBlocoAberto((b) => (b === "recebedores" ? null : "recebedores"))}
            />

            {ehMestre && (
              <SecaoDeAcesso
                cadastros={cadastros}
                avisar={avisar}
                eu={acesso}
                aberto={blocoAberto === "acesso"}
                aoAlternar={() => setBlocoAberto((b) => (b === "acesso" ? null : "acesso"))}
              />
            )}

            {/* A área de conferência é tela de computador, e não entra na barra
                de abas do celular — ela atrapalharia quem lança. Fica aqui, no
                fim dos ajustes, que é onde quem administra já vem. */}
            {veSecretaria && (
            <a
              href="/secretaria"
              style={{
                // Flex, e não `block` com `text-align`: o ícone e o rótulo
                // precisam ficar centrados juntos e alinhados pelo meio, não
                // pela linha de base do texto.
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: ESPACO[2],
                padding: ESPACO[3],
                marginTop: ESPACO[2],
                minHeight: ALVO,
                boxSizing: "border-box",
                borderRadius: 8,
                border: `1px solid ${CORES.borda}`,
                background: "white",
                color: CORES.suave,
                textDecoration: "none",
                fontSize: TEXTO.apoio,
                fontWeight: 500,
              }}
            >
              <Icone nome="grafico" /> Área de conferência
            </a>
            )}
          </div>
        )}
      </div>

      {viewingEntry && (
        <div
          onClick={() => setViewingEntry(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{ background: "white", borderRadius: "12px 12px 0 0", width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }}
          >
            <div style={{ background: CORES.clara, padding: "12px 16px", borderBottom: `1px solid ${CORES.borda}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: TEXTO.apoio, fontWeight: 600 }}>Detalhes do registro</span>
              <button onClick={() => setViewingEntry(null)} aria-label="Fechar" style={iconBtn}>
                <Icone nome="fechar" tamanho={18} />
              </button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <ViewField label="Data do lançamento" value={formatarData(viewingEntry.dataCirurgia)} />
              <ViewField label="Hora do lançamento" value={horaDoRegistro(viewingEntry)} />
              {CAMPOS_DO_REGISTRO.filter((f) => cabeNesteRegistro(f, viewingEntry)).map((f) => (
                <ViewField
                  key={f.key}
                  label={f.label}
                  value={f.escolha ? rotuloDe(f.escolha, viewingEntry[f.key]) : viewingEntry[f.key]}
                />
              ))}
              {ehParticular(viewingEntry) && (
                <ViewField label="Horas" value={duracaoEntre(viewingEntry.inicio, viewingEntry.termino)} />
              )}
              <ViewField label="Procedimentos" value={(viewingEntry.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS)} />
              {CAMPOS_MANUAIS.filter((f) => cabeNesteRegistro(f, viewingEntry)).map((f) => (
                <ViewField key={f.key} label={f.appLabel || f.label} value={viewingEntry[f.key]} />
              ))}
              <ViewField label="Conferido" value={viewingEntry.conferido ? "Sim" : "Não"} />
              <ViewField label="Executado" value={rotuloDe("executado", viewingEntry.executado)} />
              <ViewField label="Procedimento complementar" value={(viewingEntry.procedimentoComplementar || []).join(", ")} />
              {modeloDoRegistro(viewingEntry) === "convenio" && (
                <ViewField label="PC Executado" value={rotuloDe("pcExecutado", viewingEntry.pcExecutado)} />
              )}
              <ViewField label="Observação" value={viewingEntry.observacao} />
              <ViewField label="Criado em" value={dataHoraDoInstante(viewingEntry.criadoEm)} />
            </div>
            <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
              <button onClick={() => setViewingEntry(null)} style={{ ...btnSecondary, flex: 1 }}>Fechar</button>
              <button
                onClick={() => {
                  const entry = viewingEntry;
                  setViewingEntry(null);
                  duplicarEntry(entry);
                }}
                style={{ ...btnSecondary, flex: 1 }}
              >
                <Icone nome="copiar" /> Duplicar
              </button>
              <button
                onClick={() => {
                  const entry = viewingEntry;
                  setViewingEntry(null);
                  startEdit(entry);
                }}
                style={{ ...btnPrimary, flex: 1 }}
              >
                <Icone nome="lapis" /> Editar
              </button>
            </div>

            {/* Apagar em linha própria, separado por um filete e no vermelho de
                alerta: é o que não tem volta, e não pode dividir fileira com
                "Fechar" e "Editar", onde um polegar apressado erra o alvo. */}
            {podeApagarAqui && (
              <div style={{ padding: "0 16px 16px" }}>
                <div style={{ borderTop: `1px solid ${CORES.bordaSuave}`, marginBottom: ESPACO[3] }} />
                <button
                  onClick={() => {
                    const entry = viewingEntry;
                    setViewingEntry(null);
                    deleteEntry(entry.id);
                  }}
                  style={{ ...btnSecondary, width: "100%", color: CORES.alerta }}
                >
                  <Icone nome="lixo" tamanho={16} /> Apagar registro
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {aviso && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: ESPACO[3],
            right: ESPACO[3],
            // Acima da barra de abas, nunca por cima dela.
            bottom: `calc(${ALTURA_DA_BARRA + ESPACO[2]}px + env(safe-area-inset-bottom))`,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            gap: ESPACO[3],
            maxWidth: 640,
            margin: "0 auto",
            padding: `${ESPACO[3]} ${ESPACO[4]}`,
            borderRadius: 10,
            background: aviso.tipo === "erro" ? CORES.alertaFundo : CORES.escura,
            color: aviso.tipo === "erro" ? CORES.alerta : CORES.sobreEscura,
            border: `1px solid ${aviso.tipo === "erro" ? CORES.alerta : CORES.escura}`,
            boxShadow: "0 6px 24px rgba(26,26,26,0.18)",
            fontSize: TEXTO.apoio,
            lineHeight: 1.45,
            // Relatório pode ser longo: rola dentro do próprio aviso em vez de
            // cobrir a tela inteira.
            maxHeight: "45vh",
            overflowY: "auto",
            animation: "aviso-entra 160ms ease-out",
          }}
        >
          <div style={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0 }}>{aviso.texto}</div>
          {aviso.fixo && (
            <button
              onClick={() => setAviso(null)}
              aria-label="Fechar aviso"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                lineHeight: 1,
                color: "inherit",
              }}
            >
              <Icone nome="fechar" tamanho={16} />
            </button>
          )}
        </div>
      )}

      {/* As abas ficam embaixo, e não no topo.
          
          Num celular usado em pé, no centro cirúrgico, o polegar não alcança o
          topo da tela sem trocar a mão de posição. É a mudança de uso mais
          barata do app, e a que mais aparece.

          Só no modo normal: durante a conferência de uma guia ou de um mapa,
          trocar de aba jogaria fora o que está na tela. */}
      {status === "idle" && (
        <nav
          style={{
            position: "fixed",
            // Descolada das bordas: a barra vira uma ilha sobre o conteúdo, e
            // não um rodapé grudado. O respiro embaixo é o da barra do iPhone,
            // somado ao afastamento — sem ele a ilha encostaria no indicador.
            left: ESPACO[3],
            right: ESPACO[3],
            bottom: `calc(${ESPACO[3]} + env(safe-area-inset-bottom))`,
            display: "flex",
            gap: ESPACO[1],
            padding: ESPACO[1],
            background: "white",
            border: `1px solid ${CORES.borda}`,
            borderRadius: 999,
            // A sombra é o que separa a ilha do que passa por baixo dela.
            boxShadow: "0 6px 20px rgba(26, 26, 26, 0.10)",
            zIndex: 40,
          }}
        >
          {ABAS.map((aba) => {
            const ativa = activeTab === aba.chave;
            return (
              <button
                key={aba.chave}
                onClick={() => setActiveTab(aba.chave)}
                aria-current={ativa ? "page" : undefined}
                className="aba-da-barra"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: ALVO,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  padding: `${ESPACO[2]} ${ESPACO[1]}`,
                  // A aba ativa é uma pílula preenchida, no mesmo tom que o
                  // resto do app já usa para "escolhido" (chip de mês, bloco
                  // de cadastro aberto). A linha no topo saiu: dentro de uma
                  // ilha arredondada ela cortava o canto.
                  background: ativa ? CORES.clara : "transparent",
                  border: "none",
                  borderRadius: 999,
                  color: ativa ? CORES.escura : CORES.suave,
                  fontWeight: ativa ? 600 : 500,
                  fontSize: TEXTO.miudo,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                <Icone nome={aba.icone} tamanho={21} espessura={ativa ? 1.8 : 1.5} />
                {aba.nome}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/**
 * O mesmo botão, porém numa pilha vertical.
 *
 * `btnPrimary` e `btnSecondary` nascem com `flex: 1` para dividir uma fileira.
 * Dentro de uma coluna, esse mesmo `flex` faria o botão esticar na vertical —
 * daí a troca por `0 0 auto`.
 */
function btnEmpilhado(base) {
  return { ...base, flex: "0 0 auto", width: "100%" };
}

/** O botão esmaecido enquanto não há local escolhido. */
function semLocal(base, localAtivo) {
  return localAtivo ? base : { ...base, opacity: 0.45, cursor: "default" };
}

/**
 * As três abas do app, na ordem em que aparecem no rodapé.
 *
 * Ícones de traço, e não emoji: emoji é multicolorido, muda de desenho em cada
 * sistema e não alinha com o texto ao lado. O da aba ativa vem um pouco mais
 * grosso, e a cor é a do texto em volta — a aba escolhida escurece junto.
 */
const ABAS = [
  { chave: "novo", nome: "Novo", icone: "camera" },
  { chave: "procedimentos", nome: "Procedimentos", icone: "mapa" },
  { chave: "cadastros", nome: "Cadastros", icone: "pessoas" },
];

/**
 * Atendimento, guia, carteira e convênio no cartão da lista.
 *
 * Só entra o que o registro tem: registro sem guia ainda não
 * pode virar uma linha com rótulo vazio. O convênio vai sem rótulo — o nome
 * já se identifica sozinho, e a linha inteira precisa caber num celular.
 */
function LinhaDeIdentificacao({ entry }) {
  const numeros = [
    entry.atendimento ? `Atendimento: ${entry.atendimento}` : "",
    entry.nGuia ? `Nº Guia: ${entry.nGuia}` : "",
    entry.nCarteira ? `Carteira: ${entry.nCarteira}` : "",
  ].filter(Boolean);

  // Só os números. O convênio virou etiqueta no cabeçalho do cartão e o local
  // subiu para a linha em negrito: repeti-los aqui seria dizer duas vezes a
  // mesma coisa, a dois centímetros de distância.
  if (numeros.length === 0) return null;

  return (
    <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginTop: 2 }}>
      {numeros.join(" · ")}
    </div>
  );
}

/**
 * Os botões de um campo de escolha — Executado, PC Executado, Recebido.
 *
 * Botões, e não menu suspenso: são duas ou três opções, o alvo é o dedo, e
 * escolher tem de custar um toque. O `campo` diz quais opções existem; quem
 * sabe isso é `lib/estados.js`.
 */
function Escolha({ campo, valor, onEscolher, grande }) {
  const atual = estadoDe(campo, valor);

  return (
    // `flexWrap` por causa da quarta opção do PC Executado: "Pendente",
    // "Retirado" e "Não Retirado" na mesma fileira não cabem em tela de
    // celular, e sem quebrar a linha o último botão sai pela borda do cartão.
    <div style={{ display: "flex", flexWrap: "wrap", gap: grande ? 8 : 6, flexShrink: 0 }}>
      {opcoesDe(campo).map((estado) => (
        <button
          key={estado.valor}
          type="button"
          // Tocar no que já está escolhido desmarca, e o campo volta ao padrão
          // — em branco no Executado e no PC Executado. Sem isto, um toque
          // errado ficava gravado: não havia como voltar atrás pela tela, e a
          // correção virava assunto de planilha.
          aria-pressed={atual === estado.valor}
          onClick={() => onEscolher(atual === estado.valor ? padraoDe(campo) : estado.valor)}
          style={{
            ...execBtn,
            ...(atual === estado.valor
              ? {
                  background: estado.fundoNaTela,
                  color: estado.tintaNaTela,
                  border: `1px solid ${estado.fundoNaTela}`,
                }
              : null),
            ...(grande ? { flex: 1, padding: "10px 12px", fontSize: TEXTO.apoio } : null),
          }}
        >
          {estado.rotulo}
        </button>
      ))}
    </div>
  );
}

function ViewField({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>{label}</div>
      <div style={{ fontSize: TEXTO.corpo, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/**
 * Separa uma colagem de nomes, um por linha (ou separados por ponto e vírgula),
 * tirando repetidos. É o que permite montar o cadastro pelo celular: copiar a
 * lista de uma planilha ou mensagem e colar aqui.
 */
function nomesDoTexto(texto) {
  const vistos = new Set();
  return (texto || "")
    .split(/[\n;]+/)
    .map((n) => n.trim())
    .filter(Boolean)
    .filter((n) => {
      const chave = n.toLowerCase();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

/**
 * Uma seção dos Cadastros que começa fechada.
 *
 * A aba tinha seis seções abertas uma embaixo da outra, cada uma com a lista
 * inteira à mostra: achar os convênios custava rolar a página toda. Fechadas,
 * os seis títulos cabem numa tela só.
 *
 * Abrir uma fecha a anterior, e é isso que mantém a promessa: com duas abertas
 * o problema volta na primeira lista comprida. A contagem no título existe para
 * que fechado não vire cego — dá para ver que há 24 cirurgiões sem abrir.
 */
function Bloco({ titulo, quantidade, aberto, aoAlternar, children }) {
  const caixa = useRef(null);

  // Ao abrir, trazer o título para o topo. Sem isto, uma seção lá embaixo abre
  // fora da tela e a pessoa rola atrás do que acabou de pedir.
  useEffect(() => {
    if (aberto && caixa.current) {
      caixa.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [aberto]);

  return (
    <div
      ref={caixa}
      style={{
        border: `1px solid ${CORES.borda}`,
        borderRadius: 8,
        background: "white",
        overflow: "hidden",
        scrollMarginTop: ESPACO[2],
      }}
    >
      <button
        type="button"
        onClick={aoAlternar}
        aria-expanded={aberto}
        style={{
          width: "100%",
          minHeight: ALVO,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ESPACO[2],
          padding: `0 ${ESPACO[3]}`,
          background: aberto ? CORES.clara : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          // Sem cor declarada, o botão herda a do navegador — preto puro no
          // Chrome e AZUL no iOS —, e o ícone, que desenha com `currentColor`,
          // ia junto. Nenhum dos dois está na paleta.
          color: CORES.tinta,
        }}
      >
        <span
          style={{
            fontSize: TEXTO.miudo,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: CORES.suave,
          }}
        >
          {titulo}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: ESPACO[2], flexShrink: 0, color: CORES.suave }}>
          {quantidade !== undefined && (
            <span style={{ fontSize: TEXTO.miudo, color: CORES.tenue }}>{quantidade}</span>
          )}
          <Icone nome={aberto ? "acima" : "abaixo"} />
        </span>
      </button>

      {/* Fechado, o conteúdo não é renderizado: é o que torna a aba leve
          quando as listas crescem. */}
      {aberto && (
        <div style={{ padding: ESPACO[3], borderTop: `1px solid ${CORES.bordaSuave}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

function CadastroSection({ title, placeholder, items, onAdd, onImportar, onRemove, aberto, aoAlternar }) {
  const [value, setValue] = useState("");
  const [lote, setLote] = useState("");
  const [abrirLote, setAbrirLote] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resumo, setResumo] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  }

  const aImportar = nomesDoTexto(lote);

  async function importar() {
    if (importando || aImportar.length === 0) return;
    setImportando(true);
    setResumo("");
    try {
      const { gravados, falhas } = await onImportar(aImportar);
      setResumo(
        falhas.length === 0
          ? `${gravados} ${gravados === 1 ? "nome cadastrado" : "nomes cadastrados"}.`
          : `${gravados} cadastrados, ${falhas.length} falharam: ${falhas.join(", ")}`
      );
      // Só limpa o que entrou: o que falhou continua na caixa para nova tentativa.
      setLote(falhas.join("\n"));
    } finally {
      setImportando(false);
    }
  }

  return (
    <Bloco titulo={title} quantidade={items.length} aberto={aberto} aoAlternar={aoAlternar}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder}
        />
        <button onClick={submit} style={{ ...btnPrimary, flex: "0 0 auto", padding: "10px 16px" }}>
          + Adicionar
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setAbrirLote((v) => !v)}
          style={{ ...btnSecondary, width: "100%", padding: "10px 12px", fontSize: TEXTO.apoio }}
        >
          <Icone nome={abrirLote ? "acima" : "abaixo"} />{" "}
          {abrirLote ? "Fechar importação" : "Colar uma lista de nomes"}
        </button>

        {abrirLote && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              style={{ ...inputStyle, resize: "vertical", fontSize: TEXTO.apoio }}
              rows={6}
              value={lote}
              onChange={(e) => setLote(e.target.value)}
              placeholder={"Um nome por linha.\n\nDá para colar direto de uma planilha\nou de uma mensagem."}
            />
            <button
              onClick={importar}
              disabled={importando || aImportar.length === 0}
              style={{
                ...btnPrimary,
                padding: "12px",
                fontSize: TEXTO.apoio,
                opacity: importando || aImportar.length === 0 ? 0.5 : 1,
              }}
            >
              {importando
                ? "Cadastrando…"
                : aImportar.length === 0
                ? "Cole os nomes acima"
                : `Cadastrar ${aImportar.length} ${aImportar.length === 1 ? "nome" : "nomes"}`}
            </button>
            {resumo && (
              <div style={{ fontSize: TEXTO.apoio, color: CORES.suave }}>
                {resumo}
              </div>
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>Nenhum cadastrado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((n) => (
            <div
              key={n}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${CORES.borda}`, borderRadius: 6, background: "white", padding: "8px 12px" }}
            >
              <span style={{ fontSize: TEXTO.apoio }}>{n}</span>
              <button onClick={() => onRemove(n)} aria-label={`Remover ${n}`} style={{ ...iconBtn, color: CORES.alerta }}><Icone nome="lixo" tamanho={18} /></button>
            </div>
          ))}
        </div>
      )}
    </Bloco>
  );
}

/**
 * Seletor de mês: os meses recentes como botões, e uma grade para o resto.
 *
 * A fileira precisa ter tamanho fixo — com um chip por mês ela cresceria sem
 * limite (em dez/2027 seriam ~19 chips, umas 7 telas de arrasto lateral). Por
 * isso só entram os 2 mais recentes, mais o mês escolhido quando ele estiver
 * fora desses, e a grade cobre qualquer mês de qualquer ano.
 */
function SeletorDeMes({ meses, selecionado, onSelecionar, totalGeral, totalDeHoje, desabilitado }) {
  const [aberta, setAberta] = useState(false);
  const wrapperRef = useRef(null);

  const anos = [...new Set(meses.map((m) => m.chave.slice(0, 4)))].sort();
  // "hoje" e "todos" não são chaves de mês: sem esta guarda, a grade abriria
  // no ano "hoje" e o terceiro chip apareceria escrito errado.
  const ehChaveDeMes = Boolean(selecionado) && selecionado !== TODOS_OS_MESES && selecionado !== SO_HOJE;
  const anoDoSelecionado = ehChaveDeMes ? selecionado.slice(0, 4) : null;
  const [ano, setAno] = useState(anoDoSelecionado || anos[anos.length - 1] || String(new Date().getFullYear()));

  // Mesmo padrão do AutocompleteInput. O touchstart é o que faz fechar no iPhone.
  useEffect(() => {
    function handleOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setAberta(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const totalPorChave = Object.fromEntries(meses.map((m) => [m.chave, m.total]));

  // Os 2 mais recentes, e o escolhido junto quando estiver fora deles.
  const recentes = meses.slice(0, 2).map((m) => m.chave);
  const visiveis =
    anoDoSelecionado && !recentes.includes(selecionado) ? [...recentes.slice(0, 2), selecionado] : recentes;

  function escolher(chave) {
    onSelecionar(chave);
    setAberta(false);
  }

  const idxAno = anos.indexOf(ano);

  return (
    <div ref={wrapperRef} style={{ position: "relative", marginBottom: 12, opacity: desabilitado ? 0.45 : 1 }}>
      <div className="fileira-de-meses" style={{ display: "flex", gap: 6 }}>
        {/* "Hoje" vem primeiro e nunca sai do lugar: é o que se procura no fim
            do plantão, e um chip que muda de posição é um chip que se erra.
            Sem registro no dia ele fica apagado e sem clique, como os meses
            vazios da grade — tocar nele só levaria a uma lista vazia. */}
        <button
          onClick={() => totalDeHoje > 0 && onSelecionar(SO_HOJE)}
          disabled={totalDeHoje === 0}
          title="Só os lançamentos de hoje"
          style={{
            ...chipMes,
            ...(!desabilitado && selecionado === SO_HOJE ? chipMesAtivo : null),
            opacity: totalDeHoje === 0 ? 0.45 : 1,
            cursor: totalDeHoje === 0 ? "default" : "pointer",
          }}
        >
          Hoje <span style={{ opacity: 0.6 }}>{totalDeHoje}</span>
        </button>
        {visiveis.map((chave) => (
          <button
            key={chave}
            onClick={() => onSelecionar(chave)}
            style={{ ...chipMes, ...(!desabilitado && selecionado === chave ? chipMesAtivo : null) }}
          >
            {mesAbreviado(parseInt(chave.slice(5, 7), 10))} <span style={{ opacity: 0.6 }}>{totalPorChave[chave]}</span>
          </button>
        ))}
        <button
          onClick={() => onSelecionar(TODOS_OS_MESES)}
          style={{ ...chipMes, ...(!desabilitado && selecionado === TODOS_OS_MESES ? chipMesAtivo : null) }}
        >
          Todos <span style={{ opacity: 0.6 }}>{totalGeral}</span>
        </button>
        <button
          onClick={() => {
            if (anoDoSelecionado) setAno(anoDoSelecionado);
            setAberta((v) => !v);
          }}
          title="Escolher outro mês"
          aria-label="Escolher outro mês"
          style={{ ...chipMes, padding: "7px 10px", display: "inline-flex", alignItems: "center" }}
        >
          <Icone nome="calendario" tamanho={15} />
        </button>
      </div>

      {aberta && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            padding: 12,
            background: "white",
            border: `1px solid ${CORES.borda}`,
            borderRadius: 8,
            boxShadow: "0 6px 16px rgba(26,26,26,0.12)",
            zIndex: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button
              onClick={() => setAno(anos[idxAno - 1])}
              disabled={idxAno <= 0}
              style={{ ...btnIcone, width: 32, height: 32, opacity: idxAno <= 0 ? 0.3 : 1 }}
            >
              ‹
            </button>
            <span style={{ fontSize: TEXTO.apoio, fontWeight: 600 }}>{ano}</span>
            <button
              onClick={() => setAno(anos[idxAno + 1])}
              disabled={idxAno >= anos.length - 1}
              style={{ ...btnIcone, width: 32, height: 32, opacity: idxAno >= anos.length - 1 ? 0.3 : 1 }}
            >
              ›
            </button>
            <button onClick={() => escolher(TODOS_OS_MESES)} style={{ ...chipMes, marginLeft: 8 }}>
              Todos
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {MESES.map((_, i) => {
              const chave = `${ano}-${String(i + 1).padStart(2, "0")}`;
              const total = totalPorChave[chave];
              const vazio = !total;
              return (
                <button
                  key={chave}
                  onClick={() => !vazio && escolher(chave)}
                  disabled={vazio}
                  style={{
                    ...chipMes,
                    ...(selecionado === chave ? chipMesAtivo : null),
                    padding: "8px 4px",
                    borderRadius: 6,
                    fontSize: TEXTO.miudo,
                    cursor: vazio ? "default" : "pointer",
                    color: vazio ? "#C3CEC8" : selecionado === chave ? CORES.escura : CORES.suave,
                  }}
                >
                  {mesAbreviado(i + 1)}
                  <div style={{ fontSize: TEXTO.apoio, fontWeight: 700, marginTop: 2 }}>{vazio ? "—" : total}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * O campo do local na tela inicial, e a folha que sobe ao tocá-lo.
 *
 * A folha tem busca porque a lista passou de uma tela; tem "Recentes" porque
 * quem trabalha em dois ou três lugares não deveria rolar até o nome deles a
 * cada troca. A busca ignora acento e caixa — "sao luiz" acha o SÃO LUIZ.
 */
/**
 * O campo do local na tela inicial, e a folha que sobe ao tocá-lo.
 *
 * A folha tem busca porque a lista passou de uma tela; tem "Recentes" porque
 * quem trabalha em dois ou três lugares não deveria rolar até o nome deles a
 * cada troca. A busca ignora acento e caixa — "sao luiz" acha o SÃO LUIZ.
 */
function SeletorDeLocal({ local, lembrado, precisaConfirmar, aoConfirmar, recentes, aoEscolher }) {
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState("");
  // Quanto a folha desceu sob o dedo. O início fica numa ref: muda a cada
  // movimento e não precisa redesenhar nada sozinho.
  const [arrasto, setArrasto] = useState(0);
  const inicioDoArrasto = useRef(null);

  function fechar() {
    setAberta(false);
    setBusca("");
    setArrasto(0);
    inicioDoArrasto.current = null;
  }

  // Arrastar pela alça ou pelo cabeçalho fecha, como as folhas do iOS. Só
  // essa faixa responde: na lista, o mesmo gesto é rolar. Pointer events
  // com `touch-action: none` funcionam igual no Safari e no PWA.
  const arrastar = {
    onPointerDown: (ev) => {
      if (ev.target.closest("button")) return; // o "Fechar" continua um toque
      inicioDoArrasto.current = ev.clientY;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    },
    onPointerMove: (ev) => {
      if (inicioDoArrasto.current === null) return;
      setArrasto(Math.max(0, ev.clientY - inicioDoArrasto.current));
    },
    onPointerUp: () => {
      if (inicioDoArrasto.current === null) return;
      inicioDoArrasto.current = null;
      if (arrasto > 90) fechar();
      else setArrasto(0);
    },
  };
  arrastar.onPointerCancel = arrastar.onPointerUp;

  function escolher(nome) {
    aoEscolher(nome);
    fechar();
  }

  // Esc fecha, como em qualquer folha; e a página por trás não rola enquanto
  // a folha está aberta, senão o dedo que rola a lista arrasta o app inteiro.
  useEffect(() => {
    if (!aberta) return undefined;
    const aoTeclar = (ev) => ev.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [aberta]);

  const termo = normalizarTexto(busca.trim());
  const lista = termo ? NOMES_DE_LOCAL.filter((n) => normalizarTexto(n).includes(termo)) : NOMES_DE_LOCAL;
  const mostraRecentes = !termo && recentes.length > 0;

  const item = (nome, comRelogio) => (
    <button
      key={(comRelogio ? "r-" : "") + nome}
      type="button"
      role="option"
      aria-selected={nome === local}
      className="folha-item"
      onClick={() => escolher(nome)}
    >
      {comRelogio && <Icone nome="relogio" tamanho={18} style={{ color: "var(--acento)", flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0 }}>{nome}</span>
      {nome === local && <Icone nome="check" tamanho={20} style={{ color: "var(--acento-texto)", flexShrink: 0 }} />}
    </button>
  );

  return (
    <>
      {local && precisaConfirmar ? (
        <div className="inicio-local confirmar" role="group" aria-labelledby="rotulo-local nome-do-local">
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="inicio-local-icone"><Icone nome="local" tamanho={20} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: "#6b5212" }}>Novo dia. Ainda está em</span>
              <span id="nome-do-local" style={{ fontSize: 16, fontWeight: 600, overflowWrap: "anywhere" }}>{local}?</span>
            </span>
          </span>
          <span style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <button type="button" className="inicio-local-trocar" onClick={() => setAberta(true)}>Trocar</button>
            <button type="button" className="inicio-local-confirmar" onClick={aoConfirmar}>Confirmar</button>
          </span>
        </div>
      ) : local ? (
        <button type="button" className="inicio-local" onClick={() => setAberta(true)} aria-labelledby="rotulo-local nome-do-local">
          <span className="inicio-local-icone"><Icone nome="local" tamanho={20} /></span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <span id="nome-do-local" style={{ fontSize: 16, fontWeight: 600 }}>{local}</span>
            {lembrado && (
              <span style={{ fontSize: 12, color: "#6b665c" }}>Usado por último neste aparelho</span>
            )}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--acento-texto)", flexShrink: 0 }}>Trocar</span>
        </button>
      ) : (
        <button type="button" className="inicio-local vazio" onClick={() => setAberta(true)}>
          <span className="inicio-local-icone"><Icone nome="busca" tamanho={20} /></span>
          <span style={{ fontSize: 15, fontWeight: 500, color: "#5f5b53", flex: 1 }}>Escolha o local para começar</span>
        </button>
      )}

      {aberta && (
        <div className="folha-fundo">
          {/* O espaço vazio acima da folha também fecha: é onde o polegar vai
              naturalmente para desistir. */}
          <button
            type="button"
            aria-label="Fechar lista de locais"
            onClick={fechar}
            style={{ flex: 1, border: "none", background: "transparent", cursor: "pointer" }}
          />
          <div
            className="folha"
            role="dialog"
            aria-modal="true"
            aria-label="Escolher local"
            style={arrasto ? { transform: `translateY(${arrasto}px)`, transition: "none" } : undefined}
          >
            <div className="folha-topo" {...arrastar}>
              <span aria-hidden="true" className="folha-alca" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 12px" }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>Escolher local</span>
                <button
                  type="button"
                  onClick={fechar}
                  style={{ height: 44, padding: "0 4px", border: "none", background: "transparent", color: "var(--acento-texto)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
                >
                  Fechar
                </button>
              </div>
            </div>
            <label className="folha-busca">
              <Icone nome="busca" tamanho={18} />
              <input
                type="search"
                aria-label="Buscar local"
                placeholder="Buscar hospital ou clínica"
                value={busca}
                onChange={(ev) => setBusca(ev.target.value)}
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>
            <div role="listbox" aria-label="Locais" style={{ flex: 1, overflowY: "auto", padding: "0 0 calc(28px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", WebkitOverflowScrolling: "touch" }}>
              {mostraRecentes && (
                <>
                  <span className="folha-secao" style={{ paddingTop: 14 }}>RECENTES</span>
                  {recentes.map((n) => item(n, true))}
                </>
              )}
              <span className="folha-secao">{termo ? "RESULTADOS" : "TODOS OS LOCAIS"}</span>
              {lista.map((n) => item(n, false))}
              {lista.length === 0 && (
                <span style={{ fontSize: 14, color: "#6b665c", padding: "16px 2px" }}>Nenhum local encontrado.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Os lançamentos de hoje desta pessoa, na tela inicial.
 *
 * Responde a pergunta de quem acabou de salvar — "entrou?" — sem trocar de aba.
 * Só os dela, e não os da equipe: num dia cheio, os lançamentos dos colegas
 * enterrariam o que ela acabou de fazer.
 * Só o essencial por linha: o paciente, onde e o convênio. O Executado fica de
 * fora: é campo da conferência, que a secretária marca depois, e aqui ele só
 * apareceria "em aberto" em quase tudo. Tocar abre o registro na lista, que é
 * onde se corrige.
 */
function HojeNaInicio({ registros, carregado, aoAbrir }) {
  // Os mais recentes primeiro: é o que acabou de ser lançado que se procura.
  const ordenados = [...registros].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="inicio-rotulo">
          Hoje
          {ordenados.length > 0 && (
            <span style={{ fontWeight: 500, color: "#8b8b93", marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
              {ordenados.length}
            </span>
          )}
        </span>
        <button type="button" className="inicio-link" onClick={() => aoAbrir(null)}>
          Ver procedimentos
        </button>
      </div>

      {ordenados.length > 0 ? (
        <div className="inicio-cartao" style={{ overflow: "hidden" }}>
          {ordenados.map((e) => {
            return (
              <button key={e.id} type="button" className="inicio-hoje-linha" onClick={() => aoAbrir(e.id)}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.paciente || "Sem nome"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b665c", minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.local || "Sem local"}</span>
                    {e.convenio && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 6,
                          color: corDoConvenio(e.convenio) || "#6b665c",
                          background: fundoDoConvenio(e.convenio) || "#f3f1ec",
                        }}
                      >
                        {e.convenio}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="inicio-cartao" style={{ padding: "22px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
          <Icone nome="calendario" tamanho={28} style={{ color: "var(--acento)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {carregado ? "Você ainda não lançou nada hoje" : "Buscando os seus lançamentos de hoje…"}
          </span>
        </div>
      )}
    </section>
  );
}

function AutocompleteInput({ value, onChange, options, placeholder, invalid, minimo = 0, envolve, estilo }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const q = normalizarTexto(value);
  const matches = (q ? options.filter((o) => normalizarTexto(o).includes(q)) : options).slice(0, 50);

  /**
   * O campo já é exatamente a única sugestão que resta.
   *
   * Depois de tocar num nome, a lista continuava aberta embaixo do campo,
   * repetindo o nome que acabara de ser escolhido, e só sumia ao rolar a tela
   * ou ao tocar em outro campo: no iPhone o teclado fica em pé e o foco volta
   * para a caixa de texto, e voltar o foco reabre a lista.
   *
   * Fechar por aqui não depende de descobrir quem devolveu o foco: quando o que
   * está escrito é igual à única opção que sobrou, não há mais o que escolher, e
   * uma lista de um item igual ao campo não ajuda ninguém. Vale também para quem
   * digita o nome inteiro à mão. Com duas opções parecidas — "ANA RITA" e "ANA
   * RITA DE TULLIO" — a lista continua aberta, que é o certo: ainda há escolha.
   */
  const jaEscolhido = matches.length === 1 && normalizarTexto(matches[0]) === q;
  // `minimo` existe para as listas longas: a de procedimentos tem centenas de
  // entradas, e oferecê-las ao simples tocar no campo não ajuda a escolher.
  const showList = open && q.length >= minimo && matches.length > 0 && !jaEscolhido;

  return (
    <div ref={wrapperRef} style={{ position: "relative", ...envolve }}>
      <input
        style={{
          ...inputStyle,
          ...(invalid ? { border: `1px solid ${CORES.alerta}`, background: CORES.alertaFundo } : null),
          ...estilo,
        }}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      {showList && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "white",
            border: `1px solid ${CORES.borda}`,
            borderRadius: 6,
            marginTop: 4,
            maxHeight: 190,
            overflowY: "auto",
            zIndex: 30,
            boxShadow: "0 6px 16px rgba(26,26,26,0.12)",
          }}
        >
          {matches.map((opt) => (
            <div
              key={opt}
              // Segurar o foco onde está: sem isto o toque tira o foco da caixa
              // de texto e o devolve logo em seguida, e é essa volta que reabria
              // a lista. O clique continua acontecendo normalmente.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                padding: "10px 12px",
                fontSize: TEXTO.apoio,
                cursor: "pointer",
                borderBottom: `1px solid ${CORES.bordaSuave}`,
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>{label}</span>
      {children}
    </label>
  );
}



/**
 * Monta o usuário de cada nome do cadastro, resolvendo homônimos.
 *
 * Dois nomes que dariam o mesmo usuário ganham a inicial do meio
 * (`leandro.m.correa`) em vez de um número: número não diz a ninguém qual é
 * qual. O campo continua editável na tela, porque sempre haverá um nome que
 * nenhuma regra resolve bem.
 */
function usuariosDoCadastro(nomes, jaCadastrados) {
  const quantos = new Map();
  for (const nome of nomes) {
    const u = usuarioDoNome(nome);
    quantos.set(u, (quantos.get(u) || 0) + 1);
  }

  return nomes
    .map((nome) => {
      const base = usuarioDoNome(nome);
      const repete = (quantos.get(base) || 0) > 1 || jaCadastrados.has(base);
      const usuario = repete ? usuarioComMeio(nome) : base;
      return { nome, usuario, jaTem: jaCadastrados.has(usuario) };
    })
    .filter((x) => x.usuario);
}

/**
 * A seção de Acesso, só do mestre.
 *
 * A lista de anestesiologistas não está no código: ela mora no cadastro, que o
 * app já carrega. Então é daqui que a equipe entra no acesso — com o usuário já
 * montado a partir do nome e um PIN inicial único, que cada um troca depois.
 */
function SecaoDeAcesso({ cadastros, avisar, eu, aberto, aoAlternar }) {
  const [pessoas, setPessoas] = useState(null);
  const [pinInicial, setPinInicial] = useState("");
  const [abrirTrazer, setAbrirTrazer] = useState(false);
  const [escolhidos, setEscolhidos] = useState({}); // usuario editado, por nome
  const [marcados, setMarcados] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [pinDe, setPinDe] = useState(null); // usuário cujo PIN está sendo zerado
  const [pinNovo, setPinNovo] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/acesso/pessoas");
      if (!r.ok) throw new Error(await mensagemDeErro(r));
      setPessoas(await r.json());
    } catch (e) {
      console.error(e);
      avisar("Não consegui ler a lista de acessos.", "erro");
      setPessoas([]);
    }
  }, [avisar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const jaCadastrados = useMemo(
    () => new Set((pessoas || []).map((p) => p.usuario)),
    [pessoas]
  );

  const candidatos = useMemo(
    () => usuariosDoCadastro(cadastros.anestesistas || [], jaCadastrados),
    [cadastros.anestesistas, jaCadastrados]
  );

  const paraCriar = candidatos.filter((c) => marcados[c.nome] && !c.jaTem);

  async function criarMarcados() {
    if (ocupado) return;
    if (!/^\d{6}$/.test(pinInicial)) {
      avisar("O PIN inicial precisa ter 6 dígitos.", "erro");
      return;
    }
    if (paraCriar.length === 0) {
      avisar("Marque quem você quer criar.", "erro");
      return;
    }

    setOcupado(true);
    try {
      const r = await fetch("/api/acesso/pessoas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoas: paraCriar.map((c) => ({
            nome: c.nome,
            usuario: escolhidos[c.nome] || c.usuario,
            papel: "equipe",
            pin: pinInicial,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falhou");

      const recusadas = data.recusadas || [];
      avisar(
        recusadas.length === 0
          ? `${data.criadas.length} ${data.criadas.length === 1 ? "pessoa criada" : "pessoas criadas"} com o PIN inicial.`
          : `${data.criadas.length} criadas.\nNão entraram:\n` +
              recusadas.map((x) => `· ${x.nome || x.usuario} — ${x.motivo}`).join("\n"),
        recusadas.length === 0 ? "ok" : "erro"
      );
      setMarcados({});
      await carregar();
    } catch (e) {
      console.error(e);
      avisar("Não consegui criar os acessos. Tente de novo.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function mudar(usuario, mudancas, oQue) {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/acesso/pessoas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, ...mudancas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falhou");
      avisar(oQue);
      await carregar();
      return true;
    } catch (e) {
      console.error(e);
      avisar(`Não consegui ${oQue.toLowerCase()}: ${e.message}`, "erro");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function apagar(usuario) {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch(`/api/acesso/pessoas?usuario=${encodeURIComponent(usuario)}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falhou");
      avisar("Acesso removido.");
      await carregar();
    } catch (e) {
      console.error(e);
      avisar(`Não consegui remover: ${e.message}`, "erro");
    } finally {
      setOcupado(false);
    }
  }

  const linha = {
    border: `1px solid ${CORES.borda}`,
    borderRadius: 6,
    padding: ESPACO[3],
    background: "white",
    display: "flex",
    flexDirection: "column",
    gap: ESPACO[2],
  };

  return (
    <Bloco
      titulo="Acesso"
      quantidade={pessoas ? pessoas.length : undefined}
      aberto={aberto}
      aoAlternar={aoAlternar}
    >
      <div style={{ fontSize: TEXTO.miudo, color: CORES.tenue, marginBottom: ESPACO[3], lineHeight: 1.5 }}>
        Quem pode entrar no app, e com que papel. A secretária vê tudo, confere e apaga; a
        equipe lança e corrige, sem os botões de executado e sem a lixeira.
      </div>

      {/* ── Trazer a equipe do cadastro ───────────────────────────────────── */}
      <button
        onClick={() => setAbrirTrazer((v) => !v)}
        style={{ ...btnSecondary, width: "100%", padding: "10px 12px", fontSize: TEXTO.apoio, marginBottom: ESPACO[3] }}
      >
        <Icone nome={abrirTrazer ? "acima" : "abaixo"} />{" "}
        {abrirTrazer ? "Fechar" : "Trazer do cadastro de anestesiologistas"}
      </button>

      {abrirTrazer && (
        <div style={{ ...linha, marginBottom: ESPACO[3] }}>
          <div style={{ fontSize: TEXTO.apoio, color: CORES.suave, lineHeight: 1.45 }}>
            Marque quem entra. O usuário sai do nome; dá para corrigir antes de criar. O PIN
            inicial é o mesmo para todos — cada um troca o seu no app depois.
          </div>

          <input
            value={pinInicial}
            onChange={(e) => setPinInicial(e.target.value.replace(/\D/g, "").slice(0, DIGITOS_DO_PIN))}
            placeholder={`PIN inicial (${DIGITOS_DO_PIN} dígitos)`}
            inputMode="numeric"
            style={inputStyle}
          />

          {candidatos.length === 0 && (
            <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>
              O cadastro de anestesiologistas está vazio.
            </div>
          )}

          {candidatos.map((c) => (
            <div key={c.nome} style={{ display: "flex", alignItems: "center", gap: ESPACO[2] }}>
              <input
                type="checkbox"
                disabled={c.jaTem}
                checked={Boolean(marcados[c.nome]) && !c.jaTem}
                onChange={(e) => setMarcados((m) => ({ ...m, [c.nome]: e.target.checked }))}
                style={{ width: 20, height: 20, flexShrink: 0, accentColor: CORES.principal }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: TEXTO.apoio, color: c.jaTem ? CORES.tenue : CORES.tinta }}>{c.nome}</div>
                {c.jaTem ? (
                  <div style={{ fontSize: TEXTO.miudo, color: CORES.tenue }}>já tem acesso: {c.usuario}</div>
                ) : (
                  <input
                    value={escolhidos[c.nome] !== undefined ? escolhidos[c.nome] : c.usuario}
                    onChange={(e) =>
                      setEscolhidos((x) => ({ ...x, [c.nome]: e.target.value.toLowerCase().replace(/\s/g, "") }))
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ ...inputStyle, fontSize: TEXTO.apoio, padding: "6px 8px", marginTop: 2 }}
                  />
                )}
              </div>
            </div>
          ))}

          <button
            onClick={criarMarcados}
            disabled={ocupado || paraCriar.length === 0}
            style={{ ...btnPrimary, opacity: ocupado || paraCriar.length === 0 ? 0.5 : 1 }}
          >
            {paraCriar.length === 0 ? "Criar os marcados" : `Criar ${paraCriar.length}`}
          </button>
        </div>
      )}

      {/* ── O código de cópia, para o app de teste ─────────────────────────── */}
      <CodigoDeCopia avisar={avisar} />

      {/* ── Quem já tem acesso ────────────────────────────────────────────── */}
      {pessoas === null ? (
        <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>…</div>
      ) : pessoas.length === 0 ? (
        <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>Ninguém cadastrado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ESPACO[2] }}>
          {pessoas.map((p) => (
            <div key={p.usuario} style={{ ...linha, opacity: p.ativo ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: ESPACO[2] }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: TEXTO.corpo }}>
                    {p.usuario}
                    {p.usuario === (eu && eu.usuario) ? " (você)" : ""}
                  </div>
                  <div style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>
                    {p.nome || "(sem nome)"}
                    {p.ativo ? "" : " · desativado"}
                    {p.pinTrocado ? "" : " · PIN inicial"}
                  </div>
                </div>
                <select
                  value={p.papel}
                  onChange={(e) => mudar(p.usuario, { papel: e.target.value }, "Papel trocado")}
                  style={{ ...inputStyle, width: "auto", fontSize: TEXTO.apoio, padding: "6px 8px" }}
                >
                  {PAPEIS.map((papel) => (
                    <option key={papel} value={papel}>
                      {ROTULO_DO_PAPEL[papel]}
                    </option>
                  ))}
                </select>
              </div>

              {pinDe === p.usuario ? (
                <div style={{ display: "flex", gap: ESPACO[2] }}>
                  <input
                    value={pinNovo}
                    onChange={(e) => setPinNovo(e.target.value.replace(/\D/g, "").slice(0, DIGITOS_DO_PIN))}
                    placeholder="PIN novo"
                    inputMode="numeric"
                    autoFocus
                    style={{ ...inputStyle, flex: 1, fontSize: TEXTO.apoio }}
                  />
                  <button
                    onClick={async () => {
                      const foi = await mudar(p.usuario, { pin: pinNovo }, "PIN trocado");
                      if (foi) {
                        setPinDe(null);
                        setPinNovo("");
                      }
                    }}
                    disabled={ocupado || pinNovo.length !== DIGITOS_DO_PIN}
                    style={{ ...btnPrimary, flex: "0 0 auto", padding: "8px 12px", opacity: pinNovo.length === DIGITOS_DO_PIN ? 1 : 0.5 }}
                  >
                    Trocar
                  </button>
                  <button
                    onClick={() => {
                      setPinDe(null);
                      setPinNovo("");
                    }}
                    aria-label="Cancelar"
                    style={{ ...btnSecondary, flex: "0 0 auto", padding: "8px 12px" }}
                  >
                    <Icone nome="fechar" tamanho={16} />
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: ESPACO[1], flexWrap: "wrap" }}>
                  <button onClick={() => setPinDe(p.usuario)} style={{ ...btnDiscreto, flex: "0 0 auto" }}>
                    Zerar PIN
                  </button>
                  <button
                    onClick={() => mudar(p.usuario, { derrubarAparelhos: true }, "Aparelhos derrubados")}
                    style={{ ...btnDiscreto, flex: "0 0 auto" }}
                  >
                    Sair de todos os aparelhos
                  </button>
                  <button
                    onClick={() => mudar(p.usuario, { ativo: !p.ativo }, p.ativo ? "Desativado" : "Reativado")}
                    style={{ ...btnDiscreto, flex: "0 0 auto" }}
                  >
                    {p.ativo ? "Desativar" : "Reativar"}
                  </button>
                  <button
                    onClick={() => apagar(p.usuario)}
                    style={{ ...btnDiscreto, flex: "0 0 auto", color: CORES.alerta }}
                  >
                    <Icone nome="lixo" tamanho={16} /> Remover
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Bloco>
  );
}

/**
 * "Trocar meu PIN", para qualquer papel.
 *
 * Existe porque o PIN inicial é o mesmo para a equipe inteira: trocar o seu é o
 * que faz dele um PIN seu. Trocar derruba os outros aparelhos — se o antigo
 * vazou, o cookie que ele gerou vazou também —, e este aparelho recebe um
 * cookie novo na mesma resposta.
 */
/**
 * O código que deixa o app de teste copiar os pacientes daqui.
 *
 * Fica aqui, na seção do mestre, porque é dele a decisão de abrir a porta. O
 * código vale quinze minutos, serve só para LER e não é cookie: quem o tiver
 * não entra no app, não grava nada e não vira ninguém.
 *
 * O texto some da tela quando o prazo acaba — um código morto na tela é um
 * convite a tentar de novo com ele e não entender por que não funciona.
 */
function CodigoDeCopia({ avisar }) {
  const [codigo, setCodigo] = useState("");
  const [faltam, setFaltam] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!codigo) return;
    const t = setInterval(() => {
      setFaltam((s) => {
        if (s <= 1) {
          setCodigo("");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [codigo]);

  async function gerar() {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/acesso/codigo", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falhou");
      setCodigo(data.codigo);
      setFaltam(data.minutos * 60);
    } catch (e) {
      avisar(`Não consegui gerar o código: ${e.message}`, "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      avisar("Código copiado.");
    } catch (e) {
      avisar("Não consegui copiar sozinho — selecione o texto e copie à mão.", "erro");
    }
  }

  const minutos = Math.floor(faltam / 60);
  const segundos = String(faltam % 60).padStart(2, "0");

  return (
    <div style={{ marginBottom: ESPACO[4] }}>
      <button
        onClick={gerar}
        disabled={ocupado}
        style={{ ...btnSecondary, width: "100%", padding: "10px 12px", fontSize: TEXTO.apoio }}
      >
        <Icone nome="abaixo" />{" "}
        {codigo ? "Gerar outro código de cópia" : "Código para copiar os pacientes (app de teste)"}
      </button>

      {codigo && (
        <div
          style={{
            marginTop: ESPACO[2],
            border: `1px solid ${CORES.borda}`,
            borderRadius: 6,
            padding: ESPACO[3],
            background: "white",
          }}
        >
          <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginBottom: ESPACO[2], lineHeight: 1.45 }}>
            Cole este código no app de teste, em Acesso → Trazer os pacientes. Ele serve só para
            ler, e vence em {minutos}:{segundos}.
          </div>
          <div
            style={{
              fontSize: TEXTO.miudo,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              wordBreak: "break-all",
              background: CORES.fundo,
              border: `1px solid ${CORES.bordaSuave}`,
              borderRadius: 4,
              padding: ESPACO[2],
              marginBottom: ESPACO[2],
            }}
          >
            {codigo}
          </div>
          <button onClick={copiar} style={{ ...btnPrimary, width: "100%", padding: "10px 12px", fontSize: TEXTO.apoio }}>
            Copiar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * As iniciais de quem está logado, para o botão do cabeçalho.
 *
 * Iniciais, e não um ícone genérico: num aparelho que passa de mão em mão, a
 * primeira pergunta é "estou logado como quem?", e um bonequinho não responde.
 */
function iniciaisDe(eu) {
  // Sem ninguém, não há inicial: devolve vazio, e o botão desenha o ícone de
  // pessoa no lugar — um emoji ali mudava de desenho em cada aparelho.
  if (!eu) return "";

  const palavras = (eu.nome || "").trim().split(/\s+/).filter(Boolean);
  if (palavras.length >= 2) return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();

  return (eu.usuario || "").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
}

/**
 * O painel da conta, no cabeçalho: quem sou, trocar meu PIN, sair.
 *
 * Fica no cabeçalho porque vale nas três abas. Antes morava no fim dos
 * Cadastros, e sair do app exigia ir procurar.
 *
 * "Trocar meu PIN" existe para os três papéis porque o PIN inicial é o mesmo
 * para a equipe inteira: trocar o seu é o que faz dele um PIN seu. Trocar
 * derruba os OUTROS aparelhos — se o antigo vazou, o cookie que ele gerou
 * vazou também —, e este aqui recebe um cookie novo na mesma resposta.
 */
function MeuAcesso({ eu, avisar, aoTerminar }) {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [novo, setNovo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function trocar() {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/acesso/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinAtual: atual, pinNovo: novo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falhou");
      avisar("PIN trocado. Os outros aparelhos vão pedir o novo.");
      setAberto(false);
      setAtual("");
      setNovo("");
      if (aoTerminar) aoTerminar();
    } catch (e) {
      avisar(`Não consegui trocar o PIN: ${e.message}`, "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    try {
      await fetch("/api/acesso/sair", { method: "POST" });
    } catch (e) {
      console.error(e);
    }
    // Navegação de verdade, e não troca de tela: assim o que estava carregado
    // em memória sai junto com a sessão.
    window.location.href = "/entrar";
  }

  const soDigitos = (v) => v.replace(/\D/g, "").slice(0, DIGITOS_DO_PIN);
  const botao = { ...btnSecondary, width: "100%", flex: "none", padding: "11px 12px", fontSize: TEXTO.apoio };

  return (
    <div>
      <div style={{ fontSize: TEXTO.corpo, color: CORES.tinta, lineHeight: 1.3 }}>
        {(eu && eu.nome) || (eu && eu.usuario) || "Acesso"}
      </div>
      <div style={{ fontSize: TEXTO.miudo, color: CORES.tenue, marginTop: 2, marginBottom: ESPACO[3] }}>
        {eu ? `${eu.usuario} · ${ROTULO_DO_PAPEL[eu.papel] || eu.papel}` : "não consegui confirmar quem está logado"}
      </div>

      {aberto ? (
        <div style={{ display: "flex", flexDirection: "column", gap: ESPACO[2] }}>
          <input
            value={atual}
            onChange={(e) => setAtual(soDigitos(e.target.value))}
            placeholder="PIN atual"
            inputMode="numeric"
            autoFocus
            style={{ ...inputStyle, fontSize: TEXTO.apoio }}
          />
          <input
            value={novo}
            onChange={(e) => setNovo(soDigitos(e.target.value))}
            placeholder="PIN novo"
            inputMode="numeric"
            style={{ ...inputStyle, fontSize: TEXTO.apoio }}
          />
          <div style={{ display: "flex", gap: ESPACO[2] }}>
            <button
              onClick={trocar}
              disabled={ocupado || atual.length !== DIGITOS_DO_PIN || novo.length !== DIGITOS_DO_PIN}
              style={{
                ...btnPrimary,
                padding: "11px 12px",
                fontSize: TEXTO.apoio,
                opacity: ocupado || atual.length !== DIGITOS_DO_PIN || novo.length !== DIGITOS_DO_PIN ? 0.5 : 1,
              }}
            >
              Trocar
            </button>
            <button onClick={() => setAberto(false)} style={{ ...btnSecondary, padding: "11px 12px", fontSize: TEXTO.apoio }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ESPACO[2] }}>
          <button onClick={() => setAberto(true)} style={botao}>
            Trocar meu PIN
          </button>
          <button onClick={sair} style={{ ...botao, color: CORES.alerta }}>
            Sair deste aparelho
          </button>
        </div>
      )}

      {/* A versão, no rodapé da caixa.
      
          Aqui porque é a única gaveta do app que já é sobre "este aparelho":
          quem abre para sair ou trocar o PIN encontra, no mesmo lugar, qual
          versão está rodando nele. No cabeçalho seria ruído permanente para
          uma informação que se consulta uma vez por mês. */}
      <div
        style={{
          marginTop: ESPACO[3],
          paddingTop: ESPACO[2],
          borderTop: `1px solid ${CORES.bordaSuave}`,
          fontSize: TEXTO.miudo,
          color: CORES.tenue,
        }}
      >
        ver {VERSAO_VISIVEL}
      </div>
    </div>
  );
}
