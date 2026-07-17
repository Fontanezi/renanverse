import { Router } from "express";
import type { Database } from "better-sqlite3";
import { buildJrd, parseAcctResource } from "../webfinger";
import type { PersonRow } from "../activitystreams";
import type { PlatformConfig } from "../types";

/**
 * GET /.well-known/webfinger?resource=acct:usuario@host — descoberta de ator
 * (RFC 7033). Torna os Persons deste peer localizáveis por outros peers a
 * partir do handle, sem conhecer o id interno. Compartilhado pelos 3 apps.
 */
export function createWebfingerRouter(db: Database, config: PlatformConfig): Router {
  const router = Router();

  router.get("/.well-known/webfinger", (req, res) => {
    const parsed = parseAcctResource(
      typeof req.query.resource === "string" ? req.query.resource : undefined
    );
    if (!parsed) {
      return res.status(400).json({ error: "parametro 'resource' invalido (use acct:usuario@host)" });
    }

    const person = db
      .prepare("SELECT * FROM person WHERE preferredUsername = ?")
      .get(parsed.username) as PersonRow | undefined;
    if (!person) {
      return res.status(404).json({ error: "ator nao encontrado neste peer" });
    }

    res.type("application/jrd+json").json(buildJrd(config.baseUrl, person));
  });

  return router;
}
