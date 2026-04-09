# renanverse
<h2>FEDIVERSE REDUZIDO</h2>

O Renanverse é um sistema distribuído que implementa um ecossistema social peer-to-peer inspirado no Fediverse e no protocolo ActivityPub. O projeto tem como objetivo permitir a comunicação e replicação transparente de dados entre diferentes serviços sociais, utilizando uma arquitetura baseada em peers e super peers.

A proposta consiste na construção de três plataformas interoperáveis:
- Serviço de compartilhamento de imagens (inspirado em Instagram/Pixelfed)
- Sistema de microblogging (inspirado em Twitter/Pleroma)
- Sistema de agregação de links (inspirado em Lobsters)
  
O sistema garante que postagens, interações e recursos sejam replicados entre os serviços de forma transparente ao usuário.


<h3>Objetivos</h3>
- Implementar um ecossistema distribuído baseado no conceito de Fediverse <br>
- Permitir interoperabilidade entre diferentes tipos de serviços sociais <br>
- Garantir replicação transparente de dados entre peers <br>
- Utilizar um modelo híbrido com peers e super peers <br>
- Simular um protocolo inspirado no ActivityPub <br>

<h3>Arquitetura</h3>
O sistema segue uma arquitetura distribuída composta por:
- Peers: serviços independentes que representam as plataformas sociais <br>
- Super Peers: responsáveis por coordenar comunicação, descoberta e replicação

A comunicação entre os nós ocorre via HTTP/HTTPS, utilizando TCP na camada de transporte.

<h3>Características da arquitetura</h3>
- Comunicação cliente-servidor síncrona <br>
- Comunicação servidor-servidor assíncrona <br>
- Uso de JSON como formato de troca de mensagens <br>
- Baseado no modelo de objetos do Activity Streams

  
<h3>Modelo de Dados</h3>
As mensagens seguem o padrão do Activity Streams, utilizando objetos JSON estruturados.

Exemplo de representação de usuário:
JSON
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {"@language": "ja"}
  ],
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
  "icon": [
    "https://kenzoishii.example.com/image/165987aklre4"
  ]
}

<h3>Comunicação</h3>
- Protocolo: HTTP/HTTPS <br>
- Transporte: TCP <br>
- Métodos: GET e POST <br>
- Formato de dados: JSON <br>
- Modelo: Activity Streams

  
<h3>Tipos de interação</h3>
- Cliente → Servidor: requisições síncronas <br>
- Servidor → Servidor: comunicação assíncrona para replicação de dados

  
<h3>Funcionalidades</h3>
- Criação de postagens em diferentes plataformas <br>
- Compartilhamento de conteúdo entre serviços <br>
- Menção a usuários de outros peers <br>
- Replicação automática de dados <br>
- Gerenciamento de seguidores e interações

<h3>Conceitos Aplicados</h3>
- Sistemas distribuídos <br>
- Arquitetura peer-to-peer <br>
- Modelo super peer <br>
- Nomeação baseada em URLs globais <br>
- Comunicação assíncrona entre servidores <br>
- Interoperabilidade entre serviços <br>
- Replicação de dados

<h3>Referências</h3>
- ActivityPub: https://en.wikipedia.org/wiki/ActivityPub⁠ <br>
- Activity Streams: https://en.wikipedia.org/wiki/Activity_Streams_(format) <br>⁠
- Fediverse: https://en.wikipedia.org/wiki/Fediverse⁠

<h3>Possíveis Extensões</h3>
- Implementação de autenticação distribuída <br>
- Suporte a criptografia de ponta a ponta <br>
- Balanceamento de carga entre peers <br>
- Deploy em containers (Docker)

### Quais recursos precisam ser nomeados/identificados?

Os principais recursos que precisam ser nomeados são:

- Usuários (Person)
- Postagens (Activities / Objects)
- Serviços (peers e super peers)
- Relacionamentos (followers e following)
- Recursos de mídia (imagens e links)

Todos esses recursos são identificados de forma global por meio de URLs únicas, seguindo o padrão do Activity Streams.

---

### Qual esquema de nomeação?

O sistema utiliza um esquema de nomeação estruturado e hierárquico baseado em URLs HTTP/HTTPS. Cada recurso possui um identificador global único, por exemplo:

- `/users/{id}`
- `/inbox`
- `/outbox`
- `/followers`

Esse modelo permite organização, escalabilidade e interoperabilidade entre diferentes serviços distribuídos.

---

### Qual mecanismo de resolução de nomes?

A resolução de nomes ocorre em múltiplas camadas:

- **DNS**: resolve o domínio para o endereço do servidor
- **HTTP/HTTPS**: permite acessar o recurso através da URL
- **Roteamento interno**: direciona a requisição para o serviço correto
- **Banco de dados**: mapeia identificadores para os objetos reais

Esse processo garante que um nome (URL) seja convertido no recurso correspondente no sistema distribuído.

---

### Faz sentido usar threads?

Uma implementação onde cada thread gerencia uma conexão/cliente facilita a organização do código, ajuda no compartilhamento de recursos como variáveis globais e caminhos comuns de código, além de ser o padrão para servidores web para serviços sociais que não são baseados em interações em "tempo real" (como Streaming, Jogos, Bate-Papo); Mesmo não necessariamente aumentando a vazão do servidor, consideramos adequado para a aplicação o uso de threads.

---

### Servidores stateless ou stateful?

Como não pretendemos manter conexões abertas após a resposta dos recursos necessários (comentários, imagens, postagens, etc.), esses recursos serão externamente guardados em um banco de dados acoplado a aplicação e as respostas não dependem de um estado específico, mas são comuns e reproduzíveis a todos os clientes, consideramos ideal o modelo **stateless**; Isso pode ajudar caso precisemos distribuir clientes entre diversos nós em situações de alta demanda e adição de novos servidores "clones" para balanceamento de carga.

---

### Faz sentido usar técnicas de virtualização?

Sim, consideramos adequado valer tanto vitualização de processos através de uma runtime da linguagem typescript para facilitar portabilidade e melhorar isolamento, quanto isolação de contâiner através do Docker, para padronizar o processo deployment em diferentes instãncias, distribuição do sistema, permitir reutilização de recursos do SO base e facilitar testes em nossos computadores.

- Permite isolamento entre peers e super peers
- Facilita a execução de múltiplos serviços em paralelo
- Melhora a escalabilidade
- Simplifica o processo de deploy

Tecnologias como containers podem ser utilizadas para implementar essa abordagem.

---

### Será usado um mecanismo de sincronização?
Sim. Em um ambiente de chat ou interação em tempo real, a ordem dos eventos é fundamental. Como o atraso de rede (latência) varia entre os usuários, uma mensagem enviada depois pode chegar antes ao servidor. Utilizaremos Relógios Lógicos (Timestamps): Em vez de confiar no horário do computador de cada usuário, o servidor atribui um número sequencial a cada evento. Isso garante que a "causalidade" seja respeitada (a resposta nunca aparece antes da pergunta).

---

### Será empregada exclusão mútua? Qual algoritmo?
Sim, para a consistência de estados. Se o sistema permitir a criação de salas com nomes únicos ou limites de usuários, dois clientes podem tentar realizar a mesma ação simultaneamente. No estágio atual, um algoritmo centralizado é o mais adequado. O servidor Node.js atua como o coordenador que concede a "permissão" (lock) para a escrita no banco de dados ou alteração de estado da sala.

---

### Será necessário algoritmo de seleção? Qual?
Não é estritamente necessário enquanto houver apenas um servidor backend (ponto único de falha). Com múltiplas instâncias do servidor para suportar mais usuários, precisaremos de um algoritmo de eleição (como o Bully Algorithm). Ele serviria para decidir qual das instâncias do servidor seria a responsável por tarefas críticas, como limpar salas inativas ou gerenciar logs globais.

---

### Usará PUB/SUB? Se sim, como será a implementação?
Sim.
- Implementação: Atualmente, o Socket.io simula isso através de rooms.
- Publisher: O cliente que envia uma mensagem via socket.emit().
- Subscriber: Todos os clientes que deram join na mesma sala e ouvem via socket.on().

Para tornar o sistema verdadeiramente distribuído, a implementação deve usar um Redis Adapter. Isso permite que o "Pub/Sub" aconteça entre diferentes processos do servidor, garantindo que um usuário conectado ao "Servidor A" consiga falar com um usuário no "Servidor B".
