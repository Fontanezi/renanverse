import express, { type Express } from "express";
import { createDb } from "./db";
import { createUsersRouter } from "./routes/users";
import { createInboxRouter } from "./routes/inbox";
import type { PlatformConfig } from "./types";

/** Monta o Express app de um peer a partir da config da plataforma. */
export function createApp(config: PlatformConfig): Express {
  const db = createDb(config.dbPath);
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      peer: config.peerId,
      platform: config.displayName,
      status: "ok",
      phase: "Fase 1 — peer único, sem federação",
    });
  });

  app.use(createUsersRouter(db, config));
  app.use(createInboxRouter());

  // Rotas específicas da plataforma (ex.: /communities do Reddit), se houver.
  config.mountExtraRoutes?.(app, db);

  return app;
}

/** Sobe o servidor HTTP na porta da config. Usado pelo index.ts de cada app. */
export function startApp(config: PlatformConfig): void {
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`[${config.displayName}] peer "${config.peerId}" rodando em ${config.baseUrl} (porta ${config.port})`);
  });
}
