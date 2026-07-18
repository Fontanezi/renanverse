import { z } from "zod";
import { activityToAS2, type ActivityRow, type PlatformConfig } from "@renanverse/core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3003";

/**
 * Regra de negócio do Reddit: post orientado a título, dentro de uma comunidade.
 * - objectType "Link" (post que aponta para uma URL) ou "Page" (self post de texto).
 * - title é OBRIGATÓRIO (diferente de tweet/legenda).
 * - content é o corpo do texto, opcional (faz sentido em "Page").
 * - attachmentUrl é obrigatório QUANDO objectType === "Link" (validado no
 *   superRefine abaixo) e opcional em "Page".
 * - community (subreddit) não existe no schema genérico do núcleo; guardamos em
 *   meta.community. A listagem por comunidade é exposta por mountExtraRoutes.
 */
export const redditActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.enum(["Link", "Page"]).default("Page"),
  title: z.string().max(300, "Título muito longo (máx. 300)").optional(),
  content: z.string().optional(),
  attachmentUrl: z.string().url("attachmentUrl deve ser uma URL válida").optional(),
  community: z.string().min(1).default("geral"),
  inReplyTo: z.string().optional(),
})
  .superRefine((val, ctx) => {
    if (val.objectType === "Link" && !val.attachmentUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachmentUrl"],
        message: "Posts do tipo Link exigem attachmentUrl (a URL de destino)",
      });
    }
  })
  .transform(({ title, community, inReplyTo, content, ...rest }) => ({
    ...rest,
    content,
    meta: { title: title ?? (content ? content.slice(0, 300) : "Resposta"), community, ...(inReplyTo ? { inReplyTo } : {}) },
  }));

export const redditConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "reddit-peer-local",
  displayName: "Renanverse-Reddit",
  baseUrl: BASE_URL,
  dbPath: process.env.DATABASE_PATH ?? "./reddit.db",
  port: Number(process.env.PORT ?? 3003),
  createActivitySchema: redditActivitySchema,
  /**
   * Endpoint específico do Reddit: lista as Activities de uma comunidade.
   * A comunidade fica em meta.community (JSON), então filtramos com o operador
   * json_extract do SQLite. Não polui o núcleo nem os outros dois apps.
   */
  mountExtraRoutes: (app, db) => {
    app.get("/communities/:name/outbox", (req, res) => {
      const rows = db
        .prepare(
          "SELECT * FROM activity WHERE json_extract(meta, '$.community') = ? ORDER BY published DESC"
        )
        .all(req.params.name) as ActivityRow[];

      res.json({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "OrderedCollection",
        name: req.params.name,
        totalItems: rows.length,
        orderedItems: rows.map((r) => {
          let actorName: string | undefined;
          if (r.authorId) {
            const p = db.prepare("SELECT preferredUsername FROM person WHERE id = ?").get(r.authorId) as { preferredUsername: string } | undefined;
            actorName = p?.preferredUsername;
          }
          if (!actorName) {
            try {
              const wire = JSON.parse(r.raw) as { activity?: { actorName?: string } };
              if (wire?.activity?.actorName) actorName = wire.activity.actorName;
            } catch {}
          }
          return activityToAS2(BASE_URL, r, undefined, actorName);
        }),
      });
    });
  },
};
