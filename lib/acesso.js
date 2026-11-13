/**
 * O núcleo do acesso: papéis, cookie assinado, PIN.
 *
 * Este arquivo não importa o Redis de propósito. Ele é o único `lib/` que o
 * `middleware.js` enxerga, e middleware roda no Edge: puxar o cliente do banco
 * para lá significaria uma viagem de rede em cada toque do app. Tudo aqui é
 * cálculo local, com a Web Crypto que os dois lados (Edge e Node) já têm.
 *
 * Quem guarda e lê pessoas é `lib/pessoas.js`, que roda só nas rotas.
 */

// ── Papéis ───────────────────────────────────────────────────────────────────

export const PAPEIS = ["mestre", "secretaria", "equipe"];

/** Quem é criado sem papel declarado entra como usuário comum. */
export const PAPEL_PADRAO = "equipe";

export const ROTULO_DO_PAPEL = {
  mestre: "Mestre",
  secretaria: "Secretária",
  equipe: "Equipe",
};

export function papelValido(papel) {
  return PAPEIS.includes(papel);
}

/**
 * Os três campos que são da conferência, não do lançamento.
 *
 * Ficam juntos num lugar só porque a regra aparece em três pontos — o PUT, o
 * POST e a tela — e três cópias de uma lista de campos divergem.
 */
export const CAMPOS_DA_CONFERENCIA = ["executado", "pcExecutado", "conferido"];

/** Marcar executado, PC executado e conferido. */
export function podeConferir(papel) {
  return papel === "mestre" || papel === "secretaria";
}

/** Apagar um registro de paciente. */
export function podeApagarRegistro(papel) {
  return papel === "mestre" || papel === "secretaria";
}

/** Abrir a tela da secretaria. */
export function podeVerSecretaria(papel) {
  return papel === "mestre" || papel === "secretaria";
}

/** Criar pessoa, zerar PIN de outro, derrubar aparelhos. */
export function podeGerirAcesso(papel) {
  return papel === "mestre";
}

// ── O usuário a partir do nome ───────────────────────────────────────────────

/**
 * Pedaços que não servem como sobrenome: ligações e sufixos de geração.
 *
 * Sem isso, "JOSE SILVA JUNIOR" viraria `jose.junior`, que não identifica
 * ninguém — o sobrenome dele é Silva.
 */
const NAO_E_SOBRENOME = new Set([
  "de", "da", "do", "das", "dos", "e",
  "junior", "jr", "filho", "neto", "sobrinho", "segundo", "terceiro",
]);

function pedacos(nome) {
  return (nome || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * "LEANDRO MARQUES CORREA" → `leandro.correa`.
 *
 * Primeiro nome e último sobrenome, minúsculas e sem acento. Nome de uma só
 * palavra devolve a palavra: é o mestre que confirma o usuário na tela antes de
 * criar, então um caso esquisito aparece para ele em vez de virar bagunça.
 */
export function usuarioDoNome(nome) {
  const partes = pedacos(nome);
  if (partes.length === 0) return "";

  const primeiro = partes[0];
  const sobrenomes = partes.slice(1).filter((p) => !NAO_E_SOBRENOME.has(p));
  if (sobrenomes.length === 0) return primeiro;

  return `${primeiro}.${sobrenomes[sobrenomes.length - 1]}`;
}

/**
 * O desempate de homônimos: `leandro.m.correa`.
 *
 * Dois nomes que dão o mesmo usuário não podem sobrescrever um ao outro — e
 * numerar (`leandro.correa2`) não diz a ninguém qual é qual.
 */
export function usuarioComMeio(nome) {
  const partes = pedacos(nome);
  if (partes.length < 3) return usuarioDoNome(nome);

  const primeiro = partes[0];
  const sobrenomes = partes.slice(1).filter((p) => !NAO_E_SOBRENOME.has(p));
  if (sobrenomes.length < 2) return usuarioDoNome(nome);

  const ultimo = sobrenomes[sobrenomes.length - 1];
  const meio = sobrenomes[0][0];
  return `${primeiro}.${meio}.${ultimo}`;
}

/** O que a tela de entrada aceita digitar. */
export function usuarioValido(usuario) {
  return /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(usuario || "") && usuario.length <= 60;
}

/** Como o digitado é comparado com o guardado: sem espaço e sem maiúscula. */
export function normalizarUsuario(usuario) {
  return (usuario || "").toString().trim().toLowerCase();
}

// ── Bytes, base64url ────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function paraBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto) {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── A chave que assina o cookie ─────────────────────────────────────────────

export const NOME_DO_COOKIE = "hipnos_acesso";

const ROTULO_DA_CHAVE = "acesso-cookie-v1";

/**
 * De onde sai a chave, em ordem.
 *
 * `ACESSO_SEGREDO` se existir. Se não, ela é derivada do token do banco, que
 * já está na Vercel — por HKDF, então a chave não é o token: é material próprio
 * tirado dele, e o token não trafega em lugar nenhum.
 *
 * Isso é de propósito, e o motivo é prático: uma tranca que só vale depois de
 * alguém lembrar de criar uma variável é uma tranca que fica aberta. Quanto ao
 * risco, quem tiver o token do banco já lê e escreve todos os pacientes direto
 * lá — forjar um cookie não lhe daria nada que ele já não tenha.
 *
 * Se as duas faltarem, não há como assinar nem conferir, e quem chama recusa a
 * requisição em vez de deixar passar.
 */
function materialDaChave() {
  const proprio = process.env.ACESSO_SEGREDO;
  if (proprio) return { material: proprio, derivar: false };

  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (token) return { material: token, derivar: true };

  return { material: "", derivar: false };
}

/** Há como trancar? Falso só quando faltam as duas fontes de chave. */
export function trancaConfigurada() {
  return Boolean(materialDaChave().material);
}

let chaveEmCache = null;
let materialEmCache = "";

async function chaveDeAssinatura() {
  const { material, derivar } = materialDaChave();
  if (!material) throw new Error("Sem chave para assinar o acesso.");
  if (chaveEmCache && materialEmCache === material) return chaveEmCache;

  let bytes = enc.encode(material);

  if (derivar) {
    const base = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveBits"]);
    const derivado = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: enc.encode(ROTULO_DA_CHAVE), info: enc.encode(ROTULO_DA_CHAVE) },
      base,
      256
    );
    bytes = new Uint8Array(derivado);
  }

  chaveEmCache = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  materialEmCache = material;
  return chaveEmCache;
}

// ── O cookie ────────────────────────────────────────────────────────────────

export const DIAS_DE_VALIDADE = 90;

/**
 * O cookie: o que a pessoa é, e até quando, assinado.
 *
 * `v` é a versão da sessão. Ela existe para "sair de todos os aparelhos"
 * funcionar sem trocar a chave de todo mundo: a pessoa soma 1 na sua versão e
 * os cookies emitidos antes deixam de valer na hora.
 */
export async function assinarAcesso({ usuario, nome, papel, versao }, { dias = DIAS_DE_VALIDADE } = {}) {
  const dados = {
    u: usuario,
    n: nome || "",
    p: papel,
    v: Number(versao) || 0,
    exp: Date.now() + dias * 24 * 60 * 60 * 1000,
  };
  const corpo = paraBase64Url(enc.encode(JSON.stringify(dados)));
  const chave = await chaveDeAssinatura();
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  return `${corpo}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

/**
 * Lê o cookie, ou diz por que não vale.
 *
 * Quem chama nunca recebe "quase válido": ou vem a pessoa, ou vem o motivo.
 * A conferência da assinatura é a da própria Web Crypto (`verify`), e não uma
 * comparação de strings nossa, que vazaria tempo.
 */
export async function lerAcesso(token) {
  if (!token || typeof token !== "string") return { ok: false, motivo: "ausente" };

  const partes = token.split(".");
  if (partes.length !== 2) return { ok: false, motivo: "malformado" };

  try {
    const chave = await chaveDeAssinatura();
    const confere = await crypto.subtle.verify(
      "HMAC",
      chave,
      deBase64Url(partes[1]),
      enc.encode(partes[0])
    );
    if (!confere) return { ok: false, motivo: "assinatura" };

    const dados = JSON.parse(dec.decode(deBase64Url(partes[0])));
    if (!dados || !dados.u || !papelValido(dados.p)) return { ok: false, motivo: "malformado" };
    if (!dados.exp || Date.now() > dados.exp) return { ok: false, motivo: "expirado" };

    return {
      ok: true,
      pessoa: { usuario: dados.u, nome: dados.n || "", papel: dados.p, versao: dados.v || 0 },
    };
  } catch (e) {
    return { ok: false, motivo: "malformado" };
  }
}

/** O cabeçalho que põe o cookie — assinado pelo servidor, nunca pela página. */
export function cookieDeAcesso(token, { dias = DIAS_DE_VALIDADE } = {}) {
  const partes = [
    `${NOME_DO_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${dias * 24 * 60 * 60}`,
  ];
  // Em desenvolvimento o app roda em http, e um cookie Secure não chegaria.
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}

export function cookieApagado() {
  const partes = [`${NOME_DO_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}

// ── O PIN ───────────────────────────────────────────────────────────────────

export const DIGITOS_DO_PIN = 6;

const ITERACOES = 150000;

export function pinValido(pin) {
  return new RegExp(`^\\d{${DIGITOS_DO_PIN}}$`).test((pin || "").toString());
}

export function novoSal() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return paraBase64Url(bytes);
}

/**
 * O PIN guardado como PBKDF2-SHA256, com sal por pessoa.
 *
 * Seis dígitos são um milhão de possibilidades: com um hash rápido, quem
 * pegasse o banco testaria todas num piscar. As 150 mil iterações e o sal por
 * pessoa é o que torna isso caro — e é por isso também que "zerar PIN" põe um
 * novo em vez de mostrar o antigo: nem eu nem o mestre conseguem ler o de
 * ninguém.
 */
export async function hashDoPin(pin, sal) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sal), iterations: ITERACOES },
    base,
    256
  );
  return paraBase64Url(new Uint8Array(bits));
}

/** Comparação que não entrega, pelo tempo, quantos caracteres bateram. */
export function iguaisEmTempoConstante(a, b) {
  const x = enc.encode(a || "");
  const y = enc.encode(b || "");
  if (x.length !== y.length) return false;
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
}

export async function pinBate(pin, pessoa) {
  if (!pessoa || !pessoa.hash || !pessoa.sal) return false;
  return iguaisEmTempoConstante(await hashDoPin(pin, pessoa.sal), pessoa.hash);
}

/** Como uma pessoa nova nasce: o PIN nunca é guardado, só o hash dele. */
export async function montarPessoa({ usuario, nome, papel, pin }) {
  const sal = novoSal();
  return {
    usuario: normalizarUsuario(usuario),
    nome: (nome || "").toString().trim(),
    papel: papelValido(papel) ? papel : PAPEL_PADRAO,
    sal,
    hash: await hashDoPin(pin, sal),
    versao: 0,
    ativo: true,
    pinTrocado: false,
    criadoEm: new Date().toISOString(),
  };
}

/** O que pode sair do servidor para a tela: tudo menos o hash e o sal. */
export function pessoaParaTela(pessoa) {
  if (!pessoa) return null;
  return {
    usuario: pessoa.usuario,
    nome: pessoa.nome || "",
    papel: pessoa.papel,
    ativo: pessoa.ativo !== false,
    pinTrocado: pessoa.pinTrocado === true,
    criadoEm: pessoa.criadoEm || "",
  };
}
