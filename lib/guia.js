/**
 * Dígito verificador do nº da guia (módulo 11, pesos 2–9 cíclicos).
 *
 * A etiqueta às vezes chega sem o último dígito. Aqui o número é analisado
 * para completar o que falta e avisar quando o dígito informado não confere.
 *
 * Regra do convênio:
 *   prefixo 2 -> 10 dígitos sem DV, 11 com DV
 *   prefixo 1 ->  9 dígitos sem DV, 10 com DV
 */

/** Quantos dígitos o número tem antes do DV, conforme o primeiro dígito. */
function tamanhoBase(prefixo) {
  if (prefixo === "2") return 10;
  if (prefixo === "1") return 9;
  return null;
}

/** Calcula o DV de uma base já sem dígito verificador. */
export function calcularDV(base) {
  const n = base.length;
  let soma = 0;
  for (let j = 0; j < n; j++) {
    // Pesos 2,3,...,9 e recomeça, contando da direita para a esquerda.
    const peso = 2 + ((n - 1 - j) % 8);
    soma += Number(base[j]) * peso;
  }
  const resto = soma % 11;
  const bruto = 11 - resto;
  return bruto >= 10 ? 0 : bruto; // resto 0 ou 1 -> DV 0
}

/**
 * Analisa um nº de guia.
 *
 * Devolve sempre `numero`: o valor a ser gravado. Só é diferente da entrada no
 * caso "completada". Quando o dígito não confere o número é devolvido intacto —
 * sobrescrever o último dígito de um número cuja leitura já falhou produziria
 * um número plausível porém errado.
 */
export function analisarGuia(valor) {
  const digitos = (valor || "").toString().replace(/\D/g, "");

  // Sem nenhum dígito não há o que analisar. Devolve o texto original intacto:
  // há registros com anotações à mão nesse campo (ex.: "Urgência") e apagá-las
  // seria perder informação que alguém digitou de propósito.
  if (!digitos) {
    return { estado: "vazia", numero: (valor || "").toString(), mensagem: "" };
  }

  const base_ = tamanhoBase(digitos[0]);
  if (base_ === null) {
    return {
      estado: "formato",
      numero: digitos,
      mensagem: `Guia deveria começar com 1 ou 2 (recebido ${digitos[0]}). Confira a etiqueta.`,
    };
  }

  if (digitos.length === base_) {
    const dv = calcularDV(digitos);
    return {
      estado: "completada",
      numero: digitos + dv,
      base: digitos,
      dv: String(dv),
      mensagem: `Faltava o último dígito: completei com ${dv}.`,
    };
  }

  if (digitos.length === base_ + 1) {
    const base = digitos.slice(0, base_);
    const informado = digitos.slice(-1);
    const correto = String(calcularDV(base));

    if (informado === correto) {
      return { estado: "valida", numero: digitos, base, dv: informado, mensagem: "Guia conferida." };
    }

    return {
      estado: "divergente",
      numero: digitos, // de propósito: não corrige
      base,
      dv: informado,
      dvCorreto: correto,
      mensagem: `O último dígito não confere (informado ${informado}, esperado ${correto}). Confira a etiqueta.`,
    };
  }

  return {
    estado: "formato",
    numero: digitos,
    mensagem:
      `Guia com ${digitos.length} dígitos. Começando com ${digitos[0]}, ` +
      `o esperado é ${base_} sem o dígito ou ${base_ + 1} com ele.`,
  };
}

/** Atalho para gravação: devolve o número já completo quando dá para completar. */
export function completarGuia(valor) {
  return analisarGuia(valor).numero;
}
