import { Router } from "express";

/**
 * POST /inbox — endpoint que outros peers vão chamar pra entregar Activities.
 * Fase 1: só recebe e loga. A lógica de causalidade, buffer de reordenação
 * e deduplicação por ID entra na Fase 2 (replicação entre peers).
 * Compartilhado pelos 3 apps sem alterações.
 */
export function createInboxRouter(): Router {
  const router = Router();

  router.post("/inbox", (req, res) => {
    console.log("[inbox] activity recebida (ainda não processada):", req.body?.type, req.body?.id);
    res.status(202).json({ status: "accepted (stub — processamento real na Fase 2)" });
  });

  return router;
}
