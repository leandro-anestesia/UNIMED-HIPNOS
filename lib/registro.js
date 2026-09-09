import { CAMPOS_DO_REGISTRO, CAMPOS_MANUAIS, ehUnimed } from "./campos";
import { completarGuia } from "./guia";

/** Todos os campos de texto do registro, dos dois grupos. */
const TEXTOS = [...CAMPOS_DO_REGISTRO, ...CAMPOS_MANUAIS];

/**
 * Os acertos que valem por qualquer caminho de gravação: espaço sobrando fora,
 * caixa alta nos campos marcados com `maiusculo`, procedimentos em caixa alta
 * e nº da guia com o dígito verificador completo.
 *
 * Isto mora aqui, e não em cada rota, porque são três os caminhos que gravam —
 * salvar, editar e sincronizar — e a versão que ficasse para trás gravaria o
 * mesmo paciente com outra grafia.
 *
 * `completarGuia` só acrescenta o dígito quando ele claramente falta; guia com
 * dígito divergente, formato fora do padrão ou anotação em texto fica intacta.
 * E só vale na Unimed: o dígito verificador é regra dela, e as outras
 * operadoras numeram do jeito delas.
 */
export function normalizarRegistro(entry) {
  const textos = Object.fromEntries(
    TEXTOS.map((f) => {
      const valor = (entry[f.key] || "").toString().trim();
      return [f.key, f.maiusculo ? valor.toUpperCase() : valor];
    })
  );

  return {
    ...entry,
    ...textos,
    procedimentos: (entry.procedimentos || [])
      .map((p) => (p || "").toString().trim().toUpperCase())
      .filter(Boolean),
    urgencia: entry.urgencia === true,
    nGuia: ehUnimed(entry) ? completarGuia(entry.nGuia) : (entry.nGuia || "").toString().trim(),
  };
}

/** A normalização mexeu em alguma coisa? Se não, não vale regravar o banco. */
export function mudouNaNormalizacao(antes, depois) {
  if (TEXTOS.some((f) => (antes[f.key] || "") !== (depois[f.key] || ""))) return true;
  if (antes.urgencia !== depois.urgencia) return true;
  return (
    (antes.procedimentos || []).join(" ") !== (depois.procedimentos || []).join(" ")
  );
}
