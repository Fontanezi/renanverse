import express, { type Express } from "express";
import { createServer } from "http";
import { createDb } from "./db";
import { createUsersRouter } from "./routes/users";
import { createInboxRouter } from "./routes/inbox";
import { createWebfingerRouter } from "./routes/webfinger";
import { startFederation } from "./federation";
import { startRegistration } from "./registry";
import { initRealtime } from "./realtime";
import { ensureKeyPair } from "./httpsig";
import type { PlatformConfig } from "./types";

/** Monta o Express app de um peer a partir da config da plataforma. */
export function createApp(config: PlatformConfig): Express {
  const db = createDb(config.dbPath);
  ensureKeyPair(db); // gera o par RSA do peer na primeira execução

  const app = express();
  // Captura o corpo cru para validar o Digest das entregas assinadas.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      peer: config.peerId,
      platform: config.displayName,
      status: "ok",
      phase: "Fase 2 - federacao entre peers",
    });
  });

  app.use(createWebfingerRouter(db, config));
  app.use(createUsersRouter(db, config));
  app.use(createInboxRouter(db, config));

  // Rotas específicas da plataforma (ex.: /communities do Reddit), se houver.
  config.mountExtraRoutes?.(app, db);

  // Dispatcher de entregas + sweeper do buffer causal (loop de fundo do peer).
  startFederation(db, config);

  // Registro periódico no(s) super peer(s) para descoberta (se configurados).
  startRegistration(db, config);

  return app;
}

/** Sobe o servidor HTTP na porta da config. Usado pelo index.ts de cada app. */
export function startApp(config: PlatformConfig): void {
  const app = createApp(config);
  // Socket.io precisa do http.Server "cru" (não do app Express direto), então
  // criamos o servidor explicitamente e acoplamos o pub/sub a ele.
  const httpServer = createServer(app);
  initRealtime(httpServer, config);
  httpServer.listen(config.port, () => {
    console.log(`[${config.displayName}] peer "${config.peerId}" rodando em ${config.baseUrl} (porta ${config.port})`);
  });
}
