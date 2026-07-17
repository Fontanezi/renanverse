# Renanverse — Monorepo

Estrutura:

```
renanverse/
  packages/
    core/            # tudo que é compartilhado pelos 3 apps
      src/db.ts               # schema sqlite (person, follow, activity, kv, delivery, inbox_buffer)
      src/activitystreams.ts  # tipos + serialização AS2
      src/types.ts            # PlatformConfig / ActivityInput
      src/federation.ts       # Lamport, outbox durável + dispatcher, inbox (dedup + buffer causal)
      src/routes/users.ts     # /users, /outbox (com fan-out), /following, /followers, /feed
      src/routes/inbox.ts     # inbox real: POST /users/:id/inbox
      src/server.ts           # createApp() / startApp() + startFederation()
  apps/
    twitter/         # microblog — objectType "Note", limite de 280 chars, inReplyTo
      src/config.ts
    instagram/       # imagens — "Image", attachmentUrl obrigatório, caption, altText/filter
      src/config.ts
    reddit/          # links/texto — title, community, attachmentUrl p/ "Link"
      src/config.ts  # + GET /communities/:name/outbox via mountExtraRoutes
```

## Como funciona a divisão

Cada app é **um peer independente** (porta e banco próprios), que importa
`@renanverse/core` e só precisa fornecer um `PlatformConfig`
(`peerId`, `baseUrl`, `port`, `dbPath` e, principalmente,
`createActivitySchema` — o schema Zod que valida o POST no outbox).

Tudo que é genérico (Person, Follow, serialização AS2 e agora a **federação
inteira** — entrega, inbox, relógio lógico, buffer causal) vive uma única vez
em `packages/core` e é reaproveitado pelos 3. Um app que precise de rotas
próprias (ex.: `/communities` do Reddit) usa o hook `mountExtraRoutes` do
`PlatformConfig`, sem tocar no núcleo.

## Rodando

```bash
npm install

# em terminais separados:
npm run dev:twitter     # http://localhost:3001
npm run dev:instagram   # http://localhost:3002
npm run dev:reddit      # http://localhost:3003
```

Copie os `.env.example` de cada app para `.env` (ou exporte as variáveis
antes de rodar) se quiser mudar porta/URL/banco.

> Obs.: o `.npmrc` do repositório aponta para o registry público do npm.

## Endpoints (todos os peers)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/users` | cria um Person local |
| GET  | `/users/:id` | perfil AS2 (Person) |
| POST | `/users/:id/outbox` | publica uma Activity (valida pelo schema do app) e faz fan-out |
| GET  | `/users/:id/outbox` | Activities publicadas pelo ator |
| POST | `/users/:id/following` | segue um ator; se for remoto, federa um Follow |
| GET  | `/users/:id/following` | quem o ator segue |
| GET  | `/users/:id/followers` | quem segue o ator |
| GET  | `/users/:id/feed` | linha do tempo: Activities dos atores seguidos (locais e remotas) |
| POST | `/users/:id/inbox` | recepção servidor-servidor (Follow/Accept/Create/Like/Announce) |

Só no Reddit: `GET /communities/:name/outbox` (posts de uma comunidade).

## Regras por plataforma (`config.ts`)

- **Twitter**: `objectType` "Note"; `content` obrigatório, máx. 280; `attachmentUrl`
  opcional; `inReplyTo` opcional (guardado em `meta`, habilita threads).
- **Instagram**: `objectType` "Image"; `attachmentUrl` obrigatório (mensagem
  distingue ausente de inválido); `content` (legenda) opcional até 2200;
  `altText`/`filter` opcionais em `meta`.
- **Reddit**: `objectType` "Link" ou "Page"; `title` obrigatório; `attachmentUrl`
  exigido quando `objectType === "Link"`; `title`/`community` em `meta`.

## Testando um peer isolado

```bash
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{"preferredUsername":"renan","name":"Renan"}'

# pegue o "id" da resposta (parte final da URI em "id")
curl -X POST http://localhost:3001/users/<ID>/outbox \
  -H "Content-Type: application/json" \
  -d '{"content":"meu primeiro tweet no fediverso reduzido"}'

curl http://localhost:3001/users/<ID>/outbox
```

Um tweet com mais de 280 caracteres, ou sem `content`, retorna 400 com o
erro do Zod.

## Testando a federação (dois peers)

Com twitter (3001) e instagram (3002) rodando:

```bash
# ator A no twitter, ator B no instagram
A=$(curl -s -X POST http://localhost:3001/users -H "Content-Type: application/json" \
     -d '{"preferredUsername":"alice","name":"Alice"}' | jq -r .id)
B=$(curl -s -X POST http://localhost:3002/users -H "Content-Type: application/json" \
     -d '{"preferredUsername":"bob","name":"Bob"}' | jq -r .id)

# B (instagram) segue A (twitter) — federa um Follow para a inbox de A
curl -s -X POST http://localhost:3002/users/${B##*/}/following \
  -H "Content-Type: application/json" -d "{\"actorUri\":\"$A\"}"

# A publica — fan-out replica para a inbox de B
curl -s -X POST http://localhost:3001/users/${A##*/}/outbox \
  -H "Content-Type: application/json" -d '{"content":"ola, fediverso"}'

# feed de B no instagram já mostra o post de A (entrega é assíncrona, ~1-2s)
curl -s http://localhost:3002/users/${B##*/}/feed | jq
```

## Fase 2 (replicação entre peers) — IMPLEMENTADA

A federação servidor-servidor vive em `packages/core/src/federation.ts` e é
compartilhada pelos 3 apps. Componentes:

- **Relógio lógico de Lamport** (tabela `kv`): estampa cada Activity e ordena o
  feed; avança em `max(local, recebido) + 1` na recepção.
- **Entrega (fan-out na escrita)**: ao publicar, o peer enfileira uma entrega
  para a inbox de cada seguidor. As entregas ficam numa **outbox durável**
  (tabela `delivery`, padrão *transactional outbox*): um dispatcher em segundo
  plano tenta o POST, com **at-least-once** e **retry com backoff exponencial**
  (até 10 tentativas). Sobrevive a reinício do processo.
- **Inbox real** (`POST /users/:id/inbox`): trata `Follow`/`Accept` (federação de
  seguidores) e conteúdo (`Create`/`Like`/`Announce`), com:
  - **deduplicação** pela URI canônica da Activity (índice único em `activity.uri`);
  - **buffer causal** (tabela `inbox_buffer`): se a Activity depende de outra
    ainda não recebida (`inReplyTo`), fica retida até a dependência chegar; um
    *sweeper* aplica itens presos por tempo demais (fallback de disponibilidade,
    coerente com a escolha AP do projeto).

O schema de validação de cada app (`createActivitySchema`) roda **só na
publicação local** (`/outbox`). A inbox aceita o que os outros peers enviam, o
que permite, por exemplo, um post "Note" do Twitter aparecer no feed de um
usuário do Instagram.

Validado com dois peers: Follow federado, fan-out chegando no feed remoto,
reordenação causal de uma resposta que chegou antes do post original,
deduplicação e retry.

## Próximos passos

- **Descoberta**: hoje um peer só passa a receber posts de um ator remoto depois
  que alguém local o segue (o Follow federado avisa o peer de origem). Falta um
  mecanismo de descoberta de atores entre peers (ex.: WebFinger ou um índice em
  super peer, como descrito no relatório).
- **Undo**: `Unfollow`/`Unlike` (Activity `Undo`) ainda não são tratados na inbox.
- **Segurança**: assinatura das entregas servidor-servidor (HTTP Signatures)
  para autenticar a origem — hoje confiamos no emissor (modelo fail-stop).
