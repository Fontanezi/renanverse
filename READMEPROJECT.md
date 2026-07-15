# Renanverse — Monorepo

Estrutura:

```
renanverse/
  packages/
    core/            # tudo que é compartilhado pelos 3 apps
      src/db.ts               # schema sqlite (person, follow, activity)
      src/activitystreams.ts  # tipos + serialização AS2
      src/types.ts            # PlatformConfig / ActivityInput
      src/routes/users.ts     # rotas genéricas /users, /outbox, /following...
      src/routes/inbox.ts     # stub de inbox (Fase 1)
      src/server.ts           # createApp() / startApp()
  apps/
    twitter/         # microblog — implementado
      src/config.ts  # regras: objectType "Note", limite de 280 chars
    instagram/       # esqueleto — regras específicas ainda por implementar
      src/config.ts  # TODOs: attachmentUrl obrigatório, altText, filter
    reddit/          # esqueleto — regras específicas ainda por implementar
      src/config.ts  # TODOs: title obrigatório, community/subreddit
```

## Como funciona a divisão

Cada app é **um peer independente** (porta e banco próprios), que importa
`@renanverse/core` e só precisa fornecer um `PlatformConfig`
(`peerId`, `baseUrl`, `port`, `dbPath` e, principalmente,
`createActivitySchema` — o schema Zod que valida o POST no outbox).

Tudo que é genérico (Person, Follow, serialização AS2, inbox stub) vive
uma única vez em `packages/core` e é reaproveitado pelos 3.

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

## Testando o Twitter (já funcional)

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

## Próximos passos (Instagram e Reddit)

Os dois têm `config.ts` com TODOs explícitos. Principais pendências:

- **Instagram**: tornar `attachmentUrl` de fato obrigatório (hoje está
  `.url()` sem `.optional()`, mas vale revisar as mensagens de erro),
  decidir se `content` (legenda) é obrigatório, e pensar em `meta.altText`.
- **Reddit**: decidir se `community` precisa virar uma tabela própria
  (com endpoint `GET /communities/:name/outbox`) em vez de só um campo
  livre em `meta`, e exigir `attachmentUrl` quando `objectType === "Link"`.

## Fase 2 (replicação entre peers)

O `/inbox` de cada app continua stub. Quando entrar a Fase 2, o handler
de `packages/core/src/routes/inbox.ts` é o único lugar que precisa mudar
para os 3 apps ganharem federação de uma vez — dedup por ID, buffer de
causalidade (lamportClock) e persistência do que chegou fora de ordem.
