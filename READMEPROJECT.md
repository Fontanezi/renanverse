# Renanverse (Fediverse Reduzido) Monorepo

Ecossistema social distribuído inspirado no Fediverse e no ActivityPub, com três
plataformas interoperáveis (microblog, imagens e agregação de links) que federam
entre si, coordenadas por um cluster de super peers. Disciplina ACH2147
(Sistemas Distribuídos).

## Estrutura

```
renanverse/
  packages/
    core/                       # tudo que é compartilhado pelos peers
      src/db.ts                 # schema sqlite (person, follow, activity, kv, delivery, inbox_buffer, processed_msg)
      src/activitystreams.ts    # tipos + serialização AS2 (Person com publicKey)
      src/types.ts              # PlatformConfig / ActivityInput
      src/federation.ts         # envelope _meta, relógio vetorial (§6.6), outbox durável, inbox causal, anti-entropy, Create/Update/Delete/Like/Announce/Reject/Mention
      src/registry.ts           # cliente do super peer: registro no líder + resolução de handle (super peer, com WebFinger de fallback)
      src/realtime.ts           # pub/sub Socket.io (rooms por usuário) + Redis adapter opcional
      src/webfinger.ts          # descoberta: resolve handle usuario@host para a URI do ator
      src/httpsig.ts            # HTTP Signatures (RSA): assina e verifica entregas
      src/routes/users.ts       # /users, /outbox, /following, /activities (Update/Delete/Undo), /likes, /announces, /followers (Reject), /feed, /mentions, /catchup
      src/routes/inbox.ts       # inbox assinada: POST /users/:id/inbox
      src/routes/webfinger.ts   # GET /.well-known/webfinger
      src/server.ts             # createApp() / startApp() + http.Server + Socket.io + federação + registro
  apps/
    twitter/                    # microblog: objectType "Note", limite de 280 chars, inReplyTo
    instagram/                  # imagens: "Image", attachmentUrl obrigatório, caption, altText/filter
    reddit/                     # links/texto: title, community, attachmentUrl para "Link"
    superpeer/                  # serviço à parte: diretório de descoberta + cluster (Bully + quórum)
      src/config.ts             # id numérico, baseUrl, port, peers (outros super peers)
      src/directory.ts          # diretório handle -> { actorUri, peer } (LWW por updatedAt)
      src/cluster.ts            # heartbeat, eleição Bully, quórum 2k+1, replicação
      src/server.ts             # /register, /replicate, /resolve, /directory, /ping, /election, /coordinator, /status
```

## Como funciona a divisão

Cada app de plataforma é um peer independente (porta e banco próprios) que importa
`@renanverse/core` e fornece um `PlatformConfig` (`peerId`, `baseUrl`, `port`,
`dbPath`, `createActivitySchema` e, opcionalmente, `superPeers` e `redisUrl`).

Tudo que é genérico (Person, Follow, serialização AS2 e a federação inteira:
entrega, inbox, relógios, buffer causal, anti-entropy, pub/sub) vive uma única vez
em `packages/core` e é reaproveitado pelos três. Um app com rotas próprias (ex.:
`/communities` do Reddit) usa o hook `mountExtraRoutes` do `PlatformConfig`, sem
tocar no núcleo.

O super peer é um app separado (`apps/superpeer`), fiel ao relatório: ele não
serve conteúdo social, apenas coordena descoberta e cluster.

## Rodando

```bash
npm install

# super peers (cluster de 3), em terminais separados:
SUPERPEER_ID=1 PORT=4001 BASE_URL=http://localhost:4001 \
  SUPERPEERS=http://localhost:4002,http://localhost:4003 npm run dev:superpeer
SUPERPEER_ID=2 PORT=4002 BASE_URL=http://localhost:4002 \
  SUPERPEERS=http://localhost:4001,http://localhost:4003 npm run dev:superpeer
SUPERPEER_ID=3 PORT=4003 BASE_URL=http://localhost:4003 \
  SUPERPEERS=http://localhost:4001,http://localhost:4002 npm run dev:superpeer

# peers de plataforma, apontando para os super peers:
SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:twitter    # http://localhost:3001
SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:instagram  # http://localhost:3002
SUPERPEERS=http://localhost:4001,http://localhost:4002,http://localhost:4003 npm run dev:reddit     # http://localhost:3003
```

Um cluster de super peers é opcional para o fluxo básico: sem `SUPERPEERS`, os
peers caem no WebFinger direto para descoberta e continuam federando.

### Variáveis de ambiente

Peer de plataforma: `PEER_ID`, `PORT`, `BASE_URL`, `DATABASE_PATH`, `SUPERPEERS`
(lista separada por vírgula, opcional), `REDIS_URL` (opcional, pub/sub
multi-instância).

Super peer: `SUPERPEER_ID` (numérico, decide a eleição), `PORT`, `BASE_URL`,
`SUPERPEERS` (os outros super peers do cluster).

> Obs.: o `.npmrc` do repositório aponta para o registry público do npm.

## Endpoints dos peers de plataforma

| Método | Rota | Descrição |
|--------|------|-----------|
| GET  | `/.well-known/webfinger?resource=acct:user@host` | descoberta: resolve o handle e devolve a URI do ator (JRD) |
| POST | `/users` | cria um Person local (resposta AS2 inclui a `publicKey`) |
| GET  | `/users/:id` | perfil AS2 (Person) com `publicKey` |
| POST | `/users/:id/outbox` | publica uma Activity (valida pelo schema do app), resolve menções e faz fan-out |
| GET  | `/users/:id/outbox` | Activities publicadas pelo ator (exclui Update/Delete) |
| PATCH | `/users/:id/activities/:activityId` | edita um post `Create` local e federa um `Update` |
| DELETE | `/users/:id/activities/:activityId` | `Create` federa `Delete` (tombstone); `Like`/`Announce` federa `Undo` |
| POST | `/users/:id/likes` | curte um objeto por URI (`Like`) e federa aos seguidores |
| POST | `/users/:id/announces` | compartilha/boost um objeto por URI (`Announce`) e federa aos seguidores |
| POST | `/users/:id/following` | segue por `actorUri` ou `handle`; se remoto, federa `Follow` |
| DELETE | `/users/:id/following` | deixa de seguir; se remoto, federa `Undo{Follow}` |
| DELETE | `/users/:id/followers` | remove um seguidor e federa `Reject{Follow}` |
| GET  | `/users/:id/following` | quem o ator segue |
| GET  | `/users/:id/followers` | quem segue o ator |
| GET  | `/users/:id/feed` | linha do tempo dos atores seguidos (locais e remotos) |
| GET  | `/users/:id/mentions` | Activities recebidas que mencionam o ator (tag Mention) |
| GET  | `/catchup?since=N` | anti-entropy: envelopes autorados por este peer com sequência maior que N |
| POST | `/users/:id/inbox` | recepção servidor-servidor assinada (Follow/Accept/Reject/Undo/Create/Update/Delete/Like/Announce) |

Só no Reddit: `GET /communities/:name/outbox`.

## Endpoints do super peer

| Método | Rota | Descrição |
|--------|------|-----------|
| GET  | `/` | identidade e estado resumido (id, líder, tamanho do diretório) |
| POST | `/register` | um peer anuncia seus atores; escrita coordenada por quórum (só o líder escreve) |
| POST | `/replicate` | o líder empurra entradas do diretório para os seguidores |
| GET  | `/resolve?handle=user@host` | descoberta: handle para ator + peer |
| GET  | `/directory` | diretório completo |
| GET  | `/ping` | heartbeat (id, líder, vivo) |
| POST | `/election` | mensagem ELECTION do Bully |
| POST | `/coordinator` | anúncio de novo líder |
| GET  | `/status` | estado do cluster (líder, `leaderUrl`, quórum, pares vivos) |

## Regras por plataforma (`config.ts`)

- Twitter: `objectType` "Note"; `content` obrigatório (máx. 280); `attachmentUrl`
  opcional; `inReplyTo` opcional (em `meta`, habilita threads).
- Instagram: `objectType` "Image"; `attachmentUrl` obrigatório; `content`
  (legenda) opcional até 2200; `altText`/`filter` opcionais em `meta`.
- Reddit: `objectType` "Link" ou "Page"; `title` obrigatório; `attachmentUrl`
  exigido para "Link"; `title`/`community` em `meta`.

## Federação servidor a servidor

Vive em `packages/core/src/federation.ts`, compartilhada pelos peers.

### Envelope de controle `_meta`

Toda entrega vai embrulhada em `{ activity, _meta }`, onde `_meta` carrega
`{ msgId, origin, vclock, inReplyTo, ts }`. O `msgId` (ULID) dá deduplicação; a
`origin` é o baseUrl do peer autor; o `vclock` é o relógio vetorial usado na
ordenação causal.

### Relógio vetorial e entrega causal (§6.6)

O relógio vetorial (na tabela `kv`, chave `vclock`) é indexado pela origem
(baseUrl de cada peer). Uma mensagem de conteúdo incrementa o componente do
autor ao ser publicada; na recepção, o peer só entrega quando a regra causal é
satisfeita: `Vm[j] == Vlocal[j] + 1` e `Vm[k] <= Vlocal[k]` para todo `k != j`.
O que chega fora de ordem espera num buffer de hold-back (`inbox_buffer`) e é
liberado quando o relógio local avança; um sweeper aplica itens presos por tempo
demais, preservando disponibilidade (AP).

Controle (Follow/Accept/Reject/Undo) é ponto a ponto e não participa do relógio
vetorial de conteúdo: `wrapControl` não incrementa o relógio, `wrapContent` sim.
Isso mantém a sequência de conteúdo por origem contígua (sem lacunas fantasma),
que é o que o anti-entropy usa para detectar o que faltou.

### Entrega durável e assinada

Ao publicar, o peer enfileira uma entrega para a inbox de cada seguidor (e de
cada ator mencionado). As entregas ficam numa outbox durável (`delivery`, padrão
transactional outbox): um dispatcher tenta o POST com at-least-once e retry com
backoff exponencial (até 10 tentativas), sobrevivendo a reinício. Cada entrega é
assinada (HTTP Signatures, RSA-SHA256, esquema Cavage sobre
`(request-target) host date digest`); a inbox rejeita entrega sem assinatura
válida com 401.

### Recepção e deduplicação

A inbox deduplica por `msgId` (tabela `processed_msg`). Controle é aplicado na
hora; conteúdo passa pela regra causal. A validação por schema de cada app roda
só na publicação local, então um post "Note" do Twitter aparece no feed de um
usuário do Instagram.

### Anti-entropy / catch-up (§6.10, §7.7)

Cada peer expõe `GET /catchup?since=N` (envelopes que autorou, com sequência
maior que N). A cada 15s, `runAntiEntropy` puxa de cada origem seguida o que
falta desde o último número de sequência conhecido e reprocessa. É a rede de
segurança contra omissão silenciosa: o que se perdeu na entrega é recuperado.

## Activities suportadas

- Create: publicação de post/imagem/link, entra no feed pela ordenação causal.
- Like e Announce: curtir e compartilhar um objeto existente por URI, via
  `POST /users/:id/likes` e `POST /users/:id/announces` (o `object` da Activity
  e a URI do objeto alvo). Federam aos seguidores (§3, "replica p/ seguidores") e
  entram no feed pela ordenação causal; o desfazer vai por `Undo` (unlike/unboost).
- Update: `PATCH` num post local federa um `Update` (last-writer-wins pelo
  relógio observado); o feed remoto reflete a edição.
- Delete: `DELETE` num post `Create` federa um `Delete` (tombstone); o post some
  do feed. Feed e outbox filtram `Update`/`Delete` (registrados apenas para o
  catch-up).
- Follow/Accept/Undo: federação de seguidores (auto-accept) e desfazer
  (unfollow/unlike).
- Reject: `DELETE /users/:id/followers` federa um `Reject{Follow}`; o peer do
  seguidor desfaz o follow do lado dele.
- Mention: menções `@usuario@host` no conteúdo são resolvidas (super peer, com
  WebFinger de fallback) e anexadas como tag Mention; o fan-out entrega também
  ao ator mencionado, mesmo que ele não siga o autor (visível em `/mentions`).

## Descoberta e super peers

### WebFinger

`GET /.well-known/webfinger?resource=acct:usuario@host` devolve um JRD com o link
`self` apontando para a URI do ator. Permite seguir por handle sem conhecer o id
interno.

### Diretório de descoberta

O super peer mantém um diretório `handle -> { actorUri, peer }` (last-writer-wins
por `updatedAt`). Os peers se registram periodicamente (a cada 10s) via
`registry.ts`: descobrem o líder por `/status` e registram os atores locais só no
líder. A resolução de handle tenta o super peer primeiro e cai no WebFinger se
não houver diretório ou entrada.

### Cluster e eleição de líder (Bully, §4.4/§6.8/§7.4)

Cada super peer tem um ID numérico; o de maior ID entre os vivos é o líder.
Detecção de falha por heartbeat (`/ping` a cada 1500ms, RPC com timeout de
800ms). Se o líder para de responder, dispara-se uma eleição Bully: o candidato
envia ELECTION aos IDs maiores; se nenhum responde, vira líder e anuncia com
COORDINATOR; senão, aguarda o anúncio (timeout de 2500ms) e refaz se necessário.
Um nó de ID maior que recebe COORDINATOR de um ID menor dispara nova eleição,
garantindo convergência para o maior ID.

Quando a liderança muda (um nó vira líder, ou um nó que retorna aceita o líder
atual), o super peer ressincroniza o diretório a partir do estado atual do
cluster (§6.8): o líder reúne as entradas dos seguidores vivos e um seguidor que
reingressa puxa o diretório do líder, mesclando por LWW. Assim um super peer que
volta com o diretório vazio o repopula na hora, sem esperar o próximo ciclo de
registro dos peers.

### Quórum 2k+1 no diretório (§7.3)

A escrita no diretório é coordenada: só o líder escreve. Ele replica as entradas
aos seguidores vivos (`/replicate`) e só confirma com maioria
(`quorum = floor(N/2) + 1`). Sem maioria, recusa com 503: a coordenação suspende
escritas em vez de divergir (comportamento CP dentro da coordenação). Um
não-líder que recebe um registro encaminha ao líder. Num cluster de 3, o registro
tolera a queda de 1 super peer; com apenas 1 vivo, é recusado.

## Pub/Sub em tempo real

`packages/core/src/realtime.ts`. Cada peer sobe um servidor Socket.io acoplado ao
seu `http.Server`. O cliente entra ("join") na room do seu Person (`user:<id>`) e
recebe eventos assim que uma Activity de um ator seguido é aplicada localmente,
seja por publicação local (outbox) ou por entrega remota (federação). Eventos:
`feed:activity` (novo conteúdo), `feed:update` (edição), `feed:delete` (remoção).

O adapter de Redis é opcional (`REDIS_URL`, via `@socket.io/redis-adapter`):
quando definido, várias instâncias do mesmo peer compartilham rooms e eventos por
Redis pub/sub. Sem `REDIS_URL`, o pub/sub roda single-instance; se o Redis estiver
indisponível no boot, o peer segue single-instance com um aviso, sem cair.

## Testando um peer isolado

```bash
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{"preferredUsername":"renan","name":"Renan"}'

# use o "id" da resposta (parte final da URI em "id")
curl -X POST http://localhost:3001/users/<ID>/outbox \
  -H "Content-Type: application/json" \
  -d '{"content":"meu primeiro tweet no fediverso reduzido"}'

curl http://localhost:3001/users/<ID>/outbox
```

Um tweet acima de 280 caracteres, ou sem `content`, retorna 400 com o erro do Zod.

## Testando a federação (dois peers)

Com twitter (3001) e instagram (3002) rodando:

```bash
A=$(curl -s -X POST http://localhost:3001/users -H "Content-Type: application/json" \
     -d '{"preferredUsername":"alice","name":"Alice"}' | jq -r .id)
B=$(curl -s -X POST http://localhost:3002/users -H "Content-Type: application/json" \
     -d '{"preferredUsername":"bob","name":"Bob"}' | jq -r .id)

# bob segue alice pelo handle (resolvido via super peer, ou WebFinger)
curl -s -X POST http://localhost:3002/users/${B##*/}/following \
  -H "Content-Type: application/json" -d '{"handle":"alice@localhost:3001"}'

# alice publica; o fan-out replica para a inbox de bob
curl -s -X POST http://localhost:3001/users/${A##*/}/outbox \
  -H "Content-Type: application/json" -d '{"content":"ola, fediverso"}'

# o feed de bob no instagram já mostra o post de alice (entrega assíncrona, ~1-2s)
curl -s http://localhost:3002/users/${B##*/}/feed | jq
```

## Segurança (HTTP Signatures)

`packages/core/src/httpsig.ts`. Cada peer tem um par RSA (gerado no primeiro
start, persistido no `kv`) e publica a chave pública no `Person` (`publicKey`). O
dispatcher assina cada entrega (RSA-SHA256, cobrindo
`(request-target) host date digest`, com `Digest` SHA-256 do corpo). A inbox
refaz a signing string, confere o `Digest` e valida a assinatura buscando a
`publicKey` do ator de origem pelo `keyId`. Entregas sem assinatura válida ou com
corpo adulterado recebem 401.

## O que o relatório pede e onde está

- Três plataformas interoperáveis: `apps/twitter`, `apps/instagram`, `apps/reddit`.
- Peers e super peers: peers de plataforma + `apps/superpeer` (diretório + cluster).
- Modelo Activity Streams (JSON) sobre HTTP: `activitystreams.ts`, rotas + inbox.
- Comunicação cliente-servidor síncrona e servidor-servidor assíncrona:
  rotas HTTP + outbox durável com dispatcher.
- Nomeação por URLs globais: `actorUri` completo em todo o schema.
- Relógios vetoriais e ordenação causal: `federation.ts` (§6.6).
- Eleição de líder (Bully) e quórum 2k+1: `apps/superpeer/src/cluster.ts` (§7.3/§7.4).
- Replicação transparente e recuperação: fan-out + anti-entropy.
- Pub/Sub: `realtime.ts` (Socket.io + Redis opcional).

## Melhorias futuras

- Paginação das coleções (`outbox`, `followers`, `feed`).
- Cache das chaves públicas remotas na verificação de assinatura (hoje cada
  verificação busca o ator).
- Suíte de testes automatizados versionada no repositório (a validação de
  integração de ponta a ponta hoje é feita por um roteiro externo).
- Renderização AS2 mais fiel de `Like`/`Announce` (hoje a URI do objeto alvo
  fica em `object.object`; o alvo é preservado, mas a forma canônica seria
  `object` como string).
