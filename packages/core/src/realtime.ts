// Pub/Sub em tempo (quase) real do peer, via Socket.io.
//
// O relatório (README.md) descreve, além da federação servidor -> servidor,
// a entrega de novidades ao CLIENTE de forma reativa (padrão publish/subscribe).
// Aqui cada peer sobe um servidor Socket.io acoplado ao seu http.Server: o
// cliente de um usuário entra ("join") na room do seu Person e passa a receber
// os eventos do seu feed assim que uma Activity de um ator seguido é aplicada
// localmente — seja por publicação local (outbox) ou por entrega remota
// (federação). Sem polling.
//
// Uma instância de Socket.io por processo (um processo = um peer). Quando o
// realtime não foi inicializado (ex.: app montado em teste via createApp), as
// funções de publicação viram no-op.

import type { Server as HttpServer } from "http";
import { Server as IOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { Database } from "better-sqlite3";
import type { PlatformConfig } from "./types";

let io: IOServer | null = null;

/** Room de um usuário local: onde chegam os eventos do feed dele. */
function roomForUser(personId: string): string {
  return `user:${personId}`;
}

/**
 * Adapter opcional de Redis para o Socket.io. Quando `REDIS_URL` está definido,
 * várias instâncias do MESMO peer (atrás de um balanceador) compartilham as
 * rooms/eventos via Redis pub/sub: um `feed:activity` publicado numa instância
 * chega aos clientes conectados em qualquer outra. Sem `REDIS_URL`, o pub/sub é
 * single-instance (padrão). Conexão assíncrona e tolerante a falha: se o Redis
 * estiver indisponível, o peer segue funcionando em single-instance.
 */
async function attachRedisAdapter(server: IOServer, config: PlatformConfig): Promise<void> {
  const url = config.redisUrl ?? process.env.REDIS_URL;
  if (!url) {
    console.log(`[${config.displayName}] pub/sub single-instance (sem REDIS_URL)`);
    return;
  }

  // Loga a indisponibilidade uma única vez (evita spam dos retries de conexão).
  let warned = false;
  const warn = (e: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(
      `[${config.displayName}] Redis indisponivel, pub/sub segue single-instance: ${(e as Error).message}`
    );
  };

  // Desiste de reconectar após poucas tentativas: se o Redis não está no boot,
  // o peer opera single-instance em vez de tentar para sempre.
  const opts = { url, socket: { reconnectStrategy: (retries: number) => (retries > 3 ? false : 300) } };
  const pub = createClient(opts);
  const sub = pub.duplicate();
  pub.on("error", warn);
  sub.on("error", warn);

  try {
    await Promise.all([pub.connect(), sub.connect()]);
    server.adapter(createAdapter(pub, sub));
    console.log(`[${config.displayName}] pub/sub multi-instancia via Redis (${url})`);
  } catch (e) {
    warn(e);
    await pub.disconnect().catch(() => { });
    await sub.disconnect().catch(() => { });
  }
}

/** Acessa a instância ativa (ou null se o realtime não foi inicializado). */
export function realtimeServer(): IOServer | null {
  return io;
}

/**
 * Sobe o servidor Socket.io acoplado ao http.Server do peer. O cliente emite
 * `join` com o id do seu Person para receber os eventos do feed; `leave` sai
 * da room. Eventos publicados: `feed:activity` (novo post/like/boost no feed),
 * `feed:update` (edição) e `feed:delete` (remoção).
 */
export function initRealtime(httpServer: HttpServer, config: PlatformConfig): IOServer {
  io = new IOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket: Socket) => {
    socket.on("join", (userId: unknown) => {
      if (typeof userId === "string" && userId) {
        socket.join(roomForUser(userId));
        socket.emit("joined", { room: roomForUser(userId) });
      }
    });
    socket.on("leave", (userId: unknown) => {
      if (typeof userId === "string" && userId) socket.leave(roomForUser(userId));
    });
  });

  // Adapter de Redis (multi-instância) quando REDIS_URL estiver definido. É
  // assíncrono e não bloqueia a subida do peer; até conectar, opera single.
  void attachRedisAdapter(io, config);

  console.log(`[${config.displayName}] pub/sub (Socket.io) ativo em ${config.baseUrl}`);
  return io;
}

/** Extrai o id do Person local a partir de uma actorUri deste peer, ou null. */
function localPersonId(config: PlatformConfig, uri: string): string | null {
  const prefix = `${config.baseUrl.replace(/\/$/, "")}/users/`;
  if (!uri.startsWith(prefix)) return null;
  const id = uri.slice(prefix.length).split("/")[0];
  return id || null;
}

/**
 * Publica um evento para as rooms dos usuários LOCAIS que seguem `actorUri` —
 * exatamente o conjunto cujo feed inclui uma Activity desse ator. É chamado
 * tanto na publicação local (outbox) quanto na entrega remota (applyContent).
 */
export function publishActivityToFollowers(
  db: Database,
  config: PlatformConfig,
  actorUri: string,
  event: string,
  payload: unknown
): void {
  if (!io) return;
  // Somente seguidores ACEITOS: quem ainda está com a solicitação pendente não
  // deve receber eventos do feed desse ator.
  const followers = db
    .prepare("SELECT followerActorUri FROM follow WHERE followeeActorUri = ? AND status = 'accepted'")
    .all(actorUri) as { followerActorUri: string }[];

  const seen = new Set<string>();
  for (const f of followers) {
    const pid = localPersonId(config, f.followerActorUri);
    if (pid && !seen.has(pid)) {
      seen.add(pid);
      io.to(roomForUser(pid)).emit(event, payload);
    }
  }
}
