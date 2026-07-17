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
  catchupSince,
} from "../federation";
import { resolveHandleToActorUri } from "../webfinger";
import { publicKeyPem } from "../httpsig";
import type { PlatformConfig } from "../types";

const createPersonSchema = z.object({
  preferredUsername: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().optional(),
  icon: z.string().url().optional(),
});

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
      .prepare("SELECT * FROM activity WHERE actorUri = ? ORDER BY published DESC")
      .all(uri) as ActivityRow[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "OrderedCollection",
      totalItems: rows.length,
      orderedItems: rows.map((r) => activityToAS2(BASE_URL, r)),
    });
  });

  // POST /users/:id/outbox — cria um post local (Fase 1: sem replicação ainda)
  router.post("/users/:id/outbox", (req, res) => {
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
      followeeUri = await resolveHandleToActorUri(parsed.data.handle);
      if (!followeeUri) {
        return res
          .status(404)
          .json({ error: `nao foi possivel resolver o handle '${parsed.data.handle}' via WebFinger` });
      }
    }
    if (!followeeUri) {
      return res.status(400).json({ error: "ator a seguir nao determinado" });
    }

    try {
      db.prepare(
        `INSERT INTO follow (id, followerActorUri, followeeActorUri, createdAt)
         VALUES (?, ?, ?, ?)`
      ).run(ulid(), followerUri, followeeUri, new Date().toISOString());
    } catch {
      return res.status(409).json({ error: "já segue esse ator" });
    }

    // Se o ator seguido mora em outro peer, avisa esse peer via Follow federado,
    // para que ele passe a nos entregar as postagens do ator (fan-out remoto).
    if (!followeeUri.startsWith(BASE_URL)) {
      sendFollow(db, followerUri, followeeUri);
    }

    res.status(201).json({ follower: followerUri, followee: followeeUri });
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
      followeeUri = await resolveHandleToActorUri(parsed.data.handle);
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

  // DELETE /users/:id/activities/:activityId — desfaz um Like/Announce local
  // (unlike/unboost). Federa Undo aos seguidores e remove a Activity localmente.
  // Desfazer um post (Create) não entra aqui: isso seria uma Activity Delete.
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
    if (row.type !== "Like" && row.type !== "Announce") {
      return res
        .status(400)
        .json({ error: "só é possível desfazer Like ou Announce (posts usariam Delete)" });
    }

    const targetUri = row.uri ?? `${BASE_URL}/activities/${row.id}`;
    const undo = buildUndo(db, actor, { type: row.type, id: targetUri });
    fanOutToFollowers(db, undo);
    db.prepare("DELETE FROM activity WHERE id = ?").run(row.id);

    res.json({ undone: targetUri, type: row.type });
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

  // GET /users/:id/following
  router.get("/users/:id/following", (req, res) => {
    const person = db
      .prepare("SELECT * FROM person WHERE id = ?")
      .get(req.params.id) as PersonRow | undefined;
    if (!person) return res.status(404).json({ error: "Person não encontrado" });

    const uri = actorUri(BASE_URL, person.id);
    const rows = db
      .prepare("SELECT followeeActorUri FROM follow WHERE followerActorUri = ?")
      .all(uri) as { followeeActorUri: string }[];

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
      .prepare("SELECT followerActorUri FROM follow WHERE followeeActorUri = ?")
      .all(uri) as { followerActorUri: string }[];

    res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Collection",
      totalItems: rows.length,
      items: rows.map((r) => r.followerActorUri),
    });
  });

  return router;
}
