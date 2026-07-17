// Cliente do super peer (lado do peer): registro no diretório de descoberta e
// resolução de handles via super peer, com WebFinger como fallback.
//
// Descoberta (§4.2/§6.3): um peer não precisa conhecer a URL exata de um ator
// remoto — pergunta ao super peer "quem hospeda usuario@host". O peer também se
// registra periodicamente para manter o diretório fresco (reconstruído se o
// super peer reiniciar).

import type { Database } from "better-sqlite3";
import { resolveHandleToActorUri } from "./webfinger";
import { hostFromBaseUrl } from "./webfinger";
import type { PlatformConfig } from "./types";

const REGISTER_INTERVAL_MS = 10000;

/** Lista de super peers: da config, ou de process.env.SUPERPEERS. */
export function superPeerUrls(config: PlatformConfig): string[] {
  if (config.superPeers && config.superPeers.length) return config.superPeers;
  return (process.env.SUPERPEERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Monta a lista de atores locais no formato { handle, actorUri }. */
function localActors(db: Database, config: PlatformConfig): { handle: string; actorUri: string }[] {
  const host = hostFromBaseUrl(config.baseUrl);
  const persons = db
    .prepare("SELECT id, preferredUsername FROM person")
    .all() as { id: string; preferredUsername: string }[];
  return persons.map((p) => ({
    handle: `${p.preferredUsername}@${host}`,
    actorUri: `${config.baseUrl}/users/${p.id}`,
  }));
}

/** Descobre a URL do super peer líder consultando /status em qualquer um. */
async function findLeaderUrl(supers: string[]): Promise<string | null> {
  for (const sp of supers) {
    try {
      const res = await fetch(`${sp}/status`, { signal: AbortSignal.timeout(800) });
      if (res.ok) {
        const s = (await res.json()) as { leaderUrl?: string | null };
        if (s.leaderUrl) return s.leaderUrl;
      }
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

/**
 * Registra os atores locais no super peer LÍDER (escrita coordenada por quórum).
 * Se não houver líder/quórum no momento, ignora — tenta de novo no próximo ciclo.
 */
export async function registerWithSuperPeers(db: Database, config: PlatformConfig): Promise<void> {
  const supers = superPeerUrls(config);
  if (!supers.length) return;
  const actors = localActors(db, config);
  if (!actors.length) return;

  const leader = await findLeaderUrl(supers);
  if (!leader) return;

  try {
    await fetch(`${leader}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer: config.baseUrl, actors }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* líder indisponível ou sem quórum: tenta de novo no próximo ciclo */
  }
}

/** Resolve um handle consultando os super peers (primeiro que responder vence). */
export async function resolveViaSuperPeer(
  config: PlatformConfig,
  handle: string
): Promise<string | null> {
  for (const sp of superPeerUrls(config)) {
    try {
      const res = await fetch(`${sp}/resolve?handle=${encodeURIComponent(handle)}`);
      if (res.ok) {
        const entry = (await res.json()) as { actorUri?: string };
        if (entry.actorUri) return entry.actorUri;
      }
    } catch {
      /* tenta o próximo super peer */
    }
  }
  return null;
}

/**
 * Resolve um handle usuario@host para a URI do ator: tenta o super peer
 * (descoberta coordenada) e, se não houver/achar, cai no WebFinger direto.
 */
export async function resolveHandle(config: PlatformConfig, handle: string): Promise<string | null> {
  return (await resolveViaSuperPeer(config, handle)) ?? (await resolveHandleToActorUri(handle));
}

/** Inicia o registro periódico no(s) super peer(s). Chamado por createApp. */
export function startRegistration(db: Database, config: PlatformConfig): void {
  if (!superPeerUrls(config).length) return;
  void registerWithSuperPeers(db, config);
  setInterval(() => {
    void registerWithSuperPeers(db, config);
  }, REGISTER_INTERVAL_MS).unref();
}
