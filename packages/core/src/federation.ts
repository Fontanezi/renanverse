// Camada de federação servidor -> servidor.
//
// Implementa o que o relatório (README.md, §3 e §6.6) descreve:
//   - Envelope de controle `_meta` { msgId, origin, vclock, inReplyTo, ts }.
//   - Relógio VETORIAL por peer (chaveado pela origem = baseUrl do peer).
//   - Entrega at-least-once com outbox durável, retry/backoff e assinatura.
//   - Recepção com deduplicação por `msgId` e ordenação causal por vclock
//     (regra §6.6), com buffer de hold-back e sweeper de disponibilidade.
//
// Compartilhado pelos 3 apps sem alteração.

import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import { buildSignatureHeaders } from "./httpsig";
import { publishActivityToFollowers } from "./realtime";
import { activityToAS2, type ActivityRow } from "./activitystreams";
import type { PlatformConfig } from "./types";

const MAX_ATTEMPTS = 10;
const DISPATCH_INTERVAL_MS = 800;
const BUFFER_SWEEP_INTERVAL_MS = 5000;
const ANTI_ENTROPY_INTERVAL_MS = 15000;
// Depois deste tempo, uma Activity presa no buffer causal é aplicada mesmo sem
// a dependência ter chegado (fallback de disponibilidade / consistência
// eventual — coerente com a escolha AP do projeto).
const BUFFER_MAX_WAIT_MS = 30000;

// ---------------------------------------------------------------------------
// Tipos do wire
// ---------------------------------------------------------------------------

export type VClock = Record<string, number>;

export interface MetaEnvelope {
  msgId: string;
  origin: string;
  vclock: VClock;
  inReplyTo: string | null;
  ts: string;
}

export interface Wire {
  activity: any;
  _meta: MetaEnvelope;
}

/** Origem (baseUrl) de um ator local a partir da sua URI. */
function originOf(uri: string): string {
  try {
    return new URL(uri).origin;
  } catch {
    return uri.replace(/\/users\/.*$/, "");
  }
}

// ---------------------------------------------------------------------------
// Relógio lógico de Lamport (ordenação do feed) — mantido junto do vetorial
// ---------------------------------------------------------------------------

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

export function nextLamport(db: Database): number {
  const next = currentLamport(db) + 1;
  setLamport(db, next);
  return next;
}

export function observeLamport(db: Database, received: number): number {
  const next = Math.max(currentLamport(db), received) + 1;
  setLamport(db, next);
  return next;
}

// ---------------------------------------------------------------------------
// Relógio VETORIAL (§6.6) — chaveado pela origem (baseUrl) de cada peer
// ---------------------------------------------------------------------------

export function getVClock(db: Database): VClock {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'vclock'").get() as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.value) as VClock;
  } catch {
    return {};
  }
}

function setVClock(db: Database, vc: VClock): void {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES ('vclock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(vc));
}

/** Evento local: incrementa o próprio componente e devolve uma cópia. */
function tickVClock(db: Database, selfOrigin: string): VClock {
  const vc = getVClock(db);
  vc[selfOrigin] = (vc[selfOrigin] ?? 0) + 1;
  setVClock(db, vc);
  return { ...vc };
}

/** Merge na recepção: Vlocal[k] = max(Vlocal[k], Vm[k]) para todo k. */
function mergeVClock(db: Database, incoming: VClock): void {
  const vc = getVClock(db);
  for (const [k, v] of Object.entries(incoming)) {
    vc[k] = Math.max(vc[k] ?? 0, v);
  }
  setVClock(db, vc);
}

/**
 * Regra de entregabilidade causal do relatório (§6.6): uma mensagem da origem
 * `j` com relógio `Vm` é entregável quando
 *   Vm[j] == Vlocal[j] + 1   e   Vm[k] <= Vlocal[k]  para todo k != j.
 */
function isDeliverable(local: VClock, vm: VClock, origin: string): boolean {
  if ((vm[origin] ?? 0) !== (local[origin] ?? 0) + 1) return false;
  for (const [k, v] of Object.entries(vm)) {
    if (k === origin) continue;
    if (v > (local[k] ?? 0)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Envelopa uma Activity de CONTEÚDO (Create/Update/Delete/Like/Announce),
 * incrementando o relógio vetorial — é o que entra na ordenação causal (§6.6).
 */
export function wrapContent(db: Database, activity: any, inReplyTo?: string | null): Wire {
  const origin = originOf(activity.actor);
  return {
    activity,
    _meta: {
      msgId: ulid(),
      origin,
      vclock: tickVClock(db, origin),
      inReplyTo: inReplyTo ?? null,
      ts: new Date().toISOString(),
    },
  };
}

/**
 * Envelopa uma Activity de CONTROLE (Follow/Accept/Reject/Undo). Controle é
 * ponto-a-ponto e NÃO participa do relógio vetorial de conteúdo: não incrementa
 * na origem nem é mesclado/reordenado no destino. Isso mantém a sequência de
 * conteúdo por origem contígua (sem lacunas fantasma) e é o que permite o
 * catch-up (anti-entropy) detectar corretamente o que faltou.
 */
export function wrapControl(db: Database, activity: any): Wire {
  return {
    activity,
    _meta: {
      msgId: ulid(),
      origin: originOf(activity.actor),
      vclock: {},
      inReplyTo: null,
      ts: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Entrega (outbox durável)
// ---------------------------------------------------------------------------

export function inboxUrlForActor(actorUri: string): string {
  return `${actorUri.replace(/\/$/, "")}/inbox`;
}

/** Enfileira uma entrega. Idempotente por (targetInbox, msgId). */
export function enqueueDelivery(
  db: Database,
  targetInbox: string,
  msgId: string,
  wire: Wire
): void {
  db.prepare(
    `INSERT OR IGNORE INTO delivery
       (id, targetInbox, activityUri, payload, status, attempts, nextAttemptAt, createdAt)
     VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?)`
  ).run(
    ulid(),
    targetInbox,
    msgId,
    JSON.stringify(wire),
    new Date().toISOString(),
    new Date().toISOString()
  );
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

async function dispatchPending(db: Database): Promise<void> {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      "SELECT * FROM delivery WHERE status = 'PENDING' AND nextAttemptAt <= ? ORDER BY createdAt LIMIT 25"
    )
    .all(now) as DeliveryRow[];

  for (const d of due) {
    try {
      // Assina a entrega (HTTP Signatures) com a chave do peer; o ator fica
      // dentro do envelope, em activity.actor, e é sempre local a este peer.
      let sigHeaders: Record<string, string> = {};
      try {
        const actor = JSON.parse(d.payload)?.activity?.actor;
        if (typeof actor === "string") {
          sigHeaders = buildSignatureHeaders(db, actor, d.targetInbox, d.payload);
        }
      } catch {
        /* payload é sempre JSON válido; se algo falhar, segue sem assinatura */
      }

      const res = await fetch(d.targetInbox, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sigHeaders },
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

/** Extrai as URIs de atores mencionados (tag Mention) de uma Activity. */
function mentionTargets(activity: any): string[] {
  const tags = activity?.object?.tag;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => t && t.type === "Mention" && typeof t.href === "string")
    .map((t) => t.href as string);
}

/**
 * Fan-out na escrita: replica o envelope para as inboxes de todos os seguidores
 * do ator e dos atores mencionados (§3, Mention). Entrega assíncrona.
 */
export function fanOutToFollowers(db: Database, wire: Wire): void {
  const actorUri = wire.activity.actor as string;
  const targets = new Set<string>();

  // Apenas seguidores ACEITOS recebem o conteúdo — uma solicitação pendente
  // não dá acesso às postagens do ator (privacidade do follow request).
  const followers = db
    .prepare("SELECT followerActorUri FROM follow WHERE followeeActorUri = ? AND status = 'accepted'")
    .all(actorUri) as { followerActorUri: string }[];
  for (const f of followers) targets.add(inboxUrlForActor(f.followerActorUri));

  for (const mentioned of mentionTargets(wire.activity)) {
    if (originOf(mentioned) !== originOf(actorUri)) targets.add(inboxUrlForActor(mentioned));
  }

  for (const inbox of targets) enqueueDelivery(db, inbox, wire._meta.msgId, wire);
}

/** Envia um Follow (envelopado) para a inbox do ator remoto que se quer seguir. */
export function sendFollow(db: Database, followerUri: string, followeeUri: string): void {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${followerUri}/follows/${ulid()}`,
    type: "Follow",
    actor: followerUri,
    object: followeeUri,
  };
  const wire = wrapControl(db, activity);
  enqueueDelivery(db, inboxUrlForActor(followeeUri), wire._meta.msgId, wire);
}

/** Monta um `Undo` envelopado envolvendo o objeto original (Follow/Like/Announce). */
export function buildUndo(db: Database, actorUri: string, inner: Record<string, unknown>): Wire {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/undo/${ulid()}`,
    type: "Undo",
    actor: actorUri,
    object: inner,
  };
  return wrapControl(db, activity);
}

/** Federa um Unfollow (Undo{Follow}) para a inbox do ator seguido. */
export function sendUnfollow(db: Database, followerUri: string, followeeUri: string): void {
  const wire = buildUndo(db, followerUri, {
    type: "Follow",
    actor: followerUri,
    object: followeeUri,
  });
  enqueueDelivery(db, inboxUrlForActor(followeeUri), wire._meta.msgId, wire);
}

/** Constrói um `Update` (conteúdo) editando o objeto `targetUri`. */
export function buildUpdate(
  db: Database,
  actorUri: string,
  targetUri: string,
  objectType: string,
  content: string | null,
  attachmentUrl: string | null,
  meta?: Record<string, unknown>
): Wire {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/updates/${ulid()}`,
    type: "Update",
    actor: actorUri,
    object: {
      type: objectType,
      id: targetUri,
      content: content ?? undefined,
      attachment: attachmentUrl ?? undefined,
      ...meta,
    },
  };
  return wrapContent(db, activity);
}

/**
 * Constrói um `Like` (conteúdo) sobre o objeto `targetUri`. O `object` é a URI
 * do objeto curtido (AS2 permite `object` como string/URI). Federa aos
 * seguidores (§3, "replica p/ seguidores").
 */
export function buildLike(db: Database, actorUri: string, targetUri: string): Wire {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/likes/${ulid()}`,
    type: "Like",
    actor: actorUri,
    object: targetUri,
  };
  return wrapContent(db, activity);
}

/** Constrói um `Announce` (boost/repost) sobre o objeto `targetUri`. O
 *  `actorName` (nome legível de quem compartilha) viaja no wire para os peers
 *  destino exibirem o repost sem precisar resolver a URI do ator. */
export function buildAnnounce(
  db: Database,
  actorUri: string,
  targetUri: string,
  actorName?: string
): Wire {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/announces/${ulid()}`,
    type: "Announce",
    actor: actorUri,
    actorName,
    object: targetUri,
  };
  return wrapContent(db, activity);
}

/** Constrói um `Delete` (tombstone) do objeto `targetUri`. */
export function buildDelete(db: Database, actorUri: string, targetUri: string): Wire {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${actorUri}/deletes/${ulid()}`,
    type: "Delete",
    actor: actorUri,
    object: { id: targetUri },
  };
  return wrapContent(db, activity);
}

/** Federa um `Accept{Follow}` para a inbox do seguidor. */
export function sendAccept(db: Database, followeeUri: string, followerUri: string): void {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${followeeUri}/accepts/${ulid()}`,
    type: "Accept",
    actor: followeeUri,
    object: { type: "Follow", actor: followerUri, object: followeeUri },
  };
  const wire = wrapControl(db, activity);
  enqueueDelivery(db, inboxUrlForActor(followerUri), wire._meta.msgId, wire);
}

/** Federa um `Reject{Follow}` para a inbox do seguidor (remove-o como follower). */
export function sendReject(db: Database, followeeUri: string, followerUri: string): void {
  const activity = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${followeeUri}/rejects/${ulid()}`,
    type: "Reject",
    actor: followeeUri,
    object: { type: "Follow", actor: followerUri, object: followeeUri },
  };
  const wire = wrapControl(db, activity);
  enqueueDelivery(db, inboxUrlForActor(followerUri), wire._meta.msgId, wire);
}

// ---------------------------------------------------------------------------
// Recepção (inbox)
// ---------------------------------------------------------------------------

const KNOWN_OBJECT_KEYS = new Set(["type", "content", "attachment", "inReplyTo", "id", "attributedTo", "tag"]);

function extractMeta(object: Record<string, unknown> | undefined): string | null {
  if (!object || typeof object !== "object") return null;
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(object)) {
    if (!KNOWN_OBJECT_KEYS.has(k) && v !== undefined) meta[k] = v;
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

export interface IncomingResult {
  status: "applied" | "buffered" | "duplicate" | "follow" | "accept" | "reject" | "undo" | "ignored";
  detail?: string;
}

const CONTENT_TYPES = new Set(["Create", "Update", "Delete", "Like", "Announce"]);

/** Normaliza o corpo recebido em { activity, _meta }, tolerando ausência de _meta. */
function toWire(body: any): Wire | null {
  if (!body || typeof body !== "object") return null;
  const activity = body.activity ?? body;
  if (!activity || typeof activity.type !== "string") return null;
  const meta: MetaEnvelope = body._meta ?? {
    msgId: activity.id ?? ulid(),
    origin: originOf(activity.actor ?? ""),
    vclock: {},
    inReplyTo: activity?.object?.inReplyTo ?? null,
    ts: new Date().toISOString(),
  };
  return { activity, _meta: meta };
}

function alreadyProcessed(db: Database, msgId: string): boolean {
  return !!db.prepare("SELECT 1 FROM processed_msg WHERE msgId = ?").get(msgId);
}

function markProcessed(db: Database, msgId: string): void {
  db.prepare("INSERT OR IGNORE INTO processed_msg (msgId, at) VALUES (?, ?)").run(
    msgId,
    new Date().toISOString()
  );
}

/**
 * Processa uma entrega recebida de outro peer. Deduplica por `_meta.msgId`,
 * despacha por tipo e aplica a ordenação causal por vclock ao conteúdo.
 */
export function processIncoming(db: Database, config: PlatformConfig, body: any): IncomingResult {
  const wire = toWire(body);
  if (!wire) return { status: "ignored", detail: "corpo invalido" };

  const { activity, _meta } = wire;

  if (alreadyProcessed(db, _meta.msgId)) return { status: "duplicate" };

  // Controle (Follow/Accept/Reject/Undo): processa imediatamente, sem hold-back.
  switch (activity.type) {
    case "Follow":
      return finishControl(db, _meta, handleFollow(db, config, activity));
    case "Accept":
      return finishControl(db, _meta, handleAccept(db, config, activity));
    case "Reject":
      return finishControl(db, _meta, handleReject(db, config, activity));
    case "Undo":
      return finishControl(db, _meta, handleUndo(db, config, activity));
  }

  if (!CONTENT_TYPES.has(activity.type)) {
    return { status: "ignored", detail: `tipo ${activity.type}` };
  }

  // Conteúdo: aplica a regra causal por vclock (§6.6).
  const local = getVClock(db);
  if (isDeliverable(local, _meta.vclock, _meta.origin)) {
    applyContent(db, config, wire);
    mergeVClock(db, _meta.vclock);
    markProcessed(db, _meta.msgId);
    reevaluateBuffer(db, config);
    return { status: "applied" };
  }

  // Fora de ordem: segura no buffer causal até o Vlocal avançar.
  db.prepare(
    `INSERT OR IGNORE INTO inbox_buffer (id, msgId, origin, payload, receivedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ulid(), _meta.msgId, _meta.origin, JSON.stringify(wire), new Date().toISOString());
  console.log(`[${config.peerId}] ${activity.type} ${_meta.msgId} em buffer (vclock fora de ordem)`);
  return { status: "buffered" };
}

/**
 * Finaliza uma mensagem de controle: apenas marca como processada (dedup). NÃO
 * mescla vclock — controle fica fora do relógio vetorial de conteúdo, para não
 * criar lacunas fantasma na sequência de conteúdo por origem.
 */
function finishControl(db: Database, meta: MetaEnvelope, result: IncomingResult): IncomingResult {
  markProcessed(db, meta.msgId);
  return result;
}

function handleFollow(db: Database, config: PlatformConfig, activity: any): IncomingResult {
  const followerUri: string | undefined = activity.actor;
  const followeeUri: string | undefined =
    typeof activity.object === "string" ? activity.object : activity.object?.id;
  if (!followerUri || !followeeUri) return { status: "ignored", detail: "Follow sem actor/object" };

  const existing = db.prepare(
    "SELECT status FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?"
  ).get(followerUri, followeeUri) as { status: string } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO follow (id, followerActorUri, followeeActorUri, status, createdAt)
       VALUES (?, ?, ?, 'pending', ?)`
    ).run(ulid(), followerUri, followeeUri, new Date().toISOString());
  }

  console.log(`[${config.peerId}] solicitação de follow de ${followerUri} -> ${followeeUri}`);
  return { status: "follow" };
}

/** Accept de um Follow: atualiza o status de 'pending' para 'accepted'. */
function handleAccept(db: Database, config: PlatformConfig, activity: any): IncomingResult {
  const followeeUri: string | undefined = activity.actor;
  const inner = activity.object;
  const followerUri: string | undefined =
    inner?.actor ?? (typeof inner === "string" ? undefined : undefined);
  if (followeeUri && followerUri) {
    db.prepare(
      "UPDATE follow SET status = 'accepted' WHERE followerActorUri = ? AND followeeActorUri = ?"
    ).run(followerUri, followeeUri);
    console.log(`[${config.peerId}] Follow aceito: ${followerUri} -> ${followeeUri}`);
  }
  return { status: "accept" };
}

/** Reject de um Follow: remove o follow que havíamos registrado otimisticamente. */
function handleReject(db: Database, config: PlatformConfig, activity: any): IncomingResult {
  const rejecter: string | undefined = activity.actor;
  const inner = activity.object;
  const followerUri: string | undefined =
    inner?.actor ?? (typeof inner === "string" ? undefined : inner?.follower);
  if (rejecter && followerUri) {
    db.prepare("DELETE FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?").run(
      followerUri,
      rejecter
    );
    console.log(`[${config.peerId}] Follow rejeitado por ${rejecter}`);
  }
  return { status: "reject" };
}

function handleUndo(db: Database, config: PlatformConfig, activity: any): IncomingResult {
  const inner = activity.object;
  if (!inner || typeof inner !== "object") return { status: "ignored", detail: "Undo sem object" };

  if (inner.type === "Follow") {
    const followerUri: string | undefined = inner.actor ?? activity.actor;
    const followeeUri: string | undefined =
      typeof inner.object === "string" ? inner.object : inner.object?.id;
    if (!followerUri || !followeeUri) return { status: "ignored", detail: "Undo{Follow} incompleto" };
    db.prepare("DELETE FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?").run(
      followerUri,
      followeeUri
    );
    console.log(`[${config.peerId}] unfollow: ${followerUri} deixou de seguir ${followeeUri}`);
    return { status: "undo" };
  }

  if (inner.type === "Like" || inner.type === "Announce") {
    const targetUri: string | undefined =
      inner.id ?? (typeof inner.object === "string" ? inner.object : undefined);
    if (!targetUri) return { status: "ignored", detail: `Undo{${inner.type}} sem id` };
    db.prepare("DELETE FROM activity WHERE uri = ?").run(targetUri);
    // Pub/Sub: se era um boost (Announce), some do feed dos seguidores locais.
    if (inner.type === "Announce") {
      publishActivityToFollowers(db, config, activity.actor, "feed:delete", { activityUri: targetUri, actor: activity.actor });
    }
    console.log(`[${config.peerId}] undo ${inner.type}: removida ${targetUri}`);
    return { status: "undo" };
  }

  return { status: "ignored", detail: `Undo de ${inner.type}` };
}

/** Aplica uma Activity de conteúdo (após passar pela ordenação causal). */
function applyContent(db: Database, config: PlatformConfig, wire: Wire): void {
  const { activity, _meta } = wire;
  const object = activity.object ?? {};

  if (activity.type === "Update") {
    // Last-writer-wins pelo relógio de Lamport observado.
    db.prepare(
      `UPDATE activity SET content = ?, attachmentUrl = ?, meta = ?, lamportClock = ?, raw = ?
       WHERE uri = ?`
    ).run(
      object.content ?? null,
      object.attachment ?? null,
      extractMeta(object),
      observeLamport(db, 0),
      JSON.stringify(wire),
      object.id ?? activity.object?.id ?? activity.id
    );
    // Pub/Sub: emite o POST ja atualizado (id do post original, no mesmo formato
    // do feed) para os seguidores locais reconciliarem a edicao.
    const updatedUri = object.id ?? activity.object?.id ?? activity.id;
    const updatedRow = db.prepare("SELECT * FROM activity WHERE uri = ?").get(updatedUri) as ActivityRow | undefined;
    if (updatedRow) {
      publishActivityToFollowers(db, config, activity.actor, "feed:update", activityToAS2(config.baseUrl, updatedRow));
    }
    return;
  }

  if (activity.type === "Delete") {
    const targetUri = typeof object === "string" ? object : object.id ?? activity.id;
    db.prepare("DELETE FROM activity WHERE uri = ?").run(targetUri);
    // Pub/Sub: notifica os seguidores locais da remoção (tombstone).
    publishActivityToFollowers(db, config, activity.actor, "feed:delete", { activityUri: targetUri, actor: activity.actor });
    return;
  }

  // Like/Announce trazem `object` como URI (string) do objeto alvo; guardamos a
  // URI no `meta` para preservá-la (Create traz um objeto AS2 completo).
  const isRef = typeof object === "string";
  const objMeta = isRef ? JSON.stringify({ object }) : extractMeta(object);

  // Create / Like / Announce: insere (guardando origem + seq p/ catch-up).
  db.prepare(
    `INSERT OR IGNORE INTO activity
       (id, uri, type, actorUri, objectType, content, attachmentUrl, meta, inReplyTo, lamportClock, isLocal, origin, originSeq, published, raw, authorId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)`
  ).run(
    ulid(),
    activity.id,
    activity.type,
    activity.actor,
    isRef ? null : object.type ?? "Note",
    isRef ? null : object.content ?? null,
    isRef ? null : object.attachment ?? null,
    objMeta,
    (isRef ? null : object.inReplyTo) ?? _meta.inReplyTo ?? null,
    observeLamport(db, 0),
    _meta.origin,
    _meta.vclock[_meta.origin] ?? 0,
    activity.published ?? _meta.ts ?? new Date().toISOString(),
    JSON.stringify(wire)
  );

  // Pub/Sub: entrega em tempo real ao feed dos seguidores locais deste ator.
  // Announce precisa ser RESOLVIDO antes (objeto = URI do post original);
  // publicar o wire cru deixaria um card vazio no cliente até o próximo poll.
  if (activity.type === "Announce" && isRef) {
    publishResolvedAnnounce(db, config, activity.id as string, object as string);
    return;
  }
  publishActivityToFollowers(db, config, activity.actor, "feed:activity", activity);
}

/** Nome legível do ator gravado no envelope (raw) de uma linha da activity. */
function actorNameFromRaw(row: ActivityRow): string | undefined {
  try {
    const parsed = JSON.parse(row.raw) as { activity?: { actorName?: string } };
    return parsed?.activity?.actorName;
  } catch {
    return undefined;
  }
}

/**
 * Publica um Announce aos seguidores locais JÁ no formato do feed (objeto do
 * post original embutido + `repostOf`). Se o post original ainda não existe
 * neste peer, busca-o na origem (GET na própria URI da Activity) de forma
 * assíncrona e publica quando chegar — o cliente nunca vê o card vazio "@?".
 */
function publishResolvedAnnounce(
  db: Database,
  config: PlatformConfig,
  announceUri: string,
  objectUri: string
): void {
  const announceRow = db
    .prepare("SELECT * FROM activity WHERE uri = ?")
    .get(announceUri) as ActivityRow | undefined;
  if (!announceRow) return;

  const publish = (original: ActivityRow) => {
    publishActivityToFollowers(
      db,
      config,
      announceRow.actorUri,
      "feed:activity",
      activityToAS2(config.baseUrl, announceRow, original, actorNameFromRaw(announceRow))
    );
  };

  const original = db
    .prepare("SELECT * FROM activity WHERE uri = ?")
    .get(objectUri) as ActivityRow | undefined;
  if (original) {
    publish(original);
    return;
  }

  void fetchRemoteActivity(db, objectUri).then((fetched) => {
    if (fetched) publish(fetched);
  });
}

/**
 * Busca uma Activity remota pela sua URI canônica (servida pelo endpoint
 * GET /activities/:id do peer de origem) e a guarda localmente como linha
 * remota. Idempotente (INSERT OR IGNORE pela uri única); não mexe no vclock —
 * quando o wire "de verdade" chegar pela federação, é deduplicado pela uri.
 */
export async function fetchRemoteActivity(
  db: Database,
  uri: string
): Promise<ActivityRow | undefined> {
  try {
    const res = await fetch(uri, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const as2 = (await res.json()) as any;
    if (!as2 || typeof as2.id !== "string" || typeof as2.actor !== "string") return undefined;

    const object = as2.object ?? {};
    db.prepare(
      `INSERT OR IGNORE INTO activity
         (id, uri, type, actorUri, objectType, content, attachmentUrl, meta, inReplyTo, lamportClock, isLocal, origin, originSeq, published, raw, authorId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, NULL)`
    ).run(
      ulid(),
      as2.id,
      as2.type ?? "Create",
      as2.actor,
      object.type ?? "Note",
      object.content ?? null,
      object.attachment ?? null,
      extractMeta(object),
      object.inReplyTo ?? null,
      observeLamport(db, 0),
      originOf(as2.actor),
      as2.published ?? new Date().toISOString(),
      // Guarda como { activity } (sem _meta): o catch-up ignora, mas o nome do
      // ator continua recuperável pelo mesmo caminho do wire federado.
      JSON.stringify({ activity: as2 })
    );
    return db.prepare("SELECT * FROM activity WHERE uri = ?").get(as2.id) as
      | ActivityRow
      | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Registra uma Activity de conteúdo originada localmente (Update/Delete) como
 * linha na tabela activity, apenas para o catch-up poder reproduzi-la. Mantém a
 * sequência de conteúdo por origem contígua (Update/Delete também ticam o
 * vclock). Não aparece no feed/outbox (esses filtram Update/Delete).
 */
export function recordLocalContent(db: Database, wire: Wire, meta: string | null = null): string {
  const { activity, _meta } = wire;
  const id = (typeof activity.id === "string" ? activity.id.split("/").pop() : null) ?? ulid();
  db.prepare(
    `INSERT OR IGNORE INTO activity
       (id, uri, type, actorUri, objectType, content, attachmentUrl, meta, inReplyTo, lamportClock, isLocal, origin, originSeq, published, raw, authorId)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, 1, ?, ?, ?, ?, NULL)`
  ).run(
    id,
    activity.id,
    activity.type,
    activity.actor,
    meta,
    nextLamport(db),
    _meta.origin,
    _meta.vclock[_meta.origin] ?? 0,
    _meta.ts,
    JSON.stringify(wire)
  );
  return id;
}

// ---------------------------------------------------------------------------
// Anti-entropy / catch-up (§6.10, §7.7)
// ---------------------------------------------------------------------------

/**
 * Retorna os envelopes das Activities autoradas por este peer (origin = seu
 * baseUrl) com originSeq > since, em ordem. Serve o endpoint de catch-up.
 */
export function catchupSince(db: Database, origin: string, since: number): Wire[] {
  const rows = db
    .prepare(
      "SELECT raw FROM activity WHERE origin = ? AND originSeq > ? ORDER BY originSeq ASC"
    )
    .all(origin, since) as { raw: string }[];
  const out: Wire[] = [];
  for (const r of rows) {
    try {
      const w = JSON.parse(r.raw) as Wire;
      if (w && w.activity && w._meta) out.push(w);
    } catch {
      /* ignora linhas que não guardam o envelope */
    }
  }
  return out;
}

/**
 * Puxa periodicamente de cada peer de origem seguido as Activities que faltam
 * (desde o último seq conhecido no Vlocal), reprocessando-as. Rede de segurança
 * contra omissão silenciosa: o que se perdeu na entrega é recuperado aqui.
 */
export async function runAntiEntropy(db: Database, config: PlatformConfig): Promise<void> {
  const self = config.baseUrl;
  const followees = db
    .prepare("SELECT DISTINCT followeeActorUri FROM follow WHERE status = 'accepted'")
    .all() as { followeeActorUri: string }[];

  const origins = new Set<string>();
  for (const f of followees) {
    const o = originOf(f.followeeActorUri);
    if (o && o !== self) origins.add(o);
  }

  const vc = getVClock(db);
  for (const origin of origins) {
    const since = vc[origin] ?? 0;
    try {
      const res = await fetch(`${origin}/catchup?since=${since}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { items?: Wire[] };
      for (const wire of body.items ?? []) {
        processIncoming(db, config, wire);
      }
    } catch {
      /* origem indisponível: tenta de novo no próximo ciclo */
    }
  }
}

/** Reavalia o buffer: aplica tudo que se tornou entregável após o merge. */
function reevaluateBuffer(db: Database, config: PlatformConfig): void {
  let progress = true;
  while (progress) {
    progress = false;
    const rows = db
      .prepare("SELECT * FROM inbox_buffer ORDER BY receivedAt")
      .all() as { id: string; msgId: string; origin: string; payload: string }[];
    for (const r of rows) {
      const wire = JSON.parse(r.payload) as Wire;
      if (isDeliverable(getVClock(db), wire._meta.vclock, wire._meta.origin)) {
        db.prepare("DELETE FROM inbox_buffer WHERE id = ?").run(r.id);
        applyContent(db, config, wire);
        mergeVClock(db, wire._meta.vclock);
        markProcessed(db, wire._meta.msgId);
        console.log(`[${config.peerId}] ${wire.activity.type} ${r.msgId} liberado do buffer`);
        progress = true;
      }
    }
  }
}

/**
 * Sweeper: aplica mensagens presas tempo demais no buffer (a dependência causal
 * nunca chegou). Preserva disponibilidade em vez de bloquear — consistência
 * eventual (AP).
 */
function sweepBuffer(db: Database, config: PlatformConfig): void {
  const cutoff = new Date(Date.now() - BUFFER_MAX_WAIT_MS).toISOString();
  const stale = db
    .prepare("SELECT * FROM inbox_buffer WHERE receivedAt <= ? ORDER BY receivedAt")
    .all(cutoff) as { id: string; msgId: string; payload: string }[];

  for (const s of stale) {
    const wire = JSON.parse(s.payload) as Wire;
    db.prepare("DELETE FROM inbox_buffer WHERE id = ?").run(s.id);
    applyContent(db, config, wire);
    mergeVClock(db, wire._meta.vclock);
    markProcessed(db, wire._meta.msgId);
    console.warn(`[${config.peerId}] ${wire.activity.type} ${s.msgId} aplicado por timeout de buffer`);
  }
  if (stale.length) reevaluateBuffer(db, config);
}

// ---------------------------------------------------------------------------
// Loop de fundo
// ---------------------------------------------------------------------------

export function startFederation(db: Database, config: PlatformConfig): void {
  setInterval(() => {
    void dispatchPending(db);
  }, DISPATCH_INTERVAL_MS).unref();

  setInterval(() => {
    sweepBuffer(db, config);
  }, BUFFER_SWEEP_INTERVAL_MS).unref();

  setInterval(() => {
    void runAntiEntropy(db, config);
  }, ANTI_ENTROPY_INTERVAL_MS).unref();
}
