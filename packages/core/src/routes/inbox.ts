import { Router } from "express";
import type { Database } from "better-sqlite3";
import { processIncoming } from "../federation";
import type { PlatformConfig } from "../types";

/**
 * POST /users/:id/inbox — endpoint que outros peers chamam para entregar Activities.
 * Fase 2: processamento real, delegado a `processIncoming`:
 *  - Follow/Accept (federação de seguidores entre peers);
 *  - Create/Like/Announce com deduplicação por URI e buffer causal (hold-back)
 *    para o que chega antes da dependência (inReplyTo).
 * Compartilhado pelos 3 apps sem alterações.
 */
export function createInboxRouter(db: Database, config: PlatformConfig): Router {
  const router = Router();

  // Inbox por ator (convenção ActivityPub e o que personToAS2 anuncia). O :id
  // não é usado no processamento — o destino real é inferido da própria
  // Activity (object no Follow, seguidores no Create) —, mas manter a rota
  // por ator alinha a URL entregue com a URL que os peers descobrem.
  router.post("/users/:id/inbox", (req, res) => {
    const result = processIncoming(db, config, req.body);
    // Sempre 2xx quando o corpo é aceito: a entrega é at-least-once e o emissor
    // só precisa do ACK. Duplicatas e itens em buffer também são "aceitos".
    res.status(202).json({ status: result.status, detail: result.detail });
  });

  return router;
}
