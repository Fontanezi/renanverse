import express, { type Express } from "express";
import { Directory } from "./directory";
import { Cluster } from "./cluster";
import type { SuperPeerConfig } from "./config";

/**
 * Monta o app do super peer: diretório de descoberta + coordenação de cluster
 * (heartbeat + eleição Bully).
 */
export function createSuperPeerApp(
  config: SuperPeerConfig
): { app: Express; directory: Directory; cluster: Cluster } {
  const directory = new Directory();
  const cluster = new Cluster(config);
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      role: "super-peer",
      id: config.id,
      baseUrl: config.baseUrl,
      leaderId: cluster.leaderId,
      isLeader: cluster.isLeader(),
      cluster: config.peers,
      directorySize: directory.size,
    });
  });

  // --- Coordenação do cluster (Bully / heartbeat) ---

  app.get("/ping", (_req, res) => {
    res.json({ id: config.id, leaderId: cluster.leaderId, alive: true });
  });

  app.post("/election", (req, res) => {
    const fromId = Number(req.body?.fromId);
    if (!Number.isFinite(fromId)) return res.status(400).json({ error: "fromId invalido" });
    res.json(cluster.onElection(fromId));
  });

  app.post("/coordinator", (req, res) => {
    const leaderId = Number(req.body?.leaderId);
    if (!Number.isFinite(leaderId)) return res.status(400).json({ error: "leaderId invalido" });
    cluster.onCoordinator(leaderId);
    res.json({ ok: true });
  });

  app.get("/status", (_req, res) => {
    res.json(cluster.status());
  });

  // POST /register — um peer anuncia seus atores { peer, actors:[{handle,actorUri}] }.
  // Escrita no diretório é COORDENADA: só o líder escreve, replicando aos
  // seguidores e confirmando com MAIORIA (quórum 2k+1). Sem maioria, recusa
  // (503) — a coordenação suspende escritas para não divergir (CP).
  app.post("/register", async (req, res) => {
    const { peer, actors } = req.body ?? {};
    if (typeof peer !== "string" || !Array.isArray(actors)) {
      return res.status(400).json({ error: "esperado { peer, actors:[{handle,actorUri}] }" });
    }
    const now = new Date().toISOString();
    const entries = actors
      .filter((a) => a && typeof a.handle === "string" && typeof a.actorUri === "string")
      .map((a) => ({ handle: a.handle, actorUri: a.actorUri, peer, updatedAt: now }));
    if (!entries.length) return res.json({ registered: 0 });

    if (cluster.isLeader()) {
      const acks = 1 + (await cluster.replicate(entries)); // self + seguidores
      const need = cluster.quorumSize();
      if (acks < need) {
        return res
          .status(503)
          .json({ error: "sem quorum para escrever no diretorio", acks, need });
      }
      directory.merge(entries);
      return res.json({ committed: true, acks, need, directorySize: directory.size });
    }

    // Não sou o líder: encaminho a escrita para ele.
    const leader = cluster.leaderUrl();
    if (!leader) return res.status(503).json({ error: "sem lider no momento" });
    try {
      const r = await fetch(`${leader}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer, actors }),
        signal: AbortSignal.timeout(1500),
      });
      const body = await r.json().catch(() => ({}));
      return res.status(r.status).json(body);
    } catch {
      return res.status(503).json({ error: "falha ao encaminhar ao lider" });
    }
  });

  // POST /replicate — o líder empurra entradas do diretório para os seguidores.
  app.post("/replicate", (req, res) => {
    const entries = req.body?.entries;
    if (Array.isArray(entries)) directory.merge(entries);
    res.json({ ok: true, directorySize: directory.size });
  });

  // GET /resolve?handle=usuario@host — descoberta: handle -> ator + peer.
  app.get("/resolve", (req, res) => {
    const handle = typeof req.query.handle === "string" ? req.query.handle : "";
    const entry = directory.resolve(handle);
    if (!entry) return res.status(404).json({ error: "handle nao encontrado no diretorio" });
    res.json(entry);
  });

  // GET /directory — diretório completo (usado para sincronização entre super peers).
  app.get("/directory", (_req, res) => {
    res.json({ entries: directory.all() });
  });

  return { app, directory, cluster };
}

export function startSuperPeer(config: SuperPeerConfig): void {
  const { app, cluster } = createSuperPeerApp(config);
  app.listen(config.port, () => {
    console.log(`[super-peer #${config.id}] rodando em ${config.baseUrl} (porta ${config.port})`);
    cluster.start();
  });
}
