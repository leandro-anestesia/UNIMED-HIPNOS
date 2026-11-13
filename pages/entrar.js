import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { ALVO, ESPACO, TEXTO, btnPrimary, inputStyle } from "../lib/estilo";
import { CORES, EQUIPE, TITULO } from "../lib/marca";
import { DIGITOS_DO_PIN, usuarioValido } from "../lib/acesso";

/**
 * A tela de entrada.
 *
 * O usuário é digitado, e não escolhido numa lista: uma lista de nomes contaria
 * a quem abrisse o endereço quem trabalha aqui.
 *
 * O PIN tem teclado próprio, com alvos de 44px, em vez do teclado do sistema.
 * É a mesma razão de sempre neste app: a tela é usada em pé, com pressa, às
 * vezes de luva — e o teclado do iPhone, num campo numérico, ainda traz
 * correção e sugestão por cima.
 */

const ONDE_GUARDAR_O_USUARIO = "hipnos_ultimo_usuario";

function Pontinhos({ quantos }) {
  return (
    <div style={{ display: "flex", gap: ESPACO[2], justifyContent: "center", margin: `${ESPACO[4]}px 0` }}>
      {Array.from({ length: DIGITOS_DO_PIN }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: i < quantos ? CORES.principal : "transparent",
            border: `1px solid ${i < quantos ? CORES.principal : CORES.borda}`,
          }}
        />
      ))}
    </div>
  );
}

function Teclado({ onDigito, onApagar, desabilitado }) {
  const tecla = {
    height: ALVO + 8,
    borderRadius: 8,
    background: "white",
    border: `1px solid ${CORES.borda}`,
    color: CORES.tinta,
    fontSize: 22,
    fontWeight: 500,
    cursor: "pointer",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: ESPACO[2] }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button key={d} type="button" style={tecla} disabled={desabilitado} onClick={() => onDigito(String(d))}>
          {d}
        </button>
      ))}
      <div />
      <button type="button" style={tecla} disabled={desabilitado} onClick={() => onDigito("0")}>
        0
      </button>
      <button
        type="button"
        style={{ ...tecla, fontSize: 18, color: CORES.suave }}
        disabled={desabilitado}
        onClick={onApagar}
      >
        ⌫
      </button>
    </div>
  );
}

export default function Entrar() {
  const router = useRouter();

  const [estado, setEstado] = useState({ carregando: true });
  const [usuario, setUsuario] = useState("");
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [etapa, setEtapa] = useState("pin"); // "pin" | "confirmar"
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const jaMandou = useRef(false);

  const criandoMestre = estado.vazia === true;
  const destino = useMemo(() => {
    const de = (router.query.de || "").toString();
    // Só caminho interno: um "de" apontando para fora viraria um desvio aberto.
    return de.startsWith("/") && !de.startsWith("//") ? de : "/";
  }, [router.query.de]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/acesso/eu");
        const data = await r.json();
        if (!vivo) return;
        if (data.logado) {
          router.replace(destino);
          return;
        }
        setEstado({ carregando: false, tranca: data.tranca !== false, vazia: data.vazia === true });
        if (data.vazia === true) setUsuario("admin.admin");
        else {
          try {
            setUsuario(window.localStorage.getItem(ONDE_GUARDAR_O_USUARIO) || "");
          } catch (e) {
            /* navegador sem armazenamento: começa em branco, e está tudo bem */
          }
        }
      } catch (e) {
        if (vivo) setEstado({ carregando: false, tranca: true, vazia: false });
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  const entrar = useCallback(
    async (pinFinal) => {
      if (enviando) return;
      setEnviando(true);
      setErro("");

      try {
        const r = await fetch("/api/acesso/entrar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuario,
            pin: pinFinal,
            ...(criandoMestre ? { criarMestre: true, nome } : {}),
          }),
        });
        const data = await r.json();

        if (!r.ok) {
          setErro(data.error || "Não consegui entrar.");
          setPin("");
          setConfirmacao("");
          setEtapa("pin");
          setEnviando(false);
          return;
        }

        try {
          window.localStorage.setItem(ONDE_GUARDAR_O_USUARIO, usuario);
        } catch (e) {
          /* sem armazenamento: só não lembra o usuário na próxima vez */
        }
        // Sem `setEnviando(false)`: a tela está saindo, e reabilitar o botão
        // num instante em que a navegação já começou só convida ao duplo envio.
        router.replace(destino);
      } catch (e) {
        setErro("Não consegui falar com o servidor. Tente de novo.");
        setPin("");
        setEnviando(false);
      }
    },
    [criandoMestre, destino, enviando, nome, router, usuario]
  );

  // O PIN completo manda sozinho: seis dígitos e já era, sem procurar botão.
  useEffect(() => {
    if (enviando || jaMandou.current) return;

    if (criandoMestre) {
      if (etapa === "pin" && pin.length === DIGITOS_DO_PIN) {
        setEtapa("confirmar");
        return;
      }
      if (etapa === "confirmar" && confirmacao.length === DIGITOS_DO_PIN) {
        if (confirmacao !== pin) {
          setErro("Os dois PINs não são iguais. Vamos de novo.");
          setPin("");
          setConfirmacao("");
          setEtapa("pin");
          return;
        }
        jaMandou.current = true;
        entrar(pin);
      }
      return;
    }

    if (pin.length === DIGITOS_DO_PIN) {
      if (!usuarioValido(usuario)) {
        setErro("Digite seu usuário, no formato nome.sobrenome.");
        setPin("");
        return;
      }
      jaMandou.current = true;
      entrar(pin);
    }
  }, [pin, confirmacao, etapa, criandoMestre, usuario, enviando, entrar]);

  // Depois de um erro, a próxima digitação pode mandar de novo.
  useEffect(() => {
    if (pin.length === 0 && confirmacao.length === 0) jaMandou.current = false;
  }, [pin, confirmacao]);

  const digitar = (d) => {
    setErro("");
    if (criandoMestre && etapa === "confirmar") {
      setConfirmacao((atual) => (atual.length >= DIGITOS_DO_PIN ? atual : atual + d));
      return;
    }
    setPin((atual) => (atual.length >= DIGITOS_DO_PIN ? atual : atual + d));
  };

  const apagar = () => {
    setErro("");
    if (criandoMestre && etapa === "confirmar") {
      setConfirmacao((atual) => atual.slice(0, -1));
      return;
    }
    setPin((atual) => atual.slice(0, -1));
  };

  const caixa = {
    width: "100%",
    maxWidth: 360,
    background: "white",
    border: `1px solid ${CORES.borda}`,
    borderRadius: 12,
    padding: ESPACO[6],
    boxSizing: "border-box",
  };

  return (
    <>
      <Head>
        <title>{`Entrar · ${TITULO}`}</title>
      </Head>
      <div
        style={{
          minHeight: "100vh",
          background: CORES.fundo,
          color: CORES.tinta,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: ESPACO[4],
        }}
      >
        <div style={caixa}>
          <div style={{ textAlign: "center", marginBottom: ESPACO[6] }}>
            <img src="/logo-mark.png" alt="" width={48} height={48} style={{ display: "block", margin: "0 auto" }} />
            <div style={{ fontSize: TEXTO.miudo, letterSpacing: 1, color: CORES.suave, marginTop: ESPACO[2] }}>
              {EQUIPE}
            </div>
          </div>

          {estado.carregando ? (
            <div style={{ textAlign: "center", color: CORES.tenue, fontSize: TEXTO.apoio }}>…</div>
          ) : estado.tranca === false ? (
            <div style={{ fontSize: TEXTO.apoio, color: CORES.suave, lineHeight: 1.5 }}>
              O acesso não pôde ser verificado: falta no servidor a chave que assina os cookies. Enquanto isso, ninguém
              entra — nem eu consigo deixar entrar.
            </div>
          ) : (
            <>
              {criandoMestre && (
                <div
                  style={{
                    background: CORES.clara,
                    border: `1px solid ${CORES.principal}`,
                    borderRadius: 8,
                    padding: ESPACO[3],
                    marginBottom: ESPACO[4],
                    fontSize: TEXTO.apoio,
                    lineHeight: 1.45,
                  }}
                >
                  <strong>Primeiro acesso.</strong> Ainda não existe ninguém cadastrado, então quem entrar agora vira o
                  mestre do app. Se isto apareceu para você sem ser a primeira vez, alguém chegou antes — avise.
                </div>
              )}

              {criandoMestre && (
                <>
                  <label style={{ display: "block", fontSize: TEXTO.apoio, color: CORES.suave, marginBottom: ESPACO[1] }}>
                    Seu nome
                  </label>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value.toUpperCase())}
                    placeholder="NOME COMPLETO"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ ...inputStyle, marginBottom: ESPACO[3] }}
                  />
                </>
              )}

              <label style={{ display: "block", fontSize: TEXTO.apoio, color: CORES.suave, marginBottom: ESPACO[1] }}>
                Usuário
              </label>
              <input
                value={usuario}
                onChange={(e) => {
                  setErro("");
                  setUsuario(e.target.value.toLowerCase().replace(/\s/g, ""));
                }}
                placeholder="nome.sobrenome"
                // Sem nada disto, o iPhone entrega "Leandro.Correa" com inicial
                // maiúscula e, às vezes, uma correção no meio do usuário.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                inputMode="email"
                style={inputStyle}
              />

              <div style={{ marginTop: ESPACO[4], fontSize: TEXTO.apoio, color: CORES.suave, textAlign: "center" }}>
                {criandoMestre
                  ? etapa === "confirmar"
                    ? "Digite o mesmo PIN outra vez"
                    : `Escolha um PIN de ${DIGITOS_DO_PIN} dígitos`
                  : "PIN"}
              </div>
              <Pontinhos quantos={(criandoMestre && etapa === "confirmar" ? confirmacao : pin).length} />

              {erro && (
                <div
                  style={{
                    background: "#FDECEC",
                    border: "1px solid #F0BDBD",
                    borderRadius: 8,
                    padding: ESPACO[3],
                    marginBottom: ESPACO[4],
                    fontSize: TEXTO.apoio,
                    color: "#8A2A2A",
                  }}
                >
                  {erro}
                </div>
              )}

              <Teclado onDigito={digitar} onApagar={apagar} desabilitado={enviando} />

              {enviando && (
                <div style={{ textAlign: "center", marginTop: ESPACO[4], fontSize: TEXTO.apoio, color: CORES.tenue }}>
                  entrando…
                </div>
              )}

              {criandoMestre && (
                <button
                  type="button"
                  style={{ ...btnPrimary, width: "100%", marginTop: ESPACO[4], opacity: enviando ? 0.6 : 1 }}
                  disabled={enviando || pin.length !== DIGITOS_DO_PIN || confirmacao.length !== DIGITOS_DO_PIN}
                  onClick={() => confirmacao === pin && entrar(pin)}
                >
                  Criar o mestre
                </button>
              )}
            </>
          )}
        </div>

        <div style={{ marginTop: ESPACO[6], fontSize: TEXTO.miudo, color: CORES.tenue, textAlign: "center" }}>
          Depois de entrar, este aparelho não pede o PIN de novo por 90 dias.
        </div>
      </div>
    </>
  );
}
