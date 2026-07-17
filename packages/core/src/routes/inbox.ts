import { Router } from "express";
import type { Database } from "better-sqlite3";
import { processIncoming } from "../federation";
import { verifyRequest } from "../httpsig";
import type { PlatformConfig } from "../types";

/**
 * POST /users/:id/inbox — endpoint que outros peers chamam para entregar Activities.
 *
 * Antes de processar, verifica a assinatura HTTP (HTTP Signatures): busca a
 * chave pública do ator de origem e valida `(request-target) host date digest`
 * mais o Digest do corpo. Entregas sem assinatura válida são rejeitadas (401).
 *
 * Passando a verificação, delega a `processIncoming`:
 *  - Follow/Accept/Undo (federação de seguidores);
 *  - Create/Like/Announce com deduplicação por URI e buffer causal (hold-back).
 * Compartilhado pelos 3 apps sem alterações.
 */
export function createInboxRouter(db: Database, config: PlatformConfig): Router {
  const router = Router();

  router.post("/users/:id/inbox", async (req, res) => {
    const verification = await verifyRequest({
      method: req.method,
      path: req.originalUrl,
      headers: req.headers as Record<string, string | undefined>,
      rawBody: (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}),
    });

    if (!verification.ok) {
      console.warn(`[${config.peerId}] entrega rejeitada (assinatura): ${verification.reason}`);
      return res.status(401).json({ error: "assinatura invalida", detail: verification.reason });
    }

    const result = processIncoming(db, config, req.body);
    // 2xx quando aceito: entrega é at-least-once; duplicatas e buffer também são "aceitos".
    res.status(202).json({ status: result.status, detail: result.detail });
  });

  return router;
}
