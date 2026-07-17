import Database from "better-sqlite3";

/**
 * Cria (ou abre) o banco SQLite de um peer e garante o schema base.
 * Esse schema é o mesmo para os 3 apps (Twitter, Instagram, Reddit) —
 * o que muda entre eles é a validação na camada de rotas (routes/users.ts)
 * e o conteúdo do campo `meta` (JSON livre para dados específicos da
 * plataforma, ex: título de post no Reddit, community/subreddit, etc).
 *
 * actorUri sempre guarda a URI COMPLETA (ex: http://localhost:3001/users/abc123),
 * nunca um ID local puro. Isso é o que permite, na Fase 3, um Follow ou uma
 * Activity apontarem pra um ator que mora em outro peer sem mudar o schema.
 */
export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS person (
      id                 TEXT PRIMARY KEY,
      preferredUsername  TEXT UNIQUE NOT NULL,
      name               TEXT NOT NULL,
      summary            TEXT,
      icon               TEXT,
      createdAt          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follow (
      id                TEXT PRIMARY KEY,
      followerActorUri  TEXT NOT NULL,
      followeeActorUri  TEXT NOT NULL,
      createdAt         TEXT NOT NULL,
      UNIQUE(followerActorUri, followeeActorUri)
    );
    CREATE INDEX IF NOT EXISTS idx_follow_followee ON follow(followeeActorUri);
    CREATE INDEX IF NOT EXISTS idx_follow_follower ON follow(followerActorUri);

    CREATE TABLE IF NOT EXISTS activity (
      id             TEXT PRIMARY KEY,
      uri            TEXT,
      type           TEXT NOT NULL,
      actorUri       TEXT NOT NULL,
      objectType     TEXT,
      content        TEXT,
      attachmentUrl  TEXT,
      meta           TEXT,
      inReplyTo      TEXT,
      lamportClock   INTEGER NOT NULL DEFAULT 0,
      isLocal        INTEGER NOT NULL DEFAULT 1,
      published      TEXT NOT NULL,
      raw            TEXT NOT NULL,
      authorId       TEXT REFERENCES person(id)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity(actorUri);
    CREATE INDEX IF NOT EXISTS idx_activity_published ON activity(published);
    -- URI canônica global da Activity (AS2 "id"). Usada para deduplicação na
    -- federação. NULLs são distintos no SQLite, então índice único convive com
    -- linhas antigas sem uri preenchida.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_uri ON activity(uri);

    -- Chave/valor interno do peer (ex.: relógio lógico de Lamport).
    CREATE TABLE IF NOT EXISTS kv (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    -- Outbox DURÁVEL de entrega federada (servidor -> servidor). Cada linha é
    -- uma tentativa de POST na inbox de outro peer. Sobrevive a reinício do
    -- processo (padrão transactional outbox): o dispatcher relê PENDING e
    -- retoma as entregas. Garante at-least-once.
    CREATE TABLE IF NOT EXISTS delivery (
      id             TEXT PRIMARY KEY,
      targetInbox    TEXT NOT NULL,
      activityUri    TEXT NOT NULL,
      payload        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'PENDING',
      attempts       INTEGER NOT NULL DEFAULT 0,
      lastError      TEXT,
      nextAttemptAt  TEXT NOT NULL,
      createdAt      TEXT NOT NULL,
      UNIQUE(targetInbox, activityUri)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_pending ON delivery(status, nextAttemptAt);

    -- Buffer causal (hold-back queue): Activities recebidas cuja dependência
    -- (inReplyTo) ainda não chegou ficam aqui até a dependência ser aplicada.
    CREATE TABLE IF NOT EXISTS inbox_buffer (
      id           TEXT PRIMARY KEY,
      activityUri  TEXT NOT NULL UNIQUE,
      dependsOn    TEXT NOT NULL,
      payload      TEXT NOT NULL,
      receivedAt   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_buffer_depends ON inbox_buffer(dependsOn);
  `);

  migrateActivityColumns(db);

  return db;
}

/**
 * Migração defensiva: bancos criados na Fase 1 não têm as colunas de federação.
 * Adiciona-as se faltarem (ALTER TABLE ADD COLUMN é no-op seguro quando a coluna
 * já existe, mas o SQLite não tem "IF NOT EXISTS" para coluna, então checamos).
 */
function migrateActivityColumns(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(activity)").all() as { name: string }[]).map((c) => c.name)
  );
  const add = (name: string, ddl: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE activity ADD COLUMN ${ddl}`);
  };
  add("uri", "uri TEXT");
  add("inReplyTo", "inReplyTo TEXT");
  add("isLocal", "isLocal INTEGER NOT NULL DEFAULT 1");
}
