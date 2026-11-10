import { CAMPOS_DO_REGISTRO, CAMPOS_MANUAIS, ehUnimed } from "./campos";
import { nomeCurtoDoConvenio, semCodigoNaFrente } from "./convenios";
import { estadoDe } from "./estados";
import { completarGuia } from "./guia";
import { nomeDoLocal } from "./locais";

/**
 * Os campos de texto do registro, dos dois grupos.
 *
 * Fora os que têm tratamento próprio logo abaixo: escolha entre opções e valor
 * em dinheiro não são texto, e passar por aqui os transformaria em string.
 */
const TEXTOS = [...CAMPOS_DO_REGISTRO, ...CAMPOS_MANUAIS].filter((f) => !f.escolha && !f.moeda);

/**
 * Os acertos que valem por qualquer caminho de gravação: espaço sobrando fora,
 * caixa alta nos campos marcados com `maiusculo`, procedimentos em caixa alta
 * e nº da guia com o dígito verificador completo.
 *
 * Isto mora aqui, e não em cada rota, porque são quatro os caminhos que gravam —
 * salvar, editar, lançar um mapa inteiro e sincronizar — e a versão que ficasse
 * para trás gravaria o mesmo paciente com outra grafia.
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
    // O nome curto do convênio, venha ele da foto, do teclado ou da planilha.
    // Aqui é o único ponto por onde os caminhos passam, e é o que impede
    // "UNIMED", "UNIMED CAMPINAS" e "0110 - UNIMED CAMPINAS" de conviverem no
    // cadastro, no filtro e na conferência como se fossem três convênios.
    convenio: nomeCurtoDoConvenio(semCodigoNaFrente(textos.convenio)).toUpperCase(),
    // O local tem de estar na lista. Nome fora dela é devolvido como está,
    // para aparecer na tela e ser corrigido — apagá-lo esconderia o problema e
    // ainda perderia a única pista de onde a cirurgia foi.
    local: nomeDoLocal(textos.local) || textos.local,
    procedimentos: (entry.procedimentos || [])
      .map((p) => (p || "").toString().trim().toUpperCase())
      .filter(Boolean),
    // Marca da conferência da secretária. Fica no registro, mas não tem coluna
    // na planilha: é controle de quem confere, não dado da cirurgia.
    conferido: entry.conferido === true,
    // Os três campos de escolha. Normalizar aqui converte sozinho o registro
    // antigo — o executado já foi booleano — na primeira vez que ele for
    // gravado, sem precisar de migração.
    executado: estadoDe("executado", entry.executado),
    pcExecutado: estadoDe("pcExecutado", entry.pcExecutado),
    recebido: estadoDe("recebido", entry.recebido),
    valor: valorNumerico(entry.valor),
    nGuia: ehUnimed(entry) ? completarGuia(entry.nGuia) : (entry.nGuia || "").toString().trim(),
  };
}

/**
 * O valor em dinheiro como número, ou "" quando não há valor combinado.
 *
 * Guardar número, e não texto, é o que deixa a planilha somar a coluna e a
 * secretária ver o total do mês sem conta à mão.
 */
function valorNumerico(valor) {
  if (valor === "" || valor === null || valor === undefined) return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : "";
}

/** A normalização mexeu em alguma coisa? Se não, não vale regravar o banco. */
export function mudouNaNormalizacao(antes, depois) {
  if (TEXTOS.some((f) => (antes[f.key] || "") !== (depois[f.key] || ""))) return true;
  if (antes.executado !== depois.executado) return true;
  if (antes.pcExecutado !== depois.pcExecutado) return true;
  if (antes.recebido !== depois.recebido) return true;
  if ((antes.valor ?? "") !== (depois.valor ?? "")) return true;
  return (
    (antes.procedimentos || []).join(" ") !== (depois.procedimentos || []).join(" ")
  );
}
