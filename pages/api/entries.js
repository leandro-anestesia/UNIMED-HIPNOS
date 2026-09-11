import { kv } from "../../lib/kv";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { sheetsEnabled, syncAno, pullDaPlanilha } from "../../lib/sheets";
import { normalizarTexto } from "../../lib/texto";
import { SEPARADOR_PROCEDIMENTOS } from "../../lib/campos";
import { normalizarRegistro } from "../../lib/registro";
import { comTrava } from "../../lib/trava";

const KEY = "guias:entries";

/**
 * Espelha no Google Sheets os anos afetados por uma alteração.
 *
 * Antes de reescrever as abas, recolhe o que tenha sido editado direto na
 * planilha — senão a reescrita apagaria essas edições. O registro que acabou
 * de ser mexido no app fica de fora dessa leitura, para o app vencer.
 *
 * Nunca lança: uma falha na planilha não pode derrubar o registro no app.
 */
async function espelharNoSheets(entries, anos, idsDoApp = []) {
  if (!sheetsEnabled()) return entries;

  let atuais = entries;
  try {
    const { entries: mesclados, mudancas } = await pullDaPlanilha(entries, idsDoApp);
    if (mudancas.length > 0) {
      atuais = mesclados;
      await kv.set(KEY, atuais);
    }
  } catch (err) {
    console.error("Falha ao ler alterações da planilha:", err.message);
  }

  const unicos = [...new Set(anos.filter(Boolean))];
  for (const ano of unicos) {
    try {
      const { falhas } = await syncAno(ano, atuais);
      Object.entries(falhas).forEach(([modelo, mensagem]) => {
        console.error(`Falha ao sincronizar ${modelo} de ${ano} com o Google Sheets:`, mensagem);
      });
    } catch (err) {
      console.error(`Falha ao sincronizar o ano ${ano} com o Google Sheets:`, err.message);
    }
  }

  return atuais;
}

const TRAVA = "guias:sync:trava";
const PENDENTE = "guias:sync:pendente";
const TRAVA_ENTRIES = "guias:entries:trava";

/**
 * Serializa o ciclo ler-modificar-gravar dos registros.
 *
 * A lista inteira vive numa única chave do Redis. Sem trava, duas gravações
 * simultâneas leem a mesma lista e a última sobrescreve a outra — some um
 * paciente. Com dois anestesistas lançando ao mesmo tempo isso é real.
 *
 * Se a trava não vier em ~5s, segue sem ela: é melhor arriscar a concorrência
 * do que recusar o registro de um paciente.
 */
function comTravaDeEntries(fn) {
  return comTrava(TRAVA_ENTRIES, fn);
}

/**
 * Manda espelhar na planilha DEPOIS de responder ao app.
 *
 * O banco é o dono do dado; a planilha é espelho. Esperar as ~11 chamadas ao
 * Google antes de responder fazia o salvamento levar segundos, e era isso que
 * levava o anestesista a clicar de novo, duplicando o paciente.
 *
 * Como agora as tarefas não são mais serializadas pela resposta, elas poderiam
 * rodar em paralelo e a mais antiga terminar por último, gravando estado velho
 * na planilha. Por isso: só uma tarefa espelha por vez (trava no Redis), e quem
 * chega durante uma tarefa em curso apenas marca "pendente" — o worker refaz o
 * ciclo até não haver mais pendência, sempre relendo os registros do banco.
 *
 * Se a tarefa for interrompida, nada se perde: o registro já está no banco e a
 * planilha se corrige no próximo salvamento ou no botão de sincronizar, porque
 * `syncAno` reescreve o mês inteiro.
 */
function espelharDepoisDeResponder(anos, idsDoApp = []) {
  if (!sheetsEnabled()) return;

  const tarefa = (async () => {
    try {
      await kv.set(PENDENTE, "1");

      // Só um worker de cada vez. Quem não pegar a trava vai embora: o worker
      // ativo enxerga a marca de pendente e refaz o ciclo.
      const pegouATrava = await kv.set(TRAVA, "1", { nx: true, ex: 120 });
      if (!pegouATrava) return;

      try {
        while (await kv.get(PENDENTE)) {
          await kv.del(PENDENTE);
          const atuais = (await kv.get(KEY)) || [];
          await espelharNoSheets(atuais, anos, idsDoApp);
        }
      } finally {
        await kv.del(TRAVA);
      }

      // Alguém pode ter marcado pendente entre o último laço e a liberação da
      // trava. Uma última tentativa fecha essa fresta.
      if (await kv.get(PENDENTE)) {
        const deNovo = await kv.set(TRAVA, "1", { nx: true, ex: 120 });
        if (deNovo) {
          try {
            await kv.del(PENDENTE);
            const atuais = (await kv.get(KEY)) || [];
            await espelharNoSheets(atuais, anos, idsDoApp);
          } finally {
            await kv.del(TRAVA);
          }
        }
      }
    } catch (err) {
      console.error("Falha ao espelhar na planilha em segundo plano:", err.message);
    }
  })();

  try {
    // Funciona no Pages Router, apesar do que dizem discussões antigas: é o que
    // tira o espelhamento do caminho da resposta.
    waitUntil(tarefa);
  } catch {
    // Fora do runtime da Vercel (ex.: `next dev`) não existe waitUntil.
    // A tarefa já está rodando e o processo local segue vivo até terminar.
  }
}

function anoDe(entry) {
  return (entry && entry.dataCirurgia ? entry.dataCirurgia : "").split("-")[0];
}

/** Os procedimentos como um texto só, para comparar dois registros. */
function chaveDosProcedimentos(entry) {
  return normalizarTexto((entry.procedimentos || []).join(SEPARADOR_PROCEDIMENTOS));
}

/**
 * Procura um registro que seja o mesmo paciente, no mesmo dia, com os mesmos
 * procedimentos. Pega tanto o clique repetido quanto dois anestesistas
 * lançando o mesmo paciente de aparelhos diferentes.
 */
function acharDuplicata(entries, novo) {
  const paciente = normalizarTexto(novo.paciente);
  if (!paciente) return null; // sem nome não dá para afirmar que é o mesmo

  const procedimentos = chaveDosProcedimentos(novo);

  return (
    entries.find(
      (e) =>
        normalizarTexto(e.paciente) === paciente &&
        (e.dataCirurgia || "") === (novo.dataCirurgia || "") &&
        chaveDosProcedimentos(e) === procedimentos
    ) || null
  );
}

/**
 * Grava vários registros numa tacada só — é o mapa cirúrgico virando lista.
 *
 * Tudo sob a mesma trava e um espelhamento só: vinte lançamentos disparando
 * vinte sincronizações faria o mesmo trabalho vinte vezes, e a planilha
 * reescreve o mês inteiro de qualquer jeito.
 *
 * Duplicata aqui não pergunta, some. Quem fotografa o mesmo mapa duas vezes
 * não vai responder vinte confirmações seguidas — a resposta diz quantos
 * foram pulados e quem eram.
 */
async function lancarLote(brutos, res) {
  const novos = brutos.map((dados) =>
    normalizarRegistro({ ...dados, id: randomUUID(), criadoEm: new Date().toISOString() })
  );

  const { gravados, duplicados } = await comTravaDeEntries(async () => {
    const entries = (await kv.get(KEY)) || [];
    const gravados = [];
    const duplicados = [];

    for (const entry of novos) {
      // Compara contra a lista que vai crescendo: pega também o mapa que traz o
      // mesmo paciente duas vezes.
      if (acharDuplicata(entries, entry)) {
        duplicados.push(entry.paciente);
        continue;
      }
      entries.unshift(entry);
      gravados.push(entry);
    }

    if (gravados.length > 0) await kv.set(KEY, entries);
    return { gravados, duplicados };
  });

  if (gravados.length > 0) {
    espelharDepoisDeResponder(
      gravados.map(anoDe),
      gravados.map((e) => e.id)
    );
  }

  return res.status(200).json({ gravados: gravados.length, duplicados });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const entries = (await kv.get(KEY)) || [];
      return res.status(200).json(entries);
    }

    if (req.method === "POST") {
      // Lote: a foto de um mapa cirúrgico vira vários lançamentos de uma vez.
      if (Array.isArray((req.body || {}).registros)) {
        return lancarLote(req.body.registros, res);
      }

      const { confirmarDuplicado, ...dados } = req.body || {};
      const entry = normalizarRegistro({ ...dados, id: randomUUID(), criadoEm: new Date().toISOString() });

      const duplicada = await comTravaDeEntries(async () => {
        const entries = (await kv.get(KEY)) || [];

        if (confirmarDuplicado !== true) {
          const existente = acharDuplicata(entries, entry);
          if (existente) return existente;
        }

        entries.unshift(entry);
        await kv.set(KEY, entries);
        return null;
      });

      if (duplicada) return res.status(409).json({ duplicado: true, existente: duplicada });

      espelharDepoisDeResponder([anoDe(entry)], [entry.id]);
      return res.status(200).json(entry);
    }

    if (req.method === "PUT") {
      const updated = normalizarRegistro(req.body || {});
      if (!updated || !updated.id) return res.status(400).json({ error: "id é obrigatório" });

      const anterior = await comTravaDeEntries(async () => {
        const entries = (await kv.get(KEY)) || [];
        const antes = entries.find((e) => e.id === updated.id);
        const next = entries.map((e) =>
          e.id === updated.id ? { ...updated, criadoEm: e.criadoEm || updated.criadoEm } : e
        );
        await kv.set(KEY, next);
        return antes;
      });

      espelharDepoisDeResponder([anoDe(anterior), anoDe(updated)], [updated.id]);
      return res.status(200).json(updated);
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "id é obrigatório" });

      const removido = await comTravaDeEntries(async () => {
        const entries = (await kv.get(KEY)) || [];
        const alvo = entries.find((e) => e.id === id);
        await kv.set(KEY, entries.filter((e) => e.id !== id));
        return alvo;
      });

      espelharDepoisDeResponder([anoDe(removido)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Erro ao acessar armazenamento" });
  }
}
