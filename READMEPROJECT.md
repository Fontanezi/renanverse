# Renanverse — Monorepo

Estrutura:

```
renanverse/
  packages/
    core/            # tudo que é compartilhado pelos 3 apps
      src/db.ts               # schema sqlite (person, follow, activity, kv, delivery, inbox_buffer)
      src/activitystreams.ts  # tipos + serialização AS2 (Person com publicKey)
      src/types.ts            # PlatformConfig / ActivityInput
      src/federation.ts       # Lamport, outbox durável + dispatcher, inbox (dedup + buffer causal), Undo
      src/webfinger.ts        # descoberta: resolve handle usuario@host -> URI do ator
      src/httpsig.ts          # HTTP Signatures (RSA): assina e verifica entregas
      src/routes/users.ts     # /users, /outbox, /following (+unfollow), /activities (unlike), /feed
      src/routes/inbox.ts     # inbox real (verifica assinatura): POST /users/:id/inbox
      src/routes/webfinger.ts # GET /.well-known/webfinger
      src/server.ts           # createApp() / startApp() + startFederation() + par de chaves
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
| GET  | `/.well-known/webfinger?resource=acct:user@host` | descoberta: resolve o handle e devolve a URI do ator (JRD) |
| POST | `/users` | cria um Person local (resposta AS2 inclui a `publicKey`) |
| GET  | `/users/:id` | perfil AS2 (Person) com `publicKey` |
| POST | `/users/:id/outbox` | publica uma Activity (valida pelo schema do app) e faz fan-out |
| GET  | `/users/:id/outbox` | Activities publicadas pelo ator |
| DELETE | `/users/:id/activities/:activityId` | desfaz um Like/Announce local (federa `Undo`) |
| POST | `/users/:id/following` | segue um ator por `actorUri` ou `handle`; se remoto, federa `Follow` |
| DELETE | `/users/:id/following` | deixa de seguir (`actorUri`/`handle`); se remoto, federa `Undo{Follow}` |
| GET  | `/users/:id/following` | quem o ator segue |
| GET  | `/users/:id/followers` | quem segue o ator |
| GET  | `/users/:id/feed` | linha do tempo: Activities dos atores seguidos (locais e remotas) |
| POST | `/users/:id/inbox` | recepção servidor-servidor, assinada (Follow/Accept/Undo/Create/Like/Announce) |

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

## Descoberta (WebFinger) — IMPLEMENTADA

`packages/core/src/webfinger.ts` + `routes/webfinger.ts`. Um peer expõe
`GET /.well-known/webfinger?resource=acct:usuario@host` e devolve um JRD com o
link `self` (`application/activity+json`) apontando para a URI do ator. Isso
permite **seguir por handle** sem conhecer o id interno: `POST /users/:id/following`
aceita `{ "handle": "alice@localhost:3001" }`, resolve via WebFinger no peer
remoto e então federa o `Follow`.

```bash
curl "http://localhost:3001/.well-known/webfinger?resource=acct:alice@localhost:3001"
# bob (instagram) segue alice (twitter) só pelo handle:
curl -X POST http://localhost:3002/users/<BOB_ID>/following \
  -H "Content-Type: application/json" -d '{"handle":"alice@localhost:3001"}'
```

## Undo (unfollow / unlike) — IMPLEMENTADO

A inbox trata `Undo`: `Undo{Follow}` remove a relação de seguidor;
`Undo{Like|Announce}` remove a Activity referenciada. As ações locais que
disparam o Undo federado:

- `DELETE /users/:id/following` (por `actorUri` ou `handle`) — deixa de seguir e,
  se remoto, federa `Undo{Follow}` (o peer de origem para de fazer fan-out).
- `DELETE /users/:id/activities/:activityId` — desfaz um Like/Announce local e
  federa o `Undo` aos seguidores. (Apagar um post `Create` seria uma Activity
  `Delete`, ainda não implementada.)

## Segurança (HTTP Signatures) — IMPLEMENTADA

`packages/core/src/httpsig.ts`. Cada peer tem um par RSA (gerado no primeiro
start, persistido no `kv`) e publica a chave pública no `Person` (`publicKey`).

- **Assinatura**: o dispatcher assina cada entrega no esquema Cavage sobre
  RSA-SHA256, cobrindo `(request-target) host date digest` (o `Digest` é o
  SHA-256 do corpo).
- **Verificação**: a inbox refaz a signing string, confere o `Digest` contra o
  corpo cru e valida a assinatura buscando a `publicKey` do ator de origem
  (pelo `keyId`). Entregas sem assinatura válida são rejeitadas com **401**.

Validado com dois peers: fluxo assinado (Follow e post) aceito; entrega sem
assinatura ou com corpo adulterado retorna 401.

## Próximos passos

- **`Delete` de posts**: o `Undo` cobre Like/Follow/Announce; apagar um `Create`
  exige tratar a Activity `Delete` (tombstone) na inbox.
- **Testes automatizados**: montar uma suíte de integração da federação (subir
  peers em processo e validar fan-out, buffer causal e assinatura).
- **Paginação** das coleções (`outbox`, `followers`, `feed`) e cache das chaves
  públicas remotas na verificação (hoje cada verificação busca o ator).
- **Super peer como serviço à parte** (descrito no relatório): o código atual usa
  federação direta peer-a-peer; um super peer de descoberta/coordenação seria a
  evolução de arquitetura.
