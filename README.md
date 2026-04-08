# renanverse
FEDIVERSE REDUZIDO

O Renanverse é um sistema distribuído que implementa um ecossistema social peer-to-peer inspirado no Fediverse e no protocolo ActivityPub. O projeto tem como objetivo permitir a comunicação e replicação transparente de dados entre diferentes serviços sociais, utilizando uma arquitetura baseada em peers e super peers.

A proposta consiste na construção de três plataformas interoperáveis:
- Serviço de compartilhamento de imagens (inspirado em Instagram/Pixelfed)
- Sistema de microblogging (inspirado em Twitter/Pleroma)
- Sistema de agregação de links (inspirado em Lobsters)
  
O sistema garante que postagens, interações e recursos sejam replicados entre os serviços de forma transparente ao usuário.


Objetivos:
- Implementar um ecossistema distribuído baseado no conceito de Fediverse
- Permitir interoperabilidade entre diferentes tipos de serviços sociais
- Garantir replicação transparente de dados entre peers
- Utilizar um modelo híbrido com peers e super peers
- Simular um protocolo inspirado no ActivityPub

Arquitetura:
O sistema segue uma arquitetura distribuída composta por:
- Peers: serviços independentes que representam as plataformas sociais
- Super Peers: responsáveis por coordenar comunicação, descoberta e replicação

A comunicação entre os nós ocorre via HTTP/HTTPS, utilizando TCP na camada de transporte.

Características da arquitetura:
- Comunicação cliente-servidor síncrona
- Comunicação servidor-servidor assíncrona
- Uso de JSON como formato de troca de mensagens
- Baseado no modelo de objetos do Activity Streams

  
Modelo de Dados:
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

Comunicação:
- Protocolo: HTTP/HTTPS
- Transporte: TCP
- Métodos: GET e POST
- Formato de dados: JSON
- Modelo: Activity Streams

  
Tipos de interação:
- Cliente → Servidor: requisições síncronas
- Servidor → Servidor: comunicação assíncrona para replicação de dados

  
Funcionalidades:
- Criação de postagens em diferentes plataformas
- Compartilhamento de conteúdo entre serviços
- Menção a usuários de outros peers
- Replicação automática de dados
- Gerenciamento de seguidores e interações

Conceitos Aplicados:
- Sistemas distribuídos
- Arquitetura peer-to-peer
- Modelo super peer
- Nomeação baseada em URLs globais
- Comunicação assíncrona entre servidores
- Interoperabilidade entre serviços
- Replicação de dados

Referências:
- ActivityPub: https://en.wikipedia.org/wiki/ActivityPub⁠
- Activity Streams: https://en.wikipedia.org/wiki/Activity_Streams_(format)⁠
- Fediverse: https://en.wikipedia.org/wiki/Fediverse⁠

Possíveis Extensões:
- Implementação de autenticação distribuída
- Suporte a criptografia de ponta a ponta
- Balanceamento de carga entre peers
- Deploy em containers (Docker)
