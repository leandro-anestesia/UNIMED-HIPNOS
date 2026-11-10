import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { NOMES_DE_LOCAL, leituraDoLocal } from "../lib/locais";
import { chaveDeOrdem, ordenarRegistros } from "../lib/ordem";
import { modeloDoRegistro } from "../lib/modelos";
import { CORES, EQUIPE, PREFIXO_ARQUIVO, TITULO, corDoConvenio } from "../lib/marca";
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
  dataDoTexto,
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
  const textos = [
    e.atendimento,
    e.paciente,
    e.convenio,
    e.cirurgiao,
    e.anestesista,
    e.anestesistaCarimbo,
    ...(e.procedimentos || []),
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
  const [lendo, setLendo] = useState("guia"); // guia | mapa
  const [activeTab, setActiveTab] = useState("novo"); // novo | procedimentos | cadastros
  const [viewingEntry, setViewingEntry] = useState(null);
  const [cadastros, setCadastros] = useState(CADASTROS_VAZIOS);
  const [searchQuery, setSearchQuery] = useState("");
  const [mesSelecionado, setMesSelecionado] = useState(null); // null = ainda não escolhido
  const [sincronizando, setSincronizando] = useState(false);

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

  const loadEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/entries");
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
   * O local não é lembrado entre uma abertura e outra, de propósito.
   *
   * Campo que volta preenchido é campo que não se lê: quem opera no Bairral
   * abriria o app, fotografaria a guia e salvaria — e o registro iria para o
   * lugar do dia anterior, sem ninguém ter errado de digitar. O local sai em
   * coluna nas três planilhas e é por ele que a conferência diz onde a cirurgia
   * foi; local errado é pior do que local em branco, porque o branco se vê.
   */
  function escolherLocal(local) {
    setLocalAtivo(local);
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

  async function addCadastro(tipo, nome, { avisarFalha = true } = {}) {
    try {
      const r = await fetch("/api/cadastros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nome }),
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
    for (const f of CAMPOS_QUE_APRENDEM) {
      const valor = (dados[f.key] || "").toString().trim();
      if (!valor) continue;
      const jaTem = (cadastros[f.cadastroKey] || []).some(
        (n) => normalizarTexto(n) === normalizarTexto(valor)
      );
      if (jaTem) continue;
      await addCadastro(f.cadastroKey, valor, { avisarFalha: false });
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
    setErrorMsg("");
    setLendo("mapa");
    setStatus("extracting");
    try {
      const base64 = await fileToResizedBase64(file);

      const r = await fetch("/api/extract-mapa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.error || "Falha na leitura do mapa");

      const data = dataDoTexto(parsed.data) || agoraLocal().data;
      const linhas = (parsed.registros || []).map((p) => {
        const paciente = (p.paciente || "").toUpperCase();
        const procedimentos = (p.procedimentos || []).map((x) => (x || "").toUpperCase());
        return {
          ...p,
          paciente,
          procedimentos,
          jaLancado: jaExiste(paciente, data, procedimentos),
          incluido: !jaExiste(paciente, data, procedimentos),
        };
      });

      if (linhas.length === 0) {
        setErrorMsg("Não achei nenhum paciente nesse mapa. Confira se a foto pegou a tabela inteira.");
        setStatus("idle");
        return;
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
      valor: "",
      procedimentoComplementar: [],
      observacao: "",
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
        await aprenderCadastros({ convenio: linha.convenio, cirurgiao: linha.cirurgiao });
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

      // `data` não é campo do registro: é a data lida do documento, que entra
      // como data do lançamento. Fica fora do que se espalha no rascunho.
      const { data: dataLida, ...parsed } = respostaDaLeitura;

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
        // A etiqueta traz a data do atendimento, e ela vale mais que a de hoje:
        // a etiqueta pode ser lida no dia seguinte, e o mês da planilha mudaria.
        ...(dataDoTexto(dataLida) ? { dataCirurgia: dataDoTexto(dataLida) } : {}),
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

    const payload = { ...draft, procedimentos: marcados(draft.procedimentos) };

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

      // O que a planilha mudou e o app não pôde aceitar precisa aparecer: em
      // silêncio, a pessoa acharia que a correção dela valeu.
      const recusadas = data.recusadas || [];
      const pendencias = recusadas.length
        ? "\n\nNão consegui aceitar:\n" +
          recusadas.map((x) => `· ${x.paciente || "(sem nome)"} — ${x.coluna}: ${x.motivo}`).join("\n")
        : "";

      if (data.configurado === false) {
        avisar("A planilha do Google ainda não está configurada.", "erro");
      } else if (!data.ok) {
        avisar("Sincronizado com pendências:\n" + JSON.stringify(data.falhas || {}, null, 2), "erro");
      } else if (trouxe.length > 0) {
        avisar(`Planilha sincronizada. Trouxe ${trouxe.join(" e ")}.${pendencias}`);
      } else {
        avisar(`Planilha sincronizada. Nada novo vindo dela.${pendencias}`);
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

  const registrosVisiveis = entries
    .filter((e) => localFiltro === TODOS_OS_LOCAIS || (e.local || "").trim() === localFiltro)
    .filter((e) => convenioFiltro === TODOS_OS_CONVENIOS || (e.convenio || "").trim() === convenioFiltro)
    .filter((e) => entryMatchesSearch(e, searchQuery))
    .filter((e) => buscando || mesSelecionado === TODOS_OS_MESES || !mesSelecionado || chaveDoMes(e) === mesSelecionado)
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
    <div style={{ minHeight: "100vh", background: CORES.fundo, color: CORES.tinta, paddingBottom: 96 }}>
      <div style={{ background: CORES.escura, padding: "20px 20px 24px", position: "relative" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${CORES.principal}, ${CORES.acento})` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo-mark.png" alt={EQUIPE} style={{ height: 40, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.15em", color: CORES.acento, textTransform: "uppercase", marginBottom: 4 }}>
              {EQUIPE}
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 400, color: CORES.sobreEscura }}>{TITULO}</h1>
            <div style={{ fontSize: TEXTO.apoio, color: CORES.acento, marginTop: 4 }}>
              {loaded ? `${entries.length} registro${entries.length === 1 ? "" : "s"} · compartilhado` : "carregando…"}
            </div>
          </div>
        </div>
      </div>

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
            ⚠ Não consegui carregar os registros ({falhaDeCarga}). A lista abaixo
            não reflete o que está gravado — confira antes de lançar.
          </div>
        )}

        {status === "idle" && activeTab === "novo" && (
          // Empilhados e do mesmo tamanho: numa tela de celular, três alvos
          // largos e bem separados erram menos que dois espremidos lado a lado.
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* O local vem antes dos botões porque é a primeira decisão: o que
                se fotografa num lugar não vale no outro.

                Num seletor, e não em fichas: os nomes são longos e viravam
                três linhas de retângulos arredondados, indistinguíveis dos
                botões logo abaixo. Aqui ocupa uma linha e mostra o escolhido
                sem abrir nada.

                Começa vazio e não é lembrado: a escolha é consciente, toda
                vez. Enquanto nada está escolhido o seletor fica neutro; com
                local, acende — a mesma distinção que o filtro da lista usa. */}
            <Field label="Local">
              <select
                value={localAtivo}
                onChange={(ev) => escolherLocal(ev.target.value)}
                style={{
                  ...inputStyle,
                  fontWeight: localAtivo ? 600 : 400,
                  color: localAtivo ? CORES.escura : CORES.suave,
                  background: localAtivo ? CORES.clara : "white",
                  borderColor: localAtivo ? CORES.principal : CORES.borda,
                }}
              >
                <option value="">— Escolha o local —</option>
                {NOMES_DE_LOCAL.map((local) => (
                  <option key={local} value={local}>
                    {local}
                  </option>
                ))}
              </select>
            </Field>

            {!localAtivo && (
              <div
                style={{
                  marginTop: -10,
                  fontSize: TEXTO.apoio,
                  color: CORES.suave,
                }}
              >
                Escolha o local para começar.
              </div>
            )}

            {/* Um primário só, e o resto discreto: com quatro botões do mesmo
                peso, a tela vira uma lista de retângulos e nenhum é o caminho
                óbvio.

                Qual é o óbvio depende do local: onde a folha do dia traz todos
                os pacientes, é o mapa; onde se fotografa um por um, é a guia.
                Quem sabe a diferença é `lib/locais.js`, e o outro botão fica
                logo abaixo nos dois casos — é peso, não permissão.

                Sem local escolhido, os quatro esperam. Barrar aqui é melhor do
                que deixar fotografar a guia e recusar na hora de salvar: a
                leitura custa uma chamada ao modelo e a paciência de quem está
                no centro cirúrgico. */}
            {leituraDoLocal(localAtivo) === "mapa" ? (
              <button
                onClick={() => mapaInputRef.current && mapaInputRef.current.click()}
                disabled={!localAtivo}
                style={semLocal(btnEmpilhado(btnPrimary), localAtivo)}
              >
                📋 Ler mapa cirúrgico
              </button>
            ) : (
              <button
                onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                disabled={!localAtivo}
                style={semLocal(btnEmpilhado(btnPrimary), localAtivo)}
              >
                📷 Fotografar guia ou etiqueta
              </button>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {leituraDoLocal(localAtivo) === "mapa" ? (
                <button
                  onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                  disabled={!localAtivo}
                  style={semLocal(btnEmpilhado(btnDiscreto), localAtivo)}
                >
                  📷 Fotografar etiqueta ou guia
                </button>
              ) : (
                <button
                  onClick={() => mapaInputRef.current && mapaInputRef.current.click()}
                  disabled={!localAtivo}
                  style={semLocal(btnEmpilhado(btnDiscreto), localAtivo)}
                >
                  📋 Ler mapa cirúrgico
                </button>
              )}
              <button
                onClick={() => galleryInputRef.current && galleryInputRef.current.click()}
                disabled={!localAtivo}
                style={semLocal(btnEmpilhado(btnDiscreto), localAtivo)}
              >
                🖼 Da galeria
              </button>
              <button
                onClick={startManual}
                disabled={!localAtivo}
                style={semLocal(btnEmpilhado(btnDiscreto), localAtivo)}
              >
                ✏️ Preencher manualmente
              </button>
            </div>
          </div>
        )}

        {status === "extracting" && (
          <div style={{ padding: 24, borderRadius: 8, border: `1px solid ${CORES.principal}`, background: CORES.clara, textAlign: "center", fontSize: TEXTO.apoio }}>
            {lendo === "mapa" ? "Lendo o mapa cirúrgico…" : "Lendo a guia…"}
          </div>
        )}

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <input ref={mapaInputRef} type="file" accept="image/*" onChange={handleMapa} style={{ display: "none" }} />

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
                      {[l.hora, l.convenio, l.cirurgiao ? `Dr(a). ${l.cirurgiao}` : "", l.nGuia ? `Guia ${l.nGuia}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      {l.jaLancado && (
                        <span style={{ color: CORES.alerta, fontWeight: 600 }}> · já lançado</span>
                      )}
                    </div>
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
                {salvando
                  ? "Salvando…"
                  : `✓ Adicionar ${mapa.linhas.filter((l) => l.incluido).length} registro(s)`}
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
                        {avisoDaGuia.estado === "valida" || avisoDaGuia.estado === "completada" ? "✓ " : "⚠ "}
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
                <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>
                  Procedimentos solicitados na guia
                </span>
                {(draft.procedimentos || []).length === 0 && (
                  <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>
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
                    <input
                      style={{
                        ...inputStyle,
                        flex: 1,
                        minWidth: 0,
                        opacity: linha.incluido ? 1 : 0.45,
                        textDecoration: linha.incluido ? "none" : "line-through",
                      }}
                      type="text"
                      value={linha.descricao || ""}
                      onChange={(e) => updateProcedimento(i, { descricao: e.target.value.toUpperCase() })}
                      placeholder="Código e descrição do procedimento"
                    />
                    <button type="button" onClick={() => removeProcedimento(i)} style={{ ...iconBtn, color: CORES.alerta, flexShrink: 0 }}>
                      🗑
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addProcedimento} style={{ ...btnSecondary, padding: "10px 12px", fontSize: TEXTO.apoio }}>
                  + Acrescentar procedimento
                </button>
              </div>

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
                  <div
                    className="aviso-guia-complementar"
                    style={{
                      fontSize: TEXTO.apoio,
                      fontWeight: 700,
                      color: CORES.alerta,
                      textAlign: "center",
                    }}
                  >
                    NÃO ESQUEÇA DE PREENCHER A GUIA COMPLEMENTAR
                    <style jsx>{`
                      .aviso-guia-complementar {
                        animation: piscar-aviso 1.8s ease-in-out infinite;
                      }
                      @keyframes piscar-aviso {
                        0%,
                        100% {
                          opacity: 1;
                        }
                        50% {
                          opacity: 0.25;
                        }
                      }
                      @media (prefers-reduced-motion: reduce) {
                        .aviso-guia-complementar {
                          animation: none;
                        }
                      }
                    `}</style>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>Executado</span>
                <Escolha
                  campo="executado"
                  valor={draft.executado}
                  onEscolher={(estado) => updateDraft("executado", estado)}
                  grande
                />
              </div>

              {/* O complementar tem o próprio ciclo de cobrança, e só na
                  conferência da Unimed ele é acompanhado. */}
              {modeloDoRegistro(draft) === "convenio" && (
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
                ✕ Cancelar
              </button>
              <button
                onClick={confirmEntry}
                disabled={salvando}
                style={{ ...btnPrimary, flex: 2, opacity: salvando ? 0.6 : 1, cursor: salvando ? "default" : "pointer" }}
              >
                {salvando ? "Salvando…" : `✓ ${editingId ? "Salvar alterações" : "Adicionar ao controle"}`}
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
            <input
              style={{ ...inputStyle, marginBottom: 12 }}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔎 Buscar por paciente, data, mês, procedimento, cirurgião ou anestesiologista"
            />

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
                desabilitado={buscando}
              />
            )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.1em", textTransform: "uppercase", color: CORES.suave }}>
                  {buscando
                    ? "Resultados da busca"
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
                  style={{ ...btnIcone, opacity: sincronizando ? 0.6 : 1 }}
                >
                  {sincronizando ? "…" : "🔄"}
                </button>
                <button onClick={exportExcel} title="Baixar planilha do ano em Excel" style={btnIcone}>
                  ⬇
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
                    padding: `${ESPACO[3]}px ${ESPACO[4]}px`,
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
                    <input
                      type="checkbox"
                      checked={e.conferido === true}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => updateConferido(e, ev.target.checked)}
                      title="Conferido"
                      style={{ width: 20, height: 20, flexShrink: 0, cursor: "pointer", accentColor: CORES.principal }}
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
                            gap: 6,
                            minWidth: 0,
                          }}
                        >
                          {e.dataCirurgia && (
                            <span style={{ color: CORES.suave, flexShrink: 0 }}>
                              {formatarData(e.dataCirurgia)}
                            </span>
                          )}
                          {e.convenio && (
                            <span
                              style={{
                                color: corDoConvenio(e.convenio) || CORES.suave,
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
                        <span style={{ color: CORES.principal, fontSize: TEXTO.apoio, fontWeight: 700 }}>✓</span>
                      )}
                      {/* O incompleto precisa de marca própria: sem ela, de fora
                          ele se confunde com o que não foi feito, que é o
                          contrário do motivo de o estado existir. */}
                      {estadoDe("executado", e.executado) === "incompleto" && (
                        <span style={{ color: CORES.avisoTinta, fontSize: TEXTO.miudo, fontWeight: 700 }}>
                          INCOMPLETO
                        </span>
                      )}
                      <span style={{ color: CORES.tenue, fontSize: TEXTO.miudo }}>{aberto ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {aberto && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>
                            {formatarData(e.dataCirurgia)}
                            {horaDoRegistro(e) ? ` · ${horaDoRegistro(e)}` : ""}
                            {e.cirurgiao ? ` · Dr(a). ${e.cirurgiao}` : ""}
                            {e.anestesista ? ` · Anest. Dr(a). ${e.anestesista}` : ""}
                          </div>
                          <LinhaDeIdentificacao entry={e} />
                          {(e.procedimentoComplementar || []).length > 0 && (
                            <div style={{ fontSize: TEXTO.miudo, color: CORES.principal, marginTop: 4 }}>
                              {e.procedimentoComplementar.join(" · ")}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button onClick={() => setViewingEntry(e)} style={iconBtn} title="Ver tudo">⋯</button>
                          <button onClick={() => startEdit(e)} style={iconBtn}>✎</button>
                          <button onClick={() => deleteEntry(e.id)} style={{ ...iconBtn, color: CORES.alerta }}>🗑</button>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${CORES.bordaSuave}` }}>
                        <div style={{ fontSize: TEXTO.apoio, flex: 1, paddingRight: 8 }}>
                          {(e.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS) || "(sem procedimento)"}
                        </div>
                        <Escolha
                          campo="executado"
                          valor={e.executado}
                          onEscolher={(estado) => updateExecutado(e, estado)}
                        />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <CadastroSection
              title="Cirurgiões"
              placeholder="Nome do cirurgião"
              items={cadastros.cirurgioes}
              onAdd={(nome) => addCadastro("cirurgioes", nome)}
              onImportar={(nomes) => importarCadastros("cirurgioes", nomes)}
              onRemove={(nome) => removeCadastro("cirurgioes", nome)}
            />
            <CadastroSection
              title="Anestesiologistas"
              placeholder="Nome do anestesiologista"
              items={cadastros.anestesistas}
              onAdd={(nome) => addCadastro("anestesistas", nome)}
              onImportar={(nomes) => importarCadastros("anestesistas", nomes)}
              onRemove={(nome) => removeCadastro("anestesistas", nome)}
            />
            {/* Estas duas listas se enchem sozinhas, a cada registro salvo.
                Estão aqui para o caso contrário: apagar um nome que entrou
                escrito errado.

                Os locais não estão mais aqui: viraram lista fechada no código,
                e um cadastro que aprende ao lado de uma lista fechada só
                serviria para criar um décimo terceiro local escrito torto. */}
            <CadastroSection
              title="Convênios"
              placeholder="Nome do convênio"
              items={cadastros.convenios}
              onAdd={(nome) => addCadastro("convenios", nome)}
              onImportar={(nomes) => importarCadastros("convenios", nomes)}
              onRemove={(nome) => removeCadastro("convenios", nome)}
            />
            <CadastroSection
              title="Quem recebe"
              placeholder="Nome de quem recebe"
              items={cadastros.recebedores}
              onAdd={(nome) => addCadastro("recebedores", nome)}
              onImportar={(nomes) => importarCadastros("recebedores", nomes)}
              onRemove={(nome) => removeCadastro("recebedores", nome)}
            />

            {/* A área de conferência é tela de computador, e não entra na barra
                de abas do celular — ela atrapalharia quem lança. Fica aqui, no
                fim dos ajustes, que é onde quem administra já vem. */}
            <a
              href="/secretaria"
              style={{
                display: "block",
                textAlign: "center",
                padding: ESPACO[3],
                marginTop: ESPACO[2],
                borderRadius: 8,
                border: `1px solid ${CORES.borda}`,
                background: "white",
                color: CORES.suave,
                textDecoration: "none",
                fontSize: TEXTO.apoio,
                fontWeight: 500,
              }}
            >
              📊 Área de conferência
            </a>
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
              <button onClick={() => setViewingEntry(null)} style={iconBtn}>✕</button>
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
                ⧉ Duplicar
              </button>
              <button
                onClick={() => {
                  const entry = viewingEntry;
                  setViewingEntry(null);
                  startEdit(entry);
                }}
                style={{ ...btnPrimary, flex: 1 }}
              >
                ✎ Editar
              </button>
            </div>
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
            bottom: `calc(${ALVO + ESPACO[2] + ESPACO[3]}px + env(safe-area-inset-bottom))`,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            gap: ESPACO[3],
            maxWidth: 640,
            margin: "0 auto",
            padding: `${ESPACO[3]}px ${ESPACO[4]}px`,
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
                fontSize: 16,
                lineHeight: 1,
                color: "inherit",
              }}
            >
              ✕
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
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            background: "white",
            borderTop: `1px solid ${CORES.borda}`,
            // O respiro da barra do iPhone, que fica por cima do conteúdo.
            paddingBottom: "env(safe-area-inset-bottom)",
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
                style={{
                  flex: 1,
                  minHeight: ALVO + ESPACO[2],
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  padding: `${ESPACO[2]}px 0`,
                  background: "none",
                  border: "none",
                  borderTop: `2px solid ${ativa ? CORES.principal : "transparent"}`,
                  color: ativa ? CORES.escura : CORES.suave,
                  fontWeight: ativa ? 600 : 500,
                  fontSize: TEXTO.miudo,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 19, lineHeight: 1 }}>{aba.icone}</span>
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

/** As três abas do app, na ordem em que aparecem no rodapé. */
const ABAS = [
  { chave: "novo", nome: "Novo", icone: "➕" },
  { chave: "procedimentos", nome: "Procedimentos", icone: "📋" },
  { chave: "cadastros", nome: "Cadastros", icone: "👥" },
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

  const convenio = (entry.convenio || "").trim();
  const local = (entry.local || "").trim();
  if (numeros.length === 0 && !convenio && !local) return null;

  const cor = corDoConvenio(convenio);

  return (
    <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginTop: 2 }}>
      {numeros.join(" · ")}
      {numeros.length > 0 && convenio ? " · " : ""}
      {/* Só o nome do convênio muda de cor; os números continuam discretos. */}
      {convenio && <span style={{ color: cor || "inherit", fontWeight: cor ? 600 : 400 }}>{convenio}</span>}
      {/* O local agora existe sempre, e diz onde a cirurgia foi — é parte do
          que se procura ao percorrer a lista. */}
      {local && ((numeros.length > 0 || convenio ? " · " : "") + local)}
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
          onClick={() => onEscolher(estado.valor)}
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

function CadastroSection({ title, placeholder, items, onAdd, onImportar, onRemove }) {
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
    <div>
      <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.1em", textTransform: "uppercase", color: CORES.suave, marginBottom: 10 }}>
        {title}
      </div>
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
          {abrirLote ? "▴ Fechar importação" : "▾ Colar uma lista de nomes"}
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
              <button onClick={() => onRemove(n)} style={{ ...iconBtn, color: CORES.alerta }}>🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
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
function SeletorDeMes({ meses, selecionado, onSelecionar, totalGeral, desabilitado }) {
  const [aberta, setAberta] = useState(false);
  const wrapperRef = useRef(null);

  const anos = [...new Set(meses.map((m) => m.chave.slice(0, 4)))].sort();
  const anoDoSelecionado = selecionado && selecionado !== TODOS_OS_MESES ? selecionado.slice(0, 4) : null;
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
          style={{ ...chipMes, padding: "7px 11px" }}
        >
          ▾
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

function AutocompleteInput({ value, onChange, options, placeholder, invalid }) {
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
  const showList = open && matches.length > 0 && !jaEscolhido;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        style={invalid ? { ...inputStyle, border: `1px solid ${CORES.alerta}`, background: CORES.alertaFundo } : inputStyle}
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


