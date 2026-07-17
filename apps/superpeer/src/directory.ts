/**
 * Diretório de descoberta do super peer: mapeia handle "usuario@host" para a
 * URI do ator e o peer que o hospeda. É o estado coordenado replicado entre os
 * super peers (via quórum). Mantido em memória e reconstruído pelos registros
 * periódicos dos peers (heartbeat de registro).
 */
export interface DirEntry {
  handle: string;
  actorUri: string;
  peer: string;
  updatedAt: string;
}

export class Directory {
  private byHandle = new Map<string, DirEntry>();

  /** Insere/atualiza uma entrada (last-writer-wins por updatedAt). */
  upsert(handle: string, actorUri: string, peer: string, updatedAt?: string): DirEntry {
    const entry: DirEntry = {
      handle,
      actorUri,
      peer,
      updatedAt: updatedAt ?? new Date().toISOString(),
    };
    const cur = this.byHandle.get(handle);
    if (!cur || entry.updatedAt >= cur.updatedAt) this.byHandle.set(handle, entry);
    return this.byHandle.get(handle)!;
  }

  resolve(handle: string): DirEntry | undefined {
    return this.byHandle.get(handle);
  }

  all(): DirEntry[] {
    return [...this.byHandle.values()];
  }

  /** Mescla um conjunto de entradas (usado na sincronização entre super peers). */
  merge(entries: DirEntry[]): void {
    for (const e of entries) {
      if (e && e.handle && e.actorUri && e.peer) {
        this.upsert(e.handle, e.actorUri, e.peer, e.updatedAt);
      }
    }
  }

  get size(): number {
    return this.byHandle.size;
  }
}
