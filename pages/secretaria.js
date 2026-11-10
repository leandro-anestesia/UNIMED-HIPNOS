import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  COLUNAS_OUTROS,
  COLUNA_EXECUTADO,
  COLUNAS_PARTICULAR,
  COLUNAS_UNIMED,
  valorDaColuna,
} from "../lib/campos";
import { ALVO, ESPACO, TEXTO, btnDiscreto, btnPrimary, inputStyle } from "../lib/estilo";
import { aceitaVazio, estadoDe, foiExecutada, foiRecebido, opcoesDe } from "../lib/estados";
import { CORES, PREFIXO_ARQUIVO, TITULO, corDoConvenio } from "../lib/marca";
import { MODELOS, modeloDoRegistro } from "../lib/modelos";
import { contarPendencias, diasParados, temPendencia } from "../lib/pendencias";
import { normalizarTexto } from "../lib/texto";
import { formatarData } from "../lib/tempo";

/**
 * A área de conferência — a tela da secretária.
 *
 * Página própria, e não uma aba a mais no celular: o trabalho dela é outro. O
 * anestesiologista lança um paciente por vez, em pé, no corredor; ela confere
 * trezentos por mês, sentada, com teclado. Uma tela que serve bem aos dois não
 * serve bem a nenhum.
 *
 * O caminho é sempre o mesmo: escolher o mês, ver o que falta, resolver, e
 * marcar. Por isso a página tem esta ordem — período, pendências, totais,
 * tabela. A tabela é a última coisa, não a primeira: quem abre quer saber o que
 * fazer, não ver tudo.
 *
 * Lê o mesmo `lib/` e o mesmo banco do app. Nenhuma rota nova: o `GET
 * /api/entries?mes=` já existia para isto, e a edição é o mesmo `PUT` que a
 * lista do app usa.
 */

/**
 * As colunas de cada planilha, com o Executado na frente — exatamente como o
 * arquivo do Google.
 *
 * Com a mesma ordem, quem alterna entre a tela e a planilha não precisa
 * reaprender onde cada coisa está. O Executado é prefixado aqui, e não dentro
 * de cada lista, porque `lib/campos.js` também o mantém de fora: ele é fixo
 * nas três, e repeti-lo em três listas seria três lugares para esquecer.
 */
const COLUNAS_DO_MODELO = {
  convenio: [COLUNA_EXECUTADO, ...COLUNAS_UNIMED],
  outros: [COLUNA_EXECUTADO, ...COLUNAS_OUTROS],
  particular: [COLUNA_EXECUTADO, ...COLUNAS_PARTICULAR],
};

/**
 * O que não aparece de saída, por planilha.
 *
 * Quinze colunas não cabem em tela nenhuma sem encolher a letra a ponto de não
 * se ler. O padrão é o que cabe numa tela de notebook sem rolar para o lado, e
 * o que sai é o que a conferência consulta de vez em quando, não o tempo todo:
 * o horário do lançamento, que só desempata dois registros do mesmo dia; o
 * local e os dois nomes de médico, que ela confere abrindo a guia e não a
 * tabela; o complementar por extenso, que o "PC Executado" já resume; e a
 * observação, que é campo de exceção.
 *
 * Cada uma volta num clique no botão "Colunas" — e aí a tabela rola, que é o
 * preço justo de pedir mais do que cabe.
 *
 * A escolha fica guardada no aparelho dela. Não é decisão do app qual coluna
 * importa — é dela, e muda conforme o mês.
 */
const OCULTAS_POR_PADRAO = {
  convenio: [
    "horaLancamento",
    "local",
    "cirurgiao",
    "anestesista",
    "procedimentoComplementar",
    "observacao",
  ],
  outros: ["local", "cirurgiao", "anestesista", "procedimentoComplementar", "observacao"],
  particular: ["local", "atendimento", "cirurgiao", "inicio", "termino", "observacao"],
};

const COLUNAS_GUARDADAS = "guias:secretaria:colunas";

/** O que ela edita direto na célula. O resto é leitura. */
const EDITAVEIS = new Set([
  "executado",
  "pcExecutado",
  "recebido",
  "quemRecebeu",
  "valor",
  "observacao",
  "nGuia",
  "nCarteira",
  "atendimento",
]);

/** Como cada planilha se chama nos botões — curto, porque são três lado a lado. */
const NOME_CURTO = {
  convenio: "Unimed",
  outros: "Outros convênios",
  particular: "Particular",
};

const MESES_DO_ANO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeDoMes(chave) {
  const [ano, mes] = (chave || "").split("-");
  const nome = MESES_DO_ANO[parseInt(mes, 10) - 1];
  return nome ? `${nome.replace(/^./, (c) => c.toUpperCase())} de ${ano}` : "Sem data";
}

function mesDeHoje() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/** Dinheiro como se escreve no Brasil, para ler na tabela e nos totais. */
function emReais(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || valor === "" || valor == null) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Secretaria() {
  const [modelo, setModelo] = useState("convenio");
  const [mes, setMes] = useState(mesDeHoje());
  const [meses, setMeses] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState({});
  const [pendencia, setPendencia] = useState("");
  const [selecionados, setSelecionados] = useState(new Set());

  const [ocultas, setOcultas] = useState(OCULTAS_POR_PADRAO);
  const [escolhendoColunas, setEscolhendoColunas] = useState(false);

  useEffect(() => {
    try {
      const guardado = JSON.parse(window.localStorage.getItem(COLUNAS_GUARDADAS) || "null");
      if (guardado) setOcultas({ ...OCULTAS_POR_PADRAO, ...guardado });
    } catch {
      // aparelho com armazenamento bloqueado: segue com o padrão
    }
  }, []);

  function alternarColuna(key) {
    setOcultas((atual) => {
      const doModelo = atual[modelo] || [];
      const novo = {
        ...atual,
        [modelo]: doModelo.includes(key) ? doModelo.filter((k) => k !== key) : [...doModelo, key],
      };
      try {
        window.localStorage.setItem(COLUNAS_GUARDADAS, JSON.stringify(novo));
      } catch {
        // idem
      }
      return novo;
    });
  }

  const [aviso, setAviso] = useState("");
  const avisoTimer = useRef(null);
  const avisar = useCallback((texto) => {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso(texto);
    avisoTimer.current = setTimeout(() => setAviso(""), 4000);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch(`/api/entries?mes=${encodeURIComponent(mes)}`);
      if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
      const lista = await r.json();
      setRegistros(Array.isArray(lista) ? lista : []);
    } catch (e) {
      console.error(e);
      setErro(e.message || "não consegui carregar");
      setRegistros([]);
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    fetch("/api/entries?meses=1")
      .then((r) => r.json())
      .then((lista) => setMeses(Array.isArray(lista) ? lista : []))
      .catch(() => setMeses([]));
  }, [registros.length]);

  // Trocar de mês ou de planilha zera a seleção: marcar em lote o que não está
  // mais na tela seria marcar às cegas.
  useEffect(() => setSelecionados(new Set()), [mes, modelo]);

  const doModelo = useMemo(
    () => registros.filter((e) => modeloDoRegistro(e) === modelo),
    [registros, modelo]
  );

  /**
   * Os valores que cada filtro pode assumir, tirados do que está na tela.
   *
   * Do que está na tela, e não de uma lista fixa: oferecer um cirurgião que não
   * operou neste mês só produz filtro que não acha nada.
   */
  const opcoesDoFiltro = useMemo(() => {
    const distintos = (campo) =>
      [...new Set(doModelo.map((e) => (e[campo] || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      );
    return {
      local: distintos("local"),
      convenio: distintos("convenio"),
      cirurgiao: distintos("cirurgiao"),
      anestesista: distintos("anestesista"),
      anestesistaCarimbo: distintos("anestesistaCarimbo"),
    };
  }, [doModelo]);

  const visiveis = useMemo(() => {
    const procura = normalizarTexto(busca);
    return doModelo
      .filter((e) =>
        Object.entries(filtros).every(([campo, valor]) => !valor || (e[campo] || "").trim() === valor)
      )
      .filter((e) => !pendencia || temPendencia(e, pendencia))
      .filter((e) => {
        if (!procura) return true;
        return [e.paciente, e.nGuia, e.nCarteira, e.atendimento, e.cirurgiao, e.anestesista]
          .map((v) => normalizarTexto(v))
          .some((v) => v.includes(procura));
      })
      .sort((a, b) => (a.dataCirurgia || "").localeCompare(b.dataCirurgia || ""));
  }, [doModelo, filtros, pendencia, busca]);

  const cestas = useMemo(() => contarPendencias(doModelo), [doModelo]);

  const totais = useMemo(() => {
    const recebido = visiveis.filter(foiRecebidoDe).reduce((s, e) => s + (Number(e.valor) || 0), 0);
    const aReceber = visiveis.filter((e) => !foiRecebidoDe(e)).reduce((s, e) => s + (Number(e.valor) || 0), 0);
    return {
      total: visiveis.length,
      executados: visiveis.filter((e) => foiExecutada(e.executado)).length,
      conferidos: visiveis.filter((e) => e.conferido === true).length,
      recebido,
      aReceber,
    };
  }, [visiveis]);

  function foiRecebidoDe(e) {
    return foiRecebido(e.recebido);
  }

  /** Grava um campo de um registro, desfazendo na tela se o servidor recusar. */
  async function gravar(entry, campo, valor) {
    const antes = registros;
    const atualizado = { ...entry, [campo]: valor };
    setRegistros((lista) => lista.map((e) => (e.id === entry.id ? atualizado : e)));
    try {
      const r = await fetch("/api/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(atualizado),
      });
      if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
    } catch (e) {
      console.error(e);
      setRegistros(antes);
      avisar("Não consegui salvar. O valor voltou ao que estava.");
    }
  }

  /** O mesmo, para vários de uma vez — é o que fecha um mês. */
  async function gravarEmLote(campo, valor) {
    const alvos = visiveis.filter((e) => selecionados.has(e.id));
    if (alvos.length === 0) return;

    for (const entry of alvos) {
      // Em série, e não em paralelo: o servidor trava por mês, e vinte
      // gravações simultâneas só fariam fila do outro lado.
      // eslint-disable-next-line no-await-in-loop
      await gravar(entry, campo, valor);
    }
    setSelecionados(new Set());
    avisar(`${alvos.length} registro(s) atualizado(s).`);
  }

  function alternarSelecao(id) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function exportar() {
    if (visiveis.length === 0) return;
    const colunas = COLUNAS_DO_MODELO[modelo];
    const linhas = [
      colunas.map((c) => c.label),
      ...visiveis.map((e) => colunas.map((c) => valorDaColuna(e, c))),
    ];
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(linhas), nomeDoMes(mes).slice(0, 28));
    XLSX.writeFile(livro, `${PREFIXO_ARQUIVO}-${modelo}-${mes}.xlsx`);
  }

  const todasAsColunas = COLUNAS_DO_MODELO[modelo];
  const colunas = todasAsColunas.filter((c) => !(ocultas[modelo] || []).includes(c.key));
  const mesesOrdenados = [...new Set([mes, ...meses])].sort().reverse();

  return (
    <div style={{ minHeight: "100vh", background: CORES.fundo, color: CORES.tinta }}>
      <header
        style={{
          background: CORES.escura,
          color: CORES.sobreEscura,
          padding: `${ESPACO[3]}px ${ESPACO[4]}px`,
          borderBottom: `3px solid ${CORES.principal}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ESPACO[4],
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: TEXTO.miudo, letterSpacing: "0.14em", color: CORES.acento }}>
            CONFERÊNCIA
          </div>
          <div style={{ fontSize: 22 }}>{TITULO}</div>
        </div>
        <a href="/" style={{ color: CORES.acento, fontSize: TEXTO.apoio, textDecoration: "none" }}>
          ← Voltar ao app
        </a>
      </header>

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: ESPACO[4] }}>
        {/* ── Período e planilha ─────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: ESPACO[2], flexWrap: "wrap", alignItems: "center", marginBottom: ESPACO[4] }}>
          {MODELOS.map((m) => (
            <button
              key={m}
              onClick={() => setModelo(m)}
              style={{
                ...btnDiscreto,
                flex: "0 0 auto",
                minHeight: ALVO,
                ...(modelo === m
                  ? { background: CORES.clara, color: CORES.escura, borderColor: CORES.principal, fontWeight: 600 }
                  : null),
              }}
            >
              {NOME_CURTO[m]}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <select
            value={mes}
            onChange={(ev) => setMes(ev.target.value)}
            style={{ ...inputStyle, width: "auto", minHeight: ALVO }}
          >
            {mesesOrdenados.map((m) => (
              <option key={m} value={m}>
                {nomeDoMes(m)}
              </option>
            ))}
          </select>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setEscolhendoColunas((v) => !v)}
              style={{
                ...btnDiscreto,
                flex: "0 0 auto",
                minHeight: ALVO,
                ...(escolhendoColunas ? { background: CORES.clara, borderColor: CORES.principal } : null),
              }}
            >
              ⚙ Colunas
            </button>
            {escolhendoColunas && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 50,
                  minWidth: 240,
                  maxHeight: 420,
                  overflowY: "auto",
                  padding: ESPACO[3],
                  borderRadius: 8,
                  background: "white",
                  border: `1px solid ${CORES.borda}`,
                  boxShadow: "0 8px 28px rgba(26,26,26,0.16)",
                  textAlign: "left",
                }}
              >
                <div style={{ fontSize: TEXTO.miudo, color: CORES.suave, marginBottom: ESPACO[2] }}>
                  O que aparece na tabela
                </div>
                {todasAsColunas.map((c) => (
                  <label
                    key={c.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: ESPACO[2],
                      padding: `${ESPACO[1]}px 0`,
                      fontSize: TEXTO.apoio,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!(ocultas[modelo] || []).includes(c.key)}
                      onChange={() => alternarColuna(c.key)}
                      style={{ width: 16, height: 16, accentColor: CORES.principal }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={carregar} style={{ ...btnDiscreto, flex: "0 0 auto", minHeight: ALVO }}>
            ↻ Atualizar
          </button>
          <button onClick={exportar} style={{ ...btnDiscreto, flex: "0 0 auto", minHeight: ALVO }}>
            ⬇ Excel
          </button>
        </div>

        {erro && (
          <div style={{ padding: ESPACO[3], marginBottom: ESPACO[4], background: CORES.alertaFundo, color: CORES.alerta, borderRadius: 8, fontSize: TEXTO.apoio }}>
            ⚠ Não consegui carregar os registros ({erro}).
          </div>
        )}

        {/* ── Pendências: é daqui que o trabalho sai ─────────────────────── */}
        <Secao titulo="O que falta">
          {cestas.length === 0 ? (
            <div style={{ fontSize: TEXTO.apoio, color: CORES.tenue }}>
              {carregando ? "Carregando…" : "Nada pendente neste mês."}
            </div>
          ) : (
            <div style={{ display: "flex", gap: ESPACO[2], flexWrap: "wrap" }}>
              {cestas.map((c) => {
                const ativa = pendencia === c.chave;
                return (
                  <button
                    key={c.chave}
                    onClick={() => setPendencia(ativa ? "" : c.chave)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 2,
                      minWidth: 150,
                      padding: `${ESPACO[2]}px ${ESPACO[3]}px`,
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      background: ativa ? CORES.escura : "white",
                      color: ativa ? CORES.sobreEscura : CORES.tinta,
                      border: `1px solid ${ativa ? CORES.escura : CORES.borda}`,
                    }}
                  >
                    <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{c.quantos}</span>
                    <span style={{ fontSize: TEXTO.miudo, color: ativa ? CORES.acento : CORES.suave }}>
                      {c.nome}
                    </span>
                  </button>
                );
              })}
              {pendencia && (
                <button onClick={() => setPendencia("")} style={{ ...btnDiscreto, flex: "0 0 auto" }}>
                  ✕ Ver todos
                </button>
              )}
            </div>
          )}
        </Secao>

        {/* ── Filtros ────────────────────────────────────────────────────── */}
        <Secao titulo="Filtrar">
          <div style={{ display: "flex", gap: ESPACO[2], flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...inputStyle, width: 320, minHeight: ALVO }}
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="🔎 Paciente, guia, carteira ou atendimento"
            />
            <Filtro rotulo="Local" valor={filtros.local} opcoes={opcoesDoFiltro.local} onMuda={(v) => setFiltros((f) => ({ ...f, local: v }))} />
            {modelo === "outros" && (
              <Filtro rotulo="Convênio" valor={filtros.convenio} opcoes={opcoesDoFiltro.convenio} onMuda={(v) => setFiltros((f) => ({ ...f, convenio: v }))} />
            )}
            <Filtro rotulo="Cirurgião" valor={filtros.cirurgiao} opcoes={opcoesDoFiltro.cirurgiao} onMuda={(v) => setFiltros((f) => ({ ...f, cirurgiao: v }))} />
            <Filtro rotulo="Anestesiologista" valor={filtros.anestesista} opcoes={opcoesDoFiltro.anestesista} onMuda={(v) => setFiltros((f) => ({ ...f, anestesista: v }))} />
            {modelo === "convenio" && (
              <Filtro rotulo="Anest. Unimed" valor={filtros.anestesistaCarimbo} opcoes={opcoesDoFiltro.anestesistaCarimbo} onMuda={(v) => setFiltros((f) => ({ ...f, anestesistaCarimbo: v }))} />
            )}
            {(busca || pendencia || Object.values(filtros).some(Boolean)) && (
              <button
                onClick={() => {
                  setBusca("");
                  setFiltros({});
                  setPendencia("");
                }}
                style={{ ...btnDiscreto, flex: "0 0 auto" }}
              >
                ✕ Limpar
              </button>
            )}
          </div>
        </Secao>

        {/* ── Totais ─────────────────────────────────────────────────────── */}
        <Secao titulo="No que está à vista">
          <div style={{ display: "flex", gap: ESPACO[6], flexWrap: "wrap" }}>
            <Total rotulo="Cirurgias" valor={totais.total} />
            <Total rotulo="Executadas" valor={totais.executados} />
            <Total rotulo="Conferidas" valor={totais.conferidos} />
            {modelo === "particular" && (
              <>
                <Total rotulo="Recebido" valor={emReais(totais.recebido)} />
                <Total rotulo="A receber" valor={emReais(totais.aReceber)} destaque={totais.aReceber > 0} />
              </>
            )}
          </div>
        </Secao>

        {/* ── Marcação em lote ───────────────────────────────────────────── */}
        {selecionados.size > 0 && (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 30,
              display: "flex",
              alignItems: "center",
              gap: ESPACO[3],
              flexWrap: "wrap",
              padding: ESPACO[3],
              marginBottom: ESPACO[3],
              borderRadius: 8,
              background: CORES.escura,
              color: CORES.sobreEscura,
            }}
          >
            <strong style={{ fontSize: TEXTO.apoio }}>{selecionados.size} selecionado(s)</strong>
            <EmLote rotulo="Executado" campo="executado" onEscolher={gravarEmLote} />
            {modelo === "convenio" && <EmLote rotulo="PC Executado" campo="pcExecutado" onEscolher={gravarEmLote} />}
            {modelo === "particular" && <EmLote rotulo="Recebido" campo="recebido" onEscolher={gravarEmLote} />}
            <button onClick={() => gravarEmLote("conferido", true)} style={{ ...btnDiscreto, flex: "0 0 auto" }}>
              ✓ Marcar conferido
            </button>
            <button onClick={() => setSelecionados(new Set())} style={{ ...btnDiscreto, flex: "0 0 auto" }}>
              ✕ Limpar seleção
            </button>
          </div>
        )}

        {/* ── A tabela ───────────────────────────────────────────────────── */}
        <div style={{ overflowX: "auto", border: `1px solid ${CORES.borda}`, borderRadius: 8, background: "white" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: TEXTO.apoio }}>
            <thead>
              <tr style={{ background: CORES.escura, color: CORES.sobreEscura }}>
                {/* Dois quadradinhos lado a lado são dois significados, e sem
                    nome não há como adivinhar qual é qual. O da esquerda junta
                    linhas para marcar várias de uma vez; o da direita é a
                    conferência daquela linha. Daí o rótulo em cima de cada um e
                    a divisória entre eles. */}
                <th style={{ ...th, width: 54, textAlign: "center" }} title="Marcar várias linhas de uma vez">
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <input
                      type="checkbox"
                      checked={visiveis.length > 0 && selecionados.size === visiveis.length}
                      onChange={(ev) =>
                        setSelecionados(ev.target.checked ? new Set(visiveis.map((e) => e.id)) : new Set())
                      }
                      style={{ width: 18, height: 18, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 9, fontWeight: 400, color: CORES.acento }}>marcar</span>
                  </div>
                </th>
                <th
                  style={{ ...th, width: 62, textAlign: "center", borderRight: `1px solid ${CORES.suave}` }}
                  title="Conferido por mim"
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 14, lineHeight: "18px" }}>✓</span>
                    <span style={{ fontSize: 9, fontWeight: 400, color: CORES.acento }}>conferido</span>
                  </div>
                </th>
                {colunas.map((c) => (
                  <th key={c.key} style={th}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={colunas.length + 2} style={{ padding: ESPACO[6], textAlign: "center", color: CORES.tenue }}>
                    {carregando ? "Carregando…" : "Nada aqui com esses filtros."}
                  </td>
                </tr>
              )}
              {visiveis.map((e) => (
                <Linha
                  key={e.id}
                  entry={e}
                  colunas={colunas}
                  modelo={modelo}
                  marcado={selecionados.has(e.id)}
                  onMarcar={() => alternarSelecao(e.id)}
                  onGravar={gravar}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aviso && (
        <div
          role="status"
          style={{
            position: "fixed",
            right: ESPACO[4],
            bottom: ESPACO[4],
            zIndex: 60,
            padding: `${ESPACO[3]}px ${ESPACO[4]}px`,
            borderRadius: 10,
            background: CORES.escura,
            color: CORES.sobreEscura,
            fontSize: TEXTO.apoio,
            boxShadow: "0 6px 24px rgba(26,26,26,0.18)",
            animation: "aviso-entra 160ms ease-out",
          }}
        >
          {aviso}
        </div>
      )}
    </div>
  );
}

/* ── Peças ──────────────────────────────────────────────────────────────── */

/** A largura de cada campo editável, pelo que de fato cabe dentro dele. */
const LARGURA_DO_CAMPO = {
  nGuia: 115,
  nCarteira: 150,
  atendimento: 95,
  quemRecebeu: 140,
  observacao: 200,
};

const th = {
  padding: `${ESPACO[2]}px ${ESPACO[2]}px`,
  textAlign: "left",
  fontSize: TEXTO.miudo,
  letterSpacing: "0.04em",
  fontWeight: 600,
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
};

const td = {
  padding: `${ESPACO[1]}px ${ESPACO[1]}px`,
  borderTop: `1px solid ${CORES.bordaSuave}`,
  verticalAlign: "middle",
};

function Secao({ titulo, children }) {
  return (
    <section style={{ marginBottom: ESPACO[4] }}>
      <div
        style={{
          fontSize: TEXTO.miudo,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: CORES.suave,
          marginBottom: ESPACO[2],
        }}
      >
        {titulo}
      </div>
      {children}
    </section>
  );
}

function Total({ rotulo, valor, destaque }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 600, color: destaque ? CORES.alerta : CORES.tinta }}>
        {valor}
      </div>
      <div style={{ fontSize: TEXTO.miudo, color: CORES.suave }}>{rotulo}</div>
    </div>
  );
}

function Filtro({ rotulo, valor, opcoes, onMuda }) {
  if (!opcoes || opcoes.length < 2) return null;
  return (
    <select
      value={valor || ""}
      onChange={(ev) => onMuda(ev.target.value)}
      style={{
        ...inputStyle,
        width: "auto",
        minHeight: ALVO,
        maxWidth: 240,
        background: valor ? CORES.clara : "white",
        borderColor: valor ? CORES.principal : CORES.borda,
      }}
    >
      <option value="">{rotulo}: todos</option>
      {opcoes.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Um campo de escolha aplicado a todos os selecionados de uma vez. */
function EmLote({ rotulo, campo, onEscolher }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: ESPACO[1], fontSize: TEXTO.apoio }}>
      {rotulo}:
      {opcoesDe(campo).map((o) => (
        <button
          key={o.valor}
          onClick={() => onEscolher(campo, o.valor)}
          style={{ ...btnDiscreto, flex: "0 0 auto", padding: "6px 10px", fontSize: TEXTO.miudo }}
        >
          {o.rotulo}
        </button>
      ))}
    </span>
  );
}

/**
 * Uma linha da tabela.
 *
 * A cor da linha vem do Executado, como na planilha — é a mesma leitura de
 * relance, e quem alterna entre as duas não precisa aprender duas linguagens.
 */
function Linha({ entry, colunas, modelo, marcado, onMarcar, onGravar }) {
  const estado = estadoDe("executado", entry.executado);
  const fundo =
    entry.conferido === true
      ? CORES.conferido
      : estado === "sim"
      ? "#F4FBF7"
      : estado === "incompleto"
      ? "#FFFBF0"
      : "white";

  return (
    <tr style={{ background: marcado ? CORES.clara : fundo }}>
      <td style={{ ...td, textAlign: "center" }}>
        <input
          type="checkbox"
          checked={marcado}
          onChange={onMarcar}
          style={{ width: 18, height: 18, cursor: "pointer" }}
        />
      </td>
      <td style={{ ...td, textAlign: "center", borderRight: `1px solid ${CORES.borda}` }}>
        <input
          type="checkbox"
          checked={entry.conferido === true}
          onChange={(ev) => onGravar(entry, "conferido", ev.target.checked)}
          title="Conferido"
          style={{ width: 18, height: 18, cursor: "pointer", accentColor: CORES.principal }}
        />
      </td>
      {colunas.map((c) => (
        <Celula key={c.key} entry={entry} coluna={c} modelo={modelo} onGravar={onGravar} />
      ))}
    </tr>
  );
}

/**
 * Uma célula: editável nos campos dela, leitura no resto.
 *
 * Grava ao sair do campo, e não a cada tecla: é o ritmo de quem preenche uma
 * coluna inteira descendo com o Tab.
 */
function Celula({ entry, coluna, modelo, onGravar }) {
  const [rascunho, setRascunho] = useState(null);
  const editavel = EDITAVEIS.has(coluna.key);
  const valor = entry[coluna.key];

  if (!editavel) {
    const texto = valorDaColuna(entry, coluna);
    const cor = coluna.key === "convenio" ? corDoConvenio(valor) : null;
    const longo = coluna.key === "procedimentos" || coluna.key === "procedimentoComplementar";
    return (
      <td
        style={{
          ...td,
          color: cor || "inherit",
          fontWeight: cor ? 600 : 400,
          // Numa linha só, com reticências: a descrição TUSS é longa e quebrava
          // a linha em três — três linhas por registro é um terço dos registros
          // na tela. O texto inteiro fica no `title`, ao passar o mouse.
          maxWidth: longo ? 230 : 165,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={texto}
      >
        {coluna.key === "dataCirurgia" ? formatarData(entry.dataCirurgia) : texto}
      </td>
    );
  }

  if (coluna.escolha) {
    // "Falta receber" diz pouco; "falta receber há quarenta dias" é o que faz
    // alguém ligar para o paciente.
    const parado =
      coluna.key === "recebido" && estadoDe("recebido", valor) !== "sim" ? diasParados(entry) : null;

    return (
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: ESPACO[1] }}>
          <select
            value={estadoDe(coluna.escolha, valor)}
            onChange={(ev) => onGravar(entry, coluna.key, ev.target.value)}
            style={{ ...inputStyle, padding: "6px 8px", fontSize: TEXTO.apoio, width: "auto" }}
          >
            {/* A opção vazia, onde o campo admite ficar sem escolha: é ela que
                mostra o Executado ainda não respondido e, se alguém escolher
                errado, é por ela que se volta ao branco. Sem ela o seletor fica
                sem nenhuma opção marcada, o que se lê igual a um erro. */}
            {aceitaVazio(coluna.escolha) && <option value="">—</option>}
            {opcoesDe(coluna.escolha).map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
          {parado > 0 && (
            <span style={{ fontSize: TEXTO.miudo, color: parado > 30 ? CORES.alerta : CORES.tenue, whiteSpace: "nowrap" }}>
              há {parado}d
            </span>
          )}
        </div>
      </td>
    );
  }

  // Em repouso, o dinheiro aparece com os dois decimais — "1200,5" lido numa
  // coluna de valores faz duvidar do número. Em edição, o que foi digitado.
  const texto =
    rascunho !== null
      ? rascunho
      : coluna.moeda
      ? valor === "" || valor == null
        ? ""
        : Number(valor).toFixed(2).replace(".", ",")
      : valor || "";

  return (
    <td style={td}>
      <input
        value={texto}
        onChange={(ev) => setRascunho(ev.target.value)}
        onBlur={() => {
          if (rascunho === null) return;
          const novo = coluna.moeda ? numeroDigitado(rascunho) : rascunho;
          setRascunho(null);
          if (String(novo) !== String(valor ?? "")) onGravar(entry, coluna.key, novo);
        }}
        inputMode={coluna.moeda || coluna.digitos ? "decimal" : undefined}
        style={{
          ...inputStyle,
          padding: "6px 8px",
          fontSize: TEXTO.apoio,
          width: LARGURA_DO_CAMPO[coluna.key] || (coluna.moeda ? 100 : 130),
          background: "transparent",
          borderColor: "transparent",
        }}
        onFocus={(ev) => {
          ev.target.style.background = "white";
          ev.target.style.borderColor = CORES.principal;
        }}
        onBlurCapture={(ev) => {
          ev.target.style.background = "transparent";
          ev.target.style.borderColor = "transparent";
        }}
      />
    </td>
  );
}

/** O que foi digitado num campo de dinheiro, como número. */
function numeroDigitado(texto) {
  const limpo = (texto || "").replace(/[^\d,.]/g, "").replace(",", ".");
  if (limpo === "" || limpo === ".") return "";
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : "";
}
