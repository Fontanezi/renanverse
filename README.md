# renanverse
FEDIVERSE REDUZIDO

O projeto consiste na implementação de um ecossistema social peer-to-peer utilizando um protocolo reduzido inspirado no ActivityPub.

Neste ecossistema será feita a implementação de três sistemas principais (funcionando na política de peers e super peers): Um serviço de compartilhamento de imagens (Instagram / Pixelfed), um sistema de posts (Twitter / Pleroma) e um sistema de agregação de links (Lobsters).

O objetivo principal consiste na implementação de replicação transparente das postagens / recursos / interações entre os três serviços.

Implementação da arquitetura SuperPeer.


    Tipo de comunicação utilizado: HTTP / HTTPS (TCP) na camada de transporte. O serviço é síncrono no lado do cliente e assíncrono no lado do servidor (interação Server-Server).
    Tipos de mensagem e seus formatos: Interações com POST e GET no formato JSON (formato Activity Streams). Estrutura mensagens no formato objeto:

    {
     "@context": ["https://www.w3.org/ns/activitystreams",
                  {"@language": "ja"}],
     "type": "Person",
     "id": "https://kenzoishii.example.com/",
     "following": "https://kenzoishii.example.com/following.json",
     "followers": "https://kenzoishii.example.com/followers.json",
     "liked": "https://kenzoishii.example.com/liked.json",
     "inbox": "https://kenzoishii.example.com/inbox.json",
     "outbox": "https://kenzoishii.example.com/feed.json",
     "preferredUsername": "kenzoishii",
     "name": "石井健蔵",
     "summary": "この方はただの例です",
     "icon": [
       "https://kenzoishii.example.com/image/165987aklre4"
     ]

Funções esperadas: Criar postagens nas plataformas, mencionar usuários de outros serviços

Links de referência: https://en.wikipedia.org/wiki/ActivityPub; https://en.wikipedia.org/wiki/Activity_Streams_(format); https://en.wikipedia.org/wiki/Fediverse;
