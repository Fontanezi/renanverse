// Camada de federação servidor -> servidor (Fase 2 do READMEPROJECT).
//
// Responsabilidades:
//   1. Relógio lógico de Lamport por peer (kv).
//   2. Outbox durável + dispatcher: entrega at-least-once com retry/backoff.
//   3. Processamento de inbox: dedup por URI e buffer causal (hold-back) para
//      Activities que chegam antes da dependência (inReplyTo).
//
// Tudo isto é compartilhado pelos 3 apps sem alteração — quem varia é só a
// validação/`meta` de cada plataforma, definida no PlatformConfig.

import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import type { PlatformConfig } from "./types";

const MAX_ATTEMPTS = 10;
const DISPATCH_INTERVAL_MS = 800;
const BUFFER_SWEEP_INTERVAL_MS = 5000;
// Depois deste tempo, uma Activity presa no buffer causal é aplicada mesmo sem
// a dependência ter chegado (fallback de disponibilidade / consistência
// eventual — coerente com a escolha AP do projeto).
const BUFFER_MAX_WAIT_MS = 30000;

// ---------------------------------------------------------------------------
// Relógio lógico de Lamport
// ---------------------------------------------------------------------------

/** Lê o valor atual do relógio de Lamport deste peer. */
export function currentLamport(db: Database): number {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'lamport'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

function setLamport(db: Database, value: number): void {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES ('lamport', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(value));
}

/** Evento local: incrementa e devolve o novo tempo lógico. */
export function nextLamport(db: Database): number {
  const next = currentLamport(db) + 1;
  setLamport(db, next);
  return next;
}

/** Evento de recepção: avança o relógio para max(local, recebido) + 1. */
export function observeLamport(db: Database, received: number): number {
  const next = Math.max(currentLamport(db), received) + 1;
  setLamport(db, next);
  return next;
}

// ---------------------------------------------------------------------------
// Entrega (outbox durável)
// ---------------------------------------------------------------------------

/** Deriva a URL de inbox de um ator a partir da sua URI. */
export function inboxUrlForActor(actorUri: string): string {
  return `${actorUri.replace(/\/$/, "")}/inbox`;
}

/**
 * Enfileira uma entrega na outbox durável. Idempotente por (targetInbox,
 * activityUri): reenfileirar a mesma Activity para o mesmo destino é no-op.
 */
export function enqueueDelivery(
  db: Database,
  targetInbox: string,
  activityUri: string,
  payload: unknown
): void {
  db.prepare(
    `INSERT OR IGNORE INTO delivery
       (id, targetInbox, activityUri, payload, status, attempts, nextAttemptAt, createdAt)
     VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?)`
  ).run(ulid(), targetInbox, activityUri, JSON.stringify(payload), new Date().toISOString(), new Date().toISOString());
}

interface DeliveryRow {
  id: string;
  targetInbox: string;
  activityUri: string;
  payload: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

function backoffMs(attempts: number): number {
  return Math.min(30000, 2 ** attempts * 500);
}

/** Processa um lote de entregas pendentes já vencidas. */
async function dispatchPending(db: Database, config: PlatformConfig): Promise<void> {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      "SELECT * FROM delivery WHERE status = 'PENDING' AND nextAttemptAt <= ? ORDER BY createdAt LIMIT 25"
    )
    .all(now) as DeliveryRow[];

  for (const d of due) {
    try {
      const res = await fetch(d.targetInbox, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: d.payload,
      });
      if (res.ok) {
        db.prepare("UPDATE delivery SET status = 'DELIVERED', lastError = NULL WHERE id = ?").run(d.id);
      } else {
        registerFailure(db, d, `HTTP ${res.status}`);
      }
    } catch (err) {
      registerFailure(db, d, err instanceof Error ? err.message : String(err));
    }
  }
}

function registerFailure(db: Database, d: DeliveryRow, error: string): void {
  const attempts = d.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    db.prepare("UPDATE delivery SET status = 'FAILED', attempts = ?, lastError = ? WHERE id = ?").run(
      attempts,
      error,
      d.id
    );
    console.warn(`[federacao] entrega ${d.activityUri} -> ${d.targetInbox} FALHOU apos ${attempts} tentativas: ${error}`);
  } else {
    const nextAttemptAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
    db.prepare(
      "UPDATE delivery SET attempts = ?, lastError = ?, nextAttemptAt = ? WHERE id = ?"
    ).run(attempts, error, nextAttemptAt, d.id);
  }
}

/**
 * Fan-out na escrita: replica uma Activity local para as inboxes de todos os
 * seguidores do ator. A entrega em si é assíncrona (dispatcher).
 */
export function fanOutToFollowers(db: Database, actorUri: string, activityAS2: { id: string }): void {
  const followers = db
    .prepare("SELECT followerActorUri FROM follow WHERE followeeActorUri = ?")
    .all(actorUri) as { followerActorUri: string }[];

  for (const f of followers) {
    enqueueDelivery(db, inboxUrlForActor(f.followerActorUri), activityAS2.id, activityAS2);
  }
}

/** Envia um Follow para a inbox do ator remoto que se deseja seguir. */
export function sendFollow(
  db: Database,
  followerUri: string,
  followeeUri: string
): void {
  const lamport = nextLamport(db);
  const activityUri = `${followerUri}/follows/${ulid()}`;
  const payload = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: activityUri,
    type: "Follow",
    actor: followerUri,
    object: followeeUri,
    _lamportClock: lamport,
  };
  enqueueDelivery(db, inboxUrlForActor(followeeUri), activityUri, payload);
}

/**
 * Monta uma Activity `Undo` AS2 envolvendo o objeto original (o Follow/Like/
 * Announce que se está desfazendo). Recebe um id próprio e estampa o Lamport.
 */
export function buildUndo(
  db: Database,
  actorUri: string,
  inner: Record<string, unknown>
): { id: string; type: "Undo"; actor: string; object: Record<string, unknown>; _lamportClock: number } {
  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/undo/${ulid()}`,
    type: "Undo",
    actor: actorUri,
    object: inner,
    _lamportClock: nextLamport(db),
  } as any;
}

/** Federa um Unfollow (Undo{Follow}) para a inbox do ator seguido. */
export function sendUnfollow(
  db: Database,
  followerUri: string,
  followeeUri: string
): void {
  const undo = buildUndo(db, followerUri, {
    type: "Follow",
    actor: followerUri,
    object: followeeUri,
  });
  enqueueDelivery(db, inboxUrlForActor(followeeUri), undo.id, undo);
}

// ---------------------------------------------------------------------------
// Recepção (inbox real)
// ---------------------------------------------------------------------------

const KNOWN_OBJECT_KEYS = new Set(["type", "content", "attachment", "inReplyTo"]);

function extractMeta(object: Record<string, unknown> | undefined): string | null {
  if (!object || typeof object !== "object") return null;
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(object)) {
    if (!KNOWN_OBJECT_KEYS.has(k) && v !== undefined) meta[k] = v;
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

export interface IncomingResult {
  status: "applied" | "buffered" | "duplicate" | "follow" | "accept" | "undo" | "ignored";
  detail?: string;
}

/**
 * Processa uma Activity que chegou na inbox deste peer, vinda de outro peer.
 * Trata Follow/Accept e conteúdo (Create/Like/Announce) com dedup e buffer
 * causal. É o coração da Fase 2.
 */
export function processIncoming(
  db: Database,
  config: PlatformConfig,
  body: any
): IncomingResult {
  if (!body || typeof body !== "object" || typeof body.type !== "string") {
    return { status: "ignored", detail: "corpo sem 'type'" };
  }

  observeLamport(db, typeof body._lamportClock === "number" ? body._lamportClock : 0);

  switch (body.type) {
    case "Follow":
      return handleFollow(db, config, body);
    case "Accept":
      console.log(`[${config.peerId}] Follow aceito por`, body.actor);
      return { status: "accept" };
    case "Undo":
      return handleUndo(db, config, body);
    case "Create":
    case "Like":
    case "Announce":
      return handleContent(db, config, body);
    default:
      console.log(`[${config.peerId}] Activity ignorada (tipo ${body.type})`);
      return { status: "ignored", detail: `tipo ${body.type}` };
  }
}

function handleFollow(db: Database, config: PlatformConfig, body: any): IncomingResult {
  const followerUri: string | undefined = body.actor;
  const followeeUri: string | undefined =
    typeof body.object === "string" ? body.object : body.object?.id;
  if (!followerUri || !followeeUri) {
    return { status: "ignored", detail: "Follow sem actor/object" };
  }

  db.prepare(
    `INSERT OR IGNORE INTO follow (id, followerActorUri, followeeActorUri, createdAt)
     VALUES (?, ?, ?, ?)`
  ).run(ulid(), followerUri, followeeUri, new Date().toISOString());

  // Auto-accept: confirma o follow de volta para a inbox do seguidor.
  const acceptUri = `${followeeUri}/accepts/${ulid()}`;
  enqueueDelivery(db, inboxUrlForActor(followerUri), acceptUri, {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: acceptUri,
    type: "Accept",
    actor: followeeUri,
    object: { type: "Follow", actor: followerUri, object: followeeUri },
    _lamportClock: nextLamport(db),
  });

  console.log(`[${config.peerId}] novo seguidor remoto: ${followerUri} -> ${followeeUri}`);
  return { status: "follow" };
}

/**
 * Trata um Undo recebido. Despacha pelo tipo do objeto interno:
 *  - Undo{Follow}: remove a relação de follow (o seguidor deixa de seguir);
 *  - Undo{Like|Announce}: remove a Activity referenciada (por uri).
 * DELETE é idempotente, então reentregas do Undo são inofensivas (sem dedup).
 */
function handleUndo(db: Database, config: PlatformConfig, body: any): IncomingResult {
  const inner = body.object;
  if (!inner || typeof inner !== "object") {
    return { status: "ignored", detail: "Undo sem object" };
  }

  if (inner.type === "Follow") {
    const followerUri: string | undefined = inner.actor ?? body.actor;
    const followeeUri: string | undefined =
      typeof inner.object === "string" ? inner.object : inner.object?.id;
    if (!followerUri || !followeeUri) {
      return { status: "ignored", detail: "Undo{Follow} sem actor/object" };
    }
    db.prepare(
      "DELETE FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?"
    ).run(followerUri, followeeUri);
    console.log(`[${config.peerId}] unfollow: ${followerUri} deixou de seguir ${followeeUri}`);
    return { status: "undo" };
  }

  if (inner.type === "Like" || inner.type === "Announce") {
    // A Activity original foi guardada com uri = id do Like/Announce.
    const targetUri: string | undefined =
      inner.id ?? (typeof inner.object === "string" ? inner.object : undefined);
    if (!targetUri) {
      return { status: "ignored", detail: `Undo{${inner.type}} sem id do alvo` };
    }
    db.prepare("DELETE FROM activity WHERE uri = ?").run(targetUri);
    console.log(`[${config.peerId}] undo ${inner.type}: removida ${targetUri}`);
    return { status: "undo" };
  }

  return { status: "ignored", detail: `Undo de ${inner.type}` };
}

function handleContent(db: Database, config: PlatformConfig, body: any): IncomingResult {
  const uri: string | undefined = body.id;
  if (!uri) return { status: "ignored", detail: "Activity sem id" };

  // Dedup: já aplicada ou já no buffer?
  const seen = db.prepare("SELECT 1 FROM activity WHERE uri = ?").get(uri);
  if (seen) return { status: "duplicate" };
  const buffered = db.prepare("SELECT 1 FROM inbox_buffer WHERE activityUri = ?").get(uri);
  if (buffered) return { status: "duplicate" };

  const inReplyTo: string | undefined = body.object?.inReplyTo;

  // Buffer causal: se depende de uma Activity ainda não recebida, segura.
  if (inReplyTo) {
    const depSeen = db.prepare("SELECT 1 FROM activity WHERE uri = ?").get(inReplyTo);
    if (!depSeen) {
      db.prepare(
        `INSERT INTO inbox_buffer (id, activityUri, dependsOn, payload, receivedAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(ulid(), uri, inReplyTo, JSON.stringify(body), new Date().toISOString());
      console.log(`[${config.peerId}] Activity ${uri} em buffer (aguarda ${inReplyTo})`);
      return { status: "buffered" };
    }
  }

  applyContent(db, body);
  flushDependents(db, config, uri);
  return { status: "applied" };
}

/** Persiste uma Activity remota de conteúdo na tabela activity. */
function applyContent(db: Database, body: any): void {
  const object = body.object ?? {};
  db.prepare(
    `INSERT OR IGNORE INTO activity
       (id, uri, type, actorUri, objectType, content, attachmentUrl, meta, inReplyTo, lamportClock, isLocal, published, raw, authorId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`
  ).run(
    ulid(),
    body.id,
    body.type,
    body.actor,
    object.type ?? "Note",
    object.content ?? null,
    object.attachment ?? null,
    extractMeta(object),
    object.inReplyTo ?? null,
    typeof body._lamportClock === "number" ? body._lamportClock : 0,
    body.published ?? new Date().toISOString(),
    JSON.stringify(body)
  );
}

/** Após aplicar uma Activity, libera do buffer as que dependiam dela. */
function flushDependents(db: Database, config: PlatformConfig, appliedUri: string): void {
  const dependents = db
    .prepare("SELECT * FROM inbox_buffer WHERE dependsOn = ?")
    .all(appliedUri) as { id: string; activityUri: string; payload: string }[];

  for (const dep of dependents) {
    db.prepare("DELETE FROM inbox_buffer WHERE id = ?").run(dep.id);
    const body = JSON.parse(dep.payload);
    applyContent(db, body);
    console.log(`[${config.peerId}] Activity ${dep.activityUri} liberada do buffer`);
    flushDependents(db, config, dep.activityUri);
  }
}

/**
 * Sweeper: aplica Activities que ficaram tempo demais no buffer causal (a
 * dependência nunca chegou). Preserva disponibilidade em vez de bloquear para
 * sempre — consistência eventual.
 */
function sweepBuffer(db: Database, config: PlatformConfig): void {
  const cutoff = new Date(Date.now() - BUFFER_MAX_WAIT_MS).toISOString();
  const stale = db
    .prepare("SELECT * FROM inbox_buffer WHERE receivedAt <= ?")
    .all(cutoff) as { id: string; activityUri: string; payload: string }[];

  for (const s of stale) {
    db.prepare("DELETE FROM inbox_buffer WHERE id = ?").run(s.id);
    applyContent(db, JSON.parse(s.payload));
    console.warn(`[${config.peerId}] Activity ${s.activityUri} aplicada por timeout de buffer`);
    flushDependents(db, config, s.activityUri);
  }
}

// ---------------------------------------------------------------------------
// Loop de fundo
// ---------------------------------------------------------------------------

/** Inicia o dispatcher de entregas e o sweeper de buffer. Chamado por createApp. */
export function startFederation(db: Database, config: PlatformConfig): void {
  setInterval(() => {
    void dispatchPending(db, config);
  }, DISPATCH_INTERVAL_MS).unref();

  setInterval(() => {
    sweepBuffer(db, config);
  }, BUFFER_SWEEP_INTERVAL_MS).unref();
}
