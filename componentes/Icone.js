/**
 * Os ícones do app e da conferência.
 *
 * Traço, e não emoji: emoji é multicolorido, muda de desenho em cada sistema e
 * não alinha com o texto ao lado. Todos no mesmo quadro de 20 e na mesma
 * espessura, e na cor do texto em volta (`currentColor`) — assim o ícone de um
 * item ativo fica dourado sem uma regra a mais.
 *
 * Sempre `aria-hidden`: quem dá nome ao botão é o rótulo ao lado ou o
 * `aria-label` do próprio botão, nunca o desenho.
 */

const DESENHOS = {
  busca: (
    <>
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L17 17" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="4.5" width="14" height="13" rx="2" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </>
  ),
  colunas: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M8.5 4v12M13 4v12" />
    </>
  ),
  baixar: <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 15h12" />,
  atualizar: (
    <>
      <path d="M16 10a6 6 0 1 1-1.8-4.3" />
      <path d="M16 3.5v3.2h-3.2" />
    </>
  ),
  voltar: <path d="M12 5l-5 5 5 5" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  alerta: (
    <>
      <path d="M10 3.5L17 16H3z" />
      <path d="M10 8.2v3.3M10 13.6h.01" />
    </>
  ),
  enter: (
    <>
      <path d="M16 5v4a2 2 0 0 1-2 2H5" />
      <path d="M8 8l-3 3 3 3" />
    </>
  ),
  fechar: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  abaixo: <path d="M5 8l5 5 5-5" />,
  camera: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2l1.2-2h4.6l1.2 2h2A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
      <circle cx="10" cy="10.8" r="2.8" />
    </>
  ),
  mapa: (
    <>
      <rect x="4" y="3.5" width="12" height="14" rx="2" />
      <path d="M7.5 3.5V2.8h5v.7M7 8h6M7 11h6M7 14h3.5" />
    </>
  ),
  galeria: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7.5" cy="8" r="1.3" />
      <path d="M3.5 14l4-4 3 3 2-2 4 4" />
    </>
  ),
  lapis: <path d="M12.5 4.5l3 3L7 16H4v-3zM11 6l3 3" />,
  mais: <path d="M10 4v12M4 10h12" />,
  pessoas: (
    <>
      <circle cx="7.5" cy="7" r="2.8" />
      <path d="M2.5 16.5c.6-2.7 2.6-4.2 5-4.2s4.4 1.5 5 4.2" />
      <path d="M13 4.6a2.6 2.6 0 0 1 0 5M14.5 12.6c1.6.5 2.6 1.8 3 3.9" />
    </>
  ),
  lixo: <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5" />,
  copiar: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </>
  ),
  reticencias: <path d="M5 10h.01M10 10h.01M15 10h.01" />,
  acima: <path d="M5 12l5-5 5 5" />,
  avancar: <path d="M8 5l5 5-5 5" />,
  grafico: <path d="M4 16V9M8 16V5M12 16v-5M16 16V7M3 16.5h14" />,
  tabela: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8h14M3 12h14M8 8v8" />
    </>
  ),
};

export default function Icone({ nome, tamanho = 16, espessura = 1.5, style }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={espessura}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // O desenho não recebe toque: ele é decoração, e quem precisa receber é
      // o botão em volta. Sem isto, um toque que cai em cima do traço tem o
      // svg como alvo, e o `aria-hidden` que o esconde do leitor de tela não
      // o esconde do dedo.
      style={{ flexShrink: 0, pointerEvents: "none", ...style }}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
