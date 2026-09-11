import { kv } from "../../lib/kv";
import { sheetsEnabled, syncTudo, pullDaPlanilha } from "../../lib/sheets";
import { normalizarRegistro, mudouNaNormalizacao } from "../../lib/registro";
import { rotuloDaFalha } from "../../lib/modelos";

const KEY = "guias:entries";

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

    const normalizados = entries.map(normalizarRegistro);
    const guiasCompletadas = normalizados
      .map((e, i) =>
        e.nGuia !== entries[i].nGuia ? { de: entries[i].nGuia, para: e.nGuia, paciente: e.paciente } : null
      )
      .filter(Boolean);

    if (normalizados.some((e, i) => mudouNaNormalizacao(entries[i], e))) {
      entries = normalizados;
      await kv.set(KEY, entries);
    }

    // Primeiro traz o que foi editado direto na planilha, depois reescreve.
    let mudancas = [];
    let recusadas = [];
    try {
      const resultado = await pullDaPlanilha(entries);
      recusadas = resultado.recusadas;
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
      recusadas,
      guiasCompletadas,
      // Um ano pode ter várias planilhas: convênio, particular e uma por clínica.
      planilhas: Object.fromEntries(
        Object.entries(sincronizados).flatMap(([ano, porModelo]) =>
          Object.entries(porModelo).map(([modelo, id]) => [
            rotuloDaFalha(ano, modelo),
            `https://docs.google.com/spreadsheets/d/${id}`,
          ])
        )
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
