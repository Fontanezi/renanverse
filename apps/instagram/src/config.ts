import { z } from "zod";
import type { PlatformConfig } from "@renanverse/core";

/** Legenda (caption) do Instagram: limite generoso, como no produto real. */
export const CAPTION_MAX_CHARS = 2200;

/**
 * Regra de negócio do Instagram: postagem principal é sempre uma imagem;
 * respostas (inReplyTo) são texto puro (Note).
 * - objectType "Image": attachmentUrl OBRIGATÓRIO, content é a legenda.
 * - objectType "Note": apenas content (texto), sem attachmentUrl.
 * - inReplyTo opcional: quando presente, permite Note sem attachmentUrl.
 */
export const instagramActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.enum(["Image", "Note"]).default("Image"),
  content: z
    .string()
    .max(CAPTION_MAX_CHARS, `A legenda tem no máximo ${CAPTION_MAX_CHARS} caracteres`)
    .optional(),
  attachmentUrl: z.string().url("attachmentUrl deve ser uma URL de imagem válida").optional(),
  altText: z.string().max(1000, "O texto alternativo é muito longo").optional(),
  filter: z.string().optional(),
  inReplyTo: z.string().optional(),
})
  .superRefine((val, ctx) => {
    if (!val.inReplyTo && val.objectType === "Image" && !val.attachmentUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachmentUrl"],
        message: "Toda postagem do Instagram precisa de uma imagem (attachmentUrl)",
      });
    }
  })
  .transform(({ altText, filter, inReplyTo, ...rest }) => ({
    ...rest,
    meta: { ...(altText || filter ? { altText, filter } : {}), ...(inReplyTo ? { inReplyTo } : {}) },
  }));

export const instagramConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "instagram-peer-local",
  displayName: "Renanverse-Instagram",
  baseUrl: process.env.BASE_URL ?? "http://localhost:3002",
  dbPath: process.env.DATABASE_PATH ?? "./instagram.db",
  port: Number(process.env.PORT ?? 3002),
  createActivitySchema: instagramActivitySchema,
};
