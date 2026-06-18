# Renanverse — Fediverse Reduzido

O **Renanverse** é um sistema distribuído que implementa um ecossistema social peer-to-peer inspirado no **Fediverse** e no protocolo **ActivityPub**. O projeto tem como objetivo permitir a comunicação e replicação transparente de dados entre diferentes serviços sociais, utilizando uma arquitetura baseada em **peers** e **super peers**.

A proposta consiste na construção de três plataformas interoperáveis:

- Serviço de compartilhamento de imagens (inspirado em Instagram/Pixelfed)
- Sistema de microblogging (inspirado em Twitter/Pleroma)
- Sistema de agregação de links (inspirado em Lobsters)

O sistema garante que postagens, interações e recursos sejam replicados entre os serviços de forma transparente ao usuário.

> Disciplina associada: **ACH2147** (Sistemas Distribuídos).

## Objetivos

- Implementar um ecossistema distribuído baseado no conceito de Fediverse
- Permitir interoperabilidade entre diferentes tipos de serviços sociais
- Garantir replicação transparente de dados entre peers
- Utilizar um modelo híbrido com peers e super peers
- Simular um protocolo inspirado no ActivityPub

## Arquitetura

O sistema segue uma arquitetura distribuída composta por:

- **Peers:** serviços independentes que representam as plataformas sociais
- **Super Peers:** responsáveis por coordenar comunicação, descoberta e replicação

A comunicação entre os nós ocorre via HTTP/HTTPS, utilizando TCP na camada de transporte.

### Características da arquitetura

- Comunicação cliente-servidor síncrona
- Comunicação servidor-servidor assíncrona
- Uso de JSON como formato de troca de mensagens
- Baseado no modelo de objetos do Activity Streams

## Modelo de Dados

As mensagens seguem o padrão **Activity Streams**, utilizando objetos JSON estruturados.

Exemplo de representação de usuário (`Person`):

```json
{
  "@context": ["https://www.w3.org/ns/activitystreams", {"@language": "ja"}],
  "type": "Person",
  "id": "https://kenzoishii.example.com/",
  "following": "https://kenzoishii.example.com/following.json",
  "followers": "https://kenzoishii.example.com/followers.json",
  "liked": "https://kenzoishii.example.com/liked.json",
  "inbox": "https://kenzoishii.example.com/inbox.json",
  "outbox": "https://kenzoishii.example.com/feed.json",
  "preferredUsername": "kenzoishii",
  "name": "石井健蔵",
  "summary": "Este é um exemplo de usuário",
  "icon": ["https://kenzoishii.example.com/image/165987aklre4"]
}
```

## Comunicação

- **Protocolo:** HTTP/HTTPS
- **Transporte:** TCP
- **Métodos:** GET e POST
- **Formato de dados:** JSON
- **Modelo:** Activity Streams

### Tipos de interação

- **Cliente → Servidor:** requisições síncronas
- **Servidor → Servidor:** comunicação assíncrona para replicação de dados

## Funcionalidades

- Criação de postagens em diferentes plataformas
- Compartilhamento de conteúdo entre serviços
- Menção a usuários de outros peers
- Replicação automática de dados
- Gerenciamento de seguidores e interações

## Conceitos Aplicados

- Sistemas distribuídos
- Arquitetura peer-to-peer
- Modelo super peer
- Nomeação baseada em URLs globais
- Comunicação assíncrona entre servidores
- Interoperabilidade entre serviços
- Replicação de dados

## Decisões de Projeto (Sistemas Distribuídos)

### Quais recursos precisam ser nomeados/identificados?

Os principais recursos nomeados são: usuários (`Person`), postagens (`Activities`/`Objects`), serviços (peers e super peers), relacionamentos (`followers`/`following`) e recursos de mídia (imagens e links). Todos são identificados de forma global por meio de **URLs únicas**, seguindo o padrão do Activity Streams.

### Qual esquema de nomeação?

Esquema **estruturado e hierárquico** baseado em URLs HTTP/HTTPS. Cada recurso possui um identificador global único, por exemplo: `/users/{id}`, `/inbox`, `/outbox`, `/followers`. Esse modelo permite organização, escalabilidade e interoperabilidade entre serviços.

### Qual mecanismo de resolução de nomes?

A resolução ocorre em múltiplas camadas: **DNS** (domínio → endereço do servidor), **HTTP/HTTPS** (acesso ao recurso pela URL), **roteamento interno** (direciona a requisição ao serviço correto) e **banco de dados** (mapeia identificadores para os objetos reais).

### Faz sentido usar threads?

Sim. Uma thread por conexão/cliente facilita a organização do código e o compartilhamento de recursos, e é o padrão para servidores web de serviços sociais que não são baseados em interação em tempo real (Streaming, Jogos, Chat). Mesmo sem necessariamente aumentar a vazão, é adequado para a aplicação.

### Servidores stateless ou stateful?

**Stateless.** Não mantemos conexões abertas após a resposta; os recursos (comentários, imagens, postagens) são guardados num banco de dados acoplado e as respostas são reproduzíveis para todos os clientes. Isso facilita distribuir clientes entre nós e adicionar servidores "clones" para balanceamento de carga.

### Virtualização

Usamos **virtualização de processo** (runtime TypeScript, para portabilidade e isolamento) e **isolamento por contêiner** (Docker, para padronizar o deployment, permitir múltiplos serviços em paralelo, melhorar escalabilidade e simplificar testes).

### Sincronização

Em interações com ordem relevante, usamos **relógios lógicos (timestamps)**: o servidor atribui um número sequencial a cada evento, garantindo respeito à **causalidade** mesmo com latência de rede variável.

### Exclusão mútua

**Não.** Posts e comentários usam timestamp do servidor + IDs ordenáveis (ULID/Snowflake). Relógios lógicos só fariam sentido se houvesse edição concorrente do mesmo recurso, o que é raro em redes sociais.

### Algoritmo de seleção/eleição

Não é estritamente necessário com um único backend. Com múltiplas instâncias, usaremos um algoritmo de eleição (**Bully Algorithm**) para decidir qual instância é responsável por tarefas críticas (limpar salas inativas, gerenciar logs globais).

### PUB/SUB

**Sim.** Atualmente simulado via *rooms* do Socket.io (publisher = `socket.emit()`, subscribers = clientes que deram `join` na sala e ouvem via `socket.on()`). Para tornar verdadeiramente distribuído, usaremos um **Redis Adapter**, permitindo Pub/Sub entre processos distintos (usuário no "Servidor A" fala com usuário no "Servidor B").

### Replicação e Consistência

- **Entidades replicadas:** postagens (`Activities`/`Objects`), metadados de usuários (`Person`), relacionamentos e interações (`followers`, `following`, curtidas, comentários). A replicação é assíncrona via HTTP POST (servidor → servidor), mediada pelos super peers.
- **Modelo de consistência:** **Consistência Causal**, enfraquecendo para **Consistência Eventual** em operações concorrentes não relacionadas. Nenhum peer pode exibir a resposta de "B" antes do post original de "A".
- **Distribuição das cópias:** **dinâmica**, baseada em demanda/inscrição. As postagens viajam apenas em direção aos peers que hospedam seguidores da conta de origem, otimizando armazenamento e tráfego.
- **Protocolo de consistência:** implementação própria com **relógios lógicos (Lamport/vetoriais)** embutidos nos metadados JSON. Eventos fora de ordem ficam num *buffer* local e só são liberados quando a dependência causal é resolvida.

## Tolerância a Falhas

### Disponibilidade vs. confiabilidade

Para o Renanverse, **disponibilidade** é mais importante que confiabilidade estrita. Redes sociais do Fediverse priorizam que o usuário sempre consiga postar, ver o feed e interagir, mesmo com um peer remoto fora do ar. É aceitável que uma postagem de outro servidor demore para aparecer; não é aceitável que o serviço inteiro trave porque um peer parou de responder. Isso é coerente com a escolha de **consistência causal/eventual** e **replicação assíncrona**.

Distinção por camada:

- **Dentro de um peer** (usuário ↔ seu próprio servidor): prioriza-se **confiabilidade**, pois é a operação síncrona crítica.
- **Entre peers** (replicação federada): troca-se confiabilidade imediata por **disponibilidade e tolerância a partição**.

### Tipos de falha a tolerar

Foco em **crash** e **omissão**, com tratamento parcial de falhas **temporais**:

- **Crash (parada):** um peer ou super peer cai (processo morre, container reinicia, máquina desliga). Falha principal a tratar.
- **Omissão:** mensagens de replicação (HTTP POST servidor→servidor) se perdem ou deixam de ser enviadas/recebidas. Comum em comunicação assíncrona.
- **Temporal (parcial):** tratamento de timeouts — um peer lento demais é tratado como suspeito de falha, via deadlines nas requisições.

Fora de escopo (justificado no relatório):

- **Falha de resposta** (corrompida/incorreta): mitigada por validação de schema JSON, mas não é foco. - ELABORAR FALHA DE RESPOSTA
- **Falha bizantina** (nós maliciosos/arbitrários): BFT exige `3f+1` nós e é caro. Assume-se um modelo **fail-stop / crash-recovery** com peers cooperativos (não-adversariais). Defesa contra peers maliciosos (assinaturas HTTP, verificação de chave pública — já prevista no modelo `Person`) fica como extensão futura.

### Quantos processos falhantes suportados

- **Replicação entre peers:** tolera **N-1 peers caídos** sem perda de disponibilidade local. Cada peer é autônomo; mensagens para peers caídos não propagam até eles retornarem.
- **Super peers (coordenação/descoberta):** ponto sensível. Com 1 super peer há SPOF. Meta adotada: **tolerar a falha de até 1 super peer (de 3)**, com replicação dos super peers e **eleição de líder (Bully)** — `f+1` nós toleram `f` falhas no modelo crash. (Se fosse usado consenso forte tipo Raft, a regra seria `2f+1` nós para tolerar `f` falhas.)

> **Meta de tolerância:** tolerar a falha de qualquer número de peers e de até 1 super peer (de 3).

### Estratégia de detecção de falhas

**Heartbeat + timeout** (detector de falhas por pulso):

- Cada peer/super peer envia periodicamente um sinal de vida (heartbeat) ao coordenador, ou os super peers trocam heartbeats entre si.
- Sem heartbeat dentro do intervalo (`timeout`), o nó é marcado como **suspeito** e depois **falho**.
- Complemento na camada HTTP: **timeouts** nas requisições de replicação + **retries com backoff exponencial**. Após falhas repetidas, o peer destino é marcado indisponível e as mensagens vão para um **buffer/fila local** (reaproveitando o buffer de reordenação causal).

> Observação: em rede assíncrona, detectores de falha são **imperfeitos** (não se distingue "caiu" de "está lento"). Daí o uso de estados *suspeito/confirmado* e do timeout como trade-off entre detecção rápida e falsos positivos.

### Protocolo

Combinação por camada:

1. **Detecção:** heartbeat/pulso com timeout (gossip opcional para escalar a disseminação de liveness).
2. **Coordenação dos super peers:** **Bully Algorithm** para eleição de líder (simples, adequado ao modelo crash). Alternativa robusta e didática: **Raft** (líder + log replicado + quórum).
3. **Replicação de dados entre peers:** entrega confiável **at-least-once** com **idempotência** — cada Activity carrega um ID único (ULID/Snowflake) e relógio lógico; reentregas são deduplicadas pelo destino, tolerando omissão sem duplicar posts.

> Recomendação para o escopo: **Bully + heartbeat + replicação at-least-once idempotente com relógios lógicos**.

### Consequências do teorema CAP

Sob **partição de rede (P)** — inevitável numa federação pela internet — escolhe-se entre **Consistência forte (C)** e **Disponibilidade (A)**. O Renanverse adota **AP (Disponibilidade + Tolerância a partição)**:

- Durante uma partição, cada peer **continua aceitando postagens e interações localmente** em vez de bloquear (disponibilidade).
- Em troca, abre-se mão de consistência forte: os feeds podem divergir temporariamente.
- Ao curar a partição, as filas/buffers drenam e os relógios lógicos garantem a **ordem causal**, atingindo **consistência eventual com garantia causal** (nunca uma resposta antes do post original).

O CAP justifica formalmente por que não usamos consistência forte: ela tornaria o sistema indisponível sob partição, inaceitável numa rede social federada — mesmo trade-off do ActivityPub real. Em termos de **PACELC**: na ausência de partição, ainda priorizamos **latência** sobre consistência (daí a replicação assíncrona).

### Como recuperar da falha

Modelo **crash-recovery** (o nó retorna e se reintegra):

1. **Persistência durável:** o backend é stateless, mas o estado real vive no **banco de dados acoplado**. Um peer que reinicia recupera postagens/usuários/relacionamentos direto do BD; nada crítico vive só em memória.
2. **Buffer/fila de replicação persistente:** mensagens pendentes para peers fora do ar ficam numa fila persistida. Quando o heartbeat do peer reaparece, a fila é drenada — entrega at-least-once + idempotência garante que nada se perde nem duplica.
3. **Anti-entropy / catch-up:** um peer que volta após longa ausência puxa o que perdeu (ex.: lendo o `outbox` dos peers que segue a partir do último relógio lógico conhecido), fechando o gap de mensagens omitidas.
4. **Recuperação de super peer:** se o líder cai, o **Bully** elege um novo; quando o antigo retorna, reentra como membro comum (ou dispara nova eleição, conforme a regra do Bully em que o nó de maior ID assume).
5. **Snapshots/checkpoints (opcional):** snapshots periódicos do estado do BD para acelerar a restauração.

FOCAR MAIS NA INFRAESTRUTURA (NOS SUPER PEERS, QUANTOS SUPER PEERS PODEM FALHAR???)
FOCAR NA RESOLUÇÃO DE OMISSAO PRINCIPALMENTE E DEPOIS CRASH

