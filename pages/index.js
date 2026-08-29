import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { normalizarTexto } from "../lib/texto";
import { analisarGuia } from "../lib/guia";
import { CORES, EQUIPE, TITULO, PREFIXO_ARQUIVO } from "../lib/marca";
import { CAMPOS_DA_GUIA, CAMPOS_MANUAIS, COLUNAS, SEPARADOR_PROCEDIMENTOS, valorDaColuna } from "../lib/campos";
import { agoraLocal, formatarData, horaDoRegistro, dataHoraDoInstante } from "../lib/tempo";

const PROCEDIMENTOS_COMPLEMENTARES = [
  "31602339 - Bloqueio anestesico de plexo",
  "30906164 - Cateterismo de artéria radial",
  "30913012 - Implante de cateter venoso central",
  "31602223 - Passagem de cateter peridural",
  "31602029 - Analgesia por dia subsequente",
  "40202445 - Laringoscopia para intubação - com vídeo ou fibro",
  "31602169 - Bloqueio peridural ou subaracnoide (analgesia pós operatória)",
  "31402038 - Tampão sanguíneo peridurals",
];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const TODOS_OS_MESES = "todos";

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

/** Do lançamento mais recente para o mais antigo; empate desfeito pela criação. */
function ordenarPorData(a, b) {
  const porData = (b.dataCirurgia || "").localeCompare(a.dataCirurgia || "");
  if (porData !== 0) return porData;
  return (b.criadoEm || "").localeCompare(a.criadoEm || "");
}

function entryMatchesSearch(e, query) {
  const q = normalizarTexto(query);
  if (!q) return true;
  const textos = [e.paciente, e.cirurgiao, e.anestesista, e.anestesistaCarimbo, ...(e.procedimentos || [])];
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

function emptyDraft() {
  const { data, hora } = agoraLocal();
  const d = {};
  CAMPOS_DA_GUIA.forEach((f) => (d[f.key] = ""));
  CAMPOS_MANUAIS.forEach((f) => (d[f.key] = ""));
  d.dataCirurgia = data;
  d.horaLancamento = hora;
  d.procedimentos = [];
  d.procedimentoComplementar = [];
  d.observacao = "";
  d.executado = false;
  d.urgencia = false;
  return d;
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
  const [activeTab, setActiveTab] = useState("novo"); // novo | procedimentos | cadastros
  const [viewingEntry, setViewingEntry] = useState(null);
  const [cadastros, setCadastros] = useState({ cirurgioes: [], anestesistas: [] });
  const [searchQuery, setSearchQuery] = useState("");
  const [mesSelecionado, setMesSelecionado] = useState(null); // null = ainda não escolhido
  const [sincronizando, setSincronizando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);
  const [guiaInfo, setGuiaInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [draft, setDraft] = useState(emptyDraft());
  const [imagePreview, setImagePreview] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const loadEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/entries");
      const data = await r.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadCadastros = useCallback(async () => {
    try {
      const r = await fetch("/api/cadastros");
      const data = await r.json();
      setCadastros({ cirurgioes: data.cirurgioes || [], anestesistas: data.anestesistas || [] });
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadEntries();
    loadCadastros();
  }, [loadEntries, loadCadastros]);

  // Memoizado porque entra na dependência do efeito abaixo: recriar o array a
  // cada render faria o efeito rodar sem necessidade.
  const meses = useMemo(() => mesesDosRegistros(entries), [entries]);

  // Abre no mês corrente; se ele ainda não tiver registro, no mês mais recente
  // que tiver. Só define uma vez — não pode desfazer a escolha do usuário a
  // cada recarga da lista.
  useEffect(() => {
    if (mesSelecionado !== null || meses.length === 0) return;
    const atual = agoraLocal().data.slice(0, 7);
    setMesSelecionado(meses.some((m) => m.chave === atual) ? atual : meses[0].chave);
  }, [meses, mesSelecionado]);

  async function addCadastro(tipo, nome) {
    try {
      const r = await fetch("/api/cadastros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nome }),
      });
      const data = await r.json();
      setCadastros({ cirurgioes: data.cirurgioes || [], anestesistas: data.anestesistas || [] });
    } catch (e) {
      console.error(e);
    }
  }

  async function removeCadastro(tipo, nome) {
    try {
      const r = await fetch(`/api/cadastros?tipo=${encodeURIComponent(tipo)}&nome=${encodeURIComponent(nome)}`, { method: "DELETE" });
      const data = await r.json();
      setCadastros({ cirurgioes: data.cirurgioes || [], anestesistas: data.anestesistas || [] });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErrorMsg("");
    setStatus("extracting");
    try {
      const base64 = await fileToResizedBase64(file);
      setImagePreview(`data:image/jpeg;base64,${base64}`);

      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.error || "Falha na extração");

      // A guia às vezes chega sem o último dígito: completa já aqui, que é o
      // momento do "lançar a guia", e mostra o que aconteceu.
      const guia = analisarGuia(parsed.nGuia);
      setGuiaInfo(guia.estado === "vazia" ? null : guia);
      setDraft({
        ...emptyDraft(),
        ...parsed,
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
      const current = d.procedimentoComplementar || [];
      const next = current.includes(item) ? current.filter((i) => i !== item) : [...current, item];
      return { ...d, procedimentoComplementar: next };
    });
  }

  async function confirmEntry() {
    // A trava real é o ref: o estado do React só vale no próximo render, e um
    // toque duplo rápido dispararia dois envios antes disso. O `salvando` serve
    // para o visual do botão.
    if (salvandoRef.current) return;

    if (!(draft.anestesista || "").trim()) {
      setErrorMsg("Informe o anestesista que fez o procedimento para salvar o registro.");
      return;
    }

    const payload = { ...draft, procedimentos: marcados(draft.procedimentos) };

    salvandoRef.current = true;
    setSalvando(true);
    try {
      if (editingId) {
        await fetch("/api/entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editingId }),
        });
      } else {
        let r = await fetch("/api/entries", {
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
      await loadEntries();
    } catch (e) {
      console.error(e);
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
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
    setDraft(emptyDraft());
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
    // Mostra logo de cara se a guia já gravada tem algum problema.
    const g = analisarGuia(entry.nGuia);
    setGuiaInfo(g.estado === "vazia" ? null : g);
    setStatus("review");
  }

  async function deleteEntry(id) {
    await fetch(`/api/entries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadEntries();
  }

  async function updateExecutado(entry, value) {
    const updated = { ...entry, executado: value };
    setEntries((prev) => prev.map((x) => (x.id === entry.id ? updated : x)));
    try {
      await fetch("/api/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function sincronizarPlanilha() {
    setSincronizando(true);
    try {
      const r = await fetch("/api/sync-sheets", { method: "POST" });
      const data = await r.json();
      await loadEntries();
      const vindos = (data.importadosDaPlanilha || []).length;
      if (data.configurado === false) {
        alert("A planilha do Google ainda não está configurada.");
      } else if (!data.ok) {
        alert("Sincronizado com pendências:\n" + JSON.stringify(data.falhas || {}, null, 2));
      } else if (vindos > 0) {
        alert(`Planilha sincronizada. ${vindos} registro(s) atualizado(s) a partir dela.`);
      } else {
        alert("Planilha sincronizada. Nada novo vindo dela.");
      }
    } catch (e) {
      console.error(e);
      alert("Não consegui sincronizar com a planilha agora.");
    } finally {
      setSincronizando(false);
    }
  }

  // A busca tem prioridade sobre o mês: procurar um paciente de julho com
  // agosto selecionado precisa achar, senão parece que o registro sumiu.
  const buscando = normalizarTexto(searchQuery).length > 0;
  const registrosVisiveis = entries
    .filter((e) => entryMatchesSearch(e, searchQuery))
    .filter((e) => buscando || mesSelecionado === TODOS_OS_MESES || !mesSelecionado || chaveDoMes(e) === mesSelecionado)
    .sort(ordenarPorData);

  const resumo = {
    total: registrosVisiveis.length,
    executados: registrosVisiveis.filter((e) => e.executado === true).length,
    urgencias: registrosVisiveis.filter((e) => e.urgencia === true).length,
  };

  function exportExcel() {
    if (entries.length === 0) return;

    const headers = [
      "Data",
      "Hora do lançamento",
      ...COLUNAS.map((c) => c.label),
      "Executado",
      "Procedimento complementar",
      "Observação",
    ];
    const toRow = (e) => [
      formatarData(e.dataCirurgia),
      horaDoRegistro(e),
      ...COLUNAS.map((c) => valorDaColuna(e, c)),
      e.executado === true ? "Sim" : "Não",
      (e.procedimentoComplementar || []).join(", "),
      e.observacao || "",
    ];

    // Agrupa por ano e, dentro do ano, por mês (1-12). Sem data cai em "Sem data".
    const porAno = {};
    entries.forEach((e) => {
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
        XLSX.writeFile(wb, `${PREFIXO_ARQUIVO}-${ano}.xlsx`);
      });
  }

  return (
    <div style={{ minHeight: "100vh", background: CORES.fundo, fontFamily: "'Helvetica Neue', Arial, sans-serif", color: CORES.tinta, paddingBottom: 100 }}>
      <div style={{ background: CORES.escura, padding: "20px 20px 24px", position: "relative" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${CORES.principal}, ${CORES.acento})` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo-mark.png" alt={EQUIPE} style={{ height: 40, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 11, letterSpacing: "0.15em", color: CORES.acento, textTransform: "uppercase", marginBottom: 4 }}>
              {EQUIPE}
            </div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 400, color: "white" }}>{TITULO}</h1>
            <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, color: CORES.acento, marginTop: 4 }}>
              {loaded ? `${entries.length} registro${entries.length === 1 ? "" : "s"} · compartilhado` : "carregando…"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
        {status === "idle" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "white", border: `1px solid ${CORES.borda}`, borderRadius: 8, padding: 4 }}>
            <button onClick={() => setActiveTab("novo")} style={activeTab === "novo" ? tabBtnActive : tabBtn}>
              Novo
            </button>
            <button onClick={() => setActiveTab("procedimentos")} style={activeTab === "procedimentos" ? tabBtnActive : tabBtn}>
              Procedimentos
            </button>
            <button onClick={() => setActiveTab("cadastros")} style={activeTab === "cadastros" ? tabBtnActive : tabBtn}>
              Cadastros
            </button>
          </div>
        )}

        {status === "idle" && activeTab === "novo" && (
          <div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                style={btnPrimary}
              >
                📷 Fotografar guia
              </button>
              <button
                onClick={() => galleryInputRef.current && galleryInputRef.current.click()}
                style={btnSecondary}
              >
                🖼 Da galeria
              </button>
            </div>
            <button onClick={startManual} style={{ ...btnSecondary, width: "100%", marginTop: 10 }}>
              ✏️ Preencher manualmente
            </button>
          </div>
        )}

        {status === "extracting" && (
          <div style={{ padding: 24, borderRadius: 8, border: `1px solid ${CORES.principal}`, background: CORES.clara, textAlign: "center", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14 }}>
            Lendo a guia…
          </div>
        )}

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />

        {status === "review" && (
          <div style={{ border: `1px solid ${CORES.borda}`, borderRadius: 8, background: "white", overflow: "hidden" }}>
            <div style={{ background: CORES.clara, padding: "12px 16px", borderBottom: `1px solid ${CORES.borda}`, fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, fontWeight: 600 }}>
              {editingId ? "Editar registro" : imagePreview ? "Confira os dados lidos da guia" : "Novo registro manual"}
            </div>

            {errorMsg && (
              <div style={{ padding: "12px 16px", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, color: CORES.avisoTinta, background: CORES.avisoFundo, borderBottom: `1px solid ${CORES.borda}` }}>
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
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 2, minWidth: 0 }}>
                  <Field label="Data do lançamento">
                    <input style={inputStyle} type="date" value={draft.dataCirurgia || ""} onChange={(e) => updateDraft("dataCirurgia", e.target.value)} />
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Hora">
                    <input style={inputStyle} type="time" value={draft.horaLancamento || ""} onChange={(e) => updateDraft("horaLancamento", e.target.value)} />
                  </Field>
                </div>
              </div>

              {CAMPOS_DA_GUIA.map((f) => {
                // O cirurgião vem lido da guia, mas mantém o autocompletar do
                // cadastro: é assim que se corrige leitura ruim e se padroniza
                // a grafia do nome.
                if (f.cadastroKey) {
                  return (
                    <Field key={f.key} label={f.label}>
                      <AutocompleteInput
                        value={draft[f.key] || ""}
                        onChange={(v) => updateDraft(f.key, v)}
                        options={cadastros[f.cadastroKey] || []}
                        placeholder={f.label}
                      />
                    </Field>
                  );
                }

                const campo = (
                  <Field key={f.key} label={f.label}>
                    <input
                      style={inputStyle}
                      type="text"
                      value={draft[f.key] || ""}
                      onChange={(e) => updateDraft(f.key, f.maiusculo ? e.target.value.toUpperCase() : e.target.value)}
                      placeholder={f.label}
                    />
                  </Field>
                );

                // Urgência anda junto do nº da guia: é o caso de cirurgia sem
                // guia, ou com guia apenas clínica puxada pelo sistema.
                if (f.key !== "nGuia") return campo;

                return (
                  <div key={f.key}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Field label={f.label}>
                          <input
                            style={
                              guiaInfo && guiaInfo.estado !== "valida" && guiaInfo.estado !== "completada"
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
                              const r = analisarGuia(e.target.value);
                              setGuiaInfo(r.estado === "vazia" ? null : r);
                              if (r.numero !== e.target.value) updateDraft(f.key, r.numero);
                            }}
                            placeholder={f.label}
                            inputMode="numeric"
                          />
                        </Field>
                      </div>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "10px 12px",
                          border: `1px solid ${draft.urgencia ? CORES.alerta : CORES.borda}`,
                          borderRadius: 4,
                          background: draft.urgencia ? CORES.alertaFundo : "white",
                          color: draft.urgencia ? CORES.alerta : CORES.tinta,
                          fontFamily: "Helvetica, Arial, sans-serif",
                          fontSize: 14,
                          fontWeight: draft.urgencia ? 600 : 400,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!draft.urgencia}
                          onChange={(e) => updateDraft("urgencia", e.target.checked)}
                          style={{ width: 16, height: 16 }}
                        />
                        Urgência
                      </label>
                    </div>

                    {guiaInfo && guiaInfo.mensagem && (
                      <div
                        style={{
                          marginTop: 6,
                          fontFamily: "Helvetica, Arial, sans-serif",
                          fontSize: 12,
                          color:
                            guiaInfo.estado === "valida" || guiaInfo.estado === "completada" ? CORES.principal : CORES.alerta,
                        }}
                      >
                        {guiaInfo.estado === "valida" || guiaInfo.estado === "completada" ? "✓ " : "⚠ "}
                        {guiaInfo.mensagem}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Procedimentos solicitados: a leitura traz todos marcados, e o
                  anestesista desmarca o que não se aplica. Só os marcados são
                  gravados, na mesma célula da planilha. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave }}>
                  Procedimentos solicitados na guia
                </span>
                {(draft.procedimentos || []).length === 0 && (
                  <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, color: CORES.tenue }}>
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
                <button type="button" onClick={addProcedimento} style={{ ...btnSecondary, padding: "10px 12px", fontSize: 14 }}>
                  + Acrescentar procedimento
                </button>
              </div>

              <div style={{ height: 1, background: CORES.bordaSuave, margin: "4px 0" }} />

              {CAMPOS_MANUAIS.map((f) => {
                const rotulo = f.appLabel || f.label;
                return (
                  <Field key={f.key} label={f.required ? `${rotulo} *` : rotulo}>
                    <AutocompleteInput
                      value={draft[f.key] || ""}
                      onChange={(v) => updateDraft(f.key, v)}
                      options={cadastros[f.cadastroKey] || []}
                      placeholder={rotulo}
                      invalid={f.required && !!errorMsg && !(draft[f.key] || "").trim()}
                    />
                  </Field>
                );
              })}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave }}>Executado</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => updateDraft("executado", true)}
                    style={{ ...(draft.executado === true ? execBtnYesActive : execBtn), flex: 1, padding: "10px 12px", fontSize: 14 }}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDraft("executado", false)}
                    style={{ ...(draft.executado !== true ? execBtnNoActive : execBtn), flex: 1, padding: "10px 12px", fontSize: 14 }}
                  >
                    Não
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave }}>Procedimento Complementar</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {PROCEDIMENTOS_COMPLEMENTARES.map((item) => (
                    <label key={item} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={(draft.procedimentoComplementar || []).includes(item)}
                        onChange={() => toggleComplementar(item)}
                        style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
                      />
                      {item}
                    </label>
                  ))}
                </div>
                {(draft.procedimentoComplementar || []).length > 0 && (
                  <div
                    className="aviso-guia-vermelha"
                    style={{
                      fontFamily: "Helvetica, Arial, sans-serif",
                      fontSize: 13,
                      fontWeight: 700,
                      color: CORES.alerta,
                      textAlign: "center",
                    }}
                  >
                    NÃO ESQUEÇA DE PREENCHER A GUIA VERMELHA COMPLEMENTAR
                    <style jsx>{`
                      .aviso-guia-vermelha {
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
                        .aviso-guia-vermelha {
                          animation: none;
                        }
                      }
                    `}</style>
                  </div>
                )}
              </div>

              <Field label="Observação">
                <textarea
                  style={{ ...inputStyle, resize: "vertical" }}
                  rows={3}
                  value={draft.observacao || ""}
                  onChange={(e) => updateDraft("observacao", e.target.value)}
                  placeholder="Observações adicionais"
                />
              </Field>
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
            <input
              style={{ ...inputStyle, marginBottom: 12 }}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔎 Buscar por paciente, data, mês, procedimento, cirurgião ou anestesista"
            />

            {/* Durante a busca o seletor fica esmaecido e sem efeito,
                porque a procura roda em todos os meses. */}
            {meses.length > 0 && (
              <SeletorDeMes
                meses={meses}
                selecionado={buscando ? null : mesSelecionado}
                onSelecionar={setMesSelecionado}
                totalGeral={entries.length}
                desabilitado={buscando}
              />
            )}

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: CORES.suave }}>
                  {buscando
                    ? "Resultados da busca"
                    : mesSelecionado === TODOS_OS_MESES || !mesSelecionado
                    ? "Todos os registros"
                    : nomeDoMes(mesSelecionado, true)}
                </div>
                <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.tenue, marginTop: 2 }}>
                  {resumo.total} {resumo.total === 1 ? "registro" : "registros"}
                  {` · ${resumo.executados} executado${resumo.executados === 1 ? "" : "s"}`}
                  {resumo.urgencias > 0 && ` · ${resumo.urgencias} urgência${resumo.urgencias === 1 ? "" : "s"}`}
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
                <div style={{ textAlign: "center", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14, color: CORES.tenue, padding: "24px 0" }}>
                  Nenhum registro encontrado para essa busca.
                </div>
              )}
              {registrosVisiveis.map((e) => (
                <div
                  key={e.id}
                  onClick={() => setViewingEntry(e)}
                  style={{ border: `1px solid ${CORES.borda}`, borderRadius: 6, background: "white", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 16 }}>
                        {e.paciente || "(sem nome)"}
                        {e.urgencia && (
                          <span
                            style={{
                              marginLeft: 8,
                              padding: "2px 8px",
                              borderRadius: 10,
                              background: CORES.alertaFundo,
                              color: CORES.alerta,
                              border: `1px solid ${CORES.alerta}`,
                              fontFamily: "Helvetica, Arial, sans-serif",
                              fontSize: 11,
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                            }}
                          >
                            URGÊNCIA
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave, marginTop: 2 }}>
                        {formatarData(e.dataCirurgia)}
                        {horaDoRegistro(e) ? ` · ${horaDoRegistro(e)}` : ""}
                        {e.cirurgiao ? ` · Dr(a). ${e.cirurgiao}` : ""}
                        {e.anestesista ? ` · Anest. Dr(a). ${e.anestesista}` : ""}
                      </div>
                      {(e.nCarteira || e.nGuia) && (
                        <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave, marginTop: 2 }}>
                          {e.nGuia ? `Nº Guia: ${e.nGuia}` : ""}
                          {e.nGuia && e.nCarteira ? " · " : ""}
                          {e.nCarteira ? `Carteira: ${e.nCarteira}` : ""}
                        </div>
                      )}
                      {(e.procedimentoComplementar || []).length > 0 && (
                        <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 11, color: CORES.principal, marginTop: 4 }}>
                          {e.procedimentoComplementar.join(" · ")}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={(ev) => { ev.stopPropagation(); startEdit(e); }} style={iconBtn}>✎</button>
                      <button onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }} style={{ ...iconBtn, color: CORES.alerta }}>🗑</button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${CORES.bordaSuave}` }}>
                    <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, flex: 1, paddingRight: 8 }}>
                      {(e.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS) || "(sem procedimento)"}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={(ev) => { ev.stopPropagation(); updateExecutado(e, true); }} style={e.executado === true ? execBtnYesActive : execBtn}>
                        Sim
                      </button>
                      <button onClick={(ev) => { ev.stopPropagation(); updateExecutado(e, false); }} style={e.executado !== true ? execBtnNoActive : execBtn}>
                        Não
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {status === "idle" && activeTab === "procedimentos" && loaded && entries.length === 0 && (
          <div style={{ marginTop: 32, textAlign: "center", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14, color: CORES.tenue }}>
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
              onRemove={(nome) => removeCadastro("cirurgioes", nome)}
            />
            <CadastroSection
              title="Anestesistas"
              placeholder="Nome do anestesista"
              items={cadastros.anestesistas}
              onAdd={(nome) => addCadastro("anestesistas", nome)}
              onRemove={(nome) => removeCadastro("anestesistas", nome)}
            />
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
              <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, fontWeight: 600 }}>Detalhes do registro</span>
              <button onClick={() => setViewingEntry(null)} style={iconBtn}>✕</button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <ViewField label="Data do lançamento" value={formatarData(viewingEntry.dataCirurgia)} />
              <ViewField label="Hora do lançamento" value={horaDoRegistro(viewingEntry)} />
              {CAMPOS_DA_GUIA.map((f) => (
                <ViewField key={f.key} label={f.label} value={viewingEntry[f.key]} />
              ))}
              <ViewField label="Procedimentos" value={(viewingEntry.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS)} />
              {CAMPOS_MANUAIS.map((f) => (
                <ViewField key={f.key} label={f.appLabel || f.label} value={viewingEntry[f.key]} />
              ))}
              <ViewField label="Urgência" value={viewingEntry.urgencia ? "Sim" : "Não"} />
              <ViewField label="Executado" value={viewingEntry.executado === true ? "Sim" : "Não"} />
              <ViewField label="Procedimento complementar" value={(viewingEntry.procedimentoComplementar || []).join(", ")} />
              <ViewField label="Observação" value={viewingEntry.observacao} />
              <ViewField label="Criado em" value={dataHoraDoInstante(viewingEntry.criadoEm)} />
            </div>
            <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
              <button onClick={() => setViewingEntry(null)} style={{ ...btnSecondary, flex: 1 }}>Fechar</button>
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
    </div>
  );
}

function ViewField({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave }}>{label}</div>
      <div style={{ fontSize: 15, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CadastroSection({ title, placeholder, items, onAdd, onRemove }) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  }

  return (
    <div>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: CORES.suave, marginBottom: 10 }}>
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
      {items.length === 0 ? (
        <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, color: CORES.tenue }}>Nenhum cadastrado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((n) => (
            <div
              key={n}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${CORES.borda}`, borderRadius: 6, background: "white", padding: "8px 12px" }}
            >
              <span style={{ fontSize: 14 }}>{n}</span>
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
            <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14, fontWeight: 600 }}>{ano}</span>
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
                    fontSize: 12,
                    cursor: vazio ? "default" : "pointer",
                    color: vazio ? "#C3CEC8" : selecionado === chave ? CORES.escura : CORES.suave,
                  }}
                >
                  {mesAbreviado(i + 1)}
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{vazio ? "—" : total}</div>
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
  const showList = open && matches.length > 0;

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
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "Helvetica, Arial, sans-serif",
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
      <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: CORES.suave }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  // Sem isto, padding e borda somam à largura e o campo estoura o container.
  boxSizing: "border-box",
  padding: "10px 12px",
  border: `1px solid ${CORES.borda}`,
  borderRadius: 4,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontSize: 15,
  background: "white",
};

const btnIcone = {
  width: 38,
  height: 38,
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

const btnPrimary = {
  flex: 1,
  padding: "16px",
  borderRadius: 8,
  background: CORES.principal,
  color: "white",
  border: `1px solid ${CORES.principal}`,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};

const btnSecondary = {
  flex: 1,
  padding: "16px",
  borderRadius: 8,
  background: "white",
  color: CORES.tinta,
  border: `1px solid ${CORES.borda}`,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontWeight: 500,
  fontSize: 15,
  cursor: "pointer",
};

const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 6,
  color: CORES.suave,
  fontSize: 16,
};

const tabBtn = {
  flex: 1,
  padding: "10px",
  borderRadius: 6,
  background: "transparent",
  color: CORES.suave,
  border: "none",
  fontFamily: "Helvetica, Arial, sans-serif",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const tabBtnActive = {
  ...tabBtn,
  background: CORES.clara,
  color: CORES.escura,
};

// Chips do seletor de mês: mesma linguagem visual das abas, porém compactos e
// sem `flex: 1`, para caberem numa fileira que rola na horizontal.
const chipMes = {
  padding: "7px 12px",
  borderRadius: 16,
  background: "white",
  color: CORES.suave,
  border: `1px solid ${CORES.borda}`,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const chipMesAtivo = {
  background: CORES.clara,
  color: CORES.escura,
  border: `1px solid ${CORES.principal}`,
};

const execBtn = {
  padding: "6px 12px",
  borderRadius: 6,
  background: "white",
  color: CORES.suave,
  border: `1px solid ${CORES.borda}`,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

const execBtnYesActive = {
  ...execBtn,
  background: CORES.principal,
  color: "white",
  border: `1px solid ${CORES.principal}`,
};

const execBtnNoActive = {
  ...execBtn,
  background: CORES.alerta,
  color: "white",
  border: `1px solid ${CORES.alerta}`,
};
