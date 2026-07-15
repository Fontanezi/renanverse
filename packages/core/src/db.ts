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
      type           TEXT NOT NULL,
      actorUri       TEXT NOT NULL,
      objectType     TEXT,
      content        TEXT,
      attachmentUrl  TEXT,
      meta           TEXT,
      lamportClock   INTEGER NOT NULL DEFAULT 0,
      published      TEXT NOT NULL,
      raw            TEXT NOT NULL,
      authorId       TEXT REFERENCES person(id)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity(actorUri);
    CREATE INDEX IF NOT EXISTS idx_activity_published ON activity(published);
  `);

  return db;
}
