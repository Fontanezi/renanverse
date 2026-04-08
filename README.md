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
