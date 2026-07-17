// Coordenação do cluster de super peers: detecção de falha por heartbeat e
// eleição de líder pelo Bully Algorithm (§4.4/§6.8/§7.4).
//
// Cada super peer tem um ID numérico; o de MAIOR ID entre os vivos vira líder.
// Se o líder para de responder ao heartbeat, dispara-se nova eleição.

import type { SuperPeerConfig } from "./config";

const HEARTBEAT_INTERVAL_MS = 1500;
const ELECTION_TIMEOUT_MS = 2500;
const RPC_TIMEOUT_MS = 800;

interface PeerInfo {
  url: string;
  id: number | null;
  alive: boolean;
}

async function rpc(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

export class Cluster {
  leaderId: number | null = null;
  private electing = false;
  private peers: PeerInfo[];

  constructor(private config: SuperPeerConfig) {
    this.peers = config.peers.map((url) => ({ url, id: null, alive: false }));
  }

  get selfId(): number {
    return this.config.id;
  }

  isLeader(): boolean {
    return this.leaderId === this.selfId;
  }

  status() {
    return {
      id: this.selfId,
      leaderId: this.leaderId,
      isLeader: this.isLeader(),
      peers: this.peers.map((p) => ({ url: p.url, id: p.id, alive: p.alive })),
    };
  }

  /** URLs dos super peers vivos (não inclui self). */
  alivePeerUrls(): string[] {
    return this.peers.filter((p) => p.alive).map((p) => p.url);
  }

  /** Faz ping em todos os pares, atualizando id + vivacidade. */
  private async pingAll(): Promise<void> {
    await Promise.all(
      this.peers.map(async (p) => {
        const res = await rpc(`${p.url}/ping`);
        if (res && res.ok) {
          try {
            const b = (await res.json()) as { id?: number };
            if (typeof b.id === "number") p.id = b.id;
          } catch {
            /* ignora corpo inválido */
          }
          p.alive = true;
        } else {
          p.alive = false;
        }
      })
    );
  }

  private leaderIsAlive(): boolean {
    if (this.leaderId === null) return false;
    if (this.leaderId === this.selfId) return true;
    const lp = this.peers.find((p) => p.id === this.leaderId);
    return !!lp && lp.alive;
  }

  /** Ciclo periódico: monitora o líder e dispara eleição quando necessário. */
  async tick(): Promise<void> {
    await this.pingAll();
    if (this.isLeader()) return; // sou líder; um ID maior, se voltar, se elege
    if (!this.leaderIsAlive()) {
      await this.startElection();
    }
  }

  /** Bully: envia ELECTION aos IDs maiores; se ninguém responde, vira líder. */
  async startElection(): Promise<void> {
    if (this.electing) return;
    this.electing = true;

    const higher = this.peers.filter((p) => p.id !== null && (p.id as number) > this.selfId);
    let anyOk = false;
    await Promise.all(
      higher.map(async (p) => {
        const res = await rpc(`${p.url}/election`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId: this.selfId }),
        });
        if (res && res.ok) anyOk = true;
      })
    );

    if (!anyOk) {
      // Nenhum ID maior respondeu: eu venço.
      this.becomeLeader();
      this.electing = false;
      return;
    }

    // Alguém maior assumirá a eleição; espero o COORDINATOR. Se não vier, refaço.
    setTimeout(() => {
      this.electing = false;
      if (this.leaderId === null || (this.leaderId as number) < this.selfId) {
        void this.startElection();
      }
    }, ELECTION_TIMEOUT_MS);
  }

  private becomeLeader(): void {
    this.leaderId = this.selfId;
    console.log(`[super-peer #${this.selfId}] assumo como LIDER`);
    for (const p of this.peers) {
      void rpc(`${p.url}/coordinator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaderId: this.selfId }),
      });
    }
  }

  /** Recebeu ELECTION de um ID menor: responde OK e se afirma (Bully). */
  onElection(fromId: number): { ok: boolean } {
    if (fromId < this.selfId) void this.startElection();
    return { ok: true };
  }

  /** Recebeu o anúncio de novo líder. */
  onCoordinator(leaderId: number): void {
    this.leaderId = leaderId;
    this.electing = false;
    console.log(`[super-peer #${this.selfId}] novo lider: #${leaderId}`);
  }

  start(): void {
    setInterval(() => void this.tick(), HEARTBEAT_INTERVAL_MS).unref();
  }
}
