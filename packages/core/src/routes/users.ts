import { Router } from "express";
import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import { z } from "zod";
import {
  actorUri,
  activityToAS2,
  personToAS2,
  type ActivityRow,
  type PersonRow,
} from "../activitystreams";
import {
  nextLamport,
  wrapContent,
  fanOutToFollowers,
  sendFollow,
  sendUnfollow,
  buildUndo,
  buildUpdate,
  buildDelete,
  buildLike,
  buildAnnounce,
  sendReject,
  sendAccept,
  recordLocalContent,
  catchupSince,
} from "../federation";
import { resolveHandle } from "../registry";
import { publishActivityToFollowers } from "../realtime";
import { publicKeyPem } from "../httpsig";
import type { PlatformConfig } from "../types";

const createPersonSchema = z.object({
  preferredUsername: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().optional(),
  icon: z.string().url().optional(),
});

/** Extrai handles "usuario@host" de menções `@usuario@host` no texto. */
function parseHandles(content: string | undefined | null): string[] {
  if (!content) return [];
  const re = /@([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.:-]+)/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(`${m[1]}@${m[2]}`);
  return [...out];
}

/**
 * Router genérico de Person/Activity. Idêntico entre os 3 apps, exceto pela
 * validação de POST /users/:id/outbox, que vem de `config.createActivitySchema`
 * — é ali que Twitter, Instagram e Reddit divergem (limite de caracteres,
 * campos obrigatórios, meta específico da plataforma).
 */
export function createUsersRouter(db: Database, config: PlatformConfig): Router {
  const router = Router();
  const BASE_URL = config.baseUrl;
  const PUBLIC_KEY = publicKeyPem(db); // chave pública do peer, publicada no Person

  // POST /users — cria um novo Person neste peer
  router.post("/users", (req, res) => {
    const parsed = createPersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { preferredUsername, name, summary, icon } = parsed.data;

    const existing = db
      .prepare("SELECT id FROM person WHERE preferredUsername = ?")
      .get(preferredUsername);
    if (existing) {
      return res.status(409).json({ error: "preferredUsername já em uso" });
    }

    const id = ulid();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO person (id, preferredUsername, name, summary, icon, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, preferredUsername, name, summary ?? null, icon ?? null, createdAt);

    const row = db.prepare("SELECT * FROM person WHERE id = ?").get(id) as PersonRow;
    res.status(201).json(personToAS2(BASE_URL, row, PUBLIC_KEY));
  });

  // GET /users/:id — perfil no formato AS2 Person
  router.get("/users/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!row) return res.status(404).json({ error: "Person não encontrado" });
    res.json(personToAS2(BASE_URL, row, PUBLIC_KEY));
  });

  // GET /users/:id/outbox — lista as Activities publicadas por esse Person
  router.get("/users/:id/outbox", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare(
        "SELECT * FROM activity WHERE actorUri = ? AND type NOT IN ('Update','Delete') ORDER BY published DESC"
      )
      .all(uri) as ActivityRow[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "OrderedCollection",
      totalItems: rows.length,
      orderedItems: rows.map((r) => activityToAS2(BASE_URL, r)),
    });
  });

  // POST /users/:id/outbox — cria um post local e o replica (fan-out) para
  // seguidores e atores mencionados (@usuario@host no conteúdo).
  router.post("/users/:id/outbox", async (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const parsed = config.createActivitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { type, objectType, content, attachmentUrl, meta } = parsed.data;

    const id = ulid();
    const published = new Date().toISOString();
    const actor = actorUri(BASE_URL, person.id);
    const activityUri = `${BASE_URL}/activities/${id}`;
    const inReplyTo =
      meta && typeof meta.inReplyTo === "string" ? meta.inReplyTo : null;
    const lamport = nextLamport(db);
    const raw = JSON.stringify({ type, objectType, content, attachmentUrl, meta });

    db.prepare(
      `INSERT INTO activity
         (id, uri, type, actorUri, objectType, content, attachmentUrl, meta, inReplyTo, lamportClock, isLocal, published, raw, authorId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id,
      activityUri,
      type,
      actor,
      objectType,
      content ?? null,
      attachmentUrl ?? null,
      meta ? JSON.stringify(meta) : null,
      inReplyTo,
      lamport,
      published,
      raw,
      person.id
    );

    const row = db.prepare("SELECT * FROM activity WHERE id = ?").get(id) as ActivityRow;
    const as2 = activityToAS2(BASE_URL, row);

    // Menções: resolve @usuario@host (WebFinger) e anexa como tag Mention no
    // objeto, para o fan-out também entregar aos atores mencionados (§3).
    const handles = parseHandles(content);
    if (handles.length) {
      const tags: { type: "Mention"; href: string }[] = [];
      for (const h of handles) {
        const href = await resolveHandle(config, h);
        if (href) tags.push({ type: "Mention", href });
      }
      if (tags.length) (as2.object as Record<string, unknown>).tag = tags;
    }

    // Envolve no envelope _meta (msgId + vclock), registra origem/seq (catch-up)
    // e replica para os seguidores.
    const wire = wrapContent(db, as2, inReplyTo);
    db.prepare("UPDATE activity SET origin = ?, originSeq = ?, raw = ? WHERE id = ?").run(
      BASE_URL,
      wire._meta.vclock[BASE_URL] ?? 0,
      JSON.stringify(wire),
      id
    );
    fanOutToFollowers(db, wire);

    // Pub/Sub: avisa em tempo real os seguidores LOCAIS deste ator (feed).
    publishActivityToFollowers(db, config, actor, "feed:activity", as2);

    res.status(201).json(as2);
  });

  // POST /users/:id/following — segue outro ator. Aceita a URI completa
  // (`actorUri`) ou um handle "usuario@host" (`handle`), resolvido por WebFinger.
  router.post("/users/:id/following", async (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const schema = z
      .object({
        actorUri: z.string().url().optional(),
        handle: z.string().min(3).optional(),
      })
      .refine((d) => d.actorUri || d.handle, {
        message: "informe 'actorUri' (URI completa) ou 'handle' (usuario@host)",
      });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const followerUri = actorUri(BASE_URL, person.id);
    let followeeUri = parsed.data.actorUri ?? null;

    // Sem a URI direta: resolve o handle via WebFinger no peer remoto.
    if (!followeeUri && parsed.data.handle) {
      followeeUri = await resolveHandle(config, parsed.data.handle);
      if (!followeeUri) {
        return res
          .status(404)
          .json({ error: `nao foi possivel resolver o handle '${parsed.data.handle}' via WebFinger` });
      }
    }
    if (!followeeUri) {
      return res.status(400).json({ error: "ator a seguir nao determinado" });
    }

    const isLocal = followeeUri.startsWith(BASE_URL);
    const status = isLocal ? "accepted" : "pending";

    // Se já existe follow com status 'accepted', retorna 409.
    // Se existe com status 'pending', retorna sucesso (já solicitado).
    const existing = db.prepare(
      "SELECT status FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?"
    ).get(followerUri, followeeUri) as { status: string } | undefined;

    if (existing) {
      if (existing.status === "accepted") {
        return res.status(409).json({ error: "já segue esse ator" });
      }
      return res.json({ follower: followerUri, followee: followeeUri, status: "pending" });
    }

    try {
      db.prepare(
        `INSERT INTO follow (id, followerActorUri, followeeActorUri, status, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(ulid(), followerUri, followeeUri, status, new Date().toISOString());
    } catch {
      return res.status(409).json({ error: "já segue esse ator" });
    }

    // Se o ator seguido mora em outro peer, avisa esse peer via Follow federado,
    // para que ele passe a nos entregar as postagens do ator (fan-out remoto).
    if (!isLocal) {
      sendFollow(db, followerUri, followeeUri);
    }

    res.status(201).json({ follower: followerUri, followee: followeeUri, status });
  });

  // DELETE /users/:id/following — deixa de seguir. Aceita `actorUri` ou `handle`.
  // Remove o follow local e, se o alvo for remoto, federa um Undo{Follow}.
  router.delete("/users/:id/following", async (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const schema = z
      .object({
        actorUri: z.string().url().optional(),
        handle: z.string().min(3).optional(),
      })
      .refine((d) => d.actorUri || d.handle, {
        message: "informe 'actorUri' (URI completa) ou 'handle' (usuario@host)",
      });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const followerUri = actorUri(BASE_URL, person.id);
    let followeeUri = parsed.data.actorUri ?? null;
    if (!followeeUri && parsed.data.handle) {
      followeeUri = await resolveHandle(config, parsed.data.handle);
      if (!followeeUri) {
        return res
          .status(404)
          .json({ error: `nao foi possivel resolver o handle '${parsed.data.handle}' via WebFinger` });
      }
    }
    if (!followeeUri) {
      return res.status(400).json({ error: "ator a deixar de seguir nao determinado" });
    }

    const info = db
      .prepare("DELETE FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?")
      .run(followerUri, followeeUri);

    if (!followeeUri.startsWith(BASE_URL)) {
      sendUnfollow(db, followerUri, followeeUri);
    }

    res.json({ unfollowed: followeeUri, removed: info.changes });
  });

  // PATCH /users/:id/activities/:activityId — edita um post local (Create) e
  // federa um Update (§3). Last-writer-wins pelo relógio no destino.
  router.patch("/users/:id/activities/:activityId", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const actor = actorUri(BASE_URL, person.id);
    const row = db
      .prepare("SELECT * FROM activity WHERE id = ? AND actorUri = ?")
      .get(req.params.activityId, actor) as ActivityRow | undefined;
    if (!row) return res.status(404).json({ error: "Activity não encontrada" });
    if (row.type !== "Create") {
      return res.status(400).json({ error: "só posts (Create) podem ser editados" });
    }

    const schema = z
      .object({ content: z.string().optional(), attachmentUrl: z.string().url().optional() })
      .refine((d) => d.content !== undefined || d.attachmentUrl !== undefined, {
        message: "informe 'content' e/ou 'attachmentUrl'",
      });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const targetUri = row.uri ?? `${BASE_URL}/activities/${row.id}`;
    const newContent = parsed.data.content ?? row.content;
    const newAttachment = parsed.data.attachmentUrl ?? row.attachmentUrl;

    // Atualiza o post local.
    db.prepare(
      "UPDATE activity SET content = ?, attachmentUrl = ?, lamportClock = ? WHERE id = ?"
    ).run(newContent, newAttachment, nextLamport(db), row.id);

    // Federa o Update (e registra para catch-up).
    const wire = buildUpdate(db, actor, targetUri, row.objectType ?? "Note", newContent, newAttachment);
    recordLocalContent(db, wire);
    fanOutToFollowers(db, wire);

    res.json({ updated: targetUri });
  });

  // DELETE /users/:id/activities/:activityId — remove uma Activity local:
  //  - Like/Announce -> federa Undo (unlike/unboost);
  //  - Create        -> federa Delete (tombstone do post).
  router.delete("/users/:id/activities/:activityId", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const actor = actorUri(BASE_URL, person.id);
    const row = db
      .prepare("SELECT * FROM activity WHERE id = ? AND actorUri = ?")
      .get(req.params.activityId, actor) as ActivityRow | undefined;
    if (!row) return res.status(404).json({ error: "Activity não encontrada" });

    const targetUri = row.uri ?? `${BASE_URL}/activities/${row.id}`;

    if (row.type === "Like" || row.type === "Announce") {
      fanOutToFollowers(db, buildUndo(db, actor, { type: row.type, id: targetUri }));
      db.prepare("DELETE FROM activity WHERE id = ?").run(row.id);
      return res.json({ undone: targetUri, type: row.type });
    }

    if (row.type === "Create") {
      const wire = buildDelete(db, actor, targetUri);
      recordLocalContent(db, wire);
      fanOutToFollowers(db, wire);
      db.prepare("DELETE FROM activity WHERE id = ?").run(row.id);
      return res.json({ deleted: targetUri, type: row.type });
    }

    return res.status(400).json({ error: `tipo ${row.type} nao pode ser removido por aqui` });
  });

  // POST /users/:id/likes  e  POST /users/:id/announces — curte (Like) ou
  // compartilha (Announce) um objeto por URI (§3). O objeto alvo é a URI da
  // Activity/objeto; federa aos seguidores. O desfazer (Undo) vai por
  // DELETE /users/:id/activities/:activityId (unlike/unboost já implementado).
  const contentAction =
    (kind: "Like" | "Announce") =>
      (req: import("express").Request, res: import("express").Response) => {
        const person = db
          .prepare("SELECT * FROM person WHERE id = ?")
          .get(req.params.id) as PersonRow | undefined;
        if (!person) return res.status(404).json({ error: "Person não encontrado" });

        const schema = z.object({ object: z.string().url() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

        const actor = actorUri(BASE_URL, person.id);
        const target = parsed.data.object;
        const wire =
          kind === "Like" ? buildLike(db, actor, target) : buildAnnounce(db, actor, target);

        // Registra local (entra no feed dos seguidores + catch-up) e federa.
        // O `localId` e a chave para desfazer depois (DELETE /activities/:id).
        const localId = recordLocalContent(db, wire, JSON.stringify({ object: target }));
        fanOutToFollowers(db, wire);
        publishActivityToFollowers(db, config, actor, "feed:activity", wire.activity);

        return res
          .status(201)
          .json({ type: kind, actor, object: target, id: localId, uri: wire.activity.id });
      };

  router.post("/users/:id/likes", contentAction("Like"));
  router.post("/users/:id/announces", contentAction("Announce"));

  // DELETE /users/:id/followers — remove um seguidor (rejeita o Follow). Federa
  // um Reject para a inbox do seguidor, que então desfaz o follow do lado dele.
  router.delete("/users/:id/followers", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const schema = z.object({ actorUri: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const followeeUri = actorUri(BASE_URL, person.id);
    const followerUri = parsed.data.actorUri;

    const info = db
      .prepare("DELETE FROM follow WHERE followerActorUri = ? AND followeeActorUri = ?")
      .run(followerUri, followeeUri);

    if (!followerUri.startsWith(BASE_URL)) {
      sendReject(db, followeeUri, followerUri);
    }

    res.json({ rejected: followerUri, removed: info.changes });
  });

  // GET /catchup?since=N — anti-entropy: devolve os envelopes das Activities
  // autoradas por este peer (origin = baseUrl) com originSeq > since, para que
  // um peer que ficou para trás recupere o que perdeu (§6.10/§7.7).
  router.get("/catchup", (req, res) => {
    const since = Number(req.query.since ?? 0) || 0;
    res.json({ origin: BASE_URL, since, items: catchupSince(db, BASE_URL, since) });
  });

  // GET /users/:id/feed — linha do tempo: Activities dos atores que :id segue
  // (locais e remotas recebidas por federação), ordenadas pelo relógio lógico.
  router.get("/users/:id/feed", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare(
        `SELECT * FROM activity
           WHERE actorUri IN (SELECT followeeActorUri FROM follow WHERE followerActorUri = ?)
             AND type NOT IN ('Update','Delete')
           ORDER BY lamportClock ASC, published ASC`
      )
      .all(uri) as ActivityRow[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "OrderedCollection",
      totalItems: rows.length,
      orderedItems: rows.map((r) => activityToAS2(BASE_URL, r)),
    });
  });

  // GET /users/:id/mentions — Activities recebidas que mencionam este ator
  // (tag Mention com a URI dele), mesmo que não sejam de um ator seguido.
  router.get("/users/:id/mentions", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare(
        `SELECT * FROM activity WHERE type = 'Create' AND raw LIKE ? ORDER BY lamportClock ASC`
      )
      .all(`%"href":"${uri}"%`) as ActivityRow[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "OrderedCollection",
      totalItems: rows.length,
      orderedItems: rows.map((r) => activityToAS2(BASE_URL, r)),
    });
  });

  // GET /users/:id/following
  router.get("/users/:id/following", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare("SELECT followeeActorUri, status FROM follow WHERE followerActorUri = ? AND status = 'accepted'")
      .all(uri) as { followeeActorUri: string; status: string }[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Collection",
      totalItems: rows.length,
      items: rows.map((r) => r.followeeActorUri),
    });
  });

  // GET /users/:id/followers
  router.get("/users/:id/followers", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare("SELECT followerActorUri, status FROM follow WHERE followeeActorUri = ?")
      .all(uri) as { followerActorUri: string; status: string }[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Collection",
      totalItems: rows.length,
      items: rows.map((r) => ({ actorUri: r.followerActorUri, status: r.status })),
    });
  });

  // POST /users/:id/followers/:actorUri/accept — aceita uma solicitação de follow
  router.post("/users/:id/followers/:actorUri/accept", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const followeeUri = actorUri(BASE_URL, person.id);
    const followerUri = decodeURIComponent(req.params.actorUri);

    const result = db
      .prepare("UPDATE follow SET status = 'accepted' WHERE followerActorUri = ? AND followeeActorUri = ?")
      .run(followerUri, followeeUri);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Solicitação não encontrada" });
    }

    if (!followerUri.startsWith(BASE_URL)) {
      sendAccept(db, followeeUri, followerUri);
    }

    res.json({ status: "accepted", follower: followerUri });
  });

  return router;
}
