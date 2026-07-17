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
  app.post("/register", (req, res) => {
    const { peer, actors } = req.body ?? {};
    if (typeof peer !== "string" || !Array.isArray(actors)) {
      return res.status(400).json({ error: "esperado { peer, actors:[{handle,actorUri}] }" });
    }
    let n = 0;
    for (const a of actors) {
      if (a && typeof a.handle === "string" && typeof a.actorUri === "string") {
        directory.upsert(a.handle, a.actorUri, peer);
        n++;
      }
    }
    res.json({ registered: n, directorySize: directory.size });
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
