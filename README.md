# Controle de Cirurgias

App compartilhado da equipe de anestesia: fotografa-se a **guia**, os dados são
lidos automaticamente (API da Anthropic) e o controle fica centralizado, com
espelho no Google Sheets e exportação em Excel. Sem login — quem tem o link usa.

Este app é uma cópia independente do controle usado por outra equipe. Não há
nenhuma ligação entre os dois: repositório, banco de dados, planilha do Drive e
cadastros são separados.

## O que a foto da guia preenche

| Campo | Vem de |
| --- | --- |
| Paciente, Nº da Guia, Nº da Carteira | leitura da guia |
| Cirurgião | leitura da guia (campo "nome do profissional solicitante"), com autocompletar para corrigir a grafia |
| Procedimentos solicitados | leitura da guia, como caixas marcadas — o anestesista desmarca o que não se aplica |
| Data e hora do lançamento | preenchidas sozinhas e **editáveis** |
| Anestesista que fez o procedimento · Anestesista do carimbo | digitados (podem ser pessoas diferentes) |
| Executado · Urgência · Procedimento complementar · Observação | marcados na tela |

Os procedimentos marcados entram todos na **mesma célula** da planilha,
separados por `·`.

## Adaptar para a equipe

Tudo que identifica a equipe está em **`lib/marca.js`**: nome, título, cores e o
nome das planilhas do Drive. Além dele:

- `public/logo-mark.png` — logo do cabeçalho (fundo transparente, aparece sobre
  a faixa escura)
- `public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.png` —
  ícones do atalho no celular
- `public/manifest.json` — nome curto e cores, à mão (é um arquivo estático e
  não consegue ler `lib/marca.js`)

Nome, cores e ícones já são os da equipe. Os ícones saem do símbolo do logo
oficial, na versão negativa.

A instrução de leitura está em `pages/api/extract.js`, calibrada contra uma
Guia de Solicitação de Internação da Unimed Campinas. Ela cita os campos pelo
número (`10 - Nome`, `3 - Número da Guia Atribuído pela Operadora`, `7 - Número
da Carteira`, `14 - Nome do Profissional Solicitante`) e também pelo rótulo,
para continuar funcionando em guias de outros tipos, como as de SP/SADT.

Três coisas dessa guia que a instrução trata de propósito, e que vale conhecer
antes de mexer nela:

- **O número da guia aparece três vezes**, com valores quase iguais. O que
  interessa é o campo 3, que traz o dígito verificador depois de um hífen
  (`2728385947-6`). O campo 2 é o mesmo número sem o dígito, e a senha (campo 5)
  costuma ser idêntica. A regra de `lib/guia.js` foi conferida contra esse
  número real: o dígito calculado bate com o impresso.
- **O número da carteira começa com zeros** (17 dígitos, como
  `00027614700001013`). Eles não podem cair — por isso a planilha é escrita com
  `valueInputOption: "RAW"`, que guarda o texto sem interpretar.
- **Logo abaixo dos procedimentos vem a tabela "Gabaritos Solicitados"**, com
  aparência idêntica. Gabarito é pacote de cobrança, não procedimento, e a
  instrução manda ignorá-la.

## Publicar na Vercel

1. **Repositório no GitHub** (privado) e importar na Vercel (Add New → Project).
   O framework é detectado como Next.js.

2. **Banco KV (Upstash Redis)** — na Vercel, `vercel integration add upstash/upstash-kv`,
   ou aba **Storage** → **Create Database** → **KV**, conectando ao projeto. Isso
   preenche `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` e
   `KV_REST_API_READ_ONLY_TOKEN` sozinho.

3. **Variáveis de ambiente** (Settings → Environment Variables), em Production e
   Preview:
   - `ANTHROPIC_API_KEY` — a mesma chave do app da outra equipe
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — o JSON da mesma conta de serviço, numa linha
   - `GOOGLE_DRIVE_FOLDER_ID` — **o ID da pasta desta equipe**, que é outra

4. **Link curto**: registre-o como **domínio do projeto** (Settings → Domains),
   e não como apelido solto — apelido congela numa versão antiga.

## Preparar a pasta do Drive (a equipe faz)

A conta de serviço do Google **não tem cota de armazenamento** e não consegue
criar arquivos (`Drive storage quota has been exceeded`). Por isso o app procura
a planilha do ano pelo nome, e quem cria é uma pessoa:

1. Criar uma pasta no Drive de quem responde pela equipe.
2. Compartilhá-la com o `client_email` da conta de serviço, como **Editor**.
3. Passar o ID da pasta (o trecho depois de `/folders/` na URL) para a
   `GOOGLE_DRIVE_FOLDER_ID`.
4. Dentro dela, criar uma **Planilha Google** com o nome exato devolvido por
   `tituloDoAno` em `lib/marca.js` — hoje, `Controle de Cirurgias 2026`. Uma por
   ano.

O app cria e mantém uma aba por mês. Ajeite as larguras de coluna do primeiro
mês à mão: os meses seguintes nascem copiando o layout do mês mais antigo.

## Rodar localmente

```
npm install
cp .env.example .env.local   # preencha ao menos ANTHROPIC_API_KEY
npm run dev
```

Abre em `http://localhost:3000`. Sem KV configurado, os registros não persistem
entre reinícios — normal em dev.

O servidor de desenvolvimento pode entrar em laço de remontagem quando o HMR
cai. Quando desconfiar disso, verifique com `npm run build` e
`npx next start -p 3100`.

## Detalhes que já custaram caro

Estão comentados no código, mas vale a lista:

- **Espelhamento fora do caminho da resposta.** `waitUntil` do `@vercel/functions`
  funciona no Pages Router, apesar do que dizem discussões antigas. Sem ele,
  salvar levava ~5s, o anestesista clicava de novo e o paciente duplicava.
- **Travas no Redis em dois lugares**: no ciclo ler-modificar-gravar (senão uma
  gravação simultânea some com um paciente) e no espelhamento em segundo plano
  (senão uma tarefa antiga termina por último e grava estado velho).
- **A caixa de seleção de "Executado" precisa de faixa de linhas limitada.**
  Aplicada à coluna inteira, o Google materializa "Não" em ~1000 linhas e a
  planilha parece cheia de registros vazios.
- **"Executado" usa `BOOLEAN` com os valores "Sim"/"Não"**, e não menu suspenso:
  a API do Sheets não expõe o estilo do menu.
- **A data do lançamento não sai de `toISOString()`.** Ele devolve UTC, e das 21h
  em diante o Brasil já está no dia seguinte — o plantão da noite nasceria no mês
  errado. Ver `lib/tempo.js`.
- **O dígito verificador da guia** (módulo 11, pesos 2–9) fica em `lib/guia.js`.
  Guia sem o último dígito é completada; guia com dígito divergente é avisada,
  mas **não** corrigida — sobrescrever produziria um número plausível e errado.

## Sobre segurança

- A chave da Anthropic e as credenciais do Google ficam só no servidor, nunca
  chegam ao navegador.
- Não há autenticação: qualquer pessoa com o link vê, adiciona e apaga.
- Os dados são de saúde. O app já pede para não ser indexado, mas o link deve
  circular só entre quem precisa.
