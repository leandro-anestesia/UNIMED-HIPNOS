import { kv } from "../../lib/kv";
import { sheetsEnabled, syncTudo, pullExecutados } from "../../lib/sheets";
import { completarGuia } from "../../lib/guia";
import { CAMPOS_MANUAIS, emCaixaAlta } from "../../lib/campos";

const KEY = "guias:entries";

/** Mesmos acertos que a gravação faz, aplicados à lista inteira. */
function normalizar(e) {
  const nomes = Object.fromEntries(
    CAMPOS_MANUAIS.filter((f) => f.maiusculo).map((f) => [f.key, emCaixaAlta(e[f.key])])
  );
  return {
    ...e,
    ...nomes,
    paciente: (e.paciente || "").toUpperCase(),
    procedimentos: (e.procedimentos || [])
      .map((p) => (p || "").toString().trim().toUpperCase())
      .filter(Boolean),
    urgencia: e.urgencia === true,
    nGuia: completarGuia(e.nGuia),
  };
}

function mudou(a, b) {
  return (
    CAMPOS_MANUAIS.filter((f) => f.maiusculo).some((f) => (a[f.key] || "") !== (b[f.key] || "")) ||
    a.paciente !== b.paciente ||
    a.urgencia !== b.urgencia ||
    a.nGuia !== b.nGuia ||
    (a.procedimentos || []).join(" ") !== (b.procedimentos || []).join(" ")
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Método não permitido" });
  }

  if (!sheetsEnabled()) {
    return res.status(200).json({
      ok: false,
      configurado: false,
      mensagem: "Google Sheets não configurado (falta GOOGLE_SERVICE_ACCOUNT_JSON).",
    });
  }

  try {
    let entries = (await kv.get(KEY)) || [];

    const normalizados = entries.map(normalizar);
    const guiasCompletadas = normalizados
      .map((e, i) =>
        e.nGuia !== entries[i].nGuia ? { de: entries[i].nGuia, para: e.nGuia, paciente: e.paciente } : null
      )
      .filter(Boolean);

    if (normalizados.some((e, i) => mudou(e, entries[i]))) {
      entries = normalizados;
      await kv.set(KEY, entries);
    }

    // Primeiro traz o que foi editado direto na planilha, depois reescreve.
    let mudancas = [];
    try {
      const resultado = await pullExecutados(entries);
      if (resultado.mudancas.length > 0) {
        entries = resultado.entries;
        mudancas = resultado.mudancas;
        await kv.set(KEY, entries);
      }
    } catch (err) {
      console.error("Falha ao ler alterações da planilha:", err.message);
    }

    const { sincronizados, falhas } = await syncTudo(entries);
    return res.status(200).json({
      ok: Object.keys(falhas).length === 0,
      configurado: true,
      registros: entries.length,
      importadosDaPlanilha: mudancas,
      guiasCompletadas,
      planilhas: Object.fromEntries(
        Object.entries(sincronizados).map(([ano, id]) => [ano, `https://docs.google.com/spreadsheets/d/${id}`])
      ),
      ...(Object.keys(falhas).length > 0 ? { falhas } : {}),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      // Detalhe da resposta do Google, para saber qual API precisa ser liberada.
      detalhe: err.errors || err.response?.data?.error || null,
      contaDeServico: (() => {
        try {
          return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email;
        } catch {
          return "não foi possível ler o client_email do JSON";
        }
      })(),
    });
  }
}
