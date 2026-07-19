# Guia de Execução e Testes (Renanverse)

Este guia mostra como instalar, rodar e testar o projeto inteiro: os peers
backend (as 3 plataformas + super peers), a interface web e os testes de
integração automatizados.

Para a arquitetura, veja `READMEPROJECT.md`. Para a especificação, `README.md`.

## Pré-requisitos

- **Node.js**
  - Backend: Node 18+.
  - Frontend: Node 20.19+ (ou 22+), porque usa Vite 8. O arquivo
    `frontend/.tool-versions` já fixa `node 22`, então quem usa `mise`/`asdf`
    troca de versão automaticamente ao entrar na pasta `frontend/`.
- **npm** (vem com o Node).
- **lsof** (Unix/macOS): usado pelos testes automatizados para liberar portas.
- Sistema Unix/macOS (os scripts de teste usam `lsof`).

> Backend e frontend têm `node_modules` separados e podem usar versões de Node
> diferentes. Rode `npm install` nos dois lugares.

## Estrutura resumida

```
renanverse/
  packages/core/     # nucleo de federacao compartilhado pelos peers
  apps/              # peers backend: twitter, instagram, reddit, superpeer
  scripts/           # testes de integracao (smoke.mjs, interop.mjs)
  frontend/          # monorepo React (um app web por plataforma) + shared
```

## Portas

| Serviço            | Porta | Observação                         |
|--------------------|:-----:|------------------------------------|
| Peer Twitter       | 3001  | backend                            |
| Peer Instagram     | 3002  | backend                            |
| Peer Reddit        | 3003  | backend                            |
| Super Peer 1/2/3   | 4001/4002/4003 | opcional (descoberta/cluster) |
| Web Twitter        | 5173  | proxy para :3001                   |
| Web Instagram      | 5174  | proxy para :3002                   |
| Web Reddit         | 5175  | proxy para :3003                   |

## Instalação (uma vez)

```bash
# backend (na raiz do repo)
npm install

# frontend
cd frontend
npm install
cd ..
```

## Executar

### Opção A: uma plataforma (2 terminais)

```bash
# Terminal 1 (raiz do repo) - peer backend
npm run dev:twitter          # http://localhost:3001

# Terminal 2 - interface web
cd frontend
npm run dev:twitter          # http://localhost:5173
```

Abra `http://localhost:5173`, entre com um usuário (isso cria um Person no peer)
e comece a postar. O feed atualiza em tempo real via Socket.io.

### Opção B: as 3 plataformas com federação (6 terminais)

Backend (na raiz, um por terminal):

```bash
npm run dev:twitter          # :3001
npm run dev:instagram        # :3002
npm run dev:reddit           # :3003
```

Frontend (dentro de `frontend/`, um por terminal):

```bash
npm run dev:twitter          # :5173  -> peer :3001
npm run dev:instagram        # :5174  -> peer :3002
npm run dev:reddit           # :5175  -> peer :3003
```

Para federar entre plataformas: em cada app, a aba **Explorar** mostra o seu
handle (ex.: `alice@localhost:3001`). Copie o handle de um usuário de outra
plataforma e cole no campo "Seguir". As publicações daquele usuário passam a
aparecer no seu feed em tempo real.

### Super peers (opcional)

Os super peers fazem descoberta, eleição de líder (Bully) e quórum. Não são
necessários para usar a UI: sem eles, a descoberta por handle cai no WebFinger
direto. Para subir o cluster de 3 (um por terminal):

```bash
SUPERPEER_ID=1 PORT=4001 BASE_URL=http://localhost:4001 \
  SUPERPEERS=http://localhost:4002,http://localhost:4003 npm run dev:superpeer
SUPERPEER_ID=2 PORT=4002 BASE_URL=http://localhost:4002 \
  SUPERPEERS=http://localhost:4001,http://localhost:4003 npm run dev:superpeer
SUPERPEER_ID=3 PORT=4003 BASE_URL=http://localhost:4003 \
  SUPERPEERS=http://localhost:4001,http://localhost:4002 npm run dev:superpeer
```

E suba os peers apontando para o cluster (para se registrarem no líder):

```bash
SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:twitter
```

## Testar sem a UI (curl)

Com um peer Twitter rodando em `:3001`:

```bash
# cria um usuario (guarde o "id" da resposta; o :ID e a parte final da URI)
curl -s -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{"preferredUsername":"alice","name":"Alice"}'

# publica um post (troque <ID> pela parte final do id retornado acima)
curl -s -X POST http://localhost:3001/users/<ID>/outbox \
  -H "Content-Type: application/json" \
  -d '{"content":"ola, fediverso"}'

# ve o feed / o outbox do usuario
curl -s http://localhost:3001/users/<ID>/feed
curl -s http://localhost:3001/users/<ID>/outbox

# seguir alguem de outro peer por handle (com o peer :3002 rodando)
curl -s -X POST http://localhost:3001/users/<ID>/following \
  -H "Content-Type: application/json" \
  -d '{"handle":"bob@localhost:3002"}'
```

Campos por plataforma no `POST /outbox`:

- Twitter: `content` (obrigatório, até 280).
- Instagram: `attachmentUrl` (obrigatório), `content` (legenda, opcional).
- Reddit: `objectType` "Link" ou "Page", `title` (obrigatório), `community`;
  `attachmentUrl` obrigatório quando "Link".

## Testes de integração automatizados

Na raiz do repo (sobem toda a topologia como processos e derrubam no fim):

```bash
npm run smoke     # super peers, Bully, quorum 2k+1, vclock, pub/sub, activities
npm run interop   # federacao entre as 3 plataformas (via WebFinger)
npm test          # roda os dois em sequencia
```

Cada verificação imprime `[PASS]`/`[FAIL]`; ao final, o resumo. Os bancos dos
testes ficam em diretório temporário e são recriados a cada execução.

## Solução de problemas

- **Frontend reclama da versão do Node** (ex.: erro sobre `styleText` ou o
  binding do rolldown): o Vite 8 exige Node 20.19+/22. Use o `mise`/`asdf`
  (o `frontend/.tool-versions` já fixa o Node 22) ou selecione um Node 20.19+
  antes de `npm install`/`npm run dev` no frontend. Se trocar de Node depois de
  instalar, apague `frontend/node_modules` e rode `npm install` de novo (os
  binários de plataforma do Vite são resolvidos por versão de Node).
- **`npm install` falha com erro de autenticação/registry**: os `.npmrc` do repo
  (raiz e `frontend/`) apontam para o registry público do npm. Garanta que estão
  presentes e que você não está forçando outro registry.
- **Porta em uso**: encerre o processo anterior (ex.: `lsof -ti tcp:3001 | xargs kill -9`)
  ou rode em outra porta com as variáveis `PORT`/`BASE_URL`.
- **Backend e frontend**: lembre de rodar `npm install` nos dois (`.` e `frontend/`).

## Variáveis de ambiente

- Peer de plataforma: `PEER_ID`, `PORT`, `BASE_URL`, `DATABASE_PATH`,
  `SUPERPEERS` (lista separada por vírgula, opcional), `REDIS_URL` (opcional,
  pub/sub multi-instância).
- Super peer: `SUPERPEER_ID` (numérico, decide a eleição), `PORT`, `BASE_URL`,
  `SUPERPEERS` (os outros super peers do cluster).
